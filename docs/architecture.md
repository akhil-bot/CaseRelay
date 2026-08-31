# CaseRelay architecture

Detail moved out of the [README](../README.md) so the front page stays readable. Nothing here
is new: the wording is preserved from the README's own text, which has been through several
accuracy audits.

![CaseRelay multi-agent mesh — eight ADK agents on Gemini Enterprise Agent Platform, A2A between engines, MCP egress through Agent Gateway](diagrams/caserelay-multi-agent-mesh.png)

---

## Component wiring

```
CASA Volunteer / Supervisor
        │
        ▼
  CaseRelay Portal (Next.js on Cloud Run, or local)
        │  BFF proxy — mints ID tokens server-side;
        │  no credential reaches the browser
        │  AG-UI on the chat panel and the run event stream
        ▼
  Control Plane (FastAPI on Cloud Run, auth-required)
        │
        ├─► Chat Agent (AG-UI)  ────────► Agent Platform Sessions
        │                                 "caserelay-chat-sessions"
        │
        ├─► Intake & Authority Agent  ──► Firestore (named DB "caserelay")
        │                                       │  cases, commitments, grants,
        │                                       │  approvals, audit, run events
        │                              Pub/Sub Events
        │                                       │
        ▼                                       ▼
  Continuity Orchestrator              Agent Registry (all 8 published)
        │      │
        │      ├──────────────────────► Agent Platform Sessions
        │      │                        "caserelay-run-sessions"
        │      │                        (one session per phase invocation)
        │      └──────────────────────► Memory Bank (per-case recall)
        ▼
  ┌──► Education Agent  ──┐
  ├──► Health Agent     ──┤
  ├──► Legal Agent      ──┼── Agent Engine (reasoning engines)
  ├──► Shelter Agent    ──┤   with platform-managed Agent Identity
  ├──► Family Services  ──┤
  └──► Safeguarding Verifier ──► Model Armor
              │ engine egress           │
        Agent Gateway            Human Approval Queue
        (caserelay-egress)              │
        outbound to LLMs,       Firestore / Audit Log
        partner MCP, Firestore
```

**Technology stack:**

| Layer | Technology |
|---|---|
| Agent runtime | Google ADK on Vertex AI Agent Engine (reasoning engines), Gemini 3.5 Flash (`gemini-3.5-flash`) |
| Control plane | Python, FastAPI, Cloud Run (`caserelay-control-plane`; `allUsers` removed, auth-required) |
| Portal | Next.js, TypeScript (Cloud Run `caserelay-portal`, behind an HTTP Basic gate; also runs locally via `npm run dev`) |
| Agent conversations | GEAP Agent Platform Sessions on two dedicated Agent Engines (`caserelay-chat-sessions`, `caserelay-run-sessions`) |
| State | Firestore (named database `caserelay` — see decision note below) |
| Wire protocol | AG-UI for both the operator chat endpoint and the run event stream |
| Observability | Cloud Logging, Cloud Trace (Google-generated spans for MCP tool calls and Model Armor guardrail evaluations via Agent Gateway; ADK engine telemetry enabled) |
| Security | GEAP Agent Identity (platform-managed, mTLS + DPoP), Model Armor (Cloud DLP-backed SDP with custom dictionary detectors), Safeguarding Verifier |


---

## GEAP Capabilities Demonstrated

- **Agent Registry** — 24 registered services: eight A2A agent endpoints, two MCP partner entries, and fourteen infrastructure dependencies (Firestore, Model Armor, Vertex AI, Telemetry, Cloud Logging), auto-registered and updated by `agents-cli deploy`; Agent Gateway request logs reference the registered entry for each call (`agentRegistryResource`). The registry is a live catalogue, not a runtime routing layer — agents find each other through environment variables, not registry lookups
- **Agent Runtime** — eight reasoning engines in `us-central1` hosting the fleet. The checkpoint / sleep / deadline-triggered resume cycle around them is Firestore plus Pub/Sub push and Cloud Scheduler (one-minute sweep, dead-letter after 5 attempts, codified in `infra/bootstrap.sh`) rather than Agent Runtime itself: a Maya run ends on its checkpoints and a sweep restarts it, observed with a 23-second gap and nobody at the keyboard
- **Memory Bank** — GEAP Memory Bank (instance `8631858420611284992`) via ADK's `VertexAiMemoryBankService`; sessions extracted once per wake via synchronous `memories.generate`; recalled memories searched on resume and, when non-empty, injected into orchestrator prompts for the wake, nudge and follow-up phases (`_MEMORY_DECISION_PHASES` in `backend/api/main.py`), with a `memory_injected` audit event recording which memories entered which phase; observed end-to-end on run `de73dabce1d4`, where one recalled memory was injected into `5-wake` and `8-followup`; the recalled content so far is general process observations rather than operationally specific intelligence (named contacts, institutional shortcuts), because the compressed end-to-end script re-executes orchestrator phases that the specialists already handled, producing process-level rather than partner-interaction detail; scoped per case (`case_id` → ADK `user_id`); three custom memory topics: `partner_contacts`, `institutional_shortcuts`, `unblocking_strategies`; cross-session consolidation is live (six memories have evolved across sessions with revision history)
- **Agent Platform Sessions** — two dedicated Agent Engines via ADK's `VertexAiSessionService`. `caserelay-chat-sessions` holds the operator chat transcript, keyed on the AG-UI thread id so a returning conversation resolves in one read. `caserelay-run-sessions` holds every orchestrator agent turn, one session per phase invocation rather than one per run, because the fan-out dispatches five phases at once and Google documents row-level locking only for `DatabaseSessionService`. A deployed control plane refuses to start without both rather than falling back to in-memory sessions that look identical until the instance recycles. A throttled append is retried with jittered backoff and, if it still will not land, kept in memory and logged rather than failing the case
- **Agent Identity** — platform-managed identity per agent (`--agent-identity`); SPIFFE-style principals (`principal://agents.global.org-…`); caller principal verified at the gateway; cross-scope denial demonstrated
- **Agent Gateway** — all eight engines bound to `caserelay-egress`; outbound traffic TLS-intercepted; MCP method deny policy enforcing; Model Armor extension (`caserelay-ma-authz-ext`) fail-closed against the same `caserelay-screen` template the verifier calls; gateway request logs show method, policy evaluation and TLS interception per call
- **Model Armor** — cross-scope-request quarantine via `modelarmor.googleapis.com` template `caserelay-screen` with SDP Advanced Config referencing a Cloud DLP inspect template (`caserelay-cross-scope`) using custom dictionary detectors + hotword proximity rule; fails closed
- **Agent Observability** — Cloud Trace carries Google-generated spans for every MCP tool call and Model Armor guardrail evaluation that traverses the Agent Gateway, rendered as five-span waterfalls: the MCP `tools/call` root, an `apply_guardrail` span with `gen_ai.security.policy.name: caserelay-screen` and `gen_ai.security.decision.type`, and request/response path breakdown (308 traced requests observed). Agent Gateway request logs separately record method, policy evaluation, TLS interception status and the `agentRegistryResource` for each call. Limitation: ADK Agent Runtime does not export its own execution spans (agent phases, LLM calls, in-agent tool use), so end-to-end tracing of agent reasoning is not achieved
- **AG-UI on the wire** — both event surfaces speak the protocol: the operator chat endpoint (`/agui`, via `ag_ui_adk`) and the run event stream. `run_started`, `run_completed`, `run_failed`, `phase_started` and `phase_complete` travel as `RUN_STARTED`, `RUN_FINISHED`, `RUN_ERROR`, `STEP_STARTED` and `STEP_FINISHED` — a run is a run and a phase is a step. Everything with no true counterpart, such as a missed deadline or a quarantined reply, travels as `CUSTOM` naming itself with the whole internal event alongside, so the feed keeps every distinction it draws in red and amber. The live SSE stream and the recorded replay use the same envelopes, so the portal decodes a replayed history and a live one through one decoder
- **Gemma session narratives** — `backend/narration/gemma.py` calls Gemma 4 (`gemma-4-26b-a4b-it-maas` on Vertex AI) at the end of each run to generate a 2–4 sentence natural-language summary from the structured run events; the summary is stored on the run record (`gemma_summary`) and logged at INFO. Deployed and observed on the serving revision — three summaries generated across runs `4732b1f2c9d8`, `de73dabce1d4` and `e8f76a62c196`. The model choice is deliberate: short-text generation from structured data does not need a frontier model, and Gemma avoids burning Gemini quota on a mechanical rewrite


### Notable engineering decisions

| Decision | Rationale |
|---|---|
| **mTLS over CAA opt-out** | Agent Identity tokens are certificate-bound (DPoP + mTLS). We hit 401s when calling non-mTLS endpoints and fixed them by setting `GOOGLE_API_USE_CLIENT_CERTIFICATE=true` so traffic routes to `*.mtls.googleapis.com`. We deliberately did NOT set `GOOGLE_API_PREVENT_AGENT_TOKEN_SHARING_FOR_GCP_SERVICES=False` (Google's documented opt-out) because that disables token binding entirely. CAA enforcement remains on. See [troubleshoot-auth-manager](https://docs.google.com/iam/docs/troubleshoot-auth-manager). |
| **Named Firestore database** | Uses the database named `caserelay`, not `(default)`. Agent Runtime's network proxy URL-encodes parentheses in outgoing requests, turning `(default)` into `%28default%29`, which Firestore rejects with HTTP 400. A named database sidesteps this entirely. |
| **BFF proxy for the control plane** | The portal reaches the authenticated Cloud Run service through a Next.js server-side proxy (`portal/src/app/api/control-plane/[...path]/route.ts`) that mints Google-signed ID tokens. No credential is exposed to the browser. SSE is proxied with incremental delivery preserved. |
| **Control plane locked down** | `allUsers` removed from `roles/run.invoker`; unauthenticated calls return 403. |
| **Three separate Agent Engines for Sessions and Memory** | Chat transcripts, agent run transcripts, and Memory Bank each get their own engine. They hold different things and are written at different rates, so a retention or deletion decision about one must not be able to reach another. |
| **The run event log stays on Firestore, not Sessions** | The activity feed, timeline rail and audit trail need an ordered, live, permanent record. Sessions orders events by timestamp alone, with no sequence field and no documented tiebreak; offers no streaming or watch API; caps appends at 300 per minute per project, which a five-way fan-out can reach on its own; and requires every session to carry an expiry. Cloud Trace retains 30 days non-configurably and Cloud Logging's `entries.list` is capped at 60 requests per minute and explicitly not intended for bulk retrieval, so neither is a home for it either. The log is therefore one Firestore document per event under its run, keyed by the position it was pushed at (`backend/runtime/event_log.py`). Only the wire format is AG-UI; storage is untouched. |
| **Durable run history written off the hot path** | A phase narrates itself by pushing an event, and the SSE stream serves those events from memory, so a slow write can never surface as a stalled agent. A background writer drains one FIFO queue, preserving push order, and a run flushes it once it has finished. History survives a Cloud Run restart; deleting a case deletes its events with it. |

---

## Portal

The portal is deployed to Cloud Run as `caserelay-portal` and also runs locally via `npm run dev`. The hosted service is public at the network level; what keeps it private is the HTTP Basic gate in `portal/src/middleware.ts`, which sits in front of the API proxy as well as the pages, and whose password is mounted from Secret Manager. An anonymous request to `/api/control-plane/v1/cases` returns 401. Firebase Hosting was never used — `caserelay-portal.web.app` is not live and is not the deployment target. Per the official hackathon rules a hosted URL is optional in any case ("Your app does not need to be publicly accessible or live at the exact moment of submission or judging").

Portal screens:

1. **Case Inbox** — overdue, blocked, approval-needed, and recently completed cases
2. **Continuity Timeline** — commitments, owners, evidence, deadlines, handoffs
3. **Approval Center** — proposed action, evidence, disclosed/withheld fields, policy basis
4. **Agent Registry** — owner, version, purpose, tools, scopes, endpoint, health
5. **Audit Trace** — correlated delegation, access, model/tool calls, retry, approval, completion events
6. **Synthetic Data Lab** (`/admin`) — create a case from a named scenario, run the fleet, and watch the AG-UI event stream. An operator copilot sits beside it, driven by the ADK chat agent over AG-UI, with `list_scenarios`, `create_case` and `run_fleet` as CopilotKit frontend tools

The case detail and cases list render live control-plane data (run records persisted to Firestore) for real cases; other screens remain a scripted walkthrough with mock data.

Persona switching (advocate vs. platform view) is UI-only and carries no authentication or access-control implications. There is no end-user authentication.

---

## Continuous autonomous operation record

Four cases were seeded on 31 August 2026 and approved through the supervisor gate. Each case now has per-commitment checkpoints sleeping in Firestore; Cloud Scheduler fires an hourly sweep (`caserelay-sweep`, `0 * * * * Etc/UTC`) that publishes any overdue checkpoint to Pub/Sub, which delivers a push message to the control plane and starts a new orchestrator run with a fresh `run_id`. No human is present for any of these wakes.

**Cases seeded 2026-08-31:**

| Case ID | Scenario | Expected autonomous wake dates |
|---|---|---|
| CR-0831120614 | kai (cascade: health timeout + legal malformed) | 31 Aug (edu, health, legal), 14 Sep (shelter), 19 Sep (family) |
| CR-0831120932 | amara (long horizon, staggered) | 31 Aug (edu, health), 4 Sep (legal), 11 Sep (shelter), 18 Sep (family) |
| CR-0831121245 | theo (malformed reply from legal) | 31 Aug (edu, legal), 7 Sep (health), 14 Sep (shelter), 19 Sep (family) |
| CR-0831121606 | ellis (duplicate callback idempotency) | 31 Aug (edu, legal), 7 Sep (health), 14 Sep (shelter), 19 Sep (family) |

Each wake produces a `run_id` that differs from the previous run's `run_id` for the same case, confirming it is a genuinely new Cloud Run invocation rather than a continuation of an existing one. The sweep picks up nothing when no checkpoint is due, and those sweeps cost nothing.

**Cloud Logging query to see the wake history** (project `caserelay`):

```
resource.type="cloud_run_revision"
resource.labels.service_name="caserelay-control-plane"
textPayload=~"starting resumed run"
timestamp >= "2026-08-31T00:00:00Z"
```

Each matching line takes the form `starting resumed run {run_id} for case {case_id} (wake wf-{case_id}-{commitment_type})`. The two `run_id`s on adjacent wakes for the same case will always differ, which is the evidence that a fresh invocation fired for each checkpoint.

---

## Where to go next

- [deploy.md](deploy.md) — running it locally, and the full cloud deploy sequence
- [caserelay-walkthrough.md](caserelay-walkthrough.md) — per-phase detail, expected outputs, the control-plane API
- [scenario-showcase.md](scenario-showcase.md) — the non-Maya scenarios with captured Firestore, Logging, Gateway and Trace evidence
- [../examples/](../examples/) — runnable invocations against a local or deployed control plane
