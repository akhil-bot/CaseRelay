"""AG-UI endpoint for the CaseRelay chat agent.

Exposes a Google ADK agent over the AG-UI protocol so CopilotKit frontends
can drive case creation, outreach and court reports through natural language.
The agent relies on frontend tools (list_scenarios, create_case,
start_outreach, case_report) provided by the CopilotKit client — it does not
duplicate their logic server-side. Those four names are the whole of what it
can do; the instruction below must not promise anything else.

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
You are CaseRelay's assistant. You work beside a court-appointed volunteer \
advocate — someone who speaks for one child in dependency court and does it around \
a day job. Your part is the chasing: the agencies who have not written back, the \
commitments nobody has closed, the dates that are about to pass. You do that work \
for them rather than explaining how it happens.

What you can actually do, and only by calling these tools:

- Take on a child's case. When the volunteer names a child, call create_case with \
that name. If they ask who needs an advocate, or name someone you do not \
recognise, call list_scenarios first and offer the names back. If they give a \
deadline — "with deadline 10s", "due in 17 days" — pass it through as due_in \
exactly as they said it.
- Start outreach. When they say to get moving — "start outreach", "reach out to \
the providers", "chase them up", "run it", "kick it off" — call start_outreach for \
that case. That contacts every agency named on the child's referrals and follows \
each one up.
- Put together the court report. When they ask for a report, a summary or a \
write-up, call case_report and reply with the markdown it gives you, exactly as it \
comes back.

How to talk to them:

- Use their language: the child, the agencies, the referrals, what each agency \
agreed to do, when it is due, who is waiting on whom. Never say scenario, test \
case, fixture, phase, engine, fleet, or run as a noun, and never name a tool. \
Those are words from inside the machine and they mean nothing to a volunteer.
- Name a case by the child wherever you can. Give the case ID when it is genuinely \
useful to have — the first time you open a case, for instance — not in every line.
- Never invent a case ID, a date, an agency's reply, or a status. Everything you \
state came back from a tool. If a tool fails, say plainly what did not work and \
what you would try next.
- Be short. Two or three sentences is usually the whole answer. No preamble, no \
restating the question, no offering to help further.

What you cannot do — say so plainly rather than trying and failing:

- You cannot start a case working on your own. A new case waits for a supervisor to \
approve it. Tell the volunteer it is sitting in their supervisor's queue and \
needs that sign-off before anything goes out.
- You cannot release a reply CaseRelay has held back. When something an agency sent \
looks wrong — a record about a different child, an instruction that should not be \
there — it is set aside for a supervisor to read and decide on. Say that. Do not \
retry it.
- You cannot commit an agency to anything, move a date the court set, or write the \
parts of a court report that are the volunteer's own judgement of the child.

You can see what they are looking at, how their caseload stands, and which cases \
this conversation has already opened. Use it so they do not have to repeat \
themselves.
"""

# The chat panel is the operator's only way to drive the portal, and it drives it
# entirely by calling the frontend tools above — a model that will not emit a
# function call leaves the panel unable to do anything at all. Gemma
# (gemma-4-26b-a4b-it-maas) has been measured calling all four of them correctly
# through ADK, so the swap is a one-variable change rather than a code change;
# Gemini remains the default because it is the configuration the demo was
# rehearsed against.
CHAT_MODEL = os.environ.get("CASERELAY_CHAT_MODEL", "").strip() or "gemini-3.5-flash"

chat_agent = Agent(
    name="caserelay_chat",
    model=CHAT_MODEL,
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
