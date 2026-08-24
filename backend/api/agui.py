"""AG-UI endpoint for the CaseRelay chat agent.

Exposes a Google ADK agent over the AG-UI protocol so CopilotKit frontends
can drive case creation and fleet runs through natural language. The agent
relies on frontend tools (list_scenarios, create_case, run_fleet) provided
by the CopilotKit client — it does not duplicate their logic server-side.

Authentication: Vertex AI via Application Default Credentials. No API key.
Model region: controlled by GOOGLE_CLOUD_LOCATION (set to 'global' on Cloud Run).
"""

from __future__ import annotations

import os

os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "1")

from fastapi import FastAPI
from google.adk.agents import Agent

from ag_ui_adk import ADKAgent, add_adk_fastapi_endpoint

CHAT_INSTRUCTION = """\
You are the CaseRelay assistant, an operator-facing copilot for a child-welfare \
coordination platform powered by nine specialist agents on Vertex AI.

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
)

agui_app = FastAPI(title="CaseRelay AG-UI Chat")

adk_wrapper = ADKAgent(
    adk_agent=chat_agent,
    app_name="caserelay_chat",
    user_id="portal_operator",
    session_timeout_seconds=3600,
    use_in_memory_services=True,
)

add_adk_fastapi_endpoint(agui_app, adk_wrapper, path="/")
