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
    """Purge the case and its subcollections so a reseed starts from draft."""
    if not enabled():
        return
    ref = _case_ref(case_id)
    for name in ("commitments", "authority_grants", "human_approvals", "audit_events",
                 "screening_verdicts"):
        for doc in ref.collection(name).stream():
            doc.reference.delete()
    ref.delete()


RUNS = "runs"


def save_run(run_id: str, run: dict[str, Any]) -> None:
    """Persist the run record (metadata only, not the transient event list)."""
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
    data.setdefault("events", [])
    return data


def list_runs_for_case(case_id: str) -> list[dict[str, Any]]:
    if not enabled():
        return []
    docs = _db().collection(RUNS).where("case_id", "==", case_id).stream()
    return [d.to_dict() or {} for d in docs]


def delete_runs_for_case(case_id: str) -> None:
    if not enabled():
        return
    for doc in _db().collection(RUNS).where("case_id", "==", case_id).stream():
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
