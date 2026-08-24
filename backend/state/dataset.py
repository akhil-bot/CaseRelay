"""Test data harness.

The agents read cases out of the store and nothing else — they have no notion of a fixture or a
synthetic case. This module is the only place that manufactures case data, so a test run can
create a throwaway case, exercise the fleet against it, and delete it afterwards without any of
that leaking into agent code or prompts.

Two sources:
  fixture   — the scripted CR-1042 referral packet under fixtures/, for the demo walkthrough
  synthetic — a generated packet under a fresh case id, for repeatable runs

Both are written to the store as ordinary case data. Once ingested they are indistinguishable
to the agents, which is the point.
"""

from contextlib import contextmanager
from typing import Any, Iterator

from backend.runtime.workspace import workspace
from backend.state import synthetic
from backend.state.fixtures import referral_packet


def create_case(case_id: str | None = None, source: str = "synthetic", scenario: str | None = None) -> str:
    """Ingest a referral packet as a draft case and return its id.

    Commitments and grants are deliberately not written here: deriving those from the packet is
    the intake agent's job, and pre-filling them would hide whether it actually worked.
    """
    if source == "fixture":
        packet = referral_packet()
        case_id = case_id or packet["case_id"]
        packet = {**packet, "case_id": case_id}
    elif source == "synthetic":
        case_id = case_id or synthetic.new_case_id()
        packet = synthetic.build_packet(case_id, scenario=scenario)
    else:
        raise ValueError(f"source must be 'fixture' or 'synthetic', got {source!r}")

    # Anything this module created is disposable, whatever its source. `purge` keys off this flag,
    # so a case that arrived through a real intake path can never be swept up by it.
    packet = {**packet, "test_case": True}
    workspace.reset(case_id)
    workspace.create_case(case_id, packet)
    return case_id


def delete_case(case_id: str) -> None:
    workspace.reset(case_id)


def grant_authority(case_id: str) -> dict[str, Any]:
    """Stand in for intake + supervisor approval so a component can be probed on its own.

    The full journey has the intake agent derive commitments and grants and a supervisor approve
    them. A test that only exercises the gateway or one specialist should not have to pay for
    those LLM turns, so this writes the same records directly and activates the case.
    """
    packet = workspace.packet(case_id)
    workspace.put_commitments(case_id, synthetic.build_commitments(packet))
    workspace.put_grants(case_id, synthetic.build_grants(packet))
    return workspace.activate(case_id)


@contextmanager
def temporary_case(case_id: str | None = None, source: str = "synthetic", scenario: str | None = None) -> Iterator[str]:
    """Create a case, yield its id, and delete it even if the test fails."""
    created = create_case(case_id, source, scenario=scenario)
    try:
        yield created
    finally:
        delete_case(created)


def case_summary(case_id: str) -> dict[str, Any]:
    packet = workspace.packet(case_id)
    return {
        "case_id": case_id,
        "child_name": packet["child"]["name"],
        "status": workspace.get_case(case_id)["status"],
        "referral_ids": [r["referral_id"] for r in packet["referrals"]],
        "commitments": workspace.commitment_states(case_id),
        "grants": len(workspace.grants.get(case_id, [])),
    }
