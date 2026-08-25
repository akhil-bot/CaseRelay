import asyncio

from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from backend.memory.platform import APP_NAME as _MB_APP, commit_session_events, enabled as memory_bank_enabled
from backend.runtime.trace import tracer


def run_agent(agent, message: str, app_name: str | None = None, user_id: str | None = None) -> str:
    name = app_name or getattr(agent, "name", "caserelay")
    caller = user_id or _caller_id()
    return asyncio.run(_run(agent, message, name, caller))


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


def _case_id_from_context() -> str | None:
    """Extract case_id from RunContext if bound (set by _run_background)."""
    try:
        from backend.runtime.context import current as _ctx
        ctx = _ctx()
        return ctx.case_id or None
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

    if memory_bank_enabled():
        case_id = _case_id_from_context()
        if case_id:
            completed = await sessions.get_session(
                app_name=app_name, user_id=user_id, session_id=session.id
            )
            completed.app_name = _MB_APP
            completed.user_id = case_id
            await commit_session_events(completed)

    return "\n".join(chunks).strip()
