import json
import re
from typing import Any

INJECTION = re.compile(
    r"retrieve.*medical|health.*records|legal.*strategy|medical notes",
    re.IGNORECASE,
)


def screen(payload: Any) -> tuple[str, list[str]]:
    text = payload if isinstance(payload, str) else json.dumps(payload)
    if INJECTION.search(text):
        return "quarantine", ["block_cross_scope_request"]
    return "allow", []
