import asyncio

from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from backend.runtime.trace import tracer


def run_agent(agent, message: str, app_name: str | None = None) -> str:
    name = app_name or getattr(agent, "name", "caserelay")
    return asyncio.run(_run(agent, message, name))


async def _run(agent, message: str, app_name: str) -> str:
    tracer.add("invoke", app_name, "user message", message)
    sessions = InMemorySessionService()
    session = await sessions.create_session(
        app_name=app_name, user_id="elena-volunteer-001", session_id="live-1"
    )
    runner = Runner(agent=agent, app_name=app_name, session_service=sessions)
    chunks: list[str] = []
    async for event in runner.run_async(
        user_id="elena-volunteer-001",
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
    return "\n".join(chunks).strip()
