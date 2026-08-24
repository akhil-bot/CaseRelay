# Admin Page Spec — `/admin`

Operator surface for synthetic cases only. Refuses to display any case without `test_case: true`.

## Sequence

### 1 · Pick a scenario

`GET /v1/scenarios` returns all nine named scenarios. Render in two columns:

- **Simple** — noah, miguel, aisha, priya, lucas, fatima
- **Complex** — rosa, dante, yara

Each card shows: child name, what the scenario exercises, expected outcome.

### 2 · Create a case

`POST /v1/cases` body:
```json
{ "scenario": "<id>", "due_in": "<optional duration e.g. 45s>" }
```

Deadline control offers:
- The scenario's real horizon (e.g. `"17d"`)
- A compressed deadline for demo (e.g. `"45s"` — fires without faking the clock)

Response includes `case_id` and `due_at`. Display `due_at` next to the case so the pending wake is visible before it fires.

### 3 · Run and stream

Navigate to `/cases/{case_id}`, hit **Run**:

1. `POST /v1/cases/{case_id}/runs` → `{ run_id, state: "queued" }` (202 in < 1 s)
2. Open `GET /v1/runs/{run_id}/events` (SSE stream)
3. Stream events live as the fleet works:
   - `run_started` — run begins executing
   - `phase_started` / `phase_complete` / `phase_error` — orchestrator phase lifecycle
   - `run_completed` — all phases succeeded (terminal)
   - `run_partial_failure` — some phases succeeded, some failed (terminal)
   - `run_failed` — all phases failed or a fatal error occurred (terminal)
   - `stream_end` — final event confirming the terminal state; close the connection
   - `stream_timeout` — safety-valve disconnection after 30 minutes; reconnect to resume

   Every event carries a `message` field: a single human-readable sentence in plain English, present tense, no markdown, no truncation mid-word. Use it as the primary progress narration in the UI. Existing fields (`event`, `run_id`, `phase`, `commitment_states`, `failed_phases`, `error`, `summary`) remain unchanged.

   The five specialist fan-out phases (`3-fanout-*`) execute concurrently, so their events will interleave. Each event carries a `phase` field identifying its specialist (e.g. `3-fanout-education_liaison`) for correct UI attribution.

4. Poll `GET /v1/runs/{run_id}` for the authoritative terminal state:

| `state` | Meaning | Portal treatment |
|---------|---------|-----------------|
| `queued` | Run accepted, not yet started | spinner |
| `running` | Fleet is executing phases | spinner + live events |
| `completed` | All phases succeeded | green / success |
| `partial_failure` | Some phases failed (see `failed_phases`) | amber / warning |
| `failed` | All phases failed or fatal error (see `error`) | red / error |

The response also includes `failed_phases` (list of phase labels that errored) and `error` (human-readable message) when applicable.

### 4 · Approve or reject

When `approval_required` arrives, surface the approval in the Approval Center:

`POST /v1/approvals/{approval_id}/decide` body:
```json
{ "decision": "approve" | "reject", "reason": "..." }
```

### 5 · Delete the case

`DELETE /v1/cases/{case_id}` — only permitted for `test_case: true` cases.

## API surface used

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/v1/scenarios` | Scenario list |
| POST | `/v1/cases` | Create case |
| GET | `/v1/cases/{case_id}` | Case detail |
| POST | `/v1/cases/{case_id}/runs` | Start async run |
| GET | `/v1/runs/{run_id}` | Run status |
| GET | `/v1/runs/{run_id}/events` | SSE event stream |
| GET | `/v1/approvals` | Pending approvals |
| POST | `/v1/approvals/{id}/decide` | Approve/reject |
| DELETE | `/v1/cases/{case_id}` | Cleanup |

Base URL: `https://caserelay-api-<hash>-uc.a.run.app`  
OpenAPI contract: `contracts/openapi.json`
