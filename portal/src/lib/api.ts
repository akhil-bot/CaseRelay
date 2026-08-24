/**
 * Live API client for the CaseRelay control plane.
 *
 * Base URL is read from NEXT_PUBLIC_API_BASE_URL. All functions throw on
 * non-2xx responses with the response body as the error message.
 */

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "https://caserelay-control-plane-6nwo7o4bbq-uc.a.run.app";

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
  state: "queued" | "running" | "completed" | "partial_failure" | "failed";
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

/**
 * Opens an SSE connection to the run events stream. Returns an EventSource.
 * The caller is responsible for closing it.
 */
export function streamRunEvents(runId: string): EventSource {
  return new EventSource(`${BASE}/v1/runs/${runId}/events`);
}
