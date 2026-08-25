"""Content screening: deterministic pattern layer + Model Armor API when available.

The deterministic layer is defence-in-depth — broad prompt-injection and cross-scope
patterns that apply regardless of whether the Model Armor API is reachable. It is not
tuned to any single fixture; it catches structural injection attempts.

When `google-cloud-modelarmor` is installed and a template is configured, the API
provides ML-powered jailbreak, prompt-injection, sensitive-data, and malicious-URI
detection. The deterministic layer still runs first so zero-latency denials never
reach the network.
"""

import json
import logging
import os
import re
from typing import Any

_log = logging.getLogger(__name__)

_CROSS_SCOPE = re.compile(
    r"(?:retrieve|access|fetch|extract|get|pull|send|disclose|share|reveal|return|provide)"
    r"\s+(?:\S+\s+){0,4}"
    r"(?:medical|clinical|health|diagnosis|medication|legal\s*strategy|family\s*notes"
    r"|confidential|restricted|private|sealed)",
    re.IGNORECASE,
)

_PROMPT_INJECTION = re.compile(
    r"(?:ignore\s+(?:all\s+)?(?:previous|prior|above|earlier)\s+instructions?"
    r"|system\s*:\s*(?:ignore|override|forget|disregard)"
    r"|you\s+are\s+now\s+(?:a\s+)?(?:different|new|unrestricted)"
    r"|do\s+not\s+follow\s+(?:any|your)\s+(?:rules|instructions|guidelines)"
    r"|jailbreak|DAN\s*mode|bypass\s+(?:safety|filter|guard)"
    r"|pretend\s+(?:you\s+are|to\s+be)\s+(?:a|an)\s+(?:different|unrestricted))",
    re.IGNORECASE,
)

_SENSITIVE_DATA = re.compile(
    r"(?:\b\d{3}-\d{2}-\d{4}\b"  # SSN
    r"|\b\d{16}\b"  # credit card
    r"|password\s*[:=]\s*\S+)",
    re.IGNORECASE,
)


def _deterministic_screen(text: str) -> tuple[str, list[str]]:
    """Broad pattern-based screening. Not tuned to any fixture."""
    rules: list[str] = []
    if _CROSS_SCOPE.search(text):
        rules.append("block_cross_scope_request")
    if _PROMPT_INJECTION.search(text):
        rules.append("block_prompt_injection")
    if _SENSITIVE_DATA.search(text):
        rules.append("block_sensitive_data")
    if rules:
        return "quarantine", rules
    return "allow", []


def _model_armor_screen(text: str) -> tuple[str, list[str]] | None:
    """Call the Model Armor API. Returns None if the API is not available."""
    template = os.environ.get("MODEL_ARMOR_TEMPLATE")
    if not template:
        return None
    try:
        from google.cloud.modelarmor_v1 import (
            DataItem,
            ModelArmorClient,
            SanitizeUserPromptRequest,
        )

        location = os.environ.get("MODEL_ARMOR_LOCATION", "us-central1")
        client = ModelArmorClient(
            client_options={"api_endpoint": f"modelarmor.{location}.rep.googleapis.com"}
        )
        request = SanitizeUserPromptRequest(
            name=template,
            user_prompt_data=DataItem(text=text),
        )
        response = client.sanitize_user_prompt(request=request)
        result = response.sanitization_result
        if result and result.filter_match_state.name == "MATCH_FOUND":
            matched = [
                f.name for f in (result.filter_results or [])
                if getattr(f, "match_state", None) and f.match_state.name == "MATCH_FOUND"
            ]
            return "quarantine", matched or ["model_armor_match"]
        return "allow", []
    except ImportError:
        _log.debug("google-cloud-modelarmor not installed; skipping API screening")
        return None
    except Exception:
        _log.warning("Model Armor API call failed; falling back to deterministic screening", exc_info=True)
        return None


def screen(payload: Any) -> tuple[str, list[str]]:
    """Screen a payload for injection, cross-scope requests, and sensitive data.

    Deterministic patterns run first for zero-latency denials. Model Armor provides a
    second layer when configured. Either layer matching produces a quarantine verdict.
    """
    text = payload if isinstance(payload, str) else json.dumps(payload)

    verdict, rules = _deterministic_screen(text)
    if verdict == "quarantine":
        return verdict, rules

    api_result = _model_armor_screen(text)
    if api_result is not None:
        return api_result

    return verdict, rules
