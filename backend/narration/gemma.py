"""Gemma-powered session narrative summarizer.

Uses Google's open Gemma model (via Vertex AI) to generate concise
natural-language case session summaries from structured run events. A small
open model is architecturally appropriate here: the task is short-text
generation from structured data, not reasoning — and running it avoids
burning frontier-model quota on a mechanical rewrite.

Activated by CASERELAY_GEMMA_MODEL (default: gemma-4-26b-a4b-it-maas).
Set to empty string to disable.
"""

import logging
import os

_log = logging.getLogger("caserelay.narration.gemma")

_DEFAULT_MODEL = "gemma-4-26b-a4b-it-maas"

_SYSTEM_INSTRUCTION = (
    "You are a case-note assistant for a child-welfare coordination system. "
    "Given a sequence of structured run events from a CASA (Court Appointed Special Advocate) "
    "case session, produce a concise 2-4 sentence narrative summary suitable for a caseworker's "
    "file. Name the child, what services were contacted, which commitments were fulfilled or "
    "remain open, and any escalations. Use plain professional language. Do not invent facts "
    "not present in the events."
)


def _model_id() -> str | None:
    """Return the configured Gemma model id, or None if integration is disabled."""
    val = os.environ.get("CASERELAY_GEMMA_MODEL")
    if val is not None:
        return val.strip() or None
    return _DEFAULT_MODEL


def _format_events(events: list[dict]) -> str:
    """Turn run events into a compact textual prompt for Gemma."""
    lines: list[str] = []
    for ev in events:
        event_type = ev.get("event", "")
        message = ev.get("message", "")
        phase = ev.get("phase", "")
        if message:
            lines.append(f"[{event_type}] {message}")
        elif phase:
            lines.append(f"[{event_type}] phase={phase}")
    return "\n".join(lines) if lines else ""


def summarize_session(events: list[dict]) -> str | None:
    """Generate a narrative summary of a case run session using Gemma.

    Returns the summary text, or None if the model is disabled or the call fails.
    Never raises — failures are logged and swallowed so the run pipeline is unaffected.
    """
    model_id = _model_id()
    if not model_id:
        return None

    formatted = _format_events(events)
    if not formatted:
        return None

    try:
        from google import genai
        from google.genai import types
    except ImportError:
        _log.debug("google-genai SDK not available; Gemma summarization disabled")
        return None

    project = os.environ.get("CASERELAY_PROJECT_ID") or os.environ.get("GOOGLE_CLOUD_PROJECT", "caserelay")
    location = os.environ.get("CASERELAY_GEMMA_LOCATION", "global")

    try:
        client = genai.Client(vertexai=True, project=project, location=location)
        response = client.models.generate_content(
            model=model_id,
            config=types.GenerateContentConfig(
                system_instruction=_SYSTEM_INSTRUCTION,
                temperature=0.3,
                max_output_tokens=256,
                http_options=types.HttpOptions(timeout=10_000),
            ),
            contents=f"Summarize this case session:\n\n{formatted}",
        )
        text = response.text.strip() if response.text else None
        if text:
            _log.info("Gemma session summary generated (%d chars)", len(text))
        return text
    except Exception:
        _log.debug("Gemma summarization failed", exc_info=True)
        return None
