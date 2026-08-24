from typing import Any

from backend.runtime.workspace import workspace

REQUIRED_PACKET_KEYS = {
    "case_id",
    "child",
    "volunteer_id",
    "supervisor_id",
    "referrals",
}


def validate_packet(case_id: str) -> dict[str, Any]:
    packet = workspace.packet(case_id)
    missing = sorted(REQUIRED_PACKET_KEYS - set(packet))
    if missing:
        return {"valid": False, "case_id": case_id, "errors": [f"missing {k}" for k in missing]}
    child = packet.get("child") or {}
    if not child.get("name") or not child.get("dob"):
        return {"valid": False, "case_id": case_id, "errors": ["child.name and child.dob required"]}
    if len(packet.get("referrals") or []) != 5:
        return {"valid": False, "case_id": case_id, "errors": ["expected 5 referrals"]}
    return {
        "valid": True,
        "case_id": case_id,
        "child_name": child["name"],
        "referral_count": 5,
        "errors": [],
    }


def read_referral_packet(case_id: str) -> dict[str, Any]:
    """Return the raw referral packet. The agent must extract commitments itself."""
    return {"ok": True, "packet": workspace.packet(case_id)}


def add_commitment(
    case_id: str,
    commitment_type: str,
    owner_org: str,
    referral_id: str,
    deadline: str,
) -> dict[str, Any]:
    """Record one commitment the agent read off the packet. Call once per referral."""
    expected = {r["type"] for r in workspace.packet(case_id)["referrals"]}
    if commitment_type not in expected:
        return {"ok": False, "error": f"type must be one of {sorted(expected)}"}
    workspace.get_case(case_id)
    rows = list(workspace.commitments.get(case_id) or [])
    row = {
        "commitment_id": f"cmt-{referral_id}",
        "type": commitment_type,
        "status": "pending",
        "owner_org": owner_org,
        "referral_id": referral_id,
        "deadline": deadline,
    }
    rows = [r for r in rows if r["type"] != commitment_type] + [row]
    workspace.put_commitments(case_id, rows)
    return {
        "ok": True,
        "recorded": commitment_type,
        "commitment_count": len(rows),
        "still_missing": sorted(expected - {r["type"] for r in rows}),
    }


def propose_grant(
    case_id: str,
    agent_identity: str,
    purpose: str,
    allowed_fields: list[str],
    legal_basis: str,
) -> dict[str, Any]:
    """Propose one field-scoped authority grant. Intake can propose but never activate."""
    workspace.get_case(case_id)
    grants = list(workspace.grants.get(case_id) or [])
    raw = {
        "grant_id": f"grant-{purpose}",
        "granted_to": agent_identity,
        "purpose": purpose,
        "allowed_fields": allowed_fields,
        "legal_basis": legal_basis,
    }
    grant = _normalize_grant(raw)
    grants = [g for g in grants if g["purpose"] != grant["purpose"]] + [grant]
    workspace.put_grants(case_id, grants)
    return {
        "ok": True,
        "recorded": grant["purpose"],
        "allowed_fields": grant["allowed_fields"],
        "grant_count": len(grants),
        "approval_required": True,
    }


def finalize_intake(case_id: str) -> dict[str, Any]:
    """Confirm intake is complete. Fails loudly if a commitment or grant is missing."""
    rows = workspace.commitments.get(case_id, [])
    grants = workspace.grants.get(case_id, [])
    missing_types = sorted(
        {r["type"] for r in workspace.packet(case_id)["referrals"]} - {r["type"] for r in rows}
    )
    if missing_types or len(grants) != 5:
        return {
            "ok": False,
            "missing_commitment_types": missing_types,
            "grant_count": len(grants),
            "error": "every referral needs one commitment and one grant",
        }
    return {
        "ok": True,
        "case_id": case_id,
        "case_status": "draft",
        "commitment_count": len(rows),
        "grant_count": len(grants),
        "approval_required": True,
        "note": "case remains draft until a supervisor activates it",
    }


from backend.identity.registry import AGENT_IDENTITIES

CANONICAL_GRANTS = {
    "education": {
        "granted_to": AGENT_IDENTITIES["education"],
        "purpose": "verify_school_enrollment",
        "allowed_fields": ["child_name", "dob", "referral_id"],
        "legal_basis": "ferpa_court_order",
    },
    "health": {
        "granted_to": AGENT_IDENTITIES["health"],
        "purpose": "check_appointment_status",
        "allowed_fields": ["appointment_status", "provider_name", "appointment_date"],
        "legal_basis": "hipaa_signed_authorization",
    },
    "legal": {
        "granted_to": AGENT_IDENTITIES["legal"],
        "purpose": "check_referral_status",
        "allowed_fields": ["case_reference", "deadline"],
        "legal_basis": "state_juvenile_court_order",
    },
    "shelter": {
        "granted_to": AGENT_IDENTITIES["shelter"],
        "purpose": "check_availability",
        "allowed_fields": ["referral_id", "scheduling"],
        "legal_basis": "state_juvenile_court_order",
    },
    "family_services": {
        "granted_to": AGENT_IDENTITIES["family_services"],
        "purpose": "check_assessment_schedule",
        "allowed_fields": ["assessment_scheduling"],
        "legal_basis": "state_juvenile_court_order",
    },
}


def _normalize_grant(raw: dict) -> dict:
    blob = " ".join(str(v) for v in raw.values()).lower()
    key = None
    for name in CANONICAL_GRANTS:
        if name.replace("_", " ") in blob or name in blob or CANONICAL_GRANTS[name]["granted_to"] in blob:
            key = name
            break
    if key is None and raw.get("purpose") in {v["purpose"] for v in CANONICAL_GRANTS.values()}:
        key = next(k for k, v in CANONICAL_GRANTS.items() if v["purpose"] == raw.get("purpose"))
    if key:
        return {**raw, **CANONICAL_GRANTS[key], "status": "proposed"}
    return {**raw, "status": "proposed"}
