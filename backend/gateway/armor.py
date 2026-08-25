"""Content screening via Google Cloud Model Armor.

All screening is performed by the Model Armor API (modelarmor.googleapis.com)
backed by a template that combines:
  - PI + Jailbreak detection (LOW_AND_ABOVE)
  - Malicious URI detection
  - SDP Advanced Config referencing a Cloud DLP inspect template with custom
    infoTypes for CaseRelay's cross-scope data policy (CASERELAY_CROSS_SCOPE_MEDICAL,
    CASERELAY_CROSS_SCOPE_LEGAL, CASERELAY_CROSS_SCOPE_FAMILY) plus built-in
    detectors for SSN, credit-card, etc.

Template: projects/caserelay/locations/us-central1/templates/caserelay-screen
DLP template: projects/caserelay/locations/us-central1/inspectTemplates/caserelay-cross-scope

Fails closed: if screening cannot execute, ScreeningUnavailable is raised.
The caller must treat this as a deny, never a silent allow.
"""

import json
import logging
import os
from typing import Any

_log = logging.getLogger(__name__)


class ScreeningUnavailable(RuntimeError):
    """Content screening cannot execute — the caller must treat this as a deny."""


def _extract_matched_filters(result) -> list[str]:
    """Walk the sanitization result and return filter names that matched.

    Uses proto-to-dict so extraction works regardless of nesting depth
    (SDP has an extra inspectResult level compared to PI+Jailbreak).
    """
    try:
        from google.protobuf.json_format import MessageToDict

        d = MessageToDict(result._pb)
    except Exception:
        return []
    matched = []
    for name, entry in d.get("filterResults", {}).items():
        if _dict_has_match(entry):
            matched.append(name)
    return matched


def _dict_has_match(obj) -> bool:
    if isinstance(obj, dict):
        if obj.get("matchState") == "MATCH_FOUND":
            return True
        return any(_dict_has_match(v) for v in obj.values())
    return False


def screen(payload: Any) -> tuple[str, list[str]]:
    """Screen a payload using the Model Armor API. Fails closed on any error."""
    template = os.environ.get("MODEL_ARMOR_TEMPLATE")
    if not template:
        raise ScreeningUnavailable(
            "MODEL_ARMOR_TEMPLATE not set — cannot screen content"
        )

    text = payload if isinstance(payload, str) else json.dumps(payload)

    try:
        from google.cloud.modelarmor_v1 import (
            DataItem,
            FilterMatchState,
            ModelArmorClient,
            SanitizeUserPromptRequest,
        )
    except ImportError as exc:
        raise ScreeningUnavailable("google-cloud-modelarmor not installed") from exc

    location = os.environ.get("MODEL_ARMOR_LOCATION", "us-central1")
    client = ModelArmorClient(
        client_options={"api_endpoint": f"modelarmor.{location}.rep.googleapis.com"}
    )
    request = SanitizeUserPromptRequest(
        name=template,
        user_prompt_data=DataItem(text=text),
    )

    try:
        response = client.sanitize_user_prompt(request=request)
    except Exception as exc:
        raise ScreeningUnavailable(f"Model Armor API call failed: {exc}") from exc

    result = response.sanitization_result
    if not result:
        raise ScreeningUnavailable("Model Armor returned no sanitization result")

    if result.filter_match_state == FilterMatchState.MATCH_FOUND:
        matched = _extract_matched_filters(result)
        _log.info("Model Armor quarantine: %s", matched)
        return "quarantine", matched or ["model_armor_match"]

    return "allow", []
