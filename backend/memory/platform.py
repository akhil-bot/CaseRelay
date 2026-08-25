"""GEAP Memory Bank integration via VertexAiMemoryBankService.

Activated by setting CASERELAY_MEMORY_BANK_ID to the Agent Engine resource ID that
hosts the Memory Bank instance. When unset, all functions are no-ops and the existing
Firestore-backed memory in bank.py continues to serve.

Scope strategy: CaseRelay has no end-user authentication. Memory Bank's scope is keyed
by {app_name, user_id}. We map case_id → user_id so memories are isolated per case.
This is legitimate: the docs define user_id as "an opaque identifier" for scoping, and
cases ARE the entities that accumulate long-term knowledge in our domain.
"""

from __future__ import annotations

import asyncio
import logging
import os

logger = logging.getLogger(__name__)

APP_NAME = "caserelay"


def _memory_bank_id() -> str | None:
    return os.environ.get("CASERELAY_MEMORY_BANK_ID", "").strip() or None


def _project() -> str:
    return os.environ.get("GOOGLE_CLOUD_PROJECT", "caserelay")


def _location() -> str:
    """Memory Bank region — distinct from GOOGLE_CLOUD_LOCATION (which is 'global' for models)."""
    return os.environ.get("CASERELAY_MEMORY_BANK_LOCATION", "us-central1")


def enabled() -> bool:
    return _memory_bank_id() is not None


_service_instance = None


def get_service():
    """Lazily construct the VertexAiMemoryBankService singleton."""
    global _service_instance
    if _service_instance is not None:
        return _service_instance
    if not enabled():
        return None
    from google.adk.memory import VertexAiMemoryBankService

    _service_instance = VertexAiMemoryBankService(
        project=_project(),
        location=_location(),
        agent_engine_id=_memory_bank_id(),
    )
    return _service_instance


async def search(case_id: str, query: str) -> list[str]:
    """Retrieve relevant memories for a case via semantic similarity search."""
    svc = get_service()
    if svc is None:
        return []
    try:
        response = await svc.search_memory(
            app_name=APP_NAME,
            user_id=case_id,
            query=query,
        )
        return [
            part.text
            for entry in (response.memories or [])
            for part in (entry.content.parts or [])
            if getattr(part, "text", None)
        ]
    except Exception:
        logger.exception("Memory Bank search failed for case %s", case_id)
        return []


def search_sync(case_id: str, query: str) -> list[str]:
    """Synchronous wrapper for use in tool functions."""
    if not enabled():
        return []
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(asyncio.run, search(case_id, query)).result(timeout=15)
    return asyncio.run(search(case_id, query))


async def write_memory(case_id: str, fact: str) -> None:
    """Write an explicit coordination fact to Memory Bank (immediately retrievable).

    This is the demo-reliable path: memories.create produces an immediately-indexed
    fact. Used alongside commit_session_events which feeds the async extraction pipeline.
    """
    svc = get_service()
    if svc is None:
        return
    try:
        from google.adk.memory.memory_entry import MemoryEntry
        from google.genai import types as _types

        await svc.add_memory(
            app_name=APP_NAME,
            user_id=case_id,
            memories=[MemoryEntry(content=_types.Content(parts=[_types.Part(text=fact)]))],
        )
        logger.info("Wrote explicit memory for case %s: %s", case_id, fact[:80])
    except Exception:
        logger.exception("Failed to write explicit memory for case %s", case_id)


_EXTRACTION_TOPICS = [
    {"custom_memory_topic_label": "partner_contacts"},
    {"custom_memory_topic_label": "institutional_shortcuts"},
    {"custom_memory_topic_label": "unblocking_strategies"},
]


async def commit_session_events(session) -> None:
    """Extract coordination knowledge from session events synchronously.

    Uses memories.generate (wait_for_completion=True) rather than ingestEvents, because
    the async pipeline's idle-duration trigger never fires within compressed demo timing.
    allowed_topics restricts extraction to our custom topics (partner contacts, institutional
    shortcuts, unblocking strategies) rather than the default KEY_CONVERSATION_DETAILS which
    produces status roll-ups duplicating Firestore state.
    """
    svc = get_service()
    if svc is None:
        return
    try:
        await svc.add_events_to_memory(
            app_name=getattr(session, "app_name", APP_NAME),
            user_id=getattr(session, "user_id", "unknown"),
            events=getattr(session, "events", []),
            custom_metadata={
                "wait_for_completion": True,
                "allowed_topics": _EXTRACTION_TOPICS,
            },
        )
        logger.info(
            "Extracted memories from session (case scope: %s)",
            getattr(session, "user_id", "?"),
        )
    except Exception:
        logger.exception("Failed to extract memories from session")
