"""GEAP Memory Bank integration via direct API calls.

Activated by setting CASERELAY_MEMORY_BANK_ID to the Agent Engine resource ID that
hosts the Memory Bank instance. When unset, all functions are no-ops and the existing
Firestore-backed memory in bank.py continues to serve.

Scope strategy: CaseRelay has no end-user authentication. Memory Bank's scope is keyed
by {app_name, user_id}. We map case_id → user_id so memories are isolated per case.
This is legitimate: the docs define user_id as "an opaque identifier" for scoping, and
cases ARE the entities that accumulate long-term knowledge in our domain.

Retrieval strategy: Uses scope-only retrieval (not similarity search). Similarity search
requires a vector index that may have cold-start latency on new instances. Scope-only
retrieval returns all memories for a case immediately after creation — reliable for a
demo with a bounded number of facts per case.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

APP_NAME = "caserelay"


def _memory_bank_id() -> str | None:
    return os.environ.get("CASERELAY_MEMORY_BANK_ID", "").strip() or None


def _project_number() -> str:
    """Project number for API URLs. Falls back to project ID which also works."""
    return os.environ.get(
        "CASERELAY_PROJECT_NUMBER",
        os.environ.get("GOOGLE_CLOUD_PROJECT", "caserelay"),
    )


def _location() -> str:
    return os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1")


def enabled() -> bool:
    return _memory_bank_id() is not None


def _api_base() -> str:
    loc = _location()
    pn = _project_number()
    bank_id = _memory_bank_id()
    return (
        f"https://{loc}-aiplatform.googleapis.com/v1beta1/"
        f"projects/{pn}/locations/{loc}/reasoningEngines/{bank_id}"
    )


def _get_token() -> str:
    """Get an access token from application default credentials."""
    import google.auth
    import google.auth.transport.requests

    creds, _ = google.auth.default(
        scopes=["https://www.googleapis.com/auth/cloud-platform"]
    )
    creds.refresh(google.auth.transport.requests.Request())
    return creds.token


def _post(path: str, body: dict[str, Any]) -> dict[str, Any]:
    """Make authenticated POST to Memory Bank API."""
    import urllib.request

    url = f"{_api_base()}{path}"
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {_get_token()}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def _get(path: str) -> dict[str, Any]:
    """Make authenticated GET to Memory Bank API."""
    import urllib.request

    url = f"{_api_base()}{path}"
    req = urllib.request.Request(
        url, headers={"Authorization": f"Bearer {_get_token()}"}
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def _get_service():
    """Lazily construct the VertexAiMemoryBankService singleton (for session commit only)."""
    from google.adk.memory import VertexAiMemoryBankService

    bank_id = _memory_bank_id()
    if not bank_id:
        raise RuntimeError("CASERELAY_MEMORY_BANK_ID not set")
    project = os.environ.get("GOOGLE_CLOUD_PROJECT", "caserelay")
    return VertexAiMemoryBankService(
        project=project,
        location=_location(),
        agent_engine_id=bank_id,
    )


_service_instance = None


def get_service():
    global _service_instance
    if _service_instance is None and enabled():
        _service_instance = _get_service()
    return _service_instance


def retrieve_all(case_id: str) -> list[str]:
    """Retrieve ALL memories for a case via scope-only retrieval (no similarity search).

    This bypasses the vector index entirely — returns every memory stored for the
    case scope. Reliable with zero cold-start delay. Suitable for demos with bounded
    facts per case.
    """
    if not enabled():
        return []
    try:
        result = _post("/memories:retrieve", {
            "scope": {"app_name": APP_NAME, "user_id": case_id},
        })
        facts = []
        for entry in result.get("retrievedMemories", []):
            fact = entry.get("memory", {}).get("fact", "")
            if fact:
                facts.append(fact)
        return facts
    except Exception:
        logger.exception("Memory Bank retrieve failed for case %s", case_id)
        return []


def search_sync(case_id: str, query: str) -> list[str]:
    """Retrieve memories for a case. Uses scope-only retrieval for reliability."""
    return retrieve_all(case_id)


async def commit_session_events(session) -> None:
    """Commit a completed session's events to Memory Bank for memory extraction.

    Uses the ADK's VertexAiMemoryBankService.add_session_to_memory which triggers
    the GenerateMemories LLM pipeline. Extraction is asynchronous — facts become
    retrievable within seconds of operation completion.
    """
    svc = get_service()
    if svc is None:
        return
    try:
        await svc.add_session_to_memory(session)
        logger.info(
            "Committed session %s to Memory Bank (case scope: %s)",
            getattr(session, "id", "?"),
            getattr(session, "user_id", "?"),
        )
    except Exception:
        logger.exception("Failed to commit session to Memory Bank")
