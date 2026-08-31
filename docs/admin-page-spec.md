# Admin Page Spec — `/admin`

Operator surface for synthetic cases only. Refuses to display any case without `test_case: true`.

## Sequence

### 1 · Pick a scenario

`GET /v1/scenarios` returns all nine named scenarios. Render in two columns:

- **Simple** — noah, priya, diego, rosa, ellis, theo
- **Complex** — maya, kai, amara

Each card shows: child name, what the scenario exercises, expected outcome.

### 2 · Create a case

`POST /v1/cases` body:
```json
{ "scenario": "<id>", "due_in": "<optional duration e.g. 10s>" }
```

Deadline control offers:
- The scenario's real horizon (e.g. `"17d"`)
- A compressed deadline for demo (`"10s"` — fires without faking the clock)

Default the demo field to `10s` and do not offer a longer compressed value. `due_in` is the window the five per-commitment checkpoints are spread across, at `now + due_in × (i+1)/5`, and the wake phase only promotes a checkpoint that is already past due — so above roughly `10s` the checkpoints are not yet due when the wake phase runs — the run ends `suspended`, and the sweep fires them when they come due, starting a new run that reaches the quarantine and follow-up phases after the full sweep interval.

Response includes `case_id` and `due_at`. Display `due_at` next to the case so the pending wake is visible before it fires.

### 3 · Run and stream

Navigate to `/cases/{case_id}`, hit **Run**:

1. `POST /v1/cases/{case_id}/runs` → `{ run_id, state: "queued" }` (202 in < 1 s)
2. Open `GET /v1/runs/{run_id}/events` (SSE stream)
3. Stream events live as the fleet works. Events arrive as **AG-UI envelopes**, built by `backend/api/wire.py`. Five of CaseRelay's event names have a true AG-UI counterpart and travel as that type; the rest travel as `CUSTOM` naming themselves, because AG-UI has no notion of a missed deadline or a quarantined reply and collapsing them into an approximation would lose the distinction the feed relies on.

   | CaseRelay event | AG-UI type | Meaning |
   |---|---|---|
   | `run_started` | `RUN_STARTED` | Run begins executing; `threadId` is the case, `runId` the run |
   | `phase_started` | `STEP_STARTED` | Orchestrator phase begins; `stepName` is the phase label |
   | `phase_complete` | `STEP_FINISHED` | Phase finished; `stepName` is the phase label |
   | `run_completed` | `RUN_FINISHED` | Terminal — all phases succeeded |
   | `run_failed` | `RUN_ERROR` | Terminal — all phases failed or a fatal error occurred; `message` is the failure, not the narration |
   | `phase_error` | `CUSTOM` | One phase errored; the run continues |
   | `run_partial_failure` | `CUSTOM` | Terminal — some phases succeeded, some failed |
   | `run_suspended` | `CUSTOM` | Run parked awaiting a durable wake |
   | `commitment_overdue`, `followup_sent`, `followup_answered`, `followup_ignored`, `supervisor_notified` | `CUSTOM` | The escalation ladder, from a missed deadline to the supervisor being told |
   | `reconciliation`, `memory_recall`, `memory_write`, `run_summary` | `CUSTOM` | Deadline check, Memory Bank recall and write, closing tally |
   | `stream_end` | `CUSTOM` | Final frame confirming the terminal state; close the connection |
   | `stream_timeout` | `CUSTOM` | Safety-valve disconnection after 30 minutes; reconnect to resume |

   The whole internal event rides along intact either way — on `rawEvent` for a typed envelope, on `value` for a custom one — so the portal reverses the table and renders CaseRelay's own event names. Nothing about storage changes: the durable event log stores the internal event, and `wire.py` is the only translation point.

   Every event carries a `message` field: a single human-readable sentence in plain English, naming the real organisations and people from the case's referral packet rather than initials or internal vocabulary. Use it as the primary progress narration in the UI. The internal fields (`event`, `run_id`, `phase`, `commitment_states`, `failed_phases`, `error`, `summary`) are unchanged.

   `GET /v1/cases/{case_id}/events` replays a case's recorded history in the same AG-UI envelopes, so a case opened long after its run — or after a control-plane restart — renders through exactly the same code path as the live stream.

   The five specialist fan-out phases (`3-fanout-*`) execute concurrently, so their events will interleave. Each event carries a `phase` field identifying its specialist (e.g. `3-fanout-education_liaison`) for correct UI attribution.

   Phases are not a fixed sequence: `PHASE_REGISTRY` in `backend/runtime/fleet.py` holds fourteen specs, each with a precondition and a priority, and the engine picks the highest-priority phase whose precondition currently holds. The UI should therefore treat the phase label as a name, not a step number — `9-nudge` and `10-unanswered` appear only when a provider actually missed a deadline.

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
| GET | `/v1/cases/{case_id}/runs` | Runs recorded against the case |
| GET | `/v1/cases/{case_id}/events` | Recorded run history, replayed as AG-UI |
| GET | `/v1/runs/{run_id}` | Run status |
| GET | `/v1/runs/{run_id}/events` | Live SSE event stream, as AG-UI |
| GET | `/v1/approvals` | Pending approvals |
| POST | `/v1/approvals/{id}/decide` | Approve/reject |
| DELETE | `/v1/cases/{case_id}` | Cleanup |
| — | `/agui` | Operator copilot chat, mounted as its own AG-UI app over `ag_ui_adk`; the transcript is held on Agent Platform Sessions, keyed on the AG-UI thread id |

Base URL: `https://caserelay-control-plane-189353698936.us-central1.run.app` (auth-required; portal reaches it through the BFF proxy)  
OpenAPI contract: `contracts/openapi.json`
