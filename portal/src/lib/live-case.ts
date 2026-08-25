"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  getCase,
  listCaseRuns,
  streamRunEvents,
  getRunStatus,
  type LiveCaseDetail,
  type CaseRunSummary,
  type RunEvent,
  type RunStatus,
} from "@/lib/api";

// ---------------------------------------------------------------------------
// useLiveCase — fetch a single case from the control plane
// ---------------------------------------------------------------------------

export type LiveCaseState =
  | { status: "loading" }
  | { status: "loaded"; data: LiveCaseDetail; runs: CaseRunSummary[] }
  | { status: "not_found" }
  | { status: "error"; message: string };

type CaseAction =
  | { type: "loading" }
  | { type: "loaded"; data: LiveCaseDetail; runs: CaseRunSummary[] }
  | { type: "not_found" }
  | { type: "error"; message: string };

function caseReducer(_: LiveCaseState, action: CaseAction): LiveCaseState {
  switch (action.type) {
    case "loading": return { status: "loading" };
    case "loaded": return { status: "loaded", data: action.data, runs: action.runs };
    case "not_found": return { status: "not_found" };
    case "error": return { status: "error", message: action.message };
  }
}

/**
 * Fetches case detail and its runs from the control plane.
 * Returns a discriminated union so the caller can render each state explicitly
 * without ambiguity. There is no silent fallback to mock data.
 */
export function useLiveCase(caseId: string): LiveCaseState {
  const [state, dispatch] = useReducer(caseReducer, { status: "loading" });

  useEffect(() => {
    let cancelled = false;
    dispatch({ type: "loading" });

    const caseFetch = getCase(caseId);
    const runsFetch = listCaseRuns(caseId).catch(() => [] as CaseRunSummary[]);

    Promise.all([caseFetch, runsFetch])
      .then(([detail, runs]) => {
        if (!cancelled) dispatch({ type: "loaded", data: detail, runs });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("404")) {
          dispatch({ type: "not_found" });
        } else {
          dispatch({ type: "error", message: msg });
        }
      });

    return () => { cancelled = true; };
  }, [caseId]);

  return state;
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
      try {
        const ev: RunEvent = JSON.parse(msg.data);
        dispatch({ type: "event", ev });

        if (ev.event === "stream_end" || ev.event === "stream_timeout") {
          cleanup();
          dispatch({ type: "stream_end" });
          getRunStatus(runId).then((status) => {
            dispatch({ type: "status", status, terminal: status.state as TerminalState });
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
      } catch {
        // ignore unparseable frames
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
          dispatch({ type: "error", message: err instanceof Error ? err.message : String(err) });
        });
    };

    return cleanup;
  }, [runId, cleanup]);

  return state;
}
