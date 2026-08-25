import json
import os
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from backend.memory import bank as memory
from backend.runtime.workspace import workspace

_DEFAULT_DUE_DAYS = 17


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
    _publish_wake(case_id, workflow_id)
    return body


def _publish_wake(case_id: str, workflow_id: str) -> None:
    """Publish a wake event. Skipped in memory mode — no subscriber exists."""
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


def await_deadline(case_id: str, poll_interval: float = 2.0, max_wait: float = 300.0) -> dict:
    """Block until the case's checkpoint becomes due, then fire it.

    This is the demo-friendly path: the run genuinely waits for wall-clock time to pass.
    Returns the checkpoint dict with actual timing metadata. Raises TimeoutError if
    max_wait is exceeded before the deadline arrives (safety valve for Cloud Run's 900s limit).
    """
    import time

    workflow_id = f"wf-{case_id}"
    cp = workspace.get_checkpoint(workflow_id)
    if not cp:
        raise ValueError(f"no checkpoint for {case_id}")

    due_at = cp.get("due_at")
    if due_at is None:
        raise ValueError(f"checkpoint {workflow_id} has no due_at")
    if isinstance(due_at, str):
        due_at = datetime.fromisoformat(due_at.replace("Z", "+00:00"))
    if not due_at.tzinfo:
        due_at = due_at.replace(tzinfo=timezone.utc)

    start = time.monotonic()
    scheduled_at = datetime.now(timezone.utc)

    while True:
        now = datetime.now(timezone.utc)
        if now >= due_at:
            break
        elapsed = time.monotonic() - start
        if elapsed >= max_wait:
            raise TimeoutError(
                f"waited {elapsed:.1f}s for checkpoint {workflow_id} "
                f"(due_at={due_at.isoformat()}, now={now.isoformat()})"
            )
        remaining = (due_at - now).total_seconds()
        time.sleep(min(poll_interval, remaining + 0.1))

    fired_at = datetime.now(timezone.utc)
    elapsed_seconds = (fired_at - scheduled_at).total_seconds()

    workspace.update_checkpoint_state(workflow_id, "running")
    return {
        "workflow_id": workflow_id,
        "case_id": case_id,
        "due_at": due_at,
        "fired_at": fired_at,
        "waited_seconds": round(elapsed_seconds, 1),
        "state": "running",
    }


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
