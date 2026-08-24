import os

os.environ.setdefault("GOOGLE_CLOUD_PROJECT", "caserelay")
os.environ.setdefault("GOOGLE_CLOUD_LOCATION", "global")
os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "1")

from backend.agents.intake.agent import root_agent as intake_agent
from backend.agents.orchestrator.agent import root_agent as orchestrator_agent
from backend.memory import bank as memory
from backend.runtime.invoke import run_agent
from backend.runtime.trace import tracer
from backend.runtime.workspace import workspace
from backend.state import dataset

SPECIALISTS = [
    "education_liaison",
    "health_coordination",
    "legal_aid",
    "shelter_status",
    "family_services",
]

# The specialists are single_turn agents, so ADK only allows them to be reached as tools of
# the orchestrator. Each phase below is therefore one orchestrator turn.
PHASES: list[tuple[str, str]] = [
    (
        "2-activate",
        "A supervisor reviewed and approved the proposed grants for case {case_id}. "
        "Call activate_case, report the new status, then stop.",
    ),
    # One specialist per turn. Asked for all five in a single turn the model reliably calls two
    # or three and reports the rest as done, which silently leaves commitments pending.
    *[
        (
            f"3-fanout-{name}",
            f"Case {{case_id}} is now monitoring. Ask {name} to check and submit its "
            f"commitment for case {{case_id}}. Call no other specialist. Then stop.",
        )
        for name in SPECIALISTS
    ],
    (
        "4-checkpoint",
        "Education is still open for case {case_id}. Call schedule_wake to checkpoint the "
        "workflow and set the day-17 wake, then stop.",
    ),
    (
        "5-wake",
        "Day 17 for case {case_id} with no user session. Call wake_workflow, then ask "
        "education_liaison to re-check its commitment for case {case_id}. Then stop.",
    ),
    (
        "6-quarantine",
        "The school system sent a callback for case {case_id}. Ask safeguarding_verifier to "
        "inspect it and escalate if it reaches outside the education scope. Then stop.",
    ),
    (
        "7-approve",
        "A supervisor reviewed the quarantined callback for case {case_id} and approved the "
        "escalation. Call approve_escalation, report the decision, then stop.",
    ),
    (
        "8-enrolled",
        "A clean enrollment callback arrived for case {case_id}. Ask education_liaison to "
        "call query_school and submit status completed if the SIS confirms a seat. Then stop.",
    ),
    (
        "9-memory",
        "Close the loop for case {case_id}: call preload_memory, then summarize every "
        "commitment status and which fields were withheld from each specialist.",
    ),
]


def run_maya(case_id: str = "CR-1042", echo: bool = False) -> dict:
    """Run the CR-1042 journey phase by phase.

    Phase order and the two supervisor gates are deterministic on purpose: one LLM turn asked
    to chain a dozen ordered steps silently drops some. Inside every phase the agents still
    reason for themselves — they choose their tool calls, read the partner reply, and decide
    the commitment status.
    """
    tracer.reset(echo=echo)
    # The harness ingests the referral packet; from here on the agents only see stored case data.
    dataset.create_case(case_id, source="fixture" if case_id == "CR-1042" else "synthetic")
    said: list[dict[str, str]] = []

    tracer.add("phase", "1-intake", "read packet, extract commitments, propose grants")
    intake_text = run_agent(
        intake_agent,
        f"Process the referral packet for case {case_id}. Extract commitments and propose grants.",
        app_name="intake_authority",
    )
    said.append({"phase": "1-intake", "said": intake_text})
    if not workspace.commitments.get(case_id) or not workspace.grants.get(case_id):
        raise RuntimeError(f"intake did not persist commitments/grants: {intake_text[:400]}")

    orch_text = ""
    for label, template in PHASES:
        prompt = template.format(case_id=case_id)
        tracer.add("phase", label, prompt[:120])
        orch_text = run_agent(orchestrator_agent, prompt, app_name="continuity_orchestrator")
        said.append({"phase": label, "said": orch_text})

    from backend.runtime.context import current as _ctx
    return {
        "trace_id": _ctx().trace_id,
        "intake_text": intake_text,
        "orchestrator_text": orch_text,
        "phases": said,
        "case_status": workspace.get_case(case_id)["status"],
        "commitment_states": workspace.commitment_states(case_id),
        "grant_count": len(workspace.grants.get(case_id, [])),
        "approvals": workspace.list_approvals(case_id),
        "audit_events": len(workspace.list_audit(case_id)),
        "memory": memory.preload(case_id),
        "hops": tracer.as_table(),
    }
