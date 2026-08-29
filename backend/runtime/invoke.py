"""Runs one agent turn and keeps the ADK session that turn produced.

Sessions live on Agent Platform Sessions, hosted by the Agent Engine named by
CASERELAY_RUN_SESSION_ENGINE_ID, so the transcript of every phase of every case run
outlives the Cloud Run instance that produced it.

Each invocation gets its own session rather than sharing one per run. Sharing would give
the fleet conversational continuity, but the fan-out dispatches five phases concurrently
and Google documents row-level locking only for DatabaseSessionService — there is no
equivalent guarantee for the Vertex one. Continuity across phases already comes from
Memory Bank, so there is nothing to buy back by taking the concurrency risk.
"""

import asyncio
import contextvars
import logging
import os
import random
import re
import threading
import time
from dataclasses import dataclass, field
from uuid import uuid4

from google.adk.runners import Runner
from google.adk.sessions import BaseSessionService, InMemorySessionService, VertexAiSessionService
from google.genai import types

from backend.memory.platform import APP_NAME as _MB_APP, commit_session_events, enabled as memory_bank_enabled
from backend.runtime.trace import tracer

logger = logging.getLogger("caserelay.invoke")

_run_buffers: dict[str, list] = {}
_run_buffers_lock = threading.Lock()

_APPEND_ATTEMPTS = 3
_APPEND_BACKOFF_SECONDS = 1.0
_RETRYABLE_CODES = frozenset({429, 500, 502, 503, 504})

_ID_UNSAFE = re.compile(r"[^a-z0-9-]+")


@dataclass
class _Turn:
    """What one invocation's session did, collected as it happens.

    Holding the appended events here rather than re-reading the session afterwards keeps
    Memory Bank extraction working on the full turn even when an append failed to reach
    the platform, and saves a network read per phase.
    """

    events: list = field(default_factory=list)
    append_seconds: float = 0.0
    appends: int = 0
    dropped: int = 0


_turn: contextvars.ContextVar[_Turn | None] = contextvars.ContextVar("caserelay_turn", default=None)


def _retryable(exc: Exception) -> bool:
    """True for throttling and transient server faults, false for our own bad requests.

    A 429 here is the project-wide 300-appends-per-minute session quota, which a five-way
    fan-out can reach on its own. Everything else in the 4xx range means the request was
    wrong — a malformed session id, a missing engine — and must stay loud.
    """
    code = getattr(exc, "code", None)
    if code in _RETRYABLE_CODES:
        return True
    return code is None and "RESOURCE_EXHAUSTED" in str(exc)


class _Recording:
    """Mixin that keeps this invocation's events and what they cost to store.

    Mixed into whichever store is in use so Memory Bank extraction reads the same events
    either way, and so an event that never reached the platform is still extracted from.
    """

    async def append_event(self, session, event):
        turn = _turn.get()
        started = time.monotonic()
        try:
            return await super().append_event(session=session, event=event)
        finally:
            if turn is not None:
                turn.append_seconds += time.monotonic() - started
                turn.appends += 1
                if not event.partial:
                    turn.events.append(event)


class _ResilientSessions(VertexAiSessionService):
    """Agent Platform Sessions that lose durability rather than lose a case.

    A throttled append is retried with jittered backoff. If it still will not land, the
    event is kept in the in-memory session the model reads from and in the turn record
    Memory Bank extracts from, and the loss of the durable copy is logged and traced. The
    run therefore continues on complete history and nothing is dropped quietly; what is
    given up is the platform's copy of that one event.
    """

    async def append_event(self, session, event):
        # Every attempt re-runs the base class's in-memory append, so the copy left by a
        # failed attempt is removed before retrying — otherwise a retried event shows up
        # twice in the history the next model call reads.
        mark = len(session.events)
        for attempt in range(_APPEND_ATTEMPTS):
            try:
                return await super().append_event(session=session, event=event)
            except Exception as exc:  # noqa: BLE001
                if not _retryable(exc):
                    raise
                del session.events[mark:]
                last = attempt == _APPEND_ATTEMPTS - 1
                logger.warning(
                    "session %s append throttled (attempt %d/%d): %s",
                    session.id, attempt + 1, _APPEND_ATTEMPTS, exc,
                )
                if last:
                    break
                await asyncio.sleep(
                    _APPEND_BACKOFF_SECONDS * (2 ** attempt) * (0.5 + random.random())
                )

        turn = _turn.get()
        if turn is not None:
            turn.dropped += 1
        logger.error(
            "session %s: event from %s kept in memory but not persisted after %d attempts",
            session.id, event.author, _APPEND_ATTEMPTS,
        )
        tracer.add(
            "session_not_durable", event.author,
            f"append to session {session.id} gave up after {_APPEND_ATTEMPTS} attempts",
        )
        return await BaseSessionService.append_event(self, session=session, event=event)


class _RunSessionService(_Recording, _ResilientSessions):
    pass


class _LocalSessionService(_Recording, InMemorySessionService):
    pass


_sessions: BaseSessionService | None = None
_sessions_lock = threading.Lock()


def _build_session_service() -> BaseSessionService:
    """The store an invocation's ADK session lives in.

    A deployed control plane must use Agent Platform Sessions, so an unconfigured engine is
    a startup failure rather than a downgrade: in-memory sessions look identical right up to
    the restart that proves they were never there.
    """
    engine_id = os.environ.get("CASERELAY_RUN_SESSION_ENGINE_ID", "").strip()
    deployed = os.environ.get("CASERELAY_CONTROL_PLANE", "").strip() == "1"

    if not engine_id:
        if deployed:
            raise RuntimeError(
                "CASERELAY_RUN_SESSION_ENGINE_ID is unset on a deployed control plane; "
                "agent sessions would be lost on every restart. Set it from "
                "infra/run_sessions.env via infra/deploy_control_plane.sh."
            )
        logger.warning(
            "CASERELAY_RUN_SESSION_ENGINE_ID is unset — agent sessions are in-memory and "
            "will not survive this process. Local development only."
        )
        return _LocalSessionService()

    return _RunSessionService(
        project=os.environ.get("GOOGLE_CLOUD_PROJECT", "caserelay"),
        # Sessions are a regional resource; GOOGLE_CLOUD_LOCATION is 'global' for models.
        location=os.environ.get("CASERELAY_RUN_SESSION_LOCATION", "us-central1"),
        agent_engine_id=engine_id,
    )


def _session_service() -> BaseSessionService:
    global _sessions
    if _sessions is None:
        with _sessions_lock:
            if _sessions is None:
                _sessions = _build_session_service()
    return _sessions


def _session_id(app_name: str) -> str:
    """Build a session id the Sessions API will accept.

    Ids are limited to [a-z0-9-], and one that starts with a digit may be no longer than
    nine characters — a bare uuid4 hex opens with a digit about 40% of the time. Leading
    with the agent name keeps every id letter-initial and makes a session on the platform
    identifiable without opening it.
    """
    slug = _ID_UNSAFE.sub("-", app_name.lower()).strip("-")[:24]
    if not slug or not slug[0].isalpha():
        slug = f"run-{slug}".rstrip("-")
    return f"{slug}-{uuid4().hex[:12]}"


def run_agent(agent, message: str, app_name: str | None = None, user_id: str | None = None) -> str:
    name = app_name or getattr(agent, "name", "caserelay")
    caller = user_id or _caller_id()
    return asyncio.run(_run(agent, message, name, caller))


def finalize_run_memory(run_id: str, case_id: str) -> int:
    """Extract one memory from the entire wake's accumulated orchestrator events.

    Called once at end of _run_background. Builds a synthetic session from all
    orchestrator phases' events and runs a single synchronous extraction.
    Also generates a Gemma narrative summary of the session (independent of Memory Bank).

    Returns the number of session events fed into extraction, or 0 if nothing was committed.
    """
    _generate_gemma_summary(run_id, case_id)

    if not memory_bank_enabled():
        return 0
    with _run_buffers_lock:
        events = _run_buffers.pop(run_id, [])
    if not events:
        return 0
    asyncio.run(_extract_run(case_id, events))
    return len(events)


def _generate_gemma_summary(run_id: str, case_id: str) -> None:
    """Use Gemma to produce a natural-language session narrative from run events."""
    try:
        from backend.narration.gemma import summarize_session
        from backend.runtime.workspace import workspace

        events = workspace.run_events(run_id)
        if not events:
            return
        summary = summarize_session(events)
        if summary:
            workspace.update_run(run_id, gemma_summary=summary)
            logger.info("Gemma session summary stored for run %s (%d chars)", run_id, len(summary))
    except Exception:
        logger.debug("Gemma session summary skipped for run %s", run_id, exc_info=True)


async def _extract_run(case_id: str, events: list) -> None:
    # Local vehicle for a single extraction call, not a session anyone resumes — it never
    # needs to reach the platform.
    from google.adk.sessions import InMemorySessionService as _Svc

    svc = _Svc()
    session = await svc.create_session(
        app_name=_MB_APP, user_id=case_id, session_id="run-combined"
    )
    session.events = events
    await commit_session_events(session)


def _caller_id() -> str:
    """Derive the caller identity from the active run context, falling back to a system principal."""
    try:
        from backend.runtime.context import current as _ctx
        ctx = _ctx()
        if ctx.run_id:
            return f"run-{ctx.run_id[:8]}"
    except Exception:  # noqa: BLE001
        pass
    return "caserelay-system"


def _run_id_from_context() -> str | None:
    try:
        from backend.runtime.context import current as _ctx
        return _ctx().run_id or None
    except Exception:  # noqa: BLE001
        return None


async def _run(agent, message: str, app_name: str, user_id: str) -> str:
    tracer.add("invoke", app_name, "user message", message)
    turn = _Turn()
    _turn.set(turn)
    sessions = _session_service()
    session = await sessions.create_session(
        app_name=app_name, user_id=user_id, session_id=_session_id(app_name)
    )
    runner = Runner(agent=agent, app_name=app_name, session_service=sessions)
    chunks: list[str] = []
    async for event in runner.run_async(
        user_id=user_id,
        session_id=session.id,
        new_message=types.Content(role="user", parts=[types.Part(text=message)]),
    ):
        author = getattr(event, "author", app_name) or app_name
        content = getattr(event, "content", None)
        if not content:
            continue
        for part in content.parts or []:
            call = getattr(part, "function_call", None)
            if call is not None:
                if call.name.startswith("transfer_to_"):
                    tracer.add("transfer", author, f"hands off to {call.args.get('agent_name')}")
                else:
                    tracer.add("tool_in", author, f"calls {call.name}", dict(call.args or {}))
                continue
            response = getattr(part, "function_response", None)
            if response is not None:
                tracer.add("tool_out", author, f"{response.name} returned", response.response)
                continue
            if getattr(part, "text", None):
                tracer.add("output", author, "says", part.text)
                chunks.append(part.text)

    logger.info(
        "session %s (%s/%s): %d events, %.2fs in appends, %d not persisted",
        session.id, app_name, user_id, turn.appends, turn.append_seconds, turn.dropped,
    )

    if memory_bank_enabled() and app_name == "continuity_orchestrator":
        run_id = _run_id_from_context()
        if run_id:
            with _run_buffers_lock:
                _run_buffers.setdefault(run_id, []).extend(turn.events)

    return "\n".join(chunks).strip()
