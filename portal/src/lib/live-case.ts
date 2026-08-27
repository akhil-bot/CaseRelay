"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  getCase,
  listCaseRuns,
  listCaseEvents,
  parseRunEventFrame,
  streamRunEvents,
  getRunStatus,
  type LiveCaseDetail,
  type CaseRunSummary,
  type RunEvent,
  type RunStatus,
} from "@/lib/api";

// ---------------------------------------------------------------------------
// useLiveCase — case detail, its runs, and everything recorded against them
// ---------------------------------------------------------------------------

export type LiveCaseState =
  | { status: "loading" }
  | { status: "loaded"; data: LiveCaseDetail; runs: CaseRunSummary[]; events: RunEvent[] }
  | { status: "not_found" }
  | { status: "error"; message: string };

type CaseAction =
  | { type: "loading" }
  | {
      type: "loaded";
      data: LiveCaseDetail;
      runs: CaseRunSummary[];
      /** null when the runs are unchanged and the history already held still stands. */
      events: RunEvent[] | null;
    }
  | { type: "not_found" }
  | { type: "error"; message: string };

/**
 * The freshly parsed payload, with the identity of everything unchanged carried
 * over from the copy already on screen.
 *
 * A poll parses new objects out of JSON whether or not anything happened, and a
 * render is driven by identity, not by content: handing React a new array of the
 * same five commitments re-renders the case as surely as a real change would. So
 * each value is compared with its predecessor and the predecessor kept where the
 * two say the same thing, down to the individual event and audit line. What comes
 * back is `prev` itself when the case has not moved, one changed branch when it
 * has, and nothing else new either way.
 *
 * Lists are compared position by position, which is what the case's own lists do:
 * events and audit lines are appended, so everything already read keeps its
 * identity and only the new entry is new.
 */
function reuse<T>(prev: T, next: T): T {
  if (Object.is(prev, next)) return prev;
  if (typeof prev !== "object" || typeof next !== "object" || prev === null || next === null) {
    return next;
  }

  const prevIsArray = Array.isArray(prev);
  if (prevIsArray !== Array.isArray(next)) return next;

  if (prevIsArray) {
    const before = prev as unknown[];
    const after = next as unknown[];
    let changed = before.length !== after.length;
    const merged = after.map((item, i) => {
      const kept = i < before.length ? reuse(before[i], item) : item;
      changed ||= !Object.is(kept, before[i]);
      return kept;
    });
    return (changed ? merged : prev) as T;
  }

  const before = prev as Record<string, unknown>;
  const after = next as Record<string, unknown>;
  const keys = Object.keys(after);
  if (keys.length !== Object.keys(before).length) return next;

  let changed = false;
  const merged: Record<string, unknown> = {};
  for (const key of keys) {
    if (!(key in before)) return next;
    const kept = reuse(before[key], after[key]);
    changed ||= !Object.is(kept, before[key]);
    merged[key] = kept;
  }
  return (changed ? merged : prev) as T;
}

function caseReducer(prev: LiveCaseState, action: CaseAction): LiveCaseState {
  switch (action.type) {
    case "loading":
      return { status: "loading" };
    case "loaded": {
      if (prev.status !== "loaded") {
        return {
          status: "loaded",
          data: action.data,
          runs: action.runs,
          events: action.events ?? [],
        };
      }
      const data = reuse(prev.data, action.data);
      const runs = reuse(prev.runs, action.runs);
      const events = action.events === null ? prev.events : reuse(prev.events, action.events);
      // Same state object back means React stops here: a poll that learned
      // nothing costs one comparison and does not reach the screen at all.
      if (data === prev.data && runs === prev.runs && events === prev.events) return prev;
      return { status: "loaded", data, runs, events };
    }
    case "not_found":
      return { status: "not_found" };
    case "error":
      return { status: "error", message: action.message };
  }
}

/**
 * How long to wait before looking at the case again.
 *
 * A suspended run is not an ending. It is a case lying dormant until a scheduled
 * wake creates its successor, and that successor has to appear on screen without
 * anyone reloading — it is the one behaviour the whole product rests on. Only the
 * newest run decides the cadence: an older run keeps the state `suspended` for
 * ever once a later one has taken over from it.
 *
 * null means nothing further can happen on its own, and the polling stops.
 */
const POLL_WHILE_RUNNING = 8_000;
const POLL_WHILE_DORMANT = 20_000;

function pollDelay(runs: CaseRunSummary[]): number | null {
  const newest = runs[0];
  if (!newest) return null;
  if (newest.state === "running" || newest.state === "queued") return POLL_WHILE_RUNNING;
  if (newest.state === "suspended" || newest.state === "awaiting_supervisor") return POLL_WHILE_DORMANT;
  return null;
}

/** Newest first, so the run the case is currently living in is always runs[0]. */
function byNewest(runs: CaseRunSummary[]): CaseRunSummary[] {
  return [...runs].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

function runsKey(runs: CaseRunSummary[]): string {
  return runs.map((r) => `${r.run_id}:${r.state}`).join(",");
}

/**
 * Fetches case detail, its runs, and its recorded events, and keeps looking while
 * the case can still move on its own. Returns a discriminated union so the caller
 * can render each state explicitly, and a refresh for the moments the caller knows
 * about first — starting a round of outreach, or watching one finish.
 *
 * There is no silent fallback to mock data.
 */
export function useLiveCase(caseId: string): [LiveCaseState, () => void] {
  const [state, dispatch] = useReducer(caseReducer, { status: "loading" });
  const reloadRef = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let knownRuns = "";
    let loadedOnce = false;
    // A poll, a finished run and a returning tab can all ask at once. Only the
    // most recent answer is allowed to land, so none of them can put an older
    // version of the case back on screen.
    let latest = 0;

    // The only skeleton this hook ever shows. A poll is not a first load and
    // must never present as one, so `load` below reports what it found and
    // nothing else — an open case is never taken off the screen to be refetched.
    dispatch({ type: "loading" });

    const load = async () => {
      const attempt = ++latest;
      const superseded = () => cancelled || attempt !== latest;
      try {
        const [detail, runs] = await Promise.all([
          getCase(caseId),
          listCaseRuns(caseId).catch(() => [] as CaseRunSummary[]),
        ]);
        if (superseded()) return;

        const ordered = byNewest(runs);
        const key = runsKey(ordered);

        // The recorded history only changes when a run appears or moves on, so
        // an otherwise idle poll costs two requests rather than three.
        let events: RunEvent[] | null = null;
        if (key !== knownRuns) {
          events = await listCaseEvents(caseId).catch(() => [] as RunEvent[]);
          if (superseded()) return;
          knownRuns = key;
        }

        loadedOnce = true;
        dispatch({ type: "loaded", data: detail, runs: ordered, events });
        schedule(pollDelay(ordered));
      } catch (err: unknown) {
        if (superseded()) return;
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("404")) {
          dispatch({ type: "not_found" });
          return;
        }
        // A blip on a case already on screen should not replace it with an
        // error page. Keep what is there and look again.
        if (loadedOnce) {
          schedule(POLL_WHILE_DORMANT);
          return;
        }
        dispatch({ type: "error", message });
      }
    };

    const tick = () => {
      // A backgrounded tab is watching nothing. Wait for it to come back rather
      // than spending a request on nobody.
      if (document.hidden) {
        schedule(POLL_WHILE_DORMANT);
        return;
      }
      void load();
    };

    const schedule = (delay: number | null) => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (cancelled || delay === null) return;
      timer = setTimeout(tick, delay);
    };

    const onVisibilityChange = () => {
      if (!document.hidden) void load();
    };

    reloadRef.current = () => void load();
    void load();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      reloadRef.current = () => {};
    };
  }, [caseId]);

  const refresh = useCallback(() => reloadRef.current(), []);
  return [state, refresh];
}

// ---------------------------------------------------------------------------
// useLiveRunEvents — SSE subscription for a run's event stream
// ---------------------------------------------------------------------------

export type TerminalState = "completed" | "partial_failure" | "failed";

export interface LiveRunState {
  events: RunEvent[];
  streaming: boolean;
  terminalState: TerminalState | null;
  runStatus: RunStatus | null;
  error: string | null;
}

type RunAction =
  | { type: "reset" }
  | { type: "start" }
  | { type: "event"; ev: RunEvent }
  | { type: "terminal"; state: TerminalState }
  | { type: "status"; status: RunStatus; terminal?: TerminalState }
  | { type: "stream_end" }
  | { type: "error"; message: string };

const INITIAL_RUN_STATE: LiveRunState = {
  events: [],
  streaming: false,
  terminalState: null,
  runStatus: null,
  error: null,
};

function runReducer(state: LiveRunState, action: RunAction): LiveRunState {
  switch (action.type) {
    case "reset":
      return INITIAL_RUN_STATE;
    case "start":
      return { ...INITIAL_RUN_STATE, streaming: true };
    case "event":
      return { ...state, events: [...state.events, action.ev] };
    case "terminal":
      return { ...state, terminalState: action.state };
    case "status":
      return {
        ...state,
        runStatus: action.status,
        terminalState: action.terminal ?? state.terminalState,
      };
    case "stream_end":
      return { ...state, streaming: false };
    case "error":
      return { ...state, streaming: false, error: action.message };
  }
}

/**
 * Subscribes to the SSE event stream for a run and accumulates events.
 * Tracks the terminal state honestly — completed, partial_failure, or failed.
 */
export function useLiveRunEvents(runId: string | null): LiveRunState {
  const [state, dispatch] = useReducer(runReducer, INITIAL_RUN_STATE);
  const esRef = useRef<EventSource | null>(null);

  const cleanup = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
  }, []);

  useEffect(() => {
    if (!runId) {
      dispatch({ type: "reset" });
      return;
    }

    dispatch({ type: "start" });

    const es = streamRunEvents(runId);
    esRef.current = es;

    es.onmessage = (msg) => {
      const ev = parseRunEventFrame(msg.data);
      if (!ev) return;
      dispatch({ type: "event", ev });

      if (ev.event === "stream_end" || ev.event === "stream_timeout") {
        cleanup();
        dispatch({ type: "stream_end" });
        getRunStatus(runId).then((status) => {
          const terminal = ["completed", "failed", "partial_failure"].includes(status.state)
            ? (status.state as TerminalState)
            : undefined;
          dispatch({ type: "status", status, terminal });
        });
      } else if (
        ev.event === "run_completed" ||
        ev.event === "run_failed" ||
        ev.event === "run_partial_failure"
      ) {
        const terminal = ev.event === "run_completed"
          ? "completed"
          : ev.event === "run_failed"
            ? "failed"
            : "partial_failure";
        dispatch({ type: "terminal", state: terminal });
      }
    };

    es.onerror = () => {
      cleanup();
      dispatch({ type: "stream_end" });
      getRunStatus(runId)
        .then((status) => {
          const terminal = ["completed", "failed", "partial_failure"].includes(status.state)
            ? (status.state as TerminalState)
            : undefined;
          dispatch({ type: "status", status, terminal });
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          // A run the server no longer holds is not a stream failure. Let the
          // feed say plainly that there is no record of it.
          if (message.includes("404")) return;
          dispatch({ type: "error", message });
        });
    };

    return cleanup;
  }, [runId, cleanup]);

  return state;
}
