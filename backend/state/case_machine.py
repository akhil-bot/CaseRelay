COMMITMENT_STATES: set[str] = {"pending", "scheduled", "completed", "unresolved", "blocked", "deferred"}

LEGAL_TRANSITIONS: dict[str, set[str]] = {
    "draft": {"active"},
    "active": {"monitoring", "closed"},
    "monitoring": {"closed"},
    "closed": set(),
}


class IllegalTransition(ValueError):
    pass


def assert_transition(current: str, target: str) -> None:
    allowed = LEGAL_TRANSITIONS.get(current)
    if allowed is None:
        raise IllegalTransition(f"unknown status: {current}")
    if target not in allowed:
        raise IllegalTransition(f"cannot move {current} → {target}")
