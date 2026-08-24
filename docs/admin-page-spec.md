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

1. `POST /v1/cases/{case_id}/runs` → `{ run_id, status: "pending" }` (202 in < 1 s)
2. Open `GET /v1/runs/{run_id}/events` (SSE stream)
3. Stream events live as the fleet works:
   - `checkpoint` — workflow phase transitions
   - `agent_result` — tool call outcomes, commitment flips
   - `gateway_disclosure` — withheld-field lists
   - `approval_required` — approval landing in queue
   - `run_complete` — terminal event

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
