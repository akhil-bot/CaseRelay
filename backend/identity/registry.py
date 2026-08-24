import os
from typing import Any

from backend.state.fixtures import agent_cards

_AGENT_ID_TO_KEY = {
    "education-liaison-v1": "education",
    "health-coordination-v1": "health",
    "legal-aid-v1": "legal",
    "shelter-status-v1": "shelter",
    "family-services-v1": "family_services",
    "intake-authority-v1": "intake",
    "continuity-orchestrator-v1": "orchestrator",
    "safeguarding-verifier-v1": "verifier",
}

AGENT_IDENTITIES: dict[str, str] = {
    "education": os.environ.get("CASERELAY_IDENTITY_EDUCATION", "caserelay-education@agent.caserelay.dev"),
    "health": os.environ.get("CASERELAY_IDENTITY_HEALTH", "caserelay-health@agent.caserelay.dev"),
    "legal": os.environ.get("CASERELAY_IDENTITY_LEGAL", "caserelay-legal@agent.caserelay.dev"),
    "shelter": os.environ.get("CASERELAY_IDENTITY_SHELTER", "caserelay-shelter@agent.caserelay.dev"),
    "family_services": os.environ.get("CASERELAY_IDENTITY_FAMILY", "caserelay-family@agent.caserelay.dev"),
    "intake": os.environ.get("CASERELAY_IDENTITY_INTAKE", "caserelay-intake@agent.caserelay.dev"),
    "orchestrator": os.environ.get("CASERELAY_IDENTITY_ORCHESTRATOR", "caserelay-orchestrator@agent.caserelay.dev"),
    "verifier": os.environ.get("CASERELAY_IDENTITY_VERIFIER", "caserelay-verifier@agent.caserelay.dev"),
}

IDENTITIES: dict[str, dict[str, Any]] = {}
for _card in agent_cards():
    _key = _AGENT_ID_TO_KEY.get(_card["agent_id"])
    if _key and _key in AGENT_IDENTITIES:
        IDENTITIES[AGENT_IDENTITIES[_key]] = {
            "agent_id": _card["agent_id"],
            "agent_key": _key,
            "owner_org": _card["owner_org"],
            "allowed_data_scopes": list(_card["allowed_data_scopes"]),
            "denied_data_scopes": list(_card["denied_data_scopes"]),
            "purpose": _card["purpose"],
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
