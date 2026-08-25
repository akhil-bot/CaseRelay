import asyncio
import threading

from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from backend.memory.platform import APP_NAME as _MB_APP, commit_session_events, enabled as memory_bank_enabled
from backend.runtime.trace import tracer

_run_buffers: dict[str, list] = {}
_run_buffers_lock = threading.Lock()


def run_agent(agent, message: str, app_name: str | None = None, user_id: str | None = None) -> str:
    name = app_name or getattr(agent, "name", "caserelay")
    caller = user_id or _caller_id()
    return asyncio.run(_run(agent, message, name, caller))


def finalize_run_memory(run_id: str, case_id: str) -> int:
    """Extract one memory from the entire wake's accumulated orchestrator events.

    Called once at end of _run_background. Builds a synthetic session from all
    orchestrator phases' events and runs a single synchronous extraction.

    Returns the number of session events fed into extraction, or 0 if nothing was committed.
    """
    if not memory_bank_enabled():
        return 0
    with _run_buffers_lock:
        events = _run_buffers.pop(run_id, [])
    if not events:
        return 0
    asyncio.run(_extract_run(case_id, events))
    return len(events)


async def _extract_run(case_id: str, events: list) -> None:
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
    sessions = InMemorySessionService()
    session = await sessions.create_session(
        app_name=app_name, user_id=user_id, session_id="live-1"
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

    if memory_bank_enabled() and app_name == "continuity_orchestrator":
        run_id = _run_id_from_context()
        if run_id:
            completed = await sessions.get_session(
                app_name=app_name, user_id=user_id, session_id=session.id
            )
            with _run_buffers_lock:
                _run_buffers.setdefault(run_id, []).extend(completed.events or [])

    return "\n".join(chunks).strip()
