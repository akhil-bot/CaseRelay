from typing import Any

from google.api_core.exceptions import AlreadyExists

from backend.infra.firestore_client import get_db


class AuditMutationRejected(ValueError):
    pass


def append_event(case_id: str, event: dict[str, Any]) -> str:
    """Append a free-form event dict. Raises AuditMutationRejected if event_id already exists."""
    event_id = event["event_id"]
    db = get_db()
    ref = (
        db.collection("cases")
        .document(case_id)
        .collection("audit_events")
        .document(event_id)
    )
    try:
        ref.create(event)
    except AlreadyExists as exc:
        raise AuditMutationRejected(f"audit event {event_id} already exists") from exc
    return f"cases/{case_id}/audit_events/{event_id}"
