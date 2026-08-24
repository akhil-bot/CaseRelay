from google.adk.agents import Agent

from backend.gateway.gateway import authorized_context
from backend.partners import sim
from backend.runtime.workspace import workspace

INSTRUCTION = (
    "You are the Health Coordination liaison. Never ask the requester anything — you "
    "decide the status yourself from the clinic's reply.\n"
    "Always run all three tools in order: get_authorized_context, then query_clinic with the "
    "referral_id from that context, then submit_appointment_status.\n"
    "status must be exactly one of: pending, scheduled, completed, unresolved, blocked. "
    "appointment_booked true means scheduled; no booking means pending.\n"
    "Never return diagnosis, medications, or clinical notes."
)


def get_authorized_context(case_id: str) -> dict:
    return authorized_context(case_id, "check_appointment_status")


def query_clinic(referral_id: str) -> dict:
    return sim.clinic_status(referral_id)


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
