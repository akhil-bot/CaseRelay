"""MCP client for partner calls with automatic fallback to in-process sim.py.

Routing is controlled by the CASERELAY_PARTNER_MCP env var:
  - Unset or empty or "0" → in-process calls via sim.py (default, proven path)
  - "1" or a URL → MCP path (URL auto-detected from CASERELAY_PARTNER_MCP_URL)

The fallback ensures the demo can always run even if MCP deployment isn't ready.
"""

from __future__ import annotations

import logging
import os
from typing import Any

_log = logging.getLogger(__name__)


def _mcp_enabled() -> bool:
    val = os.environ.get("CASERELAY_PARTNER_MCP", "")
    return val not in ("", "0", "false", "False")


def _mcp_url() -> str:
    url = os.environ.get("CASERELAY_PARTNER_MCP_URL", "")
    if url:
        return url
    val = os.environ.get("CASERELAY_PARTNER_MCP", "")
    if val.startswith("http"):
        return val
    return "http://localhost:8090"


async def _call_tool(tool_name: str, arguments: dict[str, Any]) -> Any:
    """Call a tool on the partner MCP server via Streamable HTTP transport."""
    from mcp.client.session import ClientSession
    from mcp.client.streamable_http import streamable_http_client

    url = f"{_mcp_url()}/mcp"
    async with streamable_http_client(url) as (read, write):
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
