import os

os.environ.setdefault("GOOGLE_CLOUD_PROJECT", "caserelay")
os.environ.setdefault("GOOGLE_CLOUD_LOCATION", "global")
os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "1")

from dataclasses import dataclass
from typing import Callable

from backend.runtime.workspace import workspace
from backend.workflows.escalation import pending_nudges, unanswered

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
    """Supervisor approved grants AND no specialist has reported yet (first fanout only)."""
    if workspace.get_case(case_id)["status"] != "monitoring":
        return False
    states = workspace.commitment_states(case_id)
    return not states or all(v == "pending" for v in states.values())


def _specialists_have_reported(case_id: str) -> bool:
    """At least one specialist moved its commitment past the initial pending state,
    and no per-commitment checkpoints exist yet (prevents re-checkpointing on wake)."""
    if workspace.get_case(case_id)["status"] != "monitoring":
        return False
    states = workspace.commitment_states(case_id)
    if not states or not any(v != "pending" for v in states.values()):
        return False
    if any(cp.get("commitment_type") for cp in workspace.list_case_checkpoints(case_id)):
        return False
    return True


def _checkpoint_committed_and_waiting(case_id: str) -> bool:
    """At least one per-commitment checkpoint is in running state (sweep fired it)
    and wake_workflow has not yet set it to awake."""
    for cp in workspace.list_case_checkpoints(case_id):
        if cp.get("state") in ("waiting", "running") and cp.get("current_step") != "awake":
            if cp.get("commitment_states") or cp.get("commitment_type"):
                return True
    return False


def _awake(case_id: str) -> bool:
    """wake_workflow has set at least one of this case's checkpoints to current_step='awake'."""
    return any(
        cp.get("current_step") == "awake"
        for cp in workspace.list_case_checkpoints(case_id)
    )


def _pending_escalation(case_id: str) -> bool:
    """A safeguarding escalation is waiting on a supervisor.

    Only escalations count. A supervisor notice about an unresponsive partner is also
    pending human attention, but it is not a gate on the machine: nothing the fleet does
    next depends on how the volunteer answers it.
    """
    return any(
        a.get("decision") == "pending" and a.get("action_type") == "escalation"
        for a in workspace.list_approvals(case_id)
    )


def _checkpoint_awake_and_has_inject(case_id: str) -> bool:
    """wake_workflow set current_step='awake' and the referral packet has an injected callback."""
    if not _awake(case_id):
        return False
    packet = workspace.get_case(case_id).get("referral_packet", {})
    return any(r.get("inject_callback") for r in packet.get("referrals", []))


def _escalation_decided_and_still_open(case_id: str) -> bool:
    """The escalation is ruled on and the commitment it concerns is still not delivered."""
    if not any(
        a.get("action_type") == "escalation" and a.get("decision") not in (None, "pending")
        for a in workspace.list_approvals(case_id)
    ):
        return False
    states = workspace.commitment_states(case_id)
    packet = workspace.get_case(case_id).get("referral_packet", {})
    return any(
        r.get("inject_callback") and states.get(r.get("type", "")) != "completed"
        for r in packet.get("referrals", [])
    )


def _overdue_and_unchased(case_id: str) -> bool:
    """A deadline has passed undelivered and that provider has not been chased yet."""
    return _awake(case_id) and bool(pending_nudges(case_id))


def _followup_went_unanswered(case_id: str) -> bool:
    """A chased provider stayed silent and the supervisor has not been told about it."""
    return bool(unanswered(case_id))


def _checkpoint_awake_no_pending_escalation(case_id: str) -> bool:
    """Wake has fired and no escalation is blocking — safe to write final memory."""
    return _awake(case_id) and not _pending_escalation(case_id)


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
        precondition=_pending_escalation,
        priority=60,
    ),
    PhaseSpec(
        label="8-followup",
        prompt_template=(
            "The supervisor approved the escalation on case {case_id}, so the scoped follow-up "
            "may now go out. Ask education_liaison to re-check its commitment for case {case_id} "
            "using only the fields it has been granted. Then stop."
        ),
        precondition=_escalation_decided_and_still_open,
        priority=70,
    ),
    PhaseSpec(
        label="9-nudge",
        prompt_template=(
            "Deadlines have passed on case {case_id} with commitments still open. Call "
            "send_followup to chase every provider that has not reported, then call "
            "get_commitment_states and report what changed. Then stop."
        ),
        precondition=_overdue_and_unchased,
        priority=75,
    ),
    PhaseSpec(
        label="10-unanswered",
        prompt_template=(
            "A provider on case {case_id} ignored its follow-up. Call notify_supervisor so the "
            "supervisor is told which commitment is still unreported, report which one, then stop."
        ),
        precondition=_followup_went_unanswered,
        priority=78,
    ),
    PhaseSpec(
        label="11-memory",
        prompt_template=(
            "Close the loop for case {case_id}: call preload_memory, then summarize every "
            "commitment status and which fields were withheld from each specialist."
        ),
        precondition=_checkpoint_awake_no_pending_escalation,
        priority=80,
    ),
]

# Cloud operator tools (infra/case_cli.py, infra/cloud_e2e.py) iterate phases
# in priority order. Derived from the registry, not a static list.
PHASES: list[tuple[str, str]] = [
    (spec.label, spec.prompt_template)
    for spec in sorted(PHASE_REGISTRY, key=lambda s: s.priority)
]
