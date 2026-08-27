"""AG-UI envelopes for the run event stream.

The portal reads a case's history from two places — the live SSE stream and the
recorded replay — and both speak AG-UI on the wire. This module is the only
translation point: a phase still narrates itself with CaseRelay's own vocabulary
(``phase_started``, ``commitment_overdue``, ``run_suspended``) and the durable
event log still stores exactly that, so nothing here touches storage.

Five of our names have a true AG-UI counterpart and travel as that type. The rest
have none — AG-UI has no notion of a missed deadline or a quarantined reply — and
travel as ``CUSTOM`` with our name in the event's ``name`` field. Either way the
full internal event rides along intact (``rawEvent`` on a typed event, ``value``
on a custom one), because the feed distinguishes every one of these names and a
collapse into five types would throw that away.

The envelopes are built as plain dicts rather than through ``ag_ui.core``'s
models. Those models are only installed where the AG-UI chat endpoint runs, and
this module is imported by every tool that imports the app — including the gate
suite, which must be able to load the app without the chat dependency. The field
names and their casing are the protocol's own, taken from those models.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

# Our event names that mean the same thing AG-UI's own types mean. A phase is a
# step; a run starting, finishing or failing is exactly that. Everything absent
# from this table is carried by CUSTOM rather than forced into an approximation.
#
# The portal reverses this table, so it has to stay one-to-one: a type standing
# for two of our names would arrive undecodable.
AGUI_TYPES: dict[str, str] = {
    "run_started": "RUN_STARTED",
    "run_completed": "RUN_FINISHED",
    "run_failed": "RUN_ERROR",
    "phase_started": "STEP_STARTED",
    "phase_complete": "STEP_FINISHED",
}


def _millis(event: dict[str, Any]) -> int:
    """The event's own time in epoch milliseconds, which is AG-UI's unit.

    Only the stream's control frames reach here without a stamp; every narrated
    event is stamped as it is pushed, so a replayed history keeps its real times.
    """
    raw = event.get("timestamp")
    if isinstance(raw, str) and raw:
        try:
            parsed = datetime.fromisoformat(raw)
        except ValueError:
            parsed = None
        if parsed is not None:
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return int(parsed.timestamp() * 1000)
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        return int(raw)
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def to_agui(event: dict[str, Any]) -> dict[str, Any]:
    """Wrap one internal run event in its AG-UI envelope.

    The envelope's own fields are filled from the event wherever AG-UI names the
    same fact — a case is the thread, a phase is the step name — so a standard
    AG-UI consumer reads something meaningful without unpacking the payload.
    """
    name = str(event.get("event") or "run_event")
    payload = dict(event)
    frame: dict[str, Any] = {
        "type": AGUI_TYPES.get(name, "CUSTOM"),
        "timestamp": _millis(event),
    }

    if frame["type"] == "CUSTOM":
        frame["name"] = name
        frame["value"] = payload
        return frame

    frame["rawEvent"] = payload

    if frame["type"] in ("RUN_STARTED", "RUN_FINISHED"):
        frame["threadId"] = str(event.get("case_id") or "")
        frame["runId"] = str(event.get("run_id") or "")
    elif frame["type"] == "RUN_ERROR":
        # AG-UI's `message` on this type is the failure, not the narration; the
        # narration stays on the payload where the feed reads it.
        frame["message"] = str(event.get("error") or event.get("message") or "run failed")
    else:
        frame["stepName"] = str(event.get("phase") or "")

    return frame
