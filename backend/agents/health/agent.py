from google.adk.agents import Agent

from backend.gateway.gateway import authorized_context
from backend.identity.registry import AGENT_IDENTITIES
from backend.partners import sim
from backend.runtime.context import bind as _bind
from backend.runtime.workspace import workspace

AGENT_IDENTITY = AGENT_IDENTITIES["health"]

INSTRUCTION = (
    "You are the Health Coordination liaison. Never ask the requester anything — you "
    "decide the status yourself from the clinic's reply.\n"
    "Always run all three tools in order: get_authorized_context, then query_clinic with the "
    "referral_id from that context, then submit_appointment_status.\n"
    "status must be exactly one of: pending, scheduled, completed, unresolved, blocked. "
    "appointment_completed true means completed; appointment_booked true (without completed) "
    "means scheduled; no booking means pending.\n"
    "If the response contains an 'error' key (e.g. timeout or malformed), set status to unresolved.\n"
    "Never return diagnosis, medications, or clinical notes."
)


def get_authorized_context(case_id: str) -> dict:
    with _bind(agent_identity=AGENT_IDENTITY):
        return authorized_context(case_id, "check_appointment_status")


def query_clinic(referral_id: str, case_id: str | None = None) -> dict:
    """Call the clinic system. Behaviour is determined by the case's scenario configuration."""
    if not case_id:
        from backend.runtime.context import current as _ctx
        case_id = _ctx().case_id or None
    try:
        return sim.clinic_status(referral_id, case_id=case_id)
    except TimeoutError:
        return {"error": "timeout", "referral_id": referral_id, "note": "Clinic system did not respond within the allowed time."}


def submit_appointment_status(case_id: str, status: str, summary: str) -> dict:
    workspace.set_commitment(case_id, "health", status)
    return {"case_id": case_id, "status": status, "summary": summary}


def build_agent(mode: str = "task") -> Agent:
    """mode 'task' for a deployed endpoint, 'single_turn' when called in-process."""
    return Agent(
        name="health_coordination",
        model="gemini-3.5-flash",
        mode=mode,
        description="Appointment status only. No diagnosis or notes.",
        instruction=INSTRUCTION,
        tools=[get_authorized_context, query_clinic, submit_appointment_status],
        disallow_transfer_to_peers=True,
    )


root_agent = build_agent("task")
