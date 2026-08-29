"""Synthetic case generation.

CR-1042 is the scripted demo case and its facts live in fixtures/. For repeatable testing we
need many cases that do not collide, so this module derives a complete, self-consistent case
from any case id: the referral packet, the commitments, and the authority grants a supervisor
would be asked to approve. Referral ids are derived from the case suffix, which keeps a case's
records identifiable in Firestore and in the audit trail.

An optional `scenario` parameter varies the partner behaviours and deadline schedule so the
simulator has something real to read from case state. Without a scenario the packet is the
clean-path baseline.
"""

import random
from datetime import datetime, timedelta, timezone
from typing import Any

from backend.identity.registry import AGENT_IDENTITIES

# type -> (referral prefix, grant prefix, identity, purpose, allowed fields, legal basis)
SERVICES: list[tuple[str, str, str, str, str, list[str], str]] = [
    (
        "education",
        "edu",
        "edu",
        AGENT_IDENTITIES["education"],
        "verify_school_enrollment",
        ["child_name", "dob", "referral_id"],
        "ferpa_court_order",
    ),
    (
        "health",
        "hlth",
        "hlth",
        AGENT_IDENTITIES["health"],
        "check_appointment_status",
        ["appointment_status", "provider_name", "appointment_date"],
        "hipaa_signed_authorization",
    ),
    (
        "legal",
        "leg",
        "leg",
        AGENT_IDENTITIES["legal"],
        "check_referral_status",
        ["case_reference", "deadline"],
        "state_juvenile_court_order",
    ),
    (
        "shelter",
        "shl",
        "shl",
        AGENT_IDENTITIES["shelter"],
        "check_availability",
        ["referral_id", "scheduling"],
        "state_juvenile_court_order",
    ),
    (
        "family_services",
        "fam",
        "fam",
        AGENT_IDENTITIES["family_services"],
        "check_assessment_schedule",
        ["assessment_scheduling"],
        "state_juvenile_court_order",
    ),
]

ORGS = {
    "education": "Lincoln Unified School District",
    "health": "Riverbend Community Health",
    "legal": "Statewide Legal Aid Collective",
    "shelter": "Harborlight Youth Shelter",
    "family_services": "Mesa County Family Services",
}

# How each organisation is referred to once it has already been named in full.
ORG_SHORT_NAMES = {
    "education": "Lincoln Unified",
    "health": "Riverbend",
    "legal": "Statewide Legal Aid",
    "shelter": "Harborlight",
    "family_services": "Mesa County",
}

# The person who owns the referral at each organisation. A referral whose contact is None
# has nobody named on the other side yet, which is a fact about the case, not missing data.
CONTACTS: dict[str, dict[str, str | None]] = {
    "education": {"name": "Sarah Miller", "role": "Enrollment Coordinator"},
    "health": {"name": "David Chen", "role": "Records Coordinator"},
    "legal": {"name": "Anna Reed", "role": "Staff Attorney"},
    "shelter": {"name": "Tom Barnes", "role": "Intake Supervisor"},
    "family_services": {"name": "Maria Lopez", "role": "Caseworker"},
}

SUPERVISOR_NAME = "Dana Whitfield"

FOSTER_FAMILY = {"household_name": "Nguyen", "caregiver_name": "Linh Nguyen"}

OWNER_AGENTS = {
    "education": "education-liaison-v1",
    "health": "health-coordination-v1",
    "legal": "legal-aid-v1",
    "shelter": "shelter-status-v1",
    "family_services": "family-services-v1",
}

NAMES = ["Maya", "Noah", "Amara", "Diego", "Priya", "Ellis", "Rosa", "Kai", "Leila", "Theo"]

# Default days from referral to each service's due date.
DUE_OFFSETS = {"education": 17, "health": 24, "legal": 14, "shelter": 31, "family_services": 36}

# Child name keyed by scenario id so tests are legible.
_SCENARIO_CHILD = {
    "noah": "Noah",
    "priya": "Priya",
    "diego": "Diego",
    "rosa": "Rosa",
    "ellis": "Ellis",
    "theo": "Theo",
    "maya": "Maya",
    "kai": "Kai",
    "amara": "Amara",
}


def new_case_id() -> str:
    """A fresh case id that will not collide with an earlier test run."""
    return f"CR-{datetime.now(timezone.utc).strftime('%m%d%H%M%S')}"


def _suffix(case_id: str) -> str:
    digits = "".join(ch for ch in case_id if ch.isdigit())
    return digits or "0000"


def advocate_for(case_id: str) -> tuple[str, str]:
    """Which advocate holds this case, as (id, name).

    A supervisor's question is not "how many cases are there" but "who on my team
    is behind", and a caseload that all belongs to one person cannot answer it.

    Derived from the case id rather than drawn at random, so a reseed hands a case
    back to the same advocate and a supervisor's grouped caseload does not
    reshuffle underneath them between runs. The roster is fixture data — see
    backend/state/fixtures.py::advocates for why it is not a constant here.
    """
    from backend.state.fixtures import advocates, referral_packet

    # The scripted demo case's facts come from its own fixture, and both the docs
    # and the portal name its advocate. Deriving a different one here would leave
    # two answers in the store for the same case.
    scripted = referral_packet()
    if case_id == scripted.get("case_id"):
        return scripted["volunteer_id"], scripted["volunteer_name"]

    roster = advocates()
    row = roster[int(_suffix(case_id)) % len(roster)]
    return row["volunteer_id"], row["volunteer_name"]


def build_packet(case_id: str, scenario: str | None = None) -> dict[str, Any]:
    """A referral packet for this case.

    Deterministic per (case_id, scenario) so reruns match. The scenario parameter drives
    which partner behaviours are set on the referrals so sim.py can read them from state
    rather than from a caller-supplied argument.
    """
    from backend.state.scenarios import get_scenario

    spec = get_scenario(scenario) if scenario else None
    suffix = _suffix(case_id)
    rng = random.Random(f"{suffix}-{scenario or ''}")
    referral_date = datetime.now(timezone.utc) - timedelta(days=17)

    # Per-scenario due-date offsets override the defaults.
    due_offsets = dict(DUE_OFFSETS)
    if spec and spec.due_offsets:
        due_offsets.update(spec.due_offsets)

    partner_behaviours = (spec.partner_behaviours if spec else {}) or {}
    inject_map = (spec.inject_callback if spec else {}) or {}
    unnamed_contacts = set(spec.unnamed_contacts if spec else ())
    defer_first_set = set(spec.defer_first if spec else ())

    referrals = []
    for service, ref_prefix, _grant, _identity, _purpose, _fields, _basis in SERVICES:
        due = referral_date + timedelta(days=due_offsets[service])
        referral: dict[str, Any] = {
            "type": service,
            "referral_id": f"{ref_prefix}-{suffix}",
            "target_org": ORGS[service],
            "target_org_short": ORG_SHORT_NAMES[service],
            "contact": None if service in unnamed_contacts else dict(CONTACTS[service]),
            "referral_date": referral_date.date().isoformat(),
            "due_date": due.date().isoformat(),
            "status": "sent",
        }
        behaviour = partner_behaviours.get(service)
        if behaviour:
            referral["partner_behaviour"] = behaviour
        if inject_map.get(service):
            referral["inject_callback"] = True
        if service in defer_first_set:
            referral["first_contact_defer"] = True
        referrals.append(referral)

    volunteer_id, volunteer_name = advocate_for(case_id)

    dob = datetime(rng.randint(2012, 2019), rng.randint(1, 12), rng.randint(1, 28))

    # Use the scenario's canonical child name if available.
    if spec and spec.child_name:
        child_name = spec.child_name
    else:
        child_name = rng.choice(NAMES)

    return {
        "case_id": case_id,
        "child": {
            "child_id": f"child-{suffix}",
            "name": child_name,
            "dob": dob.date().isoformat(),
        },
        "volunteer_id": volunteer_id,
        "volunteer_name": volunteer_name,
        "supervisor_id": "supervisor-001",
        "supervisor_name": SUPERVISOR_NAME,
        "retention_policy": "standard_7y",
        "source_document_ref": f"gs://caserelay-fixtures/{case_id.lower()}/referral-packet.pdf",
        "court": {
            "docket_number": f"JV-2026-{suffix}",
            "appointment_date": referral_date.date().isoformat(),
            "judge_name": "Hon. Rivera",
        },
        "foster_family": {
            "household_name": FOSTER_FAMILY["household_name"],
            "placement_date": referral_date.date().isoformat(),
            "caregiver_name": FOSTER_FAMILY["caregiver_name"],
        },
        "referrals": referrals,
        "synthetic": True,
        "scenario": scenario,
        "test_case": True,
    }


def build_commitments(packet: dict[str, Any]) -> list[dict[str, Any]]:
    suffix = _suffix(packet["case_id"])
    by_type = {r["type"]: r for r in packet["referrals"]}
    rows = []
    for service, ref_prefix, _g, _i, _p, _f, _b in SERVICES:
        referral = by_type[service]
        rows.append(
            {
                "commitment_id": f"cmt-{ref_prefix}-{suffix}",
                "type": service,
                "status": "pending",
                "owner_agent": OWNER_AGENTS[service],
                "owner_org": referral["target_org"],
                "deadline": f"{referral['due_date']}T00:00:00Z",
                "referral_id": referral["referral_id"],
                "referral_date": f"{referral['referral_date']}T00:00:00Z",
                "response_payload": None,
            }
        )
    return rows


def build_grants(packet: dict[str, Any]) -> list[dict[str, Any]]:
    suffix = _suffix(packet["case_id"])
    grants = []
    for _service, _ref, grant_prefix, identity, purpose, fields, basis in SERVICES:
        grants.append(
            {
                "grant_id": f"grant-{grant_prefix}-{suffix}",
                "granted_to": identity,
                "purpose": purpose,
                "allowed_fields": list(fields),
                "legal_basis": basis,
                "status": "proposed",
            }
        )
    return grants
