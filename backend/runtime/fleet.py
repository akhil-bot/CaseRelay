import os

os.environ.setdefault("GOOGLE_CLOUD_PROJECT", "caserelay")
os.environ.setdefault("GOOGLE_CLOUD_LOCATION", "global")
os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "1")

from dataclasses import dataclass
from typing import Callable

from backend.runtime.workspace import workspace

SPECIALISTS = [
    "education_liaison",
    "health_coordination",
    "legal_aid",
    "shelter_status",
    "family_services",
]


@dataclass
class PhaseSpec:
    """Registry entry for one phase of a case run.

    The engine evaluates every phase's precondition against real case state after each
    completed phase. Phases in the same ``group`` are dispatched concurrently via
    ThreadPoolExecutor; all others run one at a time. When multiple ungrouped phases
    are simultaneously ready, the lowest ``priority`` value wins (deterministic tie-break).
    Every phase runs at most once per run — the engine tracks completions.
    """
    label: str
    prompt_template: str
    precondition: Callable[[str], bool]
    priority: int
    group: str | None = None


# ---------------------------------------------------------------------------
# Preconditions — each evaluates real workspace / case state
# ---------------------------------------------------------------------------

def _case_draft_with_commitments(case_id: str) -> bool:
    """Intake persisted commitments and grants; case is still draft awaiting supervisor."""
    case = workspace.get_case(case_id)
    return (
        case["status"] == "draft"
        and bool(workspace.commitments.get(case_id))
        and bool(workspace.grants.get(case_id))
    )


def _case_is_monitoring(case_id: str) -> bool:
    """Supervisor approved grants and the case advanced to monitoring."""
    return workspace.get_case(case_id)["status"] == "monitoring"


def _specialists_have_reported(case_id: str) -> bool:
    """At least one specialist moved its commitment past the initial pending state."""
    if workspace.get_case(case_id)["status"] != "monitoring":
        return False
    states = workspace.commitment_states(case_id)
    return bool(states) and any(v != "pending" for v in states.values())


def _checkpoint_committed_and_waiting(case_id: str) -> bool:
    """schedule_wake stored a commitment snapshot on the checkpoint and it hasn't fired.

    Accepts state "waiting" (checkpoint just written) or "running" (sweep marked it due
    and the push handler started a resumed run). The guard on current_step prevents
    re-triggering after wake_workflow has already set it to "awake".
    """
    cp = workspace.get_checkpoint(f"wf-{case_id}")
    if not cp or cp.get("state") not in ("waiting", "running"):
        return False
    if cp.get("current_step") == "awake":
        return False
    return bool(cp.get("commitment_states"))


def _checkpoint_awake_and_has_inject(case_id: str) -> bool:
    """wake_workflow set current_step='awake' and the referral packet has an injected callback."""
    cp = workspace.get_checkpoint(f"wf-{case_id}")
    if not cp or cp.get("current_step") != "awake":
        return False
    packet = workspace.get_case(case_id).get("referral_packet", {})
    return any(r.get("inject_callback") for r in packet.get("referrals", []))


def _has_pending_approval(case_id: str) -> bool:
    """Quarantine (or another mechanism) created an approval awaiting supervisor review."""
    return any(
        a.get("decision") == "pending"
        for a in workspace.list_approvals(case_id)
    )


def _approval_decided_and_has_inject(case_id: str) -> bool:
    """Escalation is resolved and a clean re-callback is expected (inject_callback in packet)."""
    approvals = workspace.list_approvals(case_id)
    if not any(a.get("decision") not in (None, "pending") for a in approvals):
        return False
    packet = workspace.get_case(case_id).get("referral_packet", {})
    return any(r.get("inject_callback") for r in packet.get("referrals", []))


def _checkpoint_awake_no_pending_approvals(case_id: str) -> bool:
    """Wake has fired and no approvals are blocking — safe to write final memory."""
    cp = workspace.get_checkpoint(f"wf-{case_id}")
    if not cp or cp.get("current_step") != "awake":
        return False
    return not any(
        a.get("decision") == "pending"
        for a in workspace.list_approvals(case_id)
    )


# ---------------------------------------------------------------------------
# Phase registry — the single source of truth for the run engine
# ---------------------------------------------------------------------------

PHASE_REGISTRY: list[PhaseSpec] = [
    PhaseSpec(
        label="2-activate",
        prompt_template=(
            "A supervisor reviewed and approved the proposed grants for case {case_id}. "
            "Call activate_case, report the new status, then stop."
        ),
        precondition=_case_draft_with_commitments,
        priority=10,
    ),
    *[
        PhaseSpec(
            label=f"3-fanout-{name}",
            prompt_template=(
                f"Case {{case_id}} is now monitoring. Ask {name} to check and submit its "
                f"commitment for case {{case_id}}. Call no other specialist. Then stop."
            ),
            precondition=_case_is_monitoring,
            priority=20,
            group="fanout",
        )
        for name in SPECIALISTS
    ],
    PhaseSpec(
        label="4-checkpoint",
        prompt_template=(
            "Education is still open for case {case_id}. Call schedule_wake to checkpoint the "
            "workflow and set the day-17 wake, then stop."
        ),
        precondition=_specialists_have_reported,
        priority=30,
    ),
    PhaseSpec(
        label="5-wake",
        prompt_template=(
            "Day 17 for case {case_id} with no user session. Call wake_workflow, then ask "
            "education_liaison to re-check its commitment for case {case_id}. Then stop."
        ),
        precondition=_checkpoint_committed_and_waiting,
        priority=40,
    ),
    PhaseSpec(
        label="6-quarantine",
        prompt_template=(
            "The school system sent a callback for case {case_id}. Ask safeguarding_verifier to "
            "inspect it and escalate if it reaches outside the education scope. Then stop."
        ),
        precondition=_checkpoint_awake_and_has_inject,
        priority=50,
    ),
    PhaseSpec(
        label="7-approve",
        prompt_template=(
            "A supervisor reviewed the quarantined callback for case {case_id} and approved the "
            "escalation. Call approve_escalation, report the decision, then stop."
        ),
        precondition=_has_pending_approval,
        priority=60,
    ),
    PhaseSpec(
        label="8-enrolled",
        prompt_template=(
            "A clean enrollment callback arrived for case {case_id}. Ask education_liaison to "
            "call query_school and submit status completed if the SIS confirms a seat. Then stop."
        ),
        precondition=_approval_decided_and_has_inject,
        priority=70,
    ),
    PhaseSpec(
        label="9-memory",
        prompt_template=(
            "Close the loop for case {case_id}: call preload_memory, then summarize every "
            "commitment status and which fields were withheld from each specialist."
        ),
        precondition=_checkpoint_awake_no_pending_approvals,
        priority=80,
    ),
]

# Cloud operator tools (infra/case_cli.py, infra/cloud_e2e.py) iterate phases
# in priority order. Derived from the registry, not a static list.
PHASES: list[tuple[str, str]] = [
    (spec.label, spec.prompt_template)
    for spec in sorted(PHASE_REGISTRY, key=lambda s: s.priority)
]
