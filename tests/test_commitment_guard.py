"""Unit tests for the deterministic commitment guard.

The guard sits on the commitment-write path and refuses to record fulfilment
when the partner tool response explicitly contradicts the claim.  These tests
run offline with no credentials — the module under test is pure logic.

Run from the repo root:
    CASERELAY_STATE=memory pytest tests/test_commitment_guard.py -v
"""

import os

os.environ.setdefault("CASERELAY_STATE", "memory")

import pytest

from backend.guards.commitment_guard import (
    build_approval,
    build_audit_event,
    check,
    clear,
    record_response,
    resolve_service_type,
)
from backend.runtime.workspace import workspace


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _clean_guard():
    """Reset the guard's response store between tests."""
    clear()
    yield
    clear()


def _make_case_with_commitment(case_id: str, service: str) -> None:
    """Create a minimal case with one commitment row so set_commitment can find it."""
    workspace.create_case(case_id, {
        "case_id": case_id,
        "child": {"name": "Test Child", "dob": "2015-01-01"},
        "test_case": True,
        "referrals": [
            {
                "type": service,
                "referral_id": f"ref-{service}",
                "target_org": f"Test Org ({service})",
            }
        ],
    })
    workspace.commitments[case_id] = [
        {"commitment_id": f"cmt-{service}", "type": service, "status": "pending"},
    ]


# ---------------------------------------------------------------------------
# Core guard logic — check()
# ---------------------------------------------------------------------------


class TestCheckContradiction:
    """An explicit contradiction (field positively asserts the negative) is refused."""

    def test_education_enrollment_found_false(self):
        record_response("C1", "education", {"enrollment_found": False})
        refusal = check("C1", "education", "completed")
        assert refusal is not None
        assert refusal["reason_code"] == "TOOL_RESPONSE_CONTRADICTION"
        assert "enrollment_found" in refusal["contradiction"]

    def test_health_appointment_completed_false(self):
        record_response("C1", "health", {"appointment_completed": False})
        refusal = check("C1", "health", "completed")
        assert refusal is not None
        assert "appointment_completed" in refusal["contradiction"]

    def test_health_appointment_booked_false(self):
        record_response("C1", "health", {"appointment_booked": False})
        refusal = check("C1", "health", "completed")
        assert refusal is not None

    def test_legal_accepted_false(self):
        record_response("C1", "legal", {"accepted": False})
        refusal = check("C1", "legal", "completed")
        assert refusal is not None

    def test_shelter_bed_confirmed_false(self):
        record_response("C1", "shelter", {"bed_confirmed": False})
        refusal = check("C1", "shelter", "completed")
        assert refusal is not None

    def test_family_assessment_completed_false(self):
        record_response("C1", "family_services", {"assessment_completed": False})
        refusal = check("C1", "family_services", "completed")
        assert refusal is not None

    def test_family_assessment_scheduled_false(self):
        record_response("C1", "family_services", {"assessment_scheduled": False})
        refusal = check("C1", "family_services", "completed")
        assert refusal is not None


class TestCheckLegitimate:
    """A legitimate fulfilment claim (positive partner response) is allowed."""

    def test_education_enrollment_found_true(self):
        record_response("C1", "education", {"enrollment_found": True})
        assert check("C1", "education", "completed") is None

    def test_health_appointment_completed_true(self):
        record_response("C1", "health", {
            "appointment_booked": True, "appointment_completed": True,
        })
        assert check("C1", "health", "completed") is None

    def test_legal_accepted_true(self):
        record_response("C1", "legal", {"accepted": True, "counsel_assigned": True})
        assert check("C1", "legal", "completed") is None

    def test_shelter_bed_confirmed_true(self):
        record_response("C1", "shelter", {"bed_confirmed": True})
        assert check("C1", "shelter", "completed") is None

    def test_family_assessment_completed_true(self):
        record_response("C1", "family_services", {
            "assessment_scheduled": True, "assessment_completed": True,
        })
        assert check("C1", "family_services", "completed") is None


class TestCheckAbsentOrAmbiguous:
    """Absent or ambiguous evidence is allowed — never refused.

    This is the regression case that protects the Maya demo: a response
    with ``deferred: true`` and no ``enrollment_found`` field at all must
    pass through, because refusing on absence would break legitimate
    completions.
    """

    def test_no_recorded_response(self):
        """No partner response recorded at all — allow."""
        assert check("C1", "education", "completed") is None

    def test_field_missing_entirely(self):
        """Response has no enrollment_found field — allow."""
        record_response("C1", "education", {"note": "something else"})
        assert check("C1", "education", "completed") is None

    def test_deferred_response(self):
        """Maya's fan-out response: enrollment_found=False but status is deferred, not completed."""
        record_response("C1", "education", {
            "enrollment_found": False, "deferred": True,
        })
        assert check("C1", "education", "deferred") is None

    def test_generic_followup_overwrites_contradicting_response_known_gap(self):
        """Known gap: a generic follow-up reply (responded/resolved, no enrollment_found field)
        overwrites the earlier contradicting response in the flat evidence store, leaving
        the guard with nothing to check and allowing the completed write to proceed.
        This is a current limitation documented in docs/scenario-showcase.md — not
        intended behaviour of the guard itself.
        """
        record_response("C1", "education", {"enrollment_found": False})
        assert check("C1", "education", "completed") is not None

        record_response("C1", "education", {
            "responded": True, "resolved": True,
            "owner": {"name": "Sarah Miller"},
        })
        assert check("C1", "education", "completed") is None

    def test_error_response(self):
        """A timeout or malformed error has no boolean contradiction — allow."""
        record_response("C1", "education", {"error": "timeout"})
        assert check("C1", "education", "completed") is None

    def test_non_completed_status_never_checked(self):
        """Only 'completed' claims are checked; all other statuses pass unconditionally."""
        record_response("C1", "education", {"enrollment_found": False})
        for status in ("pending", "scheduled", "unresolved", "blocked", "deferred"):
            assert check("C1", "education", status) is None

    def test_unknown_service(self):
        """A service with no checker is allowed through."""
        record_response("C1", "unknown_svc", {"some_field": False})
        assert check("C1", "unknown_svc", "completed") is None


# ---------------------------------------------------------------------------
# Integration: set_commitment with guard
# ---------------------------------------------------------------------------


class TestSetCommitmentGuard:
    """The guard fires through workspace.set_commitment, the real write path."""

    def test_contradiction_blocks_write(self):
        _make_case_with_commitment("GUARD-1", "education")
        record_response("GUARD-1", "education", {"enrollment_found": False})

        refusal = workspace.set_commitment("GUARD-1", "education", "completed")

        assert refusal is not None
        assert refusal["reason_code"] == "TOOL_RESPONSE_CONTRADICTION"

        states = workspace.commitment_states("GUARD-1")
        assert states["education"] == "blocked", f"expected blocked, got {states['education']}"

    def test_legitimate_write_succeeds(self):
        _make_case_with_commitment("GUARD-2", "education")
        record_response("GUARD-2", "education", {"enrollment_found": True})

        refusal = workspace.set_commitment("GUARD-2", "education", "completed")
        assert refusal is None

        states = workspace.commitment_states("GUARD-2")
        assert states["education"] == "completed"

    def test_absent_evidence_allows_write(self):
        _make_case_with_commitment("GUARD-3", "education")

        refusal = workspace.set_commitment("GUARD-3", "education", "completed")
        assert refusal is None

        states = workspace.commitment_states("GUARD-3")
        assert states["education"] == "completed"

    def test_guard_writes_approval(self):
        _make_case_with_commitment("GUARD-4", "education")
        record_response("GUARD-4", "education", {"enrollment_found": False})

        workspace.set_commitment("GUARD-4", "education", "completed")

        approvals = workspace.list_approvals("GUARD-4")
        guard_approvals = [a for a in approvals if a.get("action_type") == "commitment_guard"]
        assert len(guard_approvals) == 1
        assert guard_approvals[0]["commitment_type"] == "education"
        assert guard_approvals[0]["decision"] == "pending"

    def test_guard_writes_audit_event(self):
        _make_case_with_commitment("GUARD-5", "education")
        record_response("GUARD-5", "education", {"enrollment_found": False})

        workspace.set_commitment("GUARD-5", "education", "completed")

        events = workspace.list_audit("GUARD-5")
        guard_events = [e for e in events if e.get("event_type") == "commitment_guard_refusal"]
        assert len(guard_events) == 1
        assert guard_events[0]["reason_code"] == "TOOL_RESPONSE_CONTRADICTION"
        assert guard_events[0]["commitment_type"] == "education"


# ---------------------------------------------------------------------------
# Refusal shape
# ---------------------------------------------------------------------------


class TestRefusalShape:
    """The refusal carries the three required fields."""

    def test_refusal_has_required_fields(self):
        record_response("C1", "education", {"enrollment_found": False})
        refusal = check("C1", "education", "completed")
        assert "reason_code" in refusal
        assert "contradiction" in refusal
        assert "remediation" in refusal

    def test_approval_shape(self):
        refusal = {"reason_code": "TOOL_RESPONSE_CONTRADICTION",
                    "contradiction": "test", "remediation": "test"}
        approval = build_approval("C1", "education", refusal, "Test Org")
        assert approval["action_type"] == "commitment_guard"
        assert approval["decision"] == "pending"
        assert "apr-guard-" in approval["approval_id"]

    def test_audit_event_shape(self):
        refusal = {"reason_code": "TOOL_RESPONSE_CONTRADICTION",
                    "contradiction": "test", "remediation": "test"}
        event = build_audit_event("education", refusal)
        assert event["event_type"] == "commitment_guard_refusal"
        assert event["verdict"] == "refuse"


# ---------------------------------------------------------------------------
# resolve_service_type
# ---------------------------------------------------------------------------


class TestResolveServiceType:
    def test_bare_service_name(self):
        assert resolve_service_type("education") == "education"

    def test_commitment_id_with_prefix(self):
        assert resolve_service_type("CR-1234-edu-001") == "education"

    def test_unknown_returns_none(self):
        assert resolve_service_type("random-string") is None


# ---------------------------------------------------------------------------
# Auto-close: workspace.try_close
# ---------------------------------------------------------------------------

SERVICES = ("education", "health", "legal", "shelter", "family_services")


def _make_full_case(case_id: str, *, statuses: dict[str, str] | None = None,
                    approvals: list[dict] | None = None) -> None:
    """Create a case at monitoring with five commitment rows."""
    workspace.create_case(case_id, {
        "case_id": case_id,
        "child": {"name": "Test Child", "dob": "2015-01-01"},
        "test_case": True,
        "referrals": [{"type": s, "referral_id": f"ref-{s}", "target_org": f"Org-{s}"}
                      for s in SERVICES],
    })
    workspace.commitments[case_id] = [
        {"commitment_id": f"cmt-{s}", "type": s, "status": (statuses or {}).get(s, "completed")}
        for s in SERVICES
    ]
    workspace.activate(case_id, "supervisor-test")
    if approvals:
        for a in approvals:
            workspace.add_approval(case_id, a)


class TestTryClose:
    """Auto-close fires only when every commitment is completed and nothing is pending."""

    def test_all_completed_no_approvals_closes(self):
        """Maya-like case: five completed, nothing pending → closes."""
        _make_full_case("CLOSE-1")
        assert workspace.try_close("CLOSE-1") is True
        case = workspace.get_case("CLOSE-1")
        assert case["status"] == "closed"
        assert "closed_at" in case

    def test_blocked_commitment_prevents_close(self):
        """Diego-like case: one blocked by guard → stays open."""
        _make_full_case("CLOSE-2", statuses={"education": "blocked"})
        assert workspace.try_close("CLOSE-2") is False
        assert workspace.get_case("CLOSE-2")["status"] == "monitoring"

    def test_pending_approval_prevents_close(self):
        """A pending approval of any kind blocks closure, even if all commitments complete."""
        _make_full_case("CLOSE-3", approvals=[{
            "approval_id": "apr-test-1",
            "action_type": "escalation",
            "decision": "pending",
        }])
        assert workspace.try_close("CLOSE-3") is False
        assert workspace.get_case("CLOSE-3")["status"] == "monitoring"

    def test_decided_approval_does_not_block(self):
        """An approval that has been decided no longer blocks closure."""
        _make_full_case("CLOSE-4", approvals=[{
            "approval_id": "apr-test-2",
            "action_type": "escalation",
            "decision": "approve",
            "decided_by": "supervisor",
        }])
        assert workspace.try_close("CLOSE-4") is True
        assert workspace.get_case("CLOSE-4")["status"] == "closed"

    def test_deferred_commitment_prevents_close(self):
        """A deferred commitment means a checkpoint is waiting; case must stay open."""
        _make_full_case("CLOSE-5", statuses={"shelter": "deferred"})
        assert workspace.try_close("CLOSE-5") is False
        assert workspace.get_case("CLOSE-5")["status"] == "monitoring"

    def test_pending_commitment_prevents_close(self):
        _make_full_case("CLOSE-6", statuses={"health": "pending"})
        assert workspace.try_close("CLOSE-6") is False

    def test_scheduled_commitment_prevents_close(self):
        _make_full_case("CLOSE-7", statuses={"legal": "scheduled"})
        assert workspace.try_close("CLOSE-7") is False

    def test_unresolved_commitment_prevents_close(self):
        """Unresolved means the partner couldn't fulfil it — not the same as done."""
        _make_full_case("CLOSE-8", statuses={"family_services": "unresolved"})
        assert workspace.try_close("CLOSE-8") is False

    def test_draft_status_cannot_close(self):
        """Only monitoring → closed is valid; a draft case must not jump."""
        workspace.create_case("CLOSE-9", {
            "case_id": "CLOSE-9",
            "child": {"name": "Test", "dob": "2015-01-01"},
            "test_case": True,
            "referrals": [{"type": "education", "referral_id": "r1", "target_org": "O"}],
        })
        workspace.commitments["CLOSE-9"] = [
            {"commitment_id": "c1", "type": "education", "status": "completed"},
        ]
        assert workspace.try_close("CLOSE-9") is False

    def test_no_commitments_prevents_close(self):
        """A case with zero commitments should not silently close."""
        workspace.create_case("CLOSE-10", {
            "case_id": "CLOSE-10",
            "child": {"name": "Test", "dob": "2015-01-01"},
            "test_case": True,
            "referrals": [],
        })
        workspace.activate("CLOSE-10", "supervisor-test")
        assert workspace.try_close("CLOSE-10") is False

    def test_guard_blocked_plus_pending_approval_prevents_close(self):
        """Diego exact scenario: one blocked commitment + its guard approval pending."""
        _make_full_case("CLOSE-11", statuses={"education": "blocked"},
                        approvals=[{
                            "approval_id": "apr-guard-edu",
                            "action_type": "commitment_guard",
                            "commitment_type": "education",
                            "decision": "pending",
                        }])
        assert workspace.try_close("CLOSE-11") is False
        assert workspace.get_case("CLOSE-11")["status"] == "monitoring"

    def test_stale_guard_approval_does_not_block(self):
        """Maya-like: guard fired during phase 8, nudge's generic followup overwrote the
        contradicting response (known gap), and education reached completed via that path.
        The guard approval is now stale — education is completed, so the approval is
        informational only and must not block closure.
        """
        _make_full_case("CLOSE-12", approvals=[{
            "approval_id": "apr-guard-edu-stale",
            "action_type": "commitment_guard",
            "commitment_type": "education",
            "decision": "pending",
        }])
        assert workspace.try_close("CLOSE-12") is True
        assert workspace.get_case("CLOSE-12")["status"] == "closed"

    def test_non_guard_pending_approval_still_blocks(self):
        """A pending escalation blocks closure even if all commitments complete."""
        _make_full_case("CLOSE-13", approvals=[{
            "approval_id": "apr-esc-1",
            "action_type": "escalation",
            "decision": "pending",
        }])
        assert workspace.try_close("CLOSE-13") is False

    def test_idempotent_on_already_closed(self):
        """Calling try_close on an already-closed case returns False, doesn't error."""
        _make_full_case("CLOSE-14")
        assert workspace.try_close("CLOSE-14") is True
        assert workspace.try_close("CLOSE-14") is False


# ---------------------------------------------------------------------------
# Maya arc integration: guard + phase preconditions + nudge + auto-close
# ---------------------------------------------------------------------------


class TestMayaArcWithGuard:
    """Trace Maya's post-guard arc phase by phase.

    Without the guard, phase 8-followup resolves education and 9-nudge never
    fires (observed on CR-0831110100).  With the guard, the SIS still returns
    enrollment_found: false, so any ``completed`` claim in phase 8 is blocked.
    This leaves education unresolved, which satisfies 9-nudge's precondition
    ``_overdue_and_unchased``.  The nudge calls ``partners.followup`` — a
    different API from ``school_callback`` — which returns a positive response
    with no ``enrollment_found`` field, overwriting the stale response and
    letting education reach ``completed``.

    Each step exercises the real code path (preconditions, guard, workspace,
    escalation module) against workspace state set up to match the point in
    Maya's run where that step fires.
    """

    CASE = "MAYA-GUARD-ARC"

    @pytest.fixture(autouse=True)
    def _setup_maya_case(self):
        """Build the case state Maya is in at the START of run 3.

        State at this point:
        - Case is ``monitoring``, activated by a supervisor
        - 4 of 5 commitments ``completed``; education is ``deferred``
        - A quarantine escalation has been raised AND decided (approved)
        - Per-commitment checkpoints exist and are woken
        - The education referral has ``inject_callback: true``
        """
        from backend.runtime.fleet import (
            _escalation_decided_and_still_open,
            _overdue_and_unchased,
        )
        self._esc_open = _escalation_decided_and_still_open
        self._nudge_ready = _overdue_and_unchased

        workspace.create_case(self.CASE, {
            "case_id": self.CASE,
            "child": {"name": "Maya", "dob": "2014-03-15"},
            "test_case": True,
            "referrals": [
                {"type": "education", "referral_id": "ref-edu",
                 "target_org": "Lincoln Unified School District",
                 "inject_callback": True},
                {"type": "health", "referral_id": "ref-hlth",
                 "target_org": "Riverbend Community Health"},
                {"type": "legal", "referral_id": "ref-leg",
                 "target_org": "Statewide Legal Aid Collective"},
                {"type": "shelter", "referral_id": "ref-shl",
                 "target_org": "Harborlight Youth Shelter"},
                {"type": "family_services", "referral_id": "ref-fam",
                 "target_org": "Mesa County Family Services"},
            ],
        })
        workspace.commitments[self.CASE] = [
            {"commitment_id": "cmt-edu", "type": "education",
             "status": "deferred", "deadline": "2026-08-01T00:00:00+00:00"},
            {"commitment_id": "cmt-hlth", "type": "health", "status": "completed"},
            {"commitment_id": "cmt-leg", "type": "legal", "status": "completed"},
            {"commitment_id": "cmt-shl", "type": "shelter", "status": "completed"},
            {"commitment_id": "cmt-fam", "type": "family_services", "status": "completed"},
        ]
        workspace.activate(self.CASE, "advocate")

        workspace.add_approval(self.CASE, {
            "approval_id": "apr-esc-maya",
            "action_type": "escalation",
            "decision": "approve",
            "decided_by": "advocate",
        })

        workspace.put_checkpoint(f"wf-{self.CASE}-edu", {
            "workflow_id": f"wf-{self.CASE}-edu",
            "case_id": self.CASE,
            "commitment_type": "education",
            "current_step": "awake",
            "state": "running",
        })

        record_response(self.CASE, "education", {
            "system": "lincoln_unified_sis",
            "enrollment_found": False,
            "deferred": True,
            "note": "Counselor not yet available to confirm enrollment.",
        })

        yield

    def test_step1_phase8_precondition_met(self):
        """Escalation decided + education not completed → phase 8 fires."""
        assert self._esc_open(self.CASE) is True

    def test_step2_guard_blocks_completed_claim(self):
        """Guard sees enrollment_found: false and blocks the completed claim."""
        refusal = check(self.CASE, "education", "completed")
        assert refusal is not None
        assert refusal["reason_code"] == "TOOL_RESPONSE_CONTRADICTION"

    def test_step3_phase8_blocks_education(self):
        """set_commitment returns a refusal and education stays blocked."""
        refusal = workspace.set_commitment(self.CASE, "education", "completed")
        assert refusal is not None
        states = workspace.commitment_states(self.CASE)
        assert states["education"] == "blocked"

    def test_step4_phase9_precondition_met_after_block(self):
        """After guard blocks education, 9-nudge's precondition is satisfied.

        This is the crux: _overdue_and_unchased returns True because education
        is blocked (not completed), its checkpoint is woken, it has no followup
        record, and the escalation is decided (not blocking).
        """
        workspace.set_commitment(self.CASE, "education", "completed")
        assert self._nudge_ready(self.CASE) is True

    def test_step5_nudge_resolves_education(self):
        """nudge_overdue calls partners.followup, which returns a generic positive reply
        with no enrollment_found field, overwriting the contradicting SIS response in the
        flat evidence store.  The guard subsequently sees no contradiction and permits
        the completed write.  This records current behaviour resulting from the known
        gap documented in docs/scenario-showcase.md.
        """
        workspace.set_commitment(self.CASE, "education", "completed")

        from backend.workflows.escalation import nudge_overdue
        results = nudge_overdue(self.CASE)

        edu_results = [r for r in results if r["service"] == "education"]
        assert len(edu_results) == 1
        assert edu_results[0]["answered"] is True

        states = workspace.commitment_states(self.CASE)
        assert states["education"] == "completed"

    def test_step6_full_arc_closes_case(self):
        """Records current end-to-end behaviour: guard blocks → nudge's generic followup
        overwrites contradicting evidence (known gap) → guard passes → case closes.
        Closure here depends on the flat-store overwrite described in docs/scenario-showcase.md,
        not on the guard being satisfied by fresh positive evidence.
        """
        refusal = workspace.set_commitment(self.CASE, "education", "completed")
        assert refusal is not None

        from backend.workflows.escalation import nudge_overdue
        nudge_overdue(self.CASE)

        states = workspace.commitment_states(self.CASE)
        assert states["education"] == "completed"

        closed = workspace.try_close(self.CASE)
        assert closed is True
        assert workspace.get_case(self.CASE)["status"] == "closed"
