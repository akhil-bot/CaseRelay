/**
 * API client for the CaseRelay control plane.
 *
 * All calls go through the same-origin BFF proxy at /api/control-plane,
 * which attaches a Google-signed ID token server-side. No credential is
 * shipped to the browser.
 */

import { decodeRunEvent } from "@/lib/agui";

const BASE = "/api/control-plane";

/** A parsed answer, and what the route said about the set the body came from. */
interface Answer<T> {
  data: T;
  /** `X-Total-Count`, where the route pages. Null where it does not. */
  total: number | null;
}

async function send<T>(path: string, init?: RequestInit): Promise<Answer<T>> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${body}`);
  }
  const header = res.headers.get("X-Total-Count");
  const total = header === null ? null : Number(header);
  return {
    data: (await res.json()) as T,
    total: total !== null && Number.isFinite(total) ? total : null,
  };
}

/**
 * Reads already on the wire, by URL.
 *
 * Several parts of the portal poll the same routes on their own timers — the
 * approvals provider and the audit page both want the caseload, the provider
 * and an open case detail both want the same case — and until now each of them
 * spent a request on it. Callers that ask for the same URL while an answer is
 * still coming now wait on the one already in flight.
 *
 * Only reads, and only until the answer lands: this coalesces concurrent
 * duplicates, it does not cache. A poll that fires after the previous one
 * finished still goes to the network, which is what a poll is for.
 *
 * Everyone sharing a call shares the parsed body, so it must be treated as
 * read-only. Every caller here derives new objects from it rather than
 * editing it in place.
 */
const inFlight = new Map<string, Promise<Answer<unknown>>>();

function read<T>(path: string): Promise<Answer<T>> {
  const existing = inFlight.get(path);
  if (existing) return existing as Promise<Answer<T>>;

  const pending = send<T>(path).finally(() => {
    inFlight.delete(path);
  }) as Promise<Answer<unknown>>;

  inFlight.set(path, pending);
  return pending as Promise<Answer<T>>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Writes are never shared: two identical POSTs are two things happening.
  const answer = init?.method && init.method !== "GET" ? await send<T>(path, init) : await read<T>(path);
  return answer.data;
}

/** One page of a list, and how many there are behind it. */
export interface Page<T> {
  items: T[];
  total: number;
}

async function readPage<T>(path: string): Promise<Page<T>> {
  const { data, total } = await read<T[]>(path);
  // A route that answered without the header is not paging; what arrived is all
  // there is, and reporting its length keeps every caller's "is there more?"
  // arithmetic honest rather than leaving it to compare against null.
  return { items: data, total: total ?? data.length };
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const rendered = search.toString();
  return rendered ? `?${rendered}` : "";
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

export async function createCase(
  scenario: string,
  dueIn?: string,
  volunteerId?: string,
  volunteerName?: string,
): Promise<CreatedCase> {
  const body: Record<string, string> = { scenario };
  if (dueIn) body.due_in = dueIn;
  if (volunteerId) body.volunteer_id = volunteerId;
  if (volunteerName) body.volunteer_name = volunteerName;
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
  /**
   * How many commitments have been extracted, where the control plane can say
   * so without opening the case. Absent behind Firestore, where commitments are
   * a subcollection — so `undefined` means unknown, not none.
   */
  commitment_count?: number;
  [key: string]: unknown;
}

/**
 * How many cases to ask for at a time.
 *
 * The caseload pages, but the portal sorts and searches it whole — by urgency,
 * by a term typed into the header — and neither of those is something the
 * control plane can order for us. So a list view reads every page rather than
 * only the first; what paging buys is that the rows start arriving after one
 * short request instead of one long one, and that a store nobody has pruned
 * cannot hand the browser everything at once.
 */
export const CASE_PAGE = 20;

export interface CaseQuery {
  /** Narrow to one case status, e.g. `draft`. Applied before paging. */
  status?: string;
  offset?: number;
  limit?: number;
}

/**
 * A page of cases, newest first.
 *
 * Still unscoped: there is no viewer filter, so whoever asks gets whichever
 * cases they asked for. An advocate's own caseload is narrowed in the browser,
 * because "mine" there also means every case that names nobody, and that is not
 * a question this endpoint can be asked.
 */
export async function listCases(params: CaseQuery = {}): Promise<Page<CaseListItem>> {
  return readPage<CaseListItem>(
    `/v1/cases${query({
      status: params.status,
      offset: params.offset ?? 0,
      limit: params.limit ?? CASE_PAGE,
    })}`,
  );
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

/** How many audit rows to read at a time, on either the per-case or the fleet route. */
export const AUDIT_PAGE = 20;

/** One case's own record, in the order it was written. */
export async function listCaseAudit(
  caseId: string,
  params: { offset?: number; limit?: number } = {},
): Promise<Page<AuditEvent>> {
  return readPage<AuditEvent>(
    `/v1/cases/${caseId}/audit${query({
      offset: params.offset ?? 0,
      limit: params.limit ?? AUDIT_PAGE,
    })}`,
  );
}

/**
 * A case's whole record, followed to the end a page at a time.
 *
 * For the readers that cannot be given part of it: a court report that quietly
 * stopped at the first hundred entries would be a misleading document rather
 * than a shorter one.
 */
export async function listAllCaseAudit(caseId: string): Promise<AuditEvent[]> {
  const collected: AuditEvent[] = [];
  for (;;) {
    const page = await listCaseAudit(caseId, { offset: collected.length, limit: AUDIT_PAGE });
    collected.push(...page.items);
    if (page.items.length === 0 || collected.length >= page.total) return collected;
  }
}

/** An audit event as the fleet-wide route serves it: with the case it belongs to. */
export interface FleetAuditEvent extends AuditEvent {
  case_id: string;
  child_name: string;
}

/**
 * Counted over the whole trail, not over the page.
 *
 * This is why the fleet route answers with an envelope rather than an array: a
 * page of fifty events cannot say how many refusals there were across eleven
 * thousand, and a reader who had to fetch every page to find out would be no
 * better off than before it paged.
 */
export interface AuditSummary {
  cases: number;
  events: number;
  traces: number;
  refusals: number;
  withheld: number;
  /** Every kind recorded, with its count, most frequent first. */
  types: [string, number][];
}

export interface AuditPage {
  events: FleetAuditEvent[];
  /** How many match the current filter. The page is a window onto these. */
  total: number;
  summary: AuditSummary;
}

/**
 * Everything recorded, across every case, newest first.
 *
 * The fan-out over cases happens on the control plane now. The portal used to
 * do it here — list the cases, then ask each one for its audit, every poll —
 * which cost one request per case and could not show the newest hundred events
 * without first reading all of them.
 */
export async function listAudit(
  params: { eventType?: string; offset?: number; limit?: number } = {},
): Promise<AuditPage> {
  return request<AuditPage>(
    `/v1/audit${query({
      event_type: params.eventType,
      offset: params.offset ?? 0,
      limit: params.limit ?? AUDIT_PAGE,
    })}`,
  );
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
  /**
   * Denormalised onto the approval by the control plane, so that captioning a
   * queue of gates does not mean opening every case named in it.
   */
  child_name?: string;
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
