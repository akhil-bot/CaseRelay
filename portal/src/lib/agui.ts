/**
 * ── Reading AG-UI off the wire ────────────────────────────────────────────────
 * The control plane streams a run as AG-UI events, both live over SSE and on
 * replay. Four of CaseRelay's event names have a true AG-UI counterpart and
 * arrive as that type; the rest — a missed deadline, a quarantined reply, a
 * supervisor told — have none, and arrive as `CUSTOM` naming themselves.
 *
 * This is the only place that knows about the envelope. Everything downstream —
 * the feed, the needs-attention block, the timeline, the audit trail — keys off
 * the specific event name, so the decoder's job is to hand back that name along
 * with every field the event carried.
 */

import { EventType } from "@ag-ui/core";
import type { RunEvent } from "@/lib/api";

/**
 * The typed half of the wire vocabulary, read backwards.
 *
 * This mirrors the control plane's own table and has to stay one-to-one with it:
 * a type that stood for two of our names would arrive undecodable.
 */
const EVENT_NAME: Partial<Record<EventType, string>> = {
  [EventType.RUN_STARTED]: "run_started",
  [EventType.RUN_FINISHED]: "run_completed",
  [EventType.RUN_ERROR]: "run_failed",
  [EventType.STEP_STARTED]: "phase_started",
  [EventType.STEP_FINISHED]: "phase_complete",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Turns one AG-UI frame back into the event the case narrated.
 *
 * The payload rides in `value` on a custom event and `rawEvent` on a typed one,
 * which is where each belongs in the protocol. The envelope is authoritative
 * about which event this is, and its `runId`/`threadId` fill in a frame whose
 * payload carried neither — the stream's own control frames.
 *
 * A frame in our older shape is passed through unchanged, so a page held open
 * across a deployment keeps reading whichever revision answers it.
 */
export function decodeRunEvent(frame: unknown): RunEvent | null {
  if (!isRecord(frame)) return null;

  const type = frame.type;
  if (typeof type !== "string") {
    return typeof frame.event === "string" ? (frame as RunEvent) : null;
  }

  const payload = isRecord(frame.value)
    ? frame.value
    : isRecord(frame.rawEvent)
      ? frame.rawEvent
      : {};

  const name =
    type === EventType.CUSTOM && typeof frame.name === "string"
      ? frame.name
      : (EVENT_NAME[type as EventType] ?? type.toLowerCase());

  const decoded: RunEvent = { ...payload, event: name };

  if (decoded.run_id === undefined && typeof frame.runId === "string") {
    decoded.run_id = frame.runId;
  }
  if (decoded.case_id === undefined && typeof frame.threadId === "string") {
    decoded.case_id = frame.threadId;
  }

  return decoded;
}
