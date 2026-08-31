"""Test data harness.

The agents read cases out of the store and nothing else — they have no notion of a fixture or a
synthetic case. This module is the only place that manufactures case data, so a test run can
create a throwaway case, exercise the fleet against it, and delete it afterwards without any of
that leaking into agent code or prompts.

Three sources:
  fixture   — the scripted demo referral packet under fixtures/, for the demo walkthrough
  synthetic — a generated packet under a fresh case id, for repeatable runs
  clone     — a copy of a case already in the store, seated on a fresh case id

All are written to the store as ordinary case data. Once ingested they are indistinguishable
to the agents, which is the point.
"""

from contextlib import contextmanager
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
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


def clone_case(
    source_case_id: str,
    case_id: str | None = None,
    volunteer: dict[str, str] | None = None,
) -> str:
    """Ingest a copy of an existing case's referral packet as a new draft case.

    Seeding from a case already in the store rather than from a scenario is how an operator
    gets a second case shaped like one they have, held by whoever they choose. What comes back
    is a case in its own right, not a view onto the source: it keeps the scenario and the
    partner behaviours, so a run against it behaves the same way, and nothing else it inherited
    still points at where it came from.

    Commitments and grants are not copied, for the same reason `create_case` does not write
    them: deriving those from the packet is the intake agent's job.
    """
    source = workspace.packet(source_case_id)
    case_id = case_id or synthetic.new_case_id()
    packet = _reseat(deepcopy(source), case_id)
    if volunteer:
        packet["volunteer_id"] = volunteer["volunteer_id"]
        packet["volunteer_name"] = volunteer["volunteer_name"]
    packet["cloned_from"] = source_case_id
    workspace.reset(case_id)
    workspace.create_case(case_id, packet)
    return case_id


def _reseat(packet: dict[str, Any], case_id: str) -> dict[str, Any]:
    """Re-derive everything in a copied packet that belonged to the case it came from.

    Two things would otherwise be wrong about the copy. Its record ids are derived from the
    source's case id, so both cases would write under one set of referral ids in Firestore and
    in the audit trail. And its referral dates are wherever the source had got to, so a clone
    of a case created last week would open with deadlines already spent. Ids come off the new
    case id; the schedule keeps the shape the source gave each partner but is re-anchored to
    today.
    """
    suffix = synthetic.case_suffix(case_id)
    referral_date = (datetime.now(timezone.utc) - timedelta(days=synthetic.REFERRAL_AGE_DAYS)).date()

    packet["case_id"] = case_id
    packet["source_document_ref"] = f"gs://caserelay-fixtures/{case_id.lower()}/referral-packet.pdf"

    child = packet.get("child")
    if isinstance(child, dict):
        child["child_id"] = f"child-{suffix}"

    court = packet.get("court")
    if isinstance(court, dict):
        court["docket_number"] = f"JV-{referral_date.year}-{suffix}"
        court["appointment_date"] = referral_date.isoformat()

    foster = packet.get("foster_family")
    if isinstance(foster, dict):
        foster["placement_date"] = referral_date.isoformat()

    for referral in packet.get("referrals", []):
        gap = _referral_gap(referral)
        referral["referral_id"] = f"{_referral_prefix(referral)}-{suffix}"
        referral["referral_date"] = referral_date.isoformat()
        referral["due_date"] = (referral_date + gap).isoformat()
        # The source may already have been run against. A new case has heard from nobody.
        referral["status"] = "sent"

    return packet


def _referral_prefix(referral: dict[str, Any]) -> str:
    """The service-scoped stem of a referral id, e.g. `edu` out of `edu-1042`."""
    referral_id = str(referral.get("referral_id") or "")
    stem = referral_id.rsplit("-", 1)[0] if "-" in referral_id else referral_id
    return stem or str(referral.get("type") or "ref")


def _referral_gap(referral: dict[str, Any]) -> timedelta:
    """How long the source gave this partner, so the clone gives them the same."""
    try:
        sent = date.fromisoformat(str(referral["referral_date"]))
        due = date.fromisoformat(str(referral["due_date"]))
    except (KeyError, ValueError):
        return timedelta(days=synthetic.DUE_OFFSETS.get(str(referral.get("type")), 17))
    return due - sent


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
    return workspace.activate(case_id, "test-harness")


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
