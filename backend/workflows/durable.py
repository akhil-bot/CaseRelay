import json
import os
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from backend.memory import bank as memory
from backend.runtime.workspace import workspace

_DEFAULT_DUE_DAYS = 17


def _parse_duration(s: str) -> timedelta:
    """Parse a duration string like '45s', '5m', '2h', '17d' into a timedelta."""
    s = s.strip()
    if s.endswith("s"):
        return timedelta(seconds=int(s[:-1]))
    if s.endswith("m"):
        return timedelta(minutes=int(s[:-1]))
    if s.endswith("h"):
        return timedelta(hours=int(s[:-1]))
    if s.endswith("d"):
        return timedelta(days=int(s[:-1]))
    raise ValueError(f"cannot parse duration {s!r}; expected e.g. '45s', '17d'")


def write_checkpoint(case_id: str, due_at: datetime | None = None) -> dict:
    """Persist a workflow checkpoint for case_id.

    workflow_id is derived from case_id so two cases in flight never share a document.
    due_at defaults to now + 17 days but callers can override it (e.g. the API's due_in
    parameter) without touching any code path the scheduler relies on.
    """
    workflow_id = f"wf-{case_id}"
    if due_at is None:
        due_at = datetime.now(timezone.utc) + timedelta(days=_DEFAULT_DUE_DAYS)
    body = {
        "workflow_id": workflow_id,
        "case_id": case_id,
        "current_step": "sleeping",
        "commitment_states": workspace.commitment_states(case_id),
        "due_at": due_at,
        "state": "waiting",
        "retry_count": 0,
        "completed": False,
    }
    workspace.put_checkpoint(workflow_id, body)
    memory.write(case_id, "checkpoint", {"workflow_id": workflow_id, "current_step": "sleeping"})
    return body


def schedule_commitment_checkpoints(case_id: str) -> dict:
    """Write a checkpoint anchored at NOW with per-commitment deadlines.

    Called by the orchestrator's schedule_wake tool during the checkpoint phase, AFTER
    fan-out has populated commitment states. The due_at is anchored at this moment —
    not at case creation — so a short due_in always produces a visible gap between the
    run ending and the push arriving.

    Stores commitment_deadlines (from the referral packet) for reconciliation at wake time.
    The checkpoint's due_at is either now + due_in (demo) or the earliest commitment
    deadline (real), whichever applies.
    """
    now = datetime.now(timezone.utc)
    case = workspace.get_case(case_id)
    due_in_str = case.get("due_in")

    commitments = workspace.commitments.get(case_id, [])
    commitment_deadlines: dict[str, str] = {}
    for c in commitments:
        ctype = c.get("type", "")
        deadline = c.get("deadline", "")
        if ctype and deadline:
            commitment_deadlines[ctype] = deadline

    if due_in_str:
        due_at = now + _parse_duration(due_in_str)
    elif commitment_deadlines:
        parsed = []
        for dl in commitment_deadlines.values():
            if isinstance(dl, str):
                dt = datetime.fromisoformat(dl.replace("Z", "+00:00"))
            else:
                dt = dl
            if not getattr(dt, "tzinfo", None):
                dt = dt.replace(tzinfo=timezone.utc)
            parsed.append(dt)
        due_at = min(parsed)
        if due_at <= now:
            due_at = now + timedelta(seconds=5)
    else:
        due_at = now + timedelta(days=_DEFAULT_DUE_DAYS)

    workflow_id = f"wf-{case_id}"
    body = {
        "workflow_id": workflow_id,
        "case_id": case_id,
        "current_step": "sleeping",
        "commitment_states": workspace.commitment_states(case_id),
        "commitment_deadlines": commitment_deadlines,
        "due_at": due_at,
        "state": "waiting",
        "retry_count": 0,
        "completed": False,
    }
    workspace.put_checkpoint(workflow_id, body)
    memory.write(case_id, "checkpoint", {"workflow_id": workflow_id, "current_step": "sleeping"})
    return body


def _publish_wake(case_id: str, workflow_id: str) -> None:
    """Publish a wake event to Pub/Sub for consumption by the push handler."""
    from backend.state import store as _store
    if not _store.enabled():
        return
    project = os.environ.get("GOOGLE_CLOUD_PROJECT", "caserelay")
    topic = os.environ.get("PUBSUB_TOPIC_EVENTS", "caserelay-events")
    from google.cloud import pubsub_v1

    pubsub_v1.PublisherClient().publish(
        f"projects/{project}/topics/{topic}",
        json.dumps(
            {"event_type": "workflow_wake", "case_id": case_id, "workflow_id": workflow_id}
        ).encode(),
    ).result(timeout=10)


def find_due(now: datetime | None = None) -> list[dict]:
    """Return all waiting checkpoints whose due_at is at or before now.

    In Firestore mode this is a server-side query. In memory mode it iterates the
    local dict — same predicate, same result, no clock manipulation.
    """
    from backend.state import store

    if now is None:
        now = datetime.now(timezone.utc)

    if store.enabled():
        return store.query_due_checkpoints(now)

    due = []
    for cp in workspace.list_checkpoints():
        if cp.get("state") != "waiting":
            continue
        cp_due = cp.get("due_at")
        if cp_due is None:
            continue
        if isinstance(cp_due, str):
            cp_due = datetime.fromisoformat(cp_due.replace("Z", "+00:00"))
        if not cp_due.tzinfo:
            cp_due = cp_due.replace(tzinfo=timezone.utc)
        if cp_due <= now:
            due.append(cp)
    return due


def sweep(now: datetime | None = None) -> list[str]:
    """Fire every workflow that is due, mark each running so double-fire is impossible.

    This is the Cloud Scheduler target. It must be idempotent: calling it twice in the
    same second produces exactly one wake per workflow.
    """
    if now is None:
        now = datetime.now(timezone.utc)
    fired = []
    for cp in find_due(now=now):
        wf_id = cp["workflow_id"]
        case_id = cp.get("case_id", "")
        workspace.update_checkpoint_state(wf_id, "running")
        _publish_wake(case_id, wf_id)
        fired.append(wf_id)
    return fired


def resume_wake(case_id: str, workflow_id: str | None = None) -> dict:
    """Resume a workflow from its checkpoint, writing a scheduler audit event."""
    if workflow_id is None:
        workflow_id = f"wf-{case_id}"
    checkpoint = workspace.get_checkpoint(workflow_id) or write_checkpoint(case_id)
    checkpoint["current_step"] = "awake"
    checkpoint["state"] = "running"
    workspace.put_checkpoint(workflow_id, checkpoint)
    memory.write(case_id, "checkpoint", {"workflow_id": workflow_id, "current_step": "awake"})

    workspace.append_audit(
        case_id,
        {
            "event_id": f"evt-wake-{uuid4().hex[:8]}",
            "event_type": "workflow_wake",
            "triggered_by": "scheduler",
            "workflow_id": workflow_id,
            "due_at": checkpoint.get("due_at", ""),
            "agent_identity": "caserelay-scheduler",
        },
    )
    return checkpoint


def reconcile_commitments(case_id: str) -> list[dict]:
    """Compare each commitment's deadline against the clock and its actual status.

    A commitment is overdue when its deadline has passed AND the partner has not
    delivered (status is still pending, unresolved, or blocked). A completed commitment
    is never overdue regardless of whether the deadline has passed — the partner
    delivered, which is what matters.
    """
    now = datetime.now(timezone.utc)
    workflow_id = f"wf-{case_id}"
    cp = workspace.get_checkpoint(workflow_id)
    commitment_deadlines = (cp or {}).get("commitment_deadlines", {})
    states = workspace.commitment_states(case_id)
    results = []

    for ctype, status in states.items():
        deadline_str = commitment_deadlines.get(ctype, "")
        if not deadline_str:
            results.append({
                "type": ctype, "status": status,
                "deadline": None, "overdue": False,
                "verdict": "no_deadline",
            })
            continue

        if isinstance(deadline_str, str):
            deadline = datetime.fromisoformat(deadline_str.replace("Z", "+00:00"))
        else:
            deadline = deadline_str
        if not getattr(deadline, "tzinfo", None):
            deadline = deadline.replace(tzinfo=timezone.utc)

        deadline_passed = now >= deadline
        delivered = status in ("completed",)
        overdue = deadline_passed and not delivered

        if delivered:
            verdict = "completed_on_time" if not deadline_passed else "completed_late"
        elif deadline_passed:
            verdict = "overdue"
        else:
            verdict = "within_deadline"

        results.append({
            "type": ctype,
            "status": status,
            "deadline": deadline.isoformat(),
            "deadline_passed": deadline_passed,
            "overdue": overdue,
            "verdict": verdict,
        })
    return results
