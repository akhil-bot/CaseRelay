"""AG-UI endpoint for the CaseRelay chat agent.

Exposes a Google ADK agent over the AG-UI protocol so CopilotKit frontends
can drive case creation and fleet runs through natural language. The agent
relies on frontend tools (list_scenarios, create_case, run_fleet) provided
by the CopilotKit client — it does not duplicate their logic server-side.

Authentication: Vertex AI via Application Default Credentials. No API key.
Model region: controlled by GOOGLE_CLOUD_LOCATION (set to 'global' on Cloud Run).

Conversations are held by Agent Platform Sessions on the Agent Engine named by
CASERELAY_CHAT_SESSION_ENGINE_ID, so a Cloud Run restart does not erase what an
operator has been discussing.
"""

from __future__ import annotations

import logging
import os

os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "1")

from fastapi import FastAPI
from google.adk.agents import Agent
from google.adk.sessions import BaseSessionService, VertexAiSessionService

from ag_ui_adk import ADKAgent, AGUIToolset, add_adk_fastapi_endpoint

logger = logging.getLogger("caserelay.agui")

CHAT_INSTRUCTION = """\
You are the CaseRelay assistant, an operator-facing copilot for a child-welfare \
coordination platform powered by eight specialist agents on Vertex AI.

You help operators create test cases from scenarios, run the specialist agent fleet, \
and monitor run events. You do this exclusively through the tools available to you — \
never fabricate a case ID, run ID, or status.

Rules:
- When the user asks to create a case, call the create_case tool. Always confirm the \
result with the real case_id returned.
- When the user asks to run the fleet (or "run it", "run maya's case", etc.), call \
the run_fleet tool with the appropriate case_ref.
- When the user asks what scenarios are available, call the list_scenarios tool.
- Never invent data. If a tool call fails, report the error honestly.
- Keep responses concise and operational.
- You may read context about the user's current view, their caseload summary, and \
scenario clock to inform your answers without being asked.
"""

chat_agent = Agent(
    name="caserelay_chat",
    model="gemini-3.5-flash",
    mode="chat",
    description="Operator-facing chat assistant for CaseRelay. Routes requests through frontend tools.",
    instruction=CHAT_INSTRUCTION,
    # Placeholder that ADKAgent swaps per run for a ClientProxyToolset built from
    # the client's input.tools. Without it the agent has no tools registered and
    # any frontend tool call fails with "Tool not found".
    tools=[AGUIToolset()],
)


def _build_session_service() -> BaseSessionService:
    """The store the chat transcript lives in.

    A deployed control plane must use Agent Platform Sessions, so an unconfigured engine
    is a startup failure rather than a downgrade: an in-memory transcript looks identical
    until the instance recycles mid-conversation and the history is gone.
    """
    engine_id = os.environ.get("CASERELAY_CHAT_SESSION_ENGINE_ID", "").strip()
    deployed = os.environ.get("CASERELAY_CONTROL_PLANE", "").strip() == "1"

    if not engine_id:
        if deployed:
            raise RuntimeError(
                "CASERELAY_CHAT_SESSION_ENGINE_ID is unset on a deployed control plane; "
                "chat sessions would be lost on every restart. Set it from "
                "infra/chat_sessions.env via infra/deploy_control_plane.sh."
            )
        from google.adk.sessions import InMemorySessionService

        logger.warning(
            "CASERELAY_CHAT_SESSION_ENGINE_ID is unset — chat sessions are in-memory and "
            "will not survive this process. Local development only."
        )
        return InMemorySessionService()

    return VertexAiSessionService(
        project=os.environ.get("GOOGLE_CLOUD_PROJECT", "caserelay"),
        # Sessions are a regional resource; GOOGLE_CLOUD_LOCATION is 'global' for models.
        location=os.environ.get("CASERELAY_CHAT_SESSION_LOCATION", "us-central1"),
        agent_engine_id=engine_id,
    )


agui_app = FastAPI(title="CaseRelay AG-UI Chat")

adk_wrapper = ADKAgent(
    adk_agent=chat_agent,
    app_name="caserelay_chat",
    user_id="portal_operator",
    session_timeout_seconds=3600,
    use_in_memory_services=True,
    session_service=_build_session_service(),
    # The AG-UI thread id doubles as the platform session id, so a restarted instance
    # resolves a returning conversation with one read instead of listing every session
    # this operator has ever held and matching on state.
    use_thread_id_as_session_id=True,
    # Sessions outlive the idle timeout: the timeout only drops the local bookkeeping,
    # and deleting the platform copy would throw away the transcript this store exists
    # to keep. Nothing reads the in-memory memory service, so do not write to it either.
    delete_session_on_cleanup=False,
    save_session_to_memory_on_cleanup=False,
)

add_adk_fastapi_endpoint(agui_app, adk_wrapper, path="/")
