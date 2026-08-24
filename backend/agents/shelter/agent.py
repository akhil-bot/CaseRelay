from google.adk.agents import Agent

from backend.gateway.gateway import authorized_context
from backend.partners import sim
from backend.runtime.workspace import workspace

INSTRUCTION = (
    "You are the Shelter liaison. Never ask the requester anything — you decide the status "
    "yourself from the shelter's reply.\n"
    "Always run all three tools in order: get_authorized_context, then query_shelter with "
    "the referral_id from that context, then submit_shelter_status.\n"
    "status must be exactly one of: pending, scheduled, completed, unresolved, blocked. "
    "bed_confirmed true means completed; otherwise pending.\n"
    "Never rank or recommend placements."
)


def get_authorized_context(case_id: str) -> dict:
    return authorized_context(case_id, "check_availability")


def query_shelter(referral_id: str, case_id: str | None = None) -> dict:
    """Call the shelter system. Behaviour is determined by the case's scenario configuration."""
    if not case_id:
        from backend.runtime.context import current as _ctx
        case_id = _ctx().case_id or None
    return sim.shelter_status(referral_id, case_id=case_id)


def submit_shelter_status(case_id: str, status: str, summary: str) -> dict:
    workspace.set_commitment(case_id, "shelter", status)
    return {"case_id": case_id, "status": status, "summary": summary}


def build_agent(mode: str = "task") -> Agent:
    """mode 'task' for a deployed endpoint, 'single_turn' when called in-process."""
    return Agent(
        name="shelter_status",
        model="gemini-3.5-flash",
        mode=mode,
        description="Shelter scheduling only. No placement rankings.",
        instruction=INSTRUCTION,
        tools=[get_authorized_context, query_shelter, submit_shelter_status],
        disallow_transfer_to_peers=True,
    )


root_agent = build_agent("task")
