from typing import Any

from backend.runtime.workspace import workspace

FORBIDDEN_RAW = {
    "diagnosis",
    "medication",
    "clinical_notes",
    "legal_strategy",
    "narrative",
    "instruction",
}


def write(case_id: str, purpose: str, state: dict[str, Any]) -> dict[str, Any]:
    cleaned = {k: v for k, v in state.items() if k not in FORBIDDEN_RAW}
    workspace.get_case(case_id)
    workspace.set_memory(case_id, purpose, cleaned)
    return cleaned


def read(case_id: str, purpose: str) -> dict[str, Any]:
    workspace.get_case(case_id)
    return dict(workspace.memory.get(case_id, {}).get(purpose) or {})


def preload(case_id: str) -> dict[str, Any]:
    workspace.get_case(case_id)
    return {
        "case_id": case_id,
        "case_status": workspace.get_case(case_id)["status"],
        "commitment_states": workspace.commitment_states(case_id),
        "scopes": dict(workspace.memory.get(case_id, {})),
    }
