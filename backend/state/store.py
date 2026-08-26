"""Firestore persistence for the case aggregate.

Firestore is the default backend. Set CASERELAY_STATE=memory to run fully offline —
this is the opt-out, not the opt-in, so a misconfigured production deployment persists
correctly rather than silently discarding writes.
"""

import os
from typing import Any

CASES = "cases"

_state_env = os.environ.get("CASERELAY_STATE", "").lower()
BACKEND: str = "memory" if _state_env == "memory" else "firestore"


def enabled() -> bool:
    return BACKEND == "firestore"


def _db():
    from backend.infra.firestore_client import get_db

    return get_db()


def _case_ref(case_id: str):
    return _db().collection(CASES).document(case_id)


def load_case(case_id: str) -> dict[str, Any]:
    """Read the whole case aggregate. Returns empty dict when the case does not exist yet."""
    if not enabled():
        return {}
    doc = _case_ref(case_id).get()
    if not doc.exists:
        return {}
    case = doc.to_dict() or {}
    ref = _case_ref(case_id)
    return {
        "case": case,
        "commitments": [d.to_dict() for d in ref.collection("commitments").stream()],
        "grants": [d.to_dict() for d in ref.collection("authority_grants").stream()],
        "approvals": [d.to_dict() for d in ref.collection("human_approvals").stream()],
        "audit": [d.to_dict() for d in ref.collection("audit_events").stream()],
        "memory": (case.get("memory_scopes") or {}),
    }


def save_case(case_id: str, case: dict[str, Any], memory: dict[str, Any] | None = None) -> None:
    if not enabled():
        return
    payload = {k: v for k, v in case.items() if k != "memory_scopes"}
    if memory is not None:
        payload["memory_scopes"] = memory
    _case_ref(case_id).set(payload, merge=True)


def save_rows(case_id: str, collection: str, rows: list[dict[str, Any]], id_key: str) -> None:
    """Replace a subcollection. Rows are small and bounded per case, so a batch set is fine."""
    if not enabled():
        return
    db = _db()
    batch = db.batch()
    coll = _case_ref(case_id).collection(collection)
    for row in rows:
        doc_id = str(row.get(id_key) or row.get("purpose") or row.get("type"))
        batch.set(coll.document(doc_id), row)
    batch.commit()


def append_row(case_id: str, collection: str, row: dict[str, Any], doc_id: str) -> None:
    if not enabled():
        return
    _case_ref(case_id).collection(collection).document(doc_id).set(row)


def list_cases() -> list[dict[str, Any]]:
    """Every case in the store, for operator tooling. Cases are few; no pagination needed."""
    if not enabled():
        return []
    return [d.to_dict() or {} for d in _db().collection(CASES).stream()]


def delete_case(case_id: str) -> None:
    """Purge the case and its subcollections so a reseed starts from draft.

    Only the case aggregate. A case's wake state lives in top-level collections keyed
    by workflow id, so deleting a case means deleting those too — see
    delete_checkpoints_for_case and delete_case_lock, both of which the caller must
    also invoke. A checkpoint left behind outlives its case and fires forever.
    """
    if not enabled():
        return
    ref = _case_ref(case_id)
    for name in ("commitments", "authority_grants", "human_approvals", "audit_events",
                 "screening_verdicts"):
        for doc in ref.collection(name).stream():
            doc.reference.delete()
    ref.delete()


def case_exists(case_id: str) -> bool:
    """Whether the case document is still present, without reading its subcollections."""
    if not enabled():
        return False
    return _case_ref(case_id).get().exists


RUNS = "runs"


RUN_EVENTS = "events"


def save_run(run_id: str, run: dict[str, Any]) -> None:
    """Persist the run record. Events are excluded: they live in their own subcollection.

    The run document is rewritten on every phase transition, so carrying a growing event
    array on it would rewrite the whole history each time. Appending one document per
    event instead keeps each write the size of the event it stores.
    """
    if not enabled():
        return
    payload = {k: v for k, v in run.items() if k != "events"}
    _db().collection(RUNS).document(run_id).set(payload, merge=True)


def load_run(run_id: str) -> dict[str, Any] | None:
    if not enabled():
        return None
    doc = _db().collection(RUNS).document(run_id).get()
    if not doc.exists:
        return None
    data = doc.to_dict() or {}
    data["events"] = load_run_events(run_id)
    return data


def _run_events_ref(run_id: str):
    return _db().collection(RUNS).document(run_id).collection(RUN_EVENTS)


def save_run_event(run_id: str, seq: int, event: dict[str, Any]) -> None:
    """Store one run event under its run, keyed by its position in the run.

    The zero-padded sequence is the document id, so a plain read of the subcollection
    sorts back into the order the events were pushed without needing an index or a
    tie-break on timestamps that can repeat within a phase.
    """
    if not enabled():
        return
    _run_events_ref(run_id).document(f"{seq:05d}").set(event)


def load_run_events(run_id: str) -> list[dict[str, Any]]:
    """Every stored event for a run, in the order it was pushed."""
    if not enabled():
        return []
    docs = sorted(_run_events_ref(run_id).stream(), key=lambda d: d.id)
    return [d.to_dict() or {} for d in docs]


def delete_run_events(run_id: str) -> None:
    if not enabled():
        return
    for doc in _run_events_ref(run_id).stream():
        doc.reference.delete()


def list_runs_for_case(case_id: str) -> list[dict[str, Any]]:
    if not enabled():
        return []
    docs = _db().collection(RUNS).where("case_id", "==", case_id).stream()
    return [d.to_dict() or {} for d in docs]


def query_active_runs() -> list[dict[str, Any]]:
    """Return all runs in running or queued state (for reclamation checks)."""
    if not enabled():
        return []
    results = []
    for state in ("running", "queued"):
        docs = _db().collection(RUNS).where("state", "==", state).stream()
        results.extend(d.to_dict() for d in docs if d.to_dict())
    return results


def delete_runs_for_case(case_id: str) -> None:
    """Delete a case's runs and the events stored beneath them.

    Deleting a document leaves its subcollections in place, so the events have to be
    removed explicitly or they outlive both the run and the case that owned them.
    """
    if not enabled():
        return
    for doc in _db().collection(RUNS).where("case_id", "==", case_id).stream():
        delete_run_events(doc.id)
        doc.reference.delete()


def save_checkpoint(workflow_id: str, body: dict[str, Any]) -> None:
    if not enabled():
        return
    _db().collection("workflow_checkpoints").document(workflow_id).set(body)


def load_checkpoint(workflow_id: str) -> dict[str, Any] | None:
    if not enabled():
        return None
    doc = _db().collection("workflow_checkpoints").document(workflow_id).get()
    return doc.to_dict() if doc.exists else None


def query_due_checkpoints(now_ts) -> list[dict[str, Any]]:
    """Find waiting checkpoints where due_at <= now. Firestore mode only."""
    if not enabled():
        return []
    docs = (
        _db()
        .collection("workflow_checkpoints")
        .where("state", "==", "waiting")
        .where("due_at", "<=", now_ts)
        .stream()
    )
    return [d.to_dict() for d in docs if d.to_dict()]


def query_checkpoints_for_case(case_id: str) -> list[dict[str, Any]]:
    if not enabled():
        return []
    docs = _db().collection("workflow_checkpoints").where("case_id", "==", case_id).stream()
    return [d.to_dict() for d in docs if d.to_dict()]


def delete_checkpoint(workflow_id: str) -> None:
    if not enabled():
        return
    _db().collection("workflow_checkpoints").document(workflow_id).delete()


def delete_checkpoints_for_case(case_id: str) -> None:
    if not enabled():
        return
    for doc in _db().collection("workflow_checkpoints").where("case_id", "==", case_id).stream():
        doc.reference.delete()


def query_running_checkpoints() -> list[dict[str, Any]]:
    """Return all checkpoints in running state (for reclamation of stranded ones)."""
    if not enabled():
        return []
    docs = _db().collection("workflow_checkpoints").where("state", "==", "running").stream()
    return [d.to_dict() for d in docs if d.to_dict()]


_LOCK_STALE_SECONDS = 600


def try_acquire_case_lock(case_id: str, run_id: str) -> bool:
    """Atomically claim a per-case run lock via Firestore transaction.

    Prevents two Cloud Run instances from starting concurrent runs for the same case
    when multiple commitment deadlines fire close together. Pub/Sub is at-least-once,
    so duplicate delivery of the same checkpoint must also be a no-op. The transaction
    guarantees that exactly one of N racing pushes acquires the lock; the rest see
    state="running" and return False.

    A lock held longer than 10 minutes is considered stale (the owning instance likely
    died without releasing it) and is forcibly reclaimed by the new caller.
    """
    if not enabled():
        return True
    from google.cloud import firestore as _fs

    db = _db()
    lock_ref = db.collection("case_locks").document(case_id)

    @_fs.transactional
    def _acquire(transaction):
        snapshot = lock_ref.get(transaction=transaction)
        if snapshot.exists:
            data = snapshot.to_dict() or {}
            if data.get("state") == "running":
                acquired_at = data.get("acquired_at")
                if acquired_at is not None:
                    from datetime import datetime, timezone
                    now = datetime.now(timezone.utc)
                    if hasattr(acquired_at, "timestamp"):
                        age = (now - acquired_at.replace(tzinfo=timezone.utc)).total_seconds()
                    else:
                        age = 0
                    if age < _LOCK_STALE_SECONDS:
                        return False
                else:
                    return False
        from datetime import datetime, timezone
        transaction.set(lock_ref, {
            "case_id": case_id,
            "state": "running",
            "run_id": run_id,
            "acquired_at": datetime.now(timezone.utc),
        })
        return True

    try:
        return _acquire(db.transaction())
    except Exception:
        return False


def release_case_lock(case_id: str) -> None:
    if not enabled():
        return
    try:
        _db().collection("case_locks").document(case_id).set(
            {"case_id": case_id, "state": "idle"}, merge=True,
        )
    except Exception:
        pass


def delete_case_lock(case_id: str) -> None:
    if not enabled():
        return
    try:
        _db().collection("case_locks").document(case_id).delete()
    except Exception:
        pass


# -- screening verdicts --------------------------------------------------------

def save_screening_verdict(case_id: str, verdict: dict[str, Any]) -> None:
    """Persist the screening verdict for a case so any replica can read it."""
    if not enabled():
        return
    _case_ref(case_id).collection("screening_verdicts").document("latest").set(verdict)


def load_screening_verdict(case_id: str) -> dict[str, Any] | None:
    """Read the most recent screening verdict for a case."""
    if not enabled():
        return None
    doc = _case_ref(case_id).collection("screening_verdicts").document("latest").get()
    return doc.to_dict() if doc.exists else None
