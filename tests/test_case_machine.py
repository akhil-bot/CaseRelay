"""Unit tests for the case status state machine.

These run without any GCP credentials or network access: the module under test
is pure logic — a transition table and a single raising function.

Run from the repo root:
    CASERELAY_STATE=memory pytest tests/test_case_machine.py -v
"""
import pytest

from backend.state.case_machine import (
    COMMITMENT_STATES,
    LEGAL_TRANSITIONS,
    IllegalTransition,
    assert_transition,
)


# ---------------------------------------------------------------------------
# Legal transitions — each must not raise
# ---------------------------------------------------------------------------


def test_draft_to_active():
    assert_transition("draft", "active")


def test_active_to_monitoring():
    assert_transition("active", "monitoring")


def test_active_to_closed():
    assert_transition("active", "closed")


def test_monitoring_to_closed():
    assert_transition("monitoring", "closed")


# ---------------------------------------------------------------------------
# Illegal transitions — each must raise IllegalTransition
# ---------------------------------------------------------------------------


def test_closed_is_terminal():
    """closed has no outgoing edges; nothing may leave it."""
    with pytest.raises(IllegalTransition):
        assert_transition("closed", "active")


def test_closed_cannot_reopen_to_monitoring():
    with pytest.raises(IllegalTransition):
        assert_transition("closed", "monitoring")


def test_draft_cannot_skip_to_monitoring():
    with pytest.raises(IllegalTransition):
        assert_transition("draft", "monitoring")


def test_draft_cannot_skip_to_closed():
    with pytest.raises(IllegalTransition):
        assert_transition("draft", "closed")


def test_monitoring_cannot_revert_to_active():
    """Transitions are one-way; no reversals are permitted."""
    with pytest.raises(IllegalTransition):
        assert_transition("monitoring", "active")


def test_unknown_status_raises():
    """A status string not in LEGAL_TRANSITIONS must always raise, never silently pass."""
    with pytest.raises(IllegalTransition):
        assert_transition("bogus", "active")


def test_self_transition_raises():
    """Moving to the current status is not permitted by the table."""
    with pytest.raises(IllegalTransition):
        assert_transition("active", "active")


# ---------------------------------------------------------------------------
# Structural invariants — guard against accidental table edits
# ---------------------------------------------------------------------------


def test_every_transition_source_is_a_known_status():
    """Every key in LEGAL_TRANSITIONS must also be reachable (or be 'draft')."""
    sources = set(LEGAL_TRANSITIONS.keys())
    # draft is the entry point so it need not appear as a target
    reachable = {"draft"} | {t for targets in LEGAL_TRANSITIONS.values() for t in targets}
    assert sources <= reachable, (
        f"transition sources not reachable from draft: {sources - reachable}"
    )


def test_every_transition_target_is_a_known_source_or_terminal():
    """Every target must be either another source or 'closed' (the only terminal)."""
    for _src, targets in LEGAL_TRANSITIONS.items():
        for target in targets:
            assert target in LEGAL_TRANSITIONS, (
                f"transition target {target!r} is not a known status in LEGAL_TRANSITIONS"
            )


def test_commitment_states_contains_expected_values():
    """The commitment state vocabulary must include the values the fleet writes."""
    required = {"pending", "completed", "deferred"}
    assert required <= COMMITMENT_STATES, (
        f"missing expected commitment states: {required - COMMITMENT_STATES}"
    )
