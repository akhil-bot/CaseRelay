import logging
import os
from typing import Any
from uuid import uuid4

from opentelemetry import trace as _otel_trace

from backend.identity.registry import IdentityDenied, assert_scope, verify
from backend.memory import bank as memory
from backend.policy.projection import project
from backend.runtime import context as _ctx_mod
from backend.runtime.workspace import workspace

_tracer = _otel_trace.get_tracer("caserelay.gateway")
_log = logging.getLogger(__name__)

_DEPLOYED_ENGINE = bool(os.environ.get("CASERELAY_AGENT"))


def _resolve_caller_principal() -> str:
    """Resolve the authenticated principal of the calling agent.

    Deployed engines (CASERELAY_AGENT set): the ONLY path is a verified ID token from the
    engine's own GCP credentials. RunContext fallback is structurally blocked — a deployed
    engine that cannot present a verified token is denied, never silently downgraded.

    In-process agents (fleet runner, gate tests): RunContext.agent_identity, set by the
    calling agent module. No cryptographic verification is possible for same-process calls.
    """
    try:
        import google.auth
        import google.auth.transport.requests
        from google.oauth2 import id_token

        request = google.auth.transport.requests.Request()
        token = id_token.fetch_id_token(request, audience="caserelay-gateway")
        claims = id_token.verify_oauth2_token(token, request, audience="caserelay-gateway")
        email = claims.get("email")
        if email:
            _log.debug("principal resolved from verified ID token: %s", email)
            return email
    except Exception as exc:
        if _DEPLOYED_ENGINE:
            _log.error("deployed engine MUST present a verified ID token; verification failed: %s", exc)
            return ""

    if _DEPLOYED_ENGINE:
        _log.error("deployed engine has no verified credential — RunContext fallback is structurally blocked")
        return ""

    ctx = _ctx_mod.current()
    if ctx.agent_identity:
        return ctx.agent_identity

    return ""


def authorized_context(case_id: str, purpose: str) -> dict[str, Any]:
    """Fields this identity may see. Extra case data is stripped here, not by the LLM."""
    ctx = _ctx_mod.current()
    with _tracer.start_as_current_span("gateway.disclosure") as span:
        span.set_attribute("caserelay.case_id", case_id)
        span.set_attribute("caserelay.commitment_type", purpose)
        span.set_attribute("caserelay.workflow_id", ctx.workflow_id or "")

        caller = _resolve_caller_principal()
        if not caller:
            workspace.append_audit(
                case_id,
                {
                    "event_id": f"evt-{uuid4().hex[:8]}",
                    "trace_id": ctx.trace_id,
                    "event_type": "denial",
                    "agent_identity": "",
                    "purpose": purpose,
                    "verdict": "deny",
                    "explanation": "no authenticated principal presented",
                },
            )
            raise IdentityDenied("no authenticated principal: caller must present credentials or context identity")

        verify(caller)
        grant = workspace.grant_for(case_id, caller, purpose)
        if not grant:
            workspace.append_audit(
                case_id,
                {
                    "event_id": f"evt-{uuid4().hex[:8]}",
                    "trace_id": ctx.trace_id,
                    "event_type": "denial",
                    "agent_identity": caller,
                    "purpose": purpose,
                    "verdict": "deny",
                    "explanation": f"no granted authority for {caller} / {purpose}",
                },
            )
            raise IdentityDenied(f"no granted authority for {caller} / {purpose}")

        if grant["granted_to"] != caller:
            workspace.append_audit(
                case_id,
                {
                    "event_id": f"evt-{uuid4().hex[:8]}",
                    "trace_id": ctx.trace_id,
                    "event_type": "denial",
                    "agent_identity": caller,
                    "purpose": purpose,
                    "expected_principal": grant["granted_to"],
                    "verdict": "deny",
                    "explanation": f"principal mismatch: caller {caller} does not match grant subject {grant['granted_to']}",
                },
            )
            raise IdentityDenied(
                f"principal mismatch: caller {caller} does not match grant subject {grant['granted_to']}"
            )

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

        for field in disclosed:
            try:
                assert_scope(caller, field)
            except IdentityDenied:
                workspace.append_audit(
                    case_id,
                    {
                        "event_id": f"evt-{uuid4().hex[:8]}",
                        "trace_id": _ctx_mod.current().trace_id,
                        "event_type": "denial",
                        "agent_identity": caller,
                        "purpose": purpose,
                        "denied_field": field,
                        "verdict": "deny",
                        "explanation": f"{caller} denied access to {field} by scope policy",
                    },
                )
                raise

        from backend.runtime.trace import tracer

        tracer.add(
            "gateway",
            caller,
            f"{purpose} — disclosed {disclosed}",
            {"withheld": withheld, "legal_basis": grant.get("legal_basis")},
        )
        audit_ref = workspace.append_audit(
            case_id,
            {
                "event_id": f"evt-{uuid4().hex[:8]}",
                "trace_id": _ctx_mod.current().trace_id,
                "event_type": "disclosure",
                "agent_identity": caller,
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
            "identity": caller,
            "purpose": purpose,
            "legal_basis": grant.get("legal_basis"),
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
