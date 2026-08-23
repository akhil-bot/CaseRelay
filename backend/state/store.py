"""Firestore persistence for the case aggregate.

Local runs keep everything in one process, so the in-memory workspace is enough. Once the eight
agents are separate endpoints they no longer share memory: the authority grants the orchestrator
writes must be readable by the education agent on another host. Every function here is a no-op
unless CASERELAY_STATE=firestore, which keeps the local path fast and offline.
"""

import os
from typing import Any

CASES = "cases"


def enabled() -> bool:
    return os.environ.get("CASERELAY_STATE", "").lower() == "firestore"


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
    for name in ("commitments", "authority_grants", "human_approvals", "audit_events"):
        for doc in ref.collection(name).stream():
            doc.reference.delete()
    ref.delete()


def save_checkpoint(workflow_id: str, body: dict[str, Any]) -> None:
    if not enabled():
        return
    _db().collection("workflow_checkpoints").document(workflow_id).set(body)


def load_checkpoint(workflow_id: str) -> dict[str, Any] | None:
    if not enabled():
        return None
    doc = _db().collection("workflow_checkpoints").document(workflow_id).get()
    return doc.to_dict() if doc.exists else None
