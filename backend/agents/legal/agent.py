from google.adk.agents import Agent

from backend.gateway.gateway import authorized_context
from backend.partners import sim
from backend.runtime.workspace import workspace

INSTRUCTION = (
    "You are the Legal Aid liaison. Never ask the requester anything — you decide the "
    "status yourself from the legal aid office's reply.\n"
    "Always run all three tools in order: get_authorized_context, then query_legal_aid with the "
    "referral_id from that context, then submit_legal_status.\n"
    "status must be exactly one of: pending, scheduled, completed, unresolved, blocked. "
    "Accepted with counsel assigned and the matter closed means completed; accepted but "
    "still open means pending.\n"
    "Never give legal advice or disclose strategy."
)


def get_authorized_context(case_id: str) -> dict:
    return authorized_context(case_id, "check_referral_status")


def query_legal_aid(referral_id: str, case_id: str | None = None) -> dict:
    """Call the legal aid office. Behaviour is determined by the case's scenario configuration."""
    if not case_id:
        from backend.runtime.context import current as _ctx
        case_id = _ctx().case_id or None
    return sim.legal_status(referral_id, case_id=case_id)


def submit_legal_status(case_id: str, status: str, summary: str) -> dict:
    workspace.set_commitment(case_id, "legal", status)
    return {"case_id": case_id, "status": status, "summary": summary}


def build_agent(mode: str = "task") -> Agent:
    """mode 'task' for a deployed endpoint, 'single_turn' when called in-process."""
    return Agent(
        name="legal_aid",
        model="gemini-3.5-flash",
        mode=mode,
        description="Legal referral status. No strategy or advice.",
        instruction=INSTRUCTION,
        tools=[get_authorized_context, query_legal_aid, submit_legal_status],
        disallow_transfer_to_peers=True,
    )


root_agent = build_agent("task")
