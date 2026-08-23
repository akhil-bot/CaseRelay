import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
FIXTURE_DIR = ROOT / "fixtures" / "cr-1042"


def load_json(name: str) -> Any:
    path = FIXTURE_DIR / name
    return json.loads(path.read_text())


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
