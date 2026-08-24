import os

from google.adk.agents import Agent

from backend.agents.education import agent as education
from backend.agents.family import agent as family
from backend.agents.health import agent as health
from backend.agents.legal import agent as legal
from backend.agents.shelter import agent as shelter
from backend.agents.verifier import agent as verifier
from backend.memory.bank import preload
from backend.runtime.workspace import workspace
from backend.workflows.durable import resume_wake, write_checkpoint

# Each specialist is a separately deployed endpoint. The env var holds its base URL; when it is
# absent the orchestrator falls back to an in-process copy so local runs need no cloud.
# The folder is the A2A route segment ADK mounts the card under.
SPECIALIST_MODULES = {
    "education_liaison": (education, "CASERELAY_URL_EDUCATION", "education"),
    "health_coordination": (health, "CASERELAY_URL_HEALTH", "health"),
    "legal_aid": (legal, "CASERELAY_URL_LEGAL", "legal"),
    "shelter_status": (shelter, "CASERELAY_URL_SHELTER", "shelter"),
    "family_services": (family, "CASERELAY_URL_FAMILY", "family"),
    "safeguarding_verifier": (verifier, "CASERELAY_URL_VERIFIER", "verifier"),
}

INSTRUCTION = (
    "You are the Continuity Orchestrator for a CASA case. You hold no raw records; "
    "specialists read their own scoped view through the Gateway.\n"
    "Specialists available as tools: education_liaison (school enrollment), "
    "health_coordination (appointments), legal_aid (referral status), shelter_status "
    "(bed availability), family_services (assessment scheduling), safeguarding_verifier "
    "(policy gate for suspicious partner payloads).\n"
    "Control-plane tools: activate_case (supervisor gate), schedule_wake, wake_workflow, "
    "approve_escalation (supervisor gate), preload_memory, get_commitment_states.\n"
    "A specialist's reply text may be empty; that does not mean it failed. After calling any "
    "specialist, call get_commitment_states and report those statuses. Never invent a status "
    "and never claim a field was withheld unless a tool told you so.\n"
    "Rules: do exactly what the current request asks and then stop — never run ahead to "
    "later steps of the journey. Always put the case id in every specialist request; a "
    "request without one will fail. Never activate a case or approve an escalation unless "
    "the request says a supervisor approved it. Never invent clinical or legal facts. "
    "When you report back, name the commitment statuses and which fields were withheld."
)


def activate_case(case_id: str) -> dict:
    """Supervisor HITL: grant proposed authorities and start monitoring."""
    return {"case_id": case_id, "status": workspace.activate(case_id)["status"]}


def schedule_wake(case_id: str) -> dict:
    """Checkpoint and schedule the day-17 education wake."""
    return write_checkpoint(case_id)


def wake_workflow(case_id: str) -> dict:
    """Resume the same workflow_id with no user session."""
    return resume_wake(case_id)


def preload_memory(case_id: str) -> dict:
    """Memory Bank: operational state only."""
    return preload(case_id)


def get_commitment_states(case_id: str) -> dict:
    """Current commitment statuses.

    A remote specialist's prose does not survive the A2A task conversion, so the orchestrator
    reads the statuses the specialists actually persisted rather than repeating their reply.
    """
    return workspace.commitment_states(case_id)


def approve_escalation(case_id: str) -> dict:
    """Supervisor HITL: release the quarantined action."""
    return workspace.decide_approval(case_id, "approved", "supervisor-001")


def _specialists() -> tuple[list, list]:
    """Split specialists into in-process sub_agents and remote tools.

    A local specialist is single_turn, so ADK exposes it as a tool that returns control here.
    A RemoteA2aAgent has no such mode and would be reached by transfer_to_agent, which hands the
    turn away and never comes back — so wrap it in AgentTool to keep the same call-and-return
    shape the phase driver depends on.
    """
    from google.adk.agents.remote_a2a_agent import RemoteA2aAgent
    from google.adk.tools.agent_tool import AgentTool

    from backend.runtime.a2a_auth import authenticated_client

    sub_agents, remote_tools = [], []
    client = None
    for name, (module, env_var, folder) in SPECIALIST_MODULES.items():
        base_url = os.environ.get(env_var, "").rstrip("/")
        if base_url:
            if client is None:
                client = authenticated_client()
            remote = RemoteA2aAgent(
                name=name,
                agent_card=f"{base_url}/a2a/{folder}/.well-known/agent-card.json",
                description=module.build_agent("task").description,
                httpx_client=client,
            )
            remote_tools.append(AgentTool(agent=remote))
        else:
            sub_agents.append(module.build_agent("single_turn"))
    return sub_agents, remote_tools


_sub_agents, _remote_tools = _specialists()

root_agent = Agent(
    name="continuity_orchestrator",
    model="gemini-3.5-flash",
    mode="chat",
    description="Routes specialist agents through granted identities. No raw records.",
    instruction=INSTRUCTION,
    tools=[
        activate_case,
        schedule_wake,
        wake_workflow,
        approve_escalation,
        preload_memory,
        get_commitment_states,
    ]
    + _remote_tools,
    sub_agents=_sub_agents,
)
