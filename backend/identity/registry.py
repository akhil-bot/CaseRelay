import logging
import os
from typing import Any

from backend.state.fixtures import agent_cards

_log = logging.getLogger(__name__)

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

_IDENTITY_ENV_VARS: list[tuple[str, str]] = [
    ("education", "CASERELAY_IDENTITY_EDUCATION"),
    ("health", "CASERELAY_IDENTITY_HEALTH"),
    ("legal", "CASERELAY_IDENTITY_LEGAL"),
    ("shelter", "CASERELAY_IDENTITY_SHELTER"),
    ("family_services", "CASERELAY_IDENTITY_FAMILY"),
    ("intake", "CASERELAY_IDENTITY_INTAKE"),
    ("orchestrator", "CASERELAY_IDENTITY_ORCHESTRATOR"),
    ("verifier", "CASERELAY_IDENTITY_VERIFIER"),
]

_DEPLOYED_ENGINE = bool(os.environ.get("CASERELAY_AGENT"))
_LOCAL_PLACEHOLDER_DOMAIN = "@LOCAL-PLACEHOLDER.invalid"

AGENT_IDENTITIES: dict[str, str] = {}
for _key, _env_var in _IDENTITY_ENV_VARS:
    _val = os.environ.get(_env_var, "")
    if not _val:
        if _DEPLOYED_ENGINE:
            raise RuntimeError(
                f"{_env_var} is not set on a deployed engine. "
                f"Source infra/fleet_endpoints.env or re-run infra/collect_endpoints.sh. "
                f"Fabricated identities are structurally blocked in deployed mode."
            )
        _val = f"caserelay-{_key.replace('_', '-')}{_LOCAL_PLACEHOLDER_DOMAIN}"
        _log.warning(
            "identity env var %s not set — using local placeholder %s "
            "(NOT a real platform principal)",
            _env_var, _val,
        )
    AGENT_IDENTITIES[_key] = _val

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

# ---------------------------------------------------------------------------
# Deployed engine: auto-register real principal from GCP credentials
# ---------------------------------------------------------------------------
# On Agent Runtime engines (CASERELAY_AGENT is set), the effective_identity assigned by the
# platform is the principal that google.auth.default() returns. This may differ from the
# env-var-based identity in AGENT_IDENTITIES, so we register it alongside the env-var entry
# so verify() can find either.
_ENGINE_AGENT = os.environ.get("CASERELAY_AGENT", "")
if _ENGINE_AGENT:
    _ENGINE_NAME_TO_KEY = {
        "education_liaison": "education",
        "health_coordination": "health",
        "legal_aid": "legal",
        "shelter_status": "shelter",
        "family_services": "family_services",
        "intake_authority": "intake",
        "continuity_orchestrator": "orchestrator",
        "safeguarding_verifier": "verifier",
    }
    _engine_key = _ENGINE_NAME_TO_KEY.get(_ENGINE_AGENT)
    if _engine_key:
        try:
            import google.auth as _gauth

            _creds, _ = _gauth.default()
            _sa_email = getattr(_creds, "service_account_email", None) or ""
            if _sa_email and _sa_email not in IDENTITIES:
                _base = next(
                    (v for v in IDENTITIES.values() if v.get("agent_key") == _engine_key),
                    None,
                )
                if _base:
                    IDENTITIES[_sa_email] = {**_base}
                    _log.info(
                        "auto-registered effective identity %s for %s", _sa_email, _ENGINE_AGENT
                    )
        except Exception as _exc:
            _log.warning("could not auto-register engine identity: %s", _exc)


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


def is_dev_default(identity: str) -> bool:
    """True if the identity is a local placeholder, not a real platform principal."""
    return identity.endswith(_LOCAL_PLACEHOLDER_DOMAIN)
