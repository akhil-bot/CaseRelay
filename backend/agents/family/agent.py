from google.adk.agents import Agent

from backend.gateway.gateway import authorized_context
from backend.partners import sim
from backend.runtime.workspace import workspace

INSTRUCTION = (
    "You are the Family Services liaison. Never ask the requester anything — you decide "
    "the status yourself from the county's reply.\n"
    "Always run all three tools in order: get_authorized_context, then "
    "query_family_services with the referral_id from that context, then submit_family_status.\n"
    "status must be exactly one of: pending, scheduled, completed, unresolved, blocked. "
    "assessment_completed true means completed; assessment_scheduled true (without completed) "
    "means scheduled; otherwise pending.\n"
    "Never return findings, risk scores, or family narratives."
)


def get_authorized_context(case_id: str) -> dict:
    return authorized_context(case_id, "check_assessment_schedule")


def query_family_services(referral_id: str, case_id: str | None = None) -> dict:
    """Call county family services. Behaviour is determined by the case's scenario configuration."""
    if not case_id:
        from backend.runtime.context import current as _ctx
        case_id = _ctx().case_id or None
    return sim.family_status(referral_id, case_id=case_id)


def submit_family_status(case_id: str, status: str, summary: str) -> dict:
    workspace.set_commitment(case_id, "family_services", status)
    return {"case_id": case_id, "status": status, "summary": summary}


def build_agent(mode: str = "task") -> Agent:
    """mode 'task' for a deployed endpoint, 'single_turn' when called in-process."""
    return Agent(
        name="family_services",
        model="gemini-3.5-flash",
        mode=mode,
        description="Assessment scheduling only. No findings or risk scores.",
        instruction=INSTRUCTION,
        tools=[get_authorized_context, query_family_services, submit_family_status],
        disallow_transfer_to_peers=True,
    )


root_agent = build_agent("task")
