from typing import Any


def project(
    payload: dict[str, Any],
    allowed_fields: list[str],
) -> tuple[dict[str, Any], list[str], list[str]]:
    allow = set(allowed_fields)
    disclosed: list[str] = []
    withheld: list[str] = []
    projected: dict[str, Any] = {}
    for key, value in payload.items():
        if key in allow:
            projected[key] = value
            disclosed.append(key)
        else:
            withheld.append(key)
    return projected, disclosed, withheld
