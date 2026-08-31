"""Deterministic commitment-write guard.

Refuses to record fulfilment when the partner tool response explicitly
contradicts the claimed status.  Plain Python — no LLM call, no prompt.

Conservative policy: refuse only when the response positively asserts
the negative (e.g. ``enrollment_found: false`` against ``completed``).
Absent fields, ambiguous replies and error responses are allowed through
so that legitimate completions — including the Maya demo arc — are never
blocked by missing evidence.
"""

from __future__ import annotations

import hashlib
import threading
from typing import Any

_lock = threading.Lock()
_responses: dict[tuple[str, str], dict[str, Any]] = {}

SERVICE_TYPES = frozenset(
    {"education", "health", "legal", "shelter", "family_services"}
)

_PREFIX_TO_SERVICE: dict[str, str] = {
    "edu": "education",
    "hlth": "health",
    "leg": "legal",
    "shl": "shelter",
    "fam": "family_services",
}


def resolve_service_type(commitment_id: str) -> str | None:
    """Map a commitment_id (or bare service name) to a canonical service type."""
    if commitment_id in SERVICE_TYPES:
        return commitment_id
    return next(
        (svc for pfx, svc in _PREFIX_TO_SERVICE.items() if f"-{pfx}-" in commitment_id),
        None,
    )


# ------------------------------------------------------------------
# Response store — thread-safe, keyed by (case_id, service)
# ------------------------------------------------------------------

def record_response(case_id: str, service: str, response: dict[str, Any]) -> None:
    with _lock:
        _responses[(case_id, service)] = response


def last_response(case_id: str, service: str) -> dict[str, Any] | None:
    with _lock:
        return _responses.get((case_id, service))


def clear(case_id: str | None = None) -> None:
    with _lock:
        if case_id is None:
            _responses.clear()
        else:
            for key in [k for k in _responses if k[0] == case_id]:
                del _responses[key]


# ------------------------------------------------------------------
# Per-service contradiction rules
# ------------------------------------------------------------------

def _check_education(resp: dict[str, Any]) -> tuple[bool, str]:
    if resp.get("enrollment_found") is False:
        return True, "SIS returned enrollment_found: false"
    return False, ""


def _check_health(resp: dict[str, Any]) -> tuple[bool, str]:
    if resp.get("appointment_completed") is False:
        return True, "clinic returned appointment_completed: false"
    if resp.get("appointment_booked") is False:
        return True, "clinic returned appointment_booked: false"
    return False, ""


def _check_legal(resp: dict[str, Any]) -> tuple[bool, str]:
    if resp.get("accepted") is False:
        return True, "legal aid returned accepted: false"
    return False, ""


def _check_shelter(resp: dict[str, Any]) -> tuple[bool, str]:
    if resp.get("bed_confirmed") is False:
        return True, "shelter returned bed_confirmed: false"
    return False, ""


def _check_family(resp: dict[str, Any]) -> tuple[bool, str]:
    if resp.get("assessment_completed") is False:
        return True, "family services returned assessment_completed: false"
    if resp.get("assessment_scheduled") is False:
        return True, "family services returned assessment_scheduled: false"
    return False, ""


_CHECKERS: dict[str, Any] = {
    "education": _check_education,
    "health": _check_health,
    "legal": _check_legal,
    "shelter": _check_shelter,
    "family_services": _check_family,
}

_REMEDIATION: dict[str, str] = {
    "education": "Re-query the school SIS or escalate to supervisor for manual verification",
    "health": "Re-query the clinic or escalate to supervisor for manual verification",
    "legal": "Re-query legal aid or escalate to supervisor for manual verification",
    "shelter": "Re-query the shelter or escalate to supervisor for manual verification",
    "family_services": "Re-query family services or escalate to supervisor for manual verification",
}


# ------------------------------------------------------------------
# Public API
# ------------------------------------------------------------------

def check(case_id: str, service: str, claimed_status: str) -> dict[str, Any] | None:
    """Return a refusal dict if the claim contradicts the recorded response, else None.

    Only ``completed`` claims are checked — every other status is allowed
    unconditionally.  When no response has been recorded the claim is also
    allowed (absent evidence is not a contradiction).
    """
    if claimed_status != "completed":
        return None

    resp = last_response(case_id, service)
    if resp is None:
        return None

    checker = _CHECKERS.get(service)
    if checker is None:
        return None

    contradicted, detail = checker(resp)
    if not contradicted:
        return None

    return {
        "reason_code": "TOOL_RESPONSE_CONTRADICTION",
        "contradiction": detail,
        "remediation": _REMEDIATION.get(service, "Escalate to supervisor for manual verification"),
    }


def build_approval(case_id: str, service: str, refusal: dict[str, Any],
                    recipient: str = "") -> dict[str, str]:
    """Build the approval record the guard writes when it fires."""
    stable_key = f"{case_id}:guard:{service}"
    approval_id = f"apr-guard-{hashlib.sha256(stable_key.encode()).hexdigest()[:8]}"
    return {
        "approval_id": approval_id,
        "action_type": "commitment_guard",
        "commitment_type": service,
        "recipient": recipient,
        "policy_basis": ["tool_response_contradiction"],
        "decision": "pending",
        "reason": (
            f"Partner response contradicts fulfilment: {refusal['contradiction']}. "
            f"{refusal['remediation']}."
        ),
    }


def build_audit_event(service: str, refusal: dict[str, Any]) -> dict[str, str]:
    """Build the audit event the guard writes when it fires."""
    return {
        "event_type": "commitment_guard_refusal",
        "commitment_type": service,
        "verdict": "refuse",
        "reason_code": refusal["reason_code"],
        "contradiction": refusal["contradiction"],
        "remediation": refusal["remediation"],
    }
