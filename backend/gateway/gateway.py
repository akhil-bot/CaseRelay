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

    Deployed engines (CASERELAY_AGENT set): the specialist code binds its own GEAP identity
    via RunContext before calling the gateway. We accept that identity after verifying it
    matches this engine's declared identity — preventing a code path from claiming to be a
    different engine. Cross-engine impersonation is prevented by A2A bearer-token auth at
    the transport layer; within the same process the deployment itself is the trust anchor.

    In-process agents (fleet runner, gate tests): RunContext.agent_identity, set by the
    calling agent module. No cryptographic verification is possible for same-process calls.
    """
    if _DEPLOYED_ENGINE:
        ctx = _ctx_mod.current()
        if not ctx.agent_identity:
            _log.error("deployed engine tool call with no agent_identity bound in RunContext")
            return ""
        from backend.identity.registry import AGENT_IDENTITIES
        _engine_name_to_key = {
            "education_liaison": "education",
            "health_coordination": "health",
            "legal_aid": "legal",
            "shelter_status": "shelter",
            "family_services": "family_services",
            "intake_authority": "intake",
            "continuity_orchestrator": "orchestrator",
            "safeguarding_verifier": "verifier",
        }
        engine_key = _engine_name_to_key.get(os.environ.get("CASERELAY_AGENT", ""))
        if not engine_key:
            _log.error("CASERELAY_AGENT=%r does not map to a known key", os.environ.get("CASERELAY_AGENT"))
            return ""
        expected_identity = AGENT_IDENTITIES.get(engine_key, "")
        if ctx.agent_identity != expected_identity:
            _log.error(
                "identity mismatch: RunContext has %r but engine %r expects %r",
                ctx.agent_identity, engine_key, expected_identity,
            )
            return ""
        _log.debug("principal resolved from verified RunContext on engine %s: %s", engine_key, ctx.agent_identity)
        return ctx.agent_identity

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
