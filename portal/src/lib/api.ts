/**
 * API client for the CaseRelay control plane.
 *
 * All calls go through the same-origin BFF proxy at /api/control-plane,
 * which attaches a Google-signed ID token server-side. No credential is
 * shipped to the browser.
 */

const BASE = "/api/control-plane";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Scenario {
  id: string;
  child_name: string;
  complexity: "simple" | "complex";
  title: string;
  description: string;
  expected_outcome: string;
  partner_behaviours: Record<string, string>;
  default_due_days: number;
}

export interface CreatedCase {
  case_id: string;
  scenario: string;
  due_at: string;
  summary: string;
}

export interface RunRef {
  run_id: string;
  case_id: string;
  state: string;
}

export interface RunStatus {
  run_id: string;
  state: "queued" | "running" | "completed" | "partial_failure" | "failed" | "suspended";
  current_phase?: string;
  commitment_states?: Record<string, string>;
  failed_phases?: string[];
  error?: string;
  trace_id?: string;
}

export interface RunEvent {
  event: string;
  run_id?: string;
  case_id?: string;
  phase?: string;
  state?: string;
  detail?: string;
  summary?: string;
  /** Plain-English narration of what is happening, added by the backend agent. */
  message?: string;
  /** ISO-8601 timestamp set by the backend on every emitted event. */
  timestamp?: string;
  failed_phases?: string[];
  error?: string;
  [key: string]: unknown;
}

// ─── Endpoints ───────────────────────────────────────────────────────────────

export async function listScenarios(): Promise<Scenario[]> {
  return request("/v1/scenarios");
}

export async function createCase(scenario: string, dueIn?: string): Promise<CreatedCase> {
  const body: Record<string, string> = { scenario };
  if (dueIn) body.due_in = dueIn;
  return request("/v1/cases", { method: "POST", body: JSON.stringify(body) });
}

export async function submitRun(caseId: string): Promise<RunRef> {
  return request(`/v1/cases/${caseId}/runs`, { method: "POST" });
}

export async function getRunStatus(runId: string): Promise<RunStatus> {
  return request(`/v1/runs/${runId}`);
}

export async function deleteCase(caseId: string): Promise<{ detail: string }> {
  return request(`/v1/cases/${caseId}`, { method: "DELETE" });
}

export async function listCases(): Promise<Record<string, unknown>[]> {
  return request("/v1/cases");
}

export interface LiveCaseDetail {
  case: Record<string, unknown>;
  commitments: Record<string, string>;
  grants: Record<string, unknown>[];
  timeline: Record<string, unknown>[];
}

export interface CaseRunSummary {
  run_id: string;
  state: string;
  current_phase: string | null;
  created_at: string;
}

export async function getCase(caseId: string): Promise<LiveCaseDetail> {
  return request(`/v1/cases/${caseId}`);
}

export async function listCaseRuns(caseId: string): Promise<CaseRunSummary[]> {
  return request(`/v1/cases/${caseId}/runs`);
}

export async function listCaseEvents(caseId: string): Promise<RunEvent[]> {
  return request(`/v1/cases/${caseId}/events`);
}

/**
 * Opens an SSE connection to the run-events stream via the BFF proxy.
 * The caller is responsible for closing the returned EventSource.
 */
export function streamRunEvents(runId: string): EventSource {
  return new EventSource(`${BASE}/v1/runs/${runId}/events`);
}
