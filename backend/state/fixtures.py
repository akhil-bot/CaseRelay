import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
FIXTURE_ROOT = ROOT / "fixtures"
FIXTURE_DIR = FIXTURE_ROOT / "cr-1042"


def load_json(name: str) -> Any:
    path = FIXTURE_DIR / name
    return json.loads(path.read_text())


def advocates() -> list[dict]:
    """The demo advocate roster, as (volunteer_id, volunteer_name) records.

    Here rather than in code with the rest of the synthetic constants for one
    reason: these are volunteer identities, and a volunteer identity written into
    backend/ is the thing that once got stamped on every run as the acting user.
    The harness checks for it (harness/gate.py, t11.3), so the roster stays data.
    """
    return json.loads((FIXTURE_ROOT / "advocates.json").read_text())


def referral_packet() -> dict:
    return load_json("referral_packet.json")


def commitments() -> list[dict]:
    return load_json("commitments.json")


def proposed_grants() -> list[dict]:
    return load_json("proposed_grants.json")


def agent_cards() -> list[dict]:
    return load_json("agent_cards.json")


def poisoned_school_payload() -> dict:
    return load_json("poisoned_school_payload.json")


def enrollment_callback() -> dict:
    return load_json("enrollment_callback.json")
