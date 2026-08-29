/**
 * API client for the CaseRelay control plane.
 *
 * All calls go through the same-origin BFF proxy at /api/control-plane,
 * which attaches a Google-signed ID token server-side. No credential is
 * shipped to the browser.
 */

import { decodeRunEvent } from "@/lib/agui";

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

/**
 * A case as /v1/cases lists it.
 *
 * Two code paths answer this endpoint and they do not return the same thing: the
 * stored one hands back the whole case document, the in-memory one a projection.
 * The fields below are the ones both promise, so everything past them is read
 * through the index signature and normalised by the caller.
 *
 * `volunteer_name` is denormalised onto the case by the backend, which is what
 * lets a supervisor's caseload be grouped by advocate without one read per case.
 */
export interface CaseListItem {
  case_id?: string;
  child_name?: string;
  status?: string;
  volunteer_id?: string;
  volunteer_name?: string;
  created_at?: string;
  test_case?: boolean;
  [key: string]: unknown;
}

/** Unscoped: there is no volunteer or supervisor filter, so this is every case. */
export async function listCases(): Promise<CaseListItem[]> {
  return request("/v1/cases");
}

// ─── Registry ────────────────────────────────────────────────────────────────

/**
 * One agent card, exactly as the registry serves it. Every card carries all ten
 * keys — the fleet's discovery depends on that, so none of them are optional.
 */
export interface AgentCardRecord {
  agent_id: string;
  display_name: string;
  owner_org: string;
  version: string;
  purpose: string;
  tools: string[];
  allowed_data_scopes: string[];
  denied_data_scopes: string[];
  identity: string;
  health_status: string;
}

/** The same cards the orchestrator discovers against, not a copy of them. */
export async function listRegistry(): Promise<AgentCardRecord[]> {
  return request("/v1/registry");
}

// ─── Audit ───────────────────────────────────────────────────────────────────

/**
 * One recorded audit event.
 *
 * Only `event_id`, `trace_id` and `timestamp` are written on every path
 * (backend/runtime/workspace.py::append_audit). Everything below them depends
 * on which agent wrote the event, so it is all optional — a denial carries no
 * disclosed fields, a scheduler wake carries no verdict, and so on.
 *
 * There is deliberately no duration here: the backend records none, and a
 * timing the UI invented would be worse than no timing at all.
 */
export interface AuditEvent {
  event_id: string;
  trace_id: string;
  /** ISO-8601, UTC. */
  timestamp: string;
  event_type: string;
  agent_identity?: string;
  /** allow, deny, quarantine, answered, no_response, supervisor_notified, deferred. */
  verdict?: string;
  explanation?: string;
  purpose?: string;
  commitment_type?: string;
  disclosed_fields?: string[];
  withheld_fields?: string[];
  legal_basis?: string | null;
  expected_principal?: string;
  denied_field?: string;
  triggered_by?: string;
  workflow_ids?: string[];
}

/** Audit is per case; there is no endpoint that spans them. */
export async function listCaseAudit(caseId: string): Promise<AuditEvent[]> {
  return request(`/v1/cases/${caseId}/audit`);
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

/** A case's recorded history, decoded from the AG-UI events the wire carries. */
export async function listCaseEvents(caseId: string): Promise<RunEvent[]> {
  const frames = await request<unknown[]>(`/v1/cases/${caseId}/events`);
  return frames
    .map(decodeRunEvent)
    .filter((ev): ev is RunEvent => ev !== null);
}

/**
 * Opens an SSE connection to the run-events stream via the BFF proxy.
 * The caller is responsible for closing the returned EventSource.
 */
export function streamRunEvents(runId: string): EventSource {
  return new EventSource(`${BASE}/v1/runs/${runId}/events`);
}

// ─── Approval endpoints ──────────────────────────────────────────────────────

export interface PendingApproval {
  approval_id: string;
  case_id: string;
  action_type: string;
  reason?: string;
  decision: string;
  [key: string]: unknown;
}

export async function listPendingApprovals(): Promise<PendingApproval[]> {
  return request("/v1/approvals");
}

export async function activateCase(
  caseId: string,
  supervisorId: string,
): Promise<{ case_id: string; status: string }> {
  return request(`/v1/cases/${caseId}/activate`, {
    method: "POST",
    body: JSON.stringify({ supervisor_id: supervisorId }),
  });
}

export async function decideApproval(
  approvalId: string,
  decision: "approve" | "reject",
  decidedBy: string,
  note?: string,
): Promise<Record<string, unknown>> {
  return request(`/v1/approvals/${approvalId}/decide`, {
    method: "POST",
    body: JSON.stringify({ decision, decided_by: decidedBy, note }),
  });
}

/**
 * One SSE frame, decoded. Returns null for anything unreadable — a partial
 * frame, or a heartbeat that arrived as data — which the caller ignores.
 */
export function parseRunEventFrame(data: string): RunEvent | null {
  try {
    return decodeRunEvent(JSON.parse(data));
  } catch {
    return null;
  }
}
