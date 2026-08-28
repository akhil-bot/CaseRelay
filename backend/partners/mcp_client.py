"""MCP client for partner calls with automatic fallback to in-process sim.py.

Routing is controlled by the CASERELAY_PARTNER_MCP env var:
  - Unset or empty or "0" → in-process calls via sim.py (default, proven path)
  - "1" or a URL → MCP path (URL auto-detected from CASERELAY_PARTNER_MCP_URL)

The fallback ensures the demo can always run even if MCP deployment isn't ready.

The deployed MCP server is a private Cloud Run service, so every call on the MCP path
carries a Google-signed ID token minted for the configured server URL.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from typing import Any

_log = logging.getLogger(__name__)

# Re-mint an ID token this long before it actually expires, so a token taken from the
# cache at the last moment is still valid by the time Cloud Run validates it.
_TOKEN_REFRESH_SKEW_SECONDS = 300

# Tokens are cached per audience. Partner calls fan out across a ThreadPoolExecutor,
# so the cache needs a lock to avoid every concurrent specialist minting its own.
_token_lock = threading.Lock()
_token_cache: dict[str, tuple[str, float]] = {}


def _mcp_enabled() -> bool:
    val = os.environ.get("CASERELAY_PARTNER_MCP", "")
    return val not in ("", "0", "false", "False")


def _mcp_url() -> str:
    url = os.environ.get("CASERELAY_PARTNER_MCP_URL", "")
    if url:
        return url.rstrip("/")
    val = os.environ.get("CASERELAY_PARTNER_MCP", "")
    if val.startswith("http"):
        return val.rstrip("/")
    return "http://localhost:8090"


def _id_token(audience: str) -> str:
    """Mint a Google-signed ID token for `audience`, reusing the cached one until it ages out.

    The token comes from the ambient credential: engines run under a platform-managed
    identity with no service account key, so fetch_id_token resolves it via the metadata
    server. Nothing else works in that environment.

    The audience must be the partner server origin the caller actually dials. Cloud Run
    gives every service two hostnames — `<service>-<project-number>.<region>.run.app` and
    `<service>-<hash>-<region>.a.run.app` — and rejects a token minted for whichever one
    was not used, so the audience is derived from the configured URL rather than fixed here.
    """
    now = time.time()
    with _token_lock:
        cached = _token_cache.get(audience)
        if cached is not None and now < cached[1] - _TOKEN_REFRESH_SKEW_SECONDS:
            return cached[0]

    import google.auth.transport.requests
    from google.oauth2 import id_token

    token = id_token.fetch_id_token(google.auth.transport.requests.Request(), audience)

    expiry = now + 3600.0
    try:
        from google.auth import jwt

        expiry = float(jwt.decode(token, verify=False)["exp"])
    except Exception as exc:
        _log.debug("partner ID token carried no readable exp, assuming 1h: %s", exc)

    with _token_lock:
        _token_cache[audience] = (token, expiry)
    return token


def _auth_headers(base_url: str) -> dict[str, str]:
    """Build the Authorization header for the partner MCP server.

    A plain-HTTP base URL is a developer running `mcp_server --http` on localhost: there is
    no IAM in front of it and no metadata server to mint against, so it gets no header.
    Anything on HTTPS is the deployed Cloud Run service, which is private — if a token
    cannot be minted, raise rather than send an unauthenticated request that would come
    back as an opaque `403 Empty Authorization header value`.
    """
    if not base_url.startswith("https://"):
        return {}
    try:
        return {"Authorization": f"Bearer {_id_token(base_url)}"}
    except Exception as exc:
        raise RuntimeError(
            f"could not mint an ID token for the partner MCP server at {base_url}: {exc}. "
            "The service is private and requires roles/run.invoker for the caller's identity. "
            "Set CASERELAY_PARTNER_MCP=0 to fall back to the in-process sim."
        ) from exc


async def _call_tool(tool_name: str, arguments: dict[str, Any]) -> Any:
    """Call a tool on the partner MCP server via Streamable HTTP transport."""
    import httpx2
    from mcp.client.session import ClientSession
    from mcp.client.streamable_http import streamable_http_client

    base_url = _mcp_url()
    # The transport takes credentials only via a caller-supplied client, and it does not
    # close one it did not create — hence the explicit context manager here.
    async with httpx2.AsyncClient(
        headers=_auth_headers(base_url),
        timeout=httpx2.Timeout(30.0, read=300.0),
        follow_redirects=True,
    ) as http_client:
        async with streamable_http_client(f"{base_url}/mcp", http_client=http_client) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = await session.call_tool(tool_name, arguments)
                if result.is_error:
                    raise RuntimeError(f"MCP tool {tool_name} error: {result.content}")
                import json
                for block in result.content:
                    if hasattr(block, "text"):
                        return json.loads(block.text)
                return {}


def _call_tool_sync(tool_name: str, arguments: dict[str, Any]) -> Any:
    """Synchronous wrapper around the async MCP call."""
    import asyncio

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor(1) as pool:
            future = pool.submit(asyncio.run, _call_tool(tool_name, arguments))
            return future.result(timeout=30)
    else:
        return asyncio.run(_call_tool(tool_name, arguments))


def school_status(referral_id: str, case_id: str | None = None) -> dict:
    if not _mcp_enabled():
        from backend.partners import sim
        return sim.school_status(referral_id, case_id=case_id)
    return _call_tool_sync("school_status", {"referral_id": referral_id, "case_id": case_id or ""})


def school_callback(referral_id: str, case_id: str | None = None) -> dict:
    if not _mcp_enabled():
        from backend.partners import sim
        return sim.school_callback(referral_id, case_id=case_id)
    return _call_tool_sync("school_callback", {"referral_id": referral_id, "case_id": case_id or ""})


def clinic_status(referral_id: str, case_id: str | None = None) -> dict:
    if not _mcp_enabled():
        from backend.partners import sim
        return sim.clinic_status(referral_id, case_id=case_id)
    return _call_tool_sync("clinic_status", {"referral_id": referral_id, "case_id": case_id or ""})


def legal_status(referral_id: str, case_id: str | None = None) -> dict:
    if not _mcp_enabled():
        from backend.partners import sim
        return sim.legal_status(referral_id, case_id=case_id)
    return _call_tool_sync("legal_status", {"referral_id": referral_id, "case_id": case_id or ""})


def shelter_status(referral_id: str, case_id: str | None = None) -> dict:
    if not _mcp_enabled():
        from backend.partners import sim
        return sim.shelter_status(referral_id, case_id=case_id)
    return _call_tool_sync("shelter_status", {"referral_id": referral_id, "case_id": case_id or ""})


def family_status(referral_id: str, case_id: str | None = None) -> dict:
    if not _mcp_enabled():
        from backend.partners import sim
        return sim.family_status(referral_id, case_id=case_id)
    return _call_tool_sync("family_status", {"referral_id": referral_id, "case_id": case_id or ""})


def followup(service: str, referral_id: str, case_id: str | None = None) -> dict:
    if not _mcp_enabled():
        from backend.partners import sim
        return sim.followup(service, referral_id, case_id=case_id)
    return _call_tool_sync("followup", {"service": service, "referral_id": referral_id, "case_id": case_id or ""})
