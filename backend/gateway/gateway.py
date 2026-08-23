from typing import Any
from uuid import uuid4

from backend.identity.registry import IdentityDenied, PURPOSE_TO_IDENTITY, verify
from backend.memory import bank as memory
from backend.policy.projection import project
from backend.runtime.workspace import TRACE_ID, workspace


def authorized_context(case_id: str, purpose: str) -> dict[str, Any]:
    """Fields this identity may see. Extra case data is stripped here, not by the LLM."""
    target = PURPOSE_TO_IDENTITY[purpose]
    verify(target)
    grant = workspace.grant_for(case_id, target, purpose)
    if not grant:
        raise IdentityDenied(f"no granted authority for {target} / {purpose}")
    packet = workspace.packet(case_id)
    referral_id = fat_referral(purpose, packet)
    due = next((r["due_date"] for r in packet["referrals"] if r["referral_id"] == referral_id), None)
    fat = {
        "child_name": packet["child"]["name"],
        "dob": packet["child"]["dob"],
        "referral_id": referral_id,
        "case_reference": packet["court"]["docket_number"],
        "deadline": due,
        "appointment_status": "unknown",
        "provider_name": None,
        "appointment_date": None,
        "scheduling": "unknown",
        "assessment_scheduling": "unknown",
        "diagnosis": "WITHHOLD",
        "legal_strategy": "WITHHOLD",
        "family_notes": "WITHHOLD",
        "clinical_notes": "WITHHOLD",
    }
    projected, disclosed, withheld = project(fat, grant["allowed_fields"])
    from backend.runtime.trace import tracer

    tracer.add(
        "gateway",
        target,
        f"{purpose} — disclosed {disclosed}",
        {"withheld": withheld, "legal_basis": grant.get("legal_basis")},
    )
    # Every disclosure is recorded, not just the ones that trip a policy. The audit trail is the
    # artifact a supervisor or judge is shown, so it has to answer "what did this agent see, under
    # what authority" for each access — the in-process trace does not survive the request.
    audit_ref = workspace.append_audit(
        case_id,
        {
            "event_id": f"evt-{uuid4().hex[:8]}",
            "trace_id": TRACE_ID,
            "event_type": "disclosure",
            "agent_identity": target,
            "purpose": purpose,
            "legal_basis": grant.get("legal_basis"),
            "disclosed_fields": disclosed,
            "withheld_fields": withheld,
            "verdict": "allow",
        },
    )
    memory.write(
        case_id,
        purpose,
        {
            "status": "context_granted",
            "disclosed_fields": disclosed,
            "withheld_fields": withheld,
            "legal_basis": grant.get("legal_basis"),
            "verdict": "allow",
        },
    )
    return {
        "audit_ref": audit_ref,
        "identity": target,
        "purpose": purpose,
        "legal_basis": grant.get("legal_basis"),
        # The referral id addresses the partner that was already sent this referral; it carries no
        # facts about the child. allowed_fields governs child data, so it is returned on the
        # envelope rather than inside the projected payload — otherwise a specialist whose grant
        # covers only its own status fields has no handle to query its partner with.
        "referral_id": referral_id,
        "payload": projected,
        "disclosed_fields": disclosed,
        "withheld_fields": withheld,
    }


def fat_referral(purpose: str, packet: dict) -> str | None:
    mapping = {
        "verify_school_enrollment": "education",
        "check_appointment_status": "health",
        "check_referral_status": "legal",
        "check_availability": "shelter",
        "check_assessment_schedule": "family_services",
    }
    want = mapping[purpose]
    for row in packet["referrals"]:
        if row["type"] == want:
            return row["referral_id"]
    return None


