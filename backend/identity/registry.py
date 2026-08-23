from typing import Any

from backend.state.fixtures import agent_cards

IDENTITIES: dict[str, dict[str, Any]] = {}
for _card in agent_cards():
    IDENTITIES[_card["identity"]] = {
        "agent_id": _card["agent_id"],
        "owner_org": _card["owner_org"],
        "allowed_data_scopes": list(_card["allowed_data_scopes"]),
        "denied_data_scopes": list(_card["denied_data_scopes"]),
        "purpose": _card["purpose"],
    }

PURPOSE_TO_IDENTITY = {
    "verify_school_enrollment": "education-agent@caserelay.iam",
    "check_appointment_status": "health-agent@caserelay.iam",
    "check_referral_status": "legal-agent@caserelay.iam",
    "check_availability": "shelter-agent@caserelay.iam",
    "check_assessment_schedule": "family-agent@caserelay.iam",
}

TYPE_TO_PURPOSE = {
    "education": "verify_school_enrollment",
    "health": "check_appointment_status",
    "legal": "check_referral_status",
    "shelter": "check_availability",
    "family_services": "check_assessment_schedule",
}


class IdentityDenied(PermissionError):
    pass


def verify(identity: str) -> dict[str, Any]:
    card = IDENTITIES.get(identity)
    if not card:
        raise IdentityDenied(f"unknown agent identity: {identity}")
    return card


def assert_scope(identity: str, field: str) -> None:
    card = verify(identity)
    if field in card["denied_data_scopes"]:
        raise IdentityDenied(f"{identity} denied field {field}")
