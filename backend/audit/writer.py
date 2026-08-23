from datetime import datetime, timezone
from typing import Any

from google.api_core.exceptions import AlreadyExists

from backend.infra.firestore_client import get_db


class AuditMutationRejected(ValueError):
    pass


def write_audit(
    case_id: str,
    event_id: str,
    *,
    trace_id: str,
    workflow_id: str = "",
    event_type: str,
    agent_identity: str,
    input_summary: dict[str, Any] | None = None,
    output_summary: dict[str, Any] | None = None,
    disclosed_fields: list[str] | None = None,
    withheld_fields: list[str] | None = None,
    policy_rules_applied: list[str] | None = None,
    verdict: str | None = None,
    explanation: str | None = None,
) -> str:
    db = get_db()
    ref = (
        db.collection("cases")
        .document(case_id)
        .collection("audit_events")
        .document(event_id)
    )
    if ref.get().exists:
        raise AuditMutationRejected(f"audit event {event_id} already exists")
    body: dict[str, Any] = {
        "event_id": event_id,
        "trace_id": trace_id,
        "workflow_id": workflow_id,
        "event_type": event_type,
        "agent_identity": agent_identity,
        "timestamp": datetime.now(timezone.utc),
        "input_summary": input_summary or {},
        "output_summary": output_summary or {},
        "disclosed_fields": disclosed_fields or [],
        "withheld_fields": withheld_fields or [],
        "policy_rules_applied": policy_rules_applied or [],
    }
    if verdict:
        body["verdict"] = verdict
    if explanation:
        body["explanation"] = explanation
    try:
        ref.create(body)
    except AlreadyExists as exc:
        raise AuditMutationRejected(f"audit event {event_id} already exists") from exc
    return f"cases/{case_id}/audit_events/{event_id}"
