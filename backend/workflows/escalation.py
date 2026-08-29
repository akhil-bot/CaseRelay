"""What happens after a deadline is missed.

A wake tells CaseRelay that a deadline has passed with a commitment still open. This module
is the ladder that follows. The provider is chased once (:func:`nudge_overdue`) and one of
two things happens: it answers, which resolves the commitment and names the person who has
taken the referral on, or it stays silent, in which case the supervisor is told
(:func:`notify_supervisor`).

The supervisor notice is a different kind of approval from the safeguarding escalation the
verifier opens. "Nobody replied" and "the reply reached outside its scope" call for
different responses from a volunteer, so they must not look alike in the queue.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from backend.identity.registry import AGENT_IDENTITIES
from backend.partners import mcp_client as partners
from backend.runtime.workspace import workspace
from backend.workflows.durable import reconcile_commitments

SUPERVISOR_NOTICE = "supervisor_notice"

# The purpose each service's authority grant was issued under. A follow-up is scoped by the
# same grant as the original request, so chasing a provider discloses nothing extra.
GRANT_PURPOSES: dict[str, str] = {
    "education": "verify_school_enrollment",
    "health": "check_appointment_status",
    "legal": "check_referral_status",
    "shelter": "check_availability",
    "family_services": "check_assessment_schedule",
}


def _referrals(case_id: str) -> dict[str, dict[str, Any]]:
    return {r.get("type", ""): r for r in workspace.packet(case_id).get("referrals", [])}


def _allowed_fields(case_id: str, service: str) -> list[str]:
    grant = workspace.grant_for(
        case_id, AGENT_IDENTITIES.get(service, ""), GRANT_PURPOSES.get(service, ""),
    )
    return list(grant.get("allowed_fields") or []) if grant else []


def pending_nudges(case_id: str) -> list[str]:
    """Services still owed that have not been chased yet.

    A commitment qualifies when its deadline has passed, or when its own checkpoint has
    already woken and it is still undelivered. The second clause matters because the two
    clocks can disagree: a commitment's deadline is the real one on the referral, while
    the checkpoint that wakes the fleet is compressed into the demo window. Without it a
    commitment left open by a failed fan-out — a denied grant, an unreachable specialist —
    is unreachable by every rung of the ladder whenever its referral deadline is still in
    the future, so it is never chased, never escalated, and nobody is ever told.
    """
    referrals = _referrals(case_id)
    woken = {
        cp.get("commitment_type")
        for cp in workspace.list_case_checkpoints(case_id)
        if cp.get("current_step") == "awake" and cp.get("commitment_type")
    }
    pending: list[str] = []
    for row in reconcile_commitments(case_id):
        service = row["type"]
        if (referrals.get(service) or {}).get("followup"):
            continue
        if row.get("overdue") or (service in woken and row.get("status") != "completed"):
            pending.append(service)
    return pending


def unanswered(case_id: str) -> list[str]:
    """Services that were chased, never replied, and have not yet reached the supervisor."""
    notified = {
        a.get("commitment_type")
        for a in workspace.list_approvals(case_id)
        if a.get("action_type") == SUPERVISOR_NOTICE
    }
    return [
        service
        for service, referral in _referrals(case_id).items()
        if (referral.get("followup") or {}).get("answered") is False and service not in notified
    ]


def followup_record(case_id: str, service: str) -> dict[str, Any]:
    """What came back the last time this provider was chased, empty if it never was."""
    return (_referrals(case_id).get(service) or {}).get("followup") or {}


def nudge_overdue(case_id: str) -> list[dict[str, Any]]:
    """Chase every provider whose deadline passed with its commitment still open.

    A provider that answers names the officer who has taken the referral on, and that name
    is written back onto the referral rather than being read once and discarded. It is the
    difference between a commitment nobody owns and one somebody does, so it belongs on the
    case where every later reader can see it.
    """
    results: list[dict[str, Any]] = []
    referrals = _referrals(case_id)

    for service in pending_nudges(case_id):
        referral = referrals.get(service) or {}
        disclosed = _allowed_fields(case_id, service)
        reply = partners.followup(service, referral.get("referral_id", ""), case_id=case_id)
        answered = bool(reply.get("responded"))
        owner = reply.get("owner") or {}

        update: dict[str, Any] = {
            "followup": {
                "sent_at": datetime.now(timezone.utc).isoformat(),
                "answered": answered,
                "disclosed_fields": disclosed,
            }
        }
        if answered and owner.get("name"):
            update["contact"] = {"name": owner["name"], "role": owner.get("role")}
        workspace.update_referral(case_id, service, **update)

        if answered and reply.get("resolved"):
            workspace.set_commitment(case_id, service, "completed")

        workspace.append_audit(case_id, {
            "event_type": "followup",
            "agent_identity": AGENT_IDENTITIES.get(service, ""),
            "purpose": GRANT_PURPOSES.get(service, ""),
            "commitment_type": service,
            "disclosed_fields": disclosed,
            "verdict": "answered" if answered else "no_response",
            "explanation": reply.get("note", ""),
        })

        results.append({
            "service": service,
            "answered": answered,
            "owner": owner.get("name") or "",
            "disclosed_fields": disclosed,
        })
    return results


def notify_supervisor(case_id: str) -> list[dict[str, Any]]:
    """Raise every provider that ignored its follow-up to the supervisor for a decision."""
    referrals = _referrals(case_id)
    notices: list[dict[str, Any]] = []

    for service in unanswered(case_id):
        org = (referrals.get(service) or {}).get("target_org", "")
        reason = (
            f"{org} has not responded to the follow-up on the {service} commitment. "
            f"Its deadline has passed and nothing has come back."
        )
        approval = {
            "approval_id": f"apr-{uuid4().hex[:8]}",
            "action_type": SUPERVISOR_NOTICE,
            "commitment_type": service,
            "recipient": org,
            "policy_basis": ["missed_deadline", "unanswered_followup"],
            "decision": "pending",
            "reason": reason,
        }
        workspace.add_approval(case_id, approval)
        workspace.append_audit(case_id, {
            "event_type": "unresponsive_partner",
            "agent_identity": AGENT_IDENTITIES.get(service, ""),
            "commitment_type": service,
            "verdict": "supervisor_notified",
            "explanation": reason,
        })
        notices.append(approval)
    return notices
