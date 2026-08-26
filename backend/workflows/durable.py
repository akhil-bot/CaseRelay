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


def schedule_commitment_checkpoints(case_id: str) -> list[dict]:
    """Write one checkpoint per commitment, each with its own due_at.

    Called by the orchestrator's schedule_wake tool during the checkpoint phase, AFTER
    fan-out has populated commitment states. Each commitment's deadline drives its own
    wake so staggered deadlines produce staggered wakes across days or weeks.

    When due_in is set (compressed demo timing), the per-commitment deadlines are spaced
    proportionally within the compressed window so each commitment still fires separately.
    """
    now = datetime.now(timezone.utc)
    case = workspace.get_case(case_id)
    due_in_str = case.get("due_in")

    commitments = workspace.commitments.get(case_id, [])
    raw_deadlines: dict[str, datetime] = {}
    for c in commitments:
        ctype = c.get("type", "")
        dl = c.get("deadline", "")
        if not (ctype and dl):
            continue
        if isinstance(dl, str):
            dt = datetime.fromisoformat(dl.replace("Z", "+00:00"))
        else:
            dt = dl
        if not getattr(dt, "tzinfo", None):
            dt = dt.replace(tzinfo=timezone.utc)
        raw_deadlines[ctype] = dt

    if not raw_deadlines:
        return [write_checkpoint(case_id)]

    sorted_types = sorted(raw_deadlines, key=lambda t: raw_deadlines[t])

    if due_in_str:
        total = _parse_duration(due_in_str)
        n = len(sorted_types)
        per_commitment_due = {
            ctype: now + total * ((i + 1) / n)
            for i, ctype in enumerate(sorted_types)
        }
    else:
        per_commitment_due = {}
        for ctype, dl in raw_deadlines.items():
            per_commitment_due[ctype] = dl if dl > now else now + timedelta(seconds=5)

    old_cp = workspace.get_checkpoint(f"wf-{case_id}")
    if old_cp:
        old_cp["state"] = "completed"
        old_cp["completed"] = True
        workspace.put_checkpoint(f"wf-{case_id}", old_cp)

    states = workspace.commitment_states(case_id)
    results: list[dict] = []
    for ctype, due_at in per_commitment_due.items():
        workflow_id = f"wf-{case_id}-{ctype}"
        body = {
            "workflow_id": workflow_id,
            "case_id": case_id,
            "commitment_type": ctype,
            "current_step": "sleeping",
            "commitment_states": states,
            "due_at": due_at,
            "state": "waiting",
            "retry_count": 0,
            "completed": False,
        }
        workspace.put_checkpoint(workflow_id, body)
        results.append(body)

    wf_ids = [f"wf-{case_id}-{t}" for t in per_commitment_due]
    memory.write(case_id, "checkpoint", {"workflow_ids": wf_ids, "current_step": "sleeping"})
    return results


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


_STALE_RUN_THRESHOLD = timedelta(minutes=10)


def _reclaim_stale(now: datetime) -> None:
    """Reclaim zombie runs and stranded checkpoints.

    A run is stale when its heartbeat_at is older than 10 minutes — no real run takes
    that long without updating its heartbeat (phases are seconds to low-minutes each,
    and every phase start/complete writes heartbeat_at). 10 minutes is 2-3x the longest
    observed full-run duration, so a live run will never be killed by this.

    A checkpoint stuck in 'running' state whose case has no active run is stranded —
    either the run that was supposed to process it died, or Bug 1's old dedup path acked
    its wake prematurely. Returning it to 'waiting' lets the next sweep fire it again.
    """
    from backend.state import store as _store

    active_runs = _store.query_active_runs() if _store.enabled() else [
        r for r in workspace.runs.values() if r.get("state") in ("running", "queued")
    ]

    still_active_case_ids: set[str] = set()
    for run in active_runs:
        heartbeat = run.get("heartbeat_at") or run.get("created_at", "")
        if not heartbeat:
            continue
        if isinstance(heartbeat, str):
            heartbeat = datetime.fromisoformat(heartbeat.replace("Z", "+00:00"))
        if not getattr(heartbeat, "tzinfo", None):
            heartbeat = heartbeat.replace(tzinfo=timezone.utc)
        if now - heartbeat < _STALE_RUN_THRESHOLD:
            still_active_case_ids.add(run.get("case_id", ""))
            continue
        run_id = run["run_id"]
        case_id = run.get("case_id", "")
        run["state"] = "failed"
        run["error"] = "reclaimed: no heartbeat for 10 minutes"
        _store.save_run(run_id, run)
        if run_id in workspace.runs:
            workspace.runs[run_id]["state"] = "failed"
            workspace.runs[run_id]["error"] = run["error"]
        _store.release_case_lock(case_id)

    running_cps = _store.query_running_checkpoints() if _store.enabled() else [
        cp for cp in workspace.list_checkpoints() if cp.get("state") == "running"
    ]
    for cp in running_cps:
        if cp.get("current_step") == "awake":
            continue
        case_id = cp.get("case_id", "")
        if case_id in still_active_case_ids:
            continue
        wf_id = cp["workflow_id"]
        cp["state"] = "waiting"
        workspace.checkpoints[wf_id] = cp
        _store.save_checkpoint(wf_id, cp)


def sweep(now: datetime | None = None) -> list[str]:
    """Fire every workflow that is due, mark each running so double-fire is impossible.

    This is the Cloud Scheduler target. It must be idempotent: calling it twice in the
    same second produces exactly one wake per workflow. Also reclaims stale runs and
    stranded checkpoints — see _reclaim_stale for the staleness contract.
    """
    if now is None:
        now = datetime.now(timezone.utc)

    _reclaim_stale(now)

    fired = []
    for cp in find_due(now=now):
        wf_id = cp["workflow_id"]
        case_id = cp.get("case_id", "")
        workspace.update_checkpoint_state(wf_id, "running")
        _publish_wake(case_id, wf_id)
        fired.append(wf_id)
    return fired


def resume_wake(case_id: str, workflow_id: str | None = None) -> dict:
    """Resume all due checkpoints for a case, coalescing near-simultaneous wakes.

    Marks every checkpoint in running state (set by sweep) as awake. Also catches any
    waiting checkpoint whose deadline has already passed so that a single run reconciles
    everything that is due, rather than requiring one push per commitment.
    """
    now = datetime.now(timezone.utc)
    all_cps = workspace.list_case_checkpoints(case_id)
    woken: list[dict] = []

    for cp in all_cps:
        if cp.get("state") == "running" and cp.get("current_step") != "awake":
            cp["current_step"] = "awake"
            workspace.put_checkpoint(cp["workflow_id"], cp)
            woken.append(cp)
        elif cp.get("state") == "waiting":
            due_at = cp.get("due_at")
            if isinstance(due_at, str):
                due_at = datetime.fromisoformat(due_at.replace("Z", "+00:00"))
            if due_at and due_at <= now:
                cp["current_step"] = "awake"
                cp["state"] = "running"
                workspace.put_checkpoint(cp["workflow_id"], cp)
                woken.append(cp)

    woken_ids = [cp["workflow_id"] for cp in woken]
    memory.write(case_id, "checkpoint", {"workflow_ids": woken_ids, "current_step": "awake"})

    workspace.append_audit(
        case_id,
        {
            "event_id": f"evt-wake-{uuid4().hex[:8]}",
            "event_type": "workflow_wake",
            "triggered_by": "scheduler",
            "workflow_ids": woken_ids,
            "agent_identity": "caserelay-scheduler",
        },
    )
    return woken[0] if woken else write_checkpoint(case_id)


def reconcile_commitments(case_id: str) -> list[dict]:
    """Compare each commitment's deadline against the clock and its actual status.

    A commitment is overdue when its deadline has passed AND the partner has not
    delivered (status is still pending, unresolved, or blocked). A completed commitment
    is never overdue regardless of whether the deadline has passed — the partner
    delivered, which is what matters.
    """
    now = datetime.now(timezone.utc)
    states = workspace.commitment_states(case_id)

    commitment_deadlines: dict[str, str] = {}
    for c in workspace.commitments.get(case_id, []):
        ctype = c.get("type", "")
        dl = c.get("deadline", "")
        if ctype and dl:
            commitment_deadlines[ctype] = dl

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
