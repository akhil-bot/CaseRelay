import logging
import os

from google.adk.agents import Agent

from backend.agents.education import agent as education
from backend.agents.family import agent as family
from backend.agents.health import agent as health
from backend.agents.legal import agent as legal
from backend.agents.shelter import agent as shelter
from backend.agents.verifier import agent as verifier
from backend.memory.bank import preload
from backend.memory.platform import enabled as memory_bank_enabled, search_sync as platform_search

logger = logging.getLogger(__name__)
from backend.runtime.workspace import workspace
from backend.workflows.durable import reconcile_commitments, resume_wake, schedule_commitment_checkpoints, write_checkpoint
from backend.workflows.escalation import notify_supervisor as _notify_supervisor, nudge_overdue

# Each specialist is a separately deployed endpoint. The env var holds its base URL; when it is
# absent the orchestrator falls back to an in-process copy so local runs need no cloud.
# In control-plane mode (CASERELAY_CONTROL_PLANE=1) the fallback is disabled and a missing
# endpoint raises so the deployed fleet is never silently bypassed.
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
    "Control-plane tools differ from step to step — you are handed only the ones the "
    "current step needs, plus get_commitment_states. Use the tools you have and no others.\n"
    "A specialist's reply text may be empty; that does not mean it failed. After calling any "
    "specialist, call get_commitment_states and report those statuses. Never invent a status "
    "and never claim a field was withheld unless a tool told you so.\n"
    "Rules: do exactly what the current request asks and then stop — never run ahead to "
    "later steps of the journey. Always put the case id in every specialist request; a "
    "request without one will fail. Never activate a case or approve an escalation unless "
    "the request says a supervisor approved it. Never invent clinical or legal facts. "
    "When you report back, name the commitment statuses and which fields were withheld."
)


def schedule_wake(case_id: str) -> list:
    """Write one checkpoint per commitment, each with its own due_at anchored at NOW.

    Returns a list of checkpoint dicts, one per commitment, with staggered deadlines.
    """
    return schedule_commitment_checkpoints(case_id)


def wake_workflow(case_id: str) -> dict:
    """Resume the same workflow_id with no user session."""
    return resume_wake(case_id)


def preload_memory(case_id: str) -> dict:
    """Load operational state and platform Memory Bank recall for continuity across sessions.

    Memory Bank recall is best-effort. If the search times out or fails (e.g. under concurrent
    fanout load), we log and return local memory rather than propagating and killing the phase.
    """
    result = preload(case_id)
    if memory_bank_enabled():
        query = f"coordination history and outcomes for case {case_id}"
        try:
            memories = platform_search(case_id, query)
            if memories:
                result["platform_memories"] = memories
        except Exception as exc:
            logger.warning("Memory Bank recall failed for case %s: %s", case_id, repr(exc))
    return result


def get_commitment_states(case_id: str) -> dict:
    """Current commitment statuses.

    A remote specialist's prose does not survive the A2A task conversion, so the orchestrator
    reads the statuses the specialists actually persisted rather than repeating their reply.
    """
    return workspace.commitment_states(case_id)


def check_overdue(case_id: str) -> list:
    """Compare each commitment's real deadline against the clock and its response state.

    Returns per-commitment verdicts: overdue (deadline passed, partner did not deliver),
    completed_on_time, completed_late, or within_deadline.
    """
    return reconcile_commitments(case_id)


def send_followup(case_id: str) -> list:
    """Chase every provider whose deadline passed with its commitment still open.

    Each reply either resolves the commitment and names the officer who took it on, or
    records that nothing came back.
    """
    return nudge_overdue(case_id)


def notify_supervisor(case_id: str) -> list:
    """Tell the supervisor which providers ignored their follow-up entirely."""
    return _notify_supervisor(case_id)


CONTROL_PLANE_TOOLS = [
    schedule_wake,
    wake_workflow,
    send_followup,
    notify_supervisor,
    preload_memory,
    get_commitment_states,
    check_overdue,
]

_TOOLS_BY_NAME = {fn.__name__: fn for fn in CONTROL_PLANE_TOOLS}

# Read-only, and the instruction requires every report of a status to come from a tool
# rather than from the model's recollection, so it is attached to every phase.
_ALWAYS_AVAILABLE = [get_commitment_states]


def resolve_specialists() -> tuple[list, list]:
    """Resolve specialist endpoints, raising when the control plane has no endpoints configured.

    In control-plane mode (CASERELAY_CONTROL_PLANE=1) every specialist must be reachable via
    its CASERELAY_URL_* env var or the registry. Falling back to in-process sub_agents is a
    silent bypass of the multi-agent architecture and is not permitted.
    """
    control_plane = os.environ.get("CASERELAY_CONTROL_PLANE", "").strip() == "1"
    missing = [
        name for name, (_, env_var, _) in SPECIALIST_MODULES.items()
        if not os.environ.get(env_var, "").strip()
    ]
    if control_plane and missing:
        raise RuntimeError(
            f"control plane requires specialist endpoints but none are reachable: "
            f"{missing}. Set CASERELAY_URL_* env vars or configure the registry."
        )
    return _specialists()


def _specialists() -> tuple[list, list]:
    """Split specialists into in-process sub_agents and remote tools.

    Each call creates a fresh httpx.AsyncClient so that the RemoteA2aAgent instances
    are not pre-bound to a stale event loop. Sharing one AsyncClient across asyncio.run()
    invocations in different threads causes 'Event loop is closed' errors: the connection
    pool's internal async primitives are tied to the loop that first used them, and every
    subsequent asyncio.run() creates a new loop for which those primitives are invalid.
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


def build_for_run(tools: tuple[str, ...] = ()) -> "Agent":
    """Build a fresh orchestrator with a new httpx client for a single run phase.

    Call this once per asyncio.run() invocation (i.e. per orchestrator phase) so that
    RemoteA2aAgent instances are never shared across event loops. The overhead is a single
    authenticated_client() instantiation plus one RemoteA2aAgent per specialist.

    ``tools`` names the control-plane tools this phase is allowed to use. Withholding the
    rest is what keeps a phase inside its own step: told to screen a callback while holding
    the tool that chases a provider, the model will sometimes do both in one turn and two
    distinct moments in the journey disappear into one.
    """
    sub_agents, remote_tools = _specialists()
    granted = _ALWAYS_AVAILABLE + [_TOOLS_BY_NAME[name] for name in tools]
    return Agent(
        name="continuity_orchestrator",
        model="gemini-3.5-flash",
        mode="chat",
        description="Routes specialist agents through granted identities. No raw records.",
        instruction=INSTRUCTION,
        tools=granted + remote_tools,
        sub_agents=sub_agents,
    )


_sub_agents, _remote_tools = _specialists()

root_agent = Agent(
    name="continuity_orchestrator",
    model="gemini-3.5-flash",
    mode="chat",
    description="Routes specialist agents through granted identities. No raw records.",
    instruction=INSTRUCTION,
    tools=CONTROL_PLANE_TOOLS + _remote_tools,
    sub_agents=_sub_agents,
)
