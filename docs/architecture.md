# CaseRelay architecture

The component-level detail behind the [README](../README.md)'s summary.

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
        │      │                        on the "caserelay-orchestrator" engine
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
| Portal | Next.js, TypeScript (Cloud Run `caserelay-portal`, behind a session login page; also runs locally via `npm run dev`) |
| Agent conversations | GEAP Agent Platform Sessions — the `caserelay-chat-sessions` engine for the operator chat transcript, the `caserelay-orchestrator` engine for agent run sessions |
| State | Firestore (named database `caserelay` — see decision note below) |
| Wire protocol | AG-UI for both the operator chat endpoint and the run event stream |
| Observability | Cloud Logging, Cloud Trace (Google-generated spans for MCP tool calls and Model Armor guardrail evaluations via Agent Gateway when `CASERELAY_PARTNER_MCP=1`; ADK engine telemetry enabled) |
| Security | GEAP Agent Identity (platform-managed, mTLS + DPoP), Model Armor (Cloud DLP-backed SDP with custom dictionary detectors), Safeguarding Verifier |


---

## GEAP Capabilities Demonstrated

- **Agent Registry** — 24 services registered by `agents-cli deploy`: eight A2A agent endpoints, two MCP partner entries, and fourteen infrastructure dependencies (Firestore, Model Armor, Vertex AI, Telemetry, Cloud Logging). The platform registers a further eleven `Non A2A` rows of its own — the eight fleet engines plus the `caserelay-chat-sessions`, `caserelay-run-sessions` and `caserelay-memory-bank` engines — so the console's Agents tab reads 19 and the CaseRelay-owned total across all tabs is 35 (a `gcloud alpha agent-registry agents list` returns 20, the extra being Google's own global `Workspace Agent`); Agent Gateway request logs reference the registered entry for each call (`agentRegistryResource`). The registry is a live catalogue, not a runtime routing layer — agents find each other through environment variables, not registry lookups
- **Agent Runtime** — eight reasoning engines in `us-central1` host the fleet. A Maya run ends on its checkpoints and a sweep restarts it with nobody at the keyboard: Firestore holds the sleeping checkpoints, Cloud Scheduler sweeps hourly (`0 * * * *`), and Pub/Sub push delivers the wake to the control plane (dead-letter after 5 attempts, codified in `infra/bootstrap.sh`). That checkpoint / sleep / resume cycle is built on those services rather than on Agent Runtime itself, and a wake lands up to an hour after the deadline it waits on
- **Memory Bank** — GEAP Memory Bank (instance `8631858420611284992`) via ADK's `VertexAiMemoryBankService`; sessions extracted once per wake via synchronous `memories.generate`; recalled memories searched on resume and, when non-empty, injected into orchestrator prompts for the wake, nudge and follow-up phases (`_MEMORY_DECISION_PHASES` in `backend/api/main.py`), with a `memory_injected` audit event recording which memories entered which phase; observed end-to-end on run `de73dabce1d4`, where one recalled memory was injected into `5-wake` and `8-followup`; recalled content so far is process-level observation rather than named contacts or institutional shortcuts; scoped per case (`case_id` → ADK `user_id`); three custom memory topics: `partner_contacts`, `institutional_shortcuts`, `unblocking_strategies`; cross-session consolidation is live (six memories have evolved across sessions with revision history)
- **Agent Platform Sessions** — two Agent Engines via ADK's `VertexAiSessionService`. `caserelay-chat-sessions` holds the operator chat transcript, keyed on the AG-UI thread id so a returning conversation resolves in one read. Agent run sessions land on the `caserelay-orchestrator` engine (`CASERELAY_RUN_SESSION_ENGINE_ID` in `infra/run_sessions.env` points at it; the separate `caserelay-run-sessions` engine was provisioned and is unused), one session per phase invocation rather than one per run, because the fan-out dispatches five phases at once and Google documents row-level locking only for `DatabaseSessionService`. A deployed control plane refuses to start without both engine ids rather than falling back to in-memory sessions that look identical until the instance recycles. A throttled append is retried with jittered backoff and, if it still will not land, kept in memory and logged rather than failing the case
- **Agent Identity** — platform-managed identity per agent (`--agent-identity`); SPIFFE-style principals (`principal://agents.global.org-…`). CaseRelay's own policy gateway (`backend/gateway/gateway.py`, distinct from Google's Agent Gateway) resolves the caller principal on every tool call, checks it against the authority grant recorded for the case and purpose, asserts each requested field against the agent's scope, and raises `IdentityDenied` on a mismatch — this is where cross-scope denial is enforced and audited. What stops one engine claiming another's identity is A2A bearer-token auth at the transport layer; two agents in the same process get no cryptographic check. The Agent Platform IAM allow policies binding these principals are in `DRY_RUN` on `caserelay-iap-authz-ext`, so they audit rather than enforce
- **Agent Gateway** — all eight engines bound to `caserelay-egress`; outbound traffic TLS-intercepted; MCP method deny policy enforcing; a Model Armor extension (`caserelay-ma-authz-ext`) screening against the same `caserelay-screen` template the verifier calls; gateway request logs show method, policy evaluation and TLS interception per call. The extension is fail-closed, so a Model Armor timeout or outage at the gateway denies that call rather than letting it through unscreened — verified on the live resource, where `failOpen` is absent (the API's default `false`) while the sibling `caserelay-iap-authz-ext` returns `failOpen: true` in the same list call. Screening also fails closed one layer in, at the application (see Model Armor below), which is the ring that produces the structured `{verdict, rules}` payload the audit event records
- **Model Armor** — cross-scope-request quarantine via `modelarmor.googleapis.com` template `caserelay-screen` with SDP Advanced Config referencing a Cloud DLP inspect template (`caserelay-cross-scope`) using custom dictionary detectors + hotword proximity rule. This is the call the Safeguarding Verifier makes in `backend/gateway/armor.py`, and it fails closed: any error, missing template or absent client library raises `ScreeningUnavailable`, and `inspect_partner_callback` turns that into a `quarantine` verdict with rule `screening_unavailable` rather than an allow. A live quarantine is recorded in [`proofs/complex-scenarios/maya/model-armor-screening-verdict.json`](proofs/complex-scenarios/maya/model-armor-screening-verdict.json) — `verdict: quarantine`, `rules: ["sdp"]`
- **Agent Observability** — Cloud Trace carries Google-generated spans for MCP tool calls and Model Armor guardrail evaluations that traverse the Agent Gateway, rendered as five-span waterfalls: the MCP `tools/call` root, an `apply_guardrail` span with `gen_ai.security.policy.name: caserelay-screen` and `gen_ai.security.decision.type`, and request/response path breakdown (308 traced requests observed). Demonstrated end-to-end on 2026-08-31: trace `442a845a56a86c50ee5d35be1891cdd7` shows `MCP send tools/call family_status` as the root span with nested `apply_guardrail "Google Cloud Model Armor"` and `/mcp`. The default configuration routes partner calls through the in-process simulator (`CASERELAY_PARTNER_MCP=0`), so it is that leg specifically which produces no MCP spans; engine egress traverses Agent Gateway either way. ADK Agent Runtime does not export its own execution spans (agent phases, LLM calls, in-agent tool use), so agent reasoning is not traced end to end
- **AG-UI on the wire** — both event surfaces speak the protocol: the operator chat endpoint (`/agui`, via `ag_ui_adk`) and the run event stream. `run_started`, `run_completed`, `run_failed`, `phase_started` and `phase_complete` travel as `RUN_STARTED`, `RUN_FINISHED`, `RUN_ERROR`, `STEP_STARTED` and `STEP_FINISHED` — a run is a run and a phase is a step. Everything with no true counterpart, such as a missed deadline or a quarantined reply, travels as `CUSTOM` naming itself with the whole internal event alongside, so the feed keeps every distinction it draws in red and amber. The live SSE stream and the recorded replay use the same envelopes, so the portal decodes a replayed history and a live one through one decoder
- **Gemma session narratives** — `backend/narration/gemma.py` calls Gemma 4 (`gemma-4-26b-a4b-it-maas` on Vertex AI) at the end of each run to generate a 2–4 sentence natural-language summary from the structured run events; the summary is stored on the run record (`gemma_summary`) and logged at INFO. Deployed and observed on the serving revision — three summaries generated across runs `4732b1f2c9d8`, `de73dabce1d4` and `e8f76a62c196`. The model choice is deliberate: short-text generation from structured data does not need a frontier model, and Gemma avoids burning Gemini quota on a mechanical rewrite


### Notable engineering decisions

| Decision | Rationale |
|---|---|
| **mTLS over CAA opt-out** | Agent Identity tokens are certificate-bound (DPoP + mTLS). We hit 401s when calling non-mTLS endpoints and fixed them by setting `GOOGLE_API_USE_CLIENT_CERTIFICATE=true` so traffic routes to `*.mtls.googleapis.com`. We deliberately did NOT set `GOOGLE_API_PREVENT_AGENT_TOKEN_SHARING_FOR_GCP_SERVICES=False` (Google's documented opt-out) because that disables token binding entirely. CAA enforcement remains on. See [troubleshoot-auth-manager](https://docs.cloud.google.com/iam/docs/troubleshoot-auth-manager). |
| **Named Firestore database** | Uses the database named `caserelay`, not `(default)`. Agent Runtime's network proxy URL-encodes parentheses in outgoing requests, turning `(default)` into `%28default%29`, which Firestore rejects with HTTP 400. A named database sidesteps this entirely. |
| **BFF proxy for the control plane** | The portal reaches the authenticated Cloud Run service through a Next.js server-side proxy (`portal/src/app/api/control-plane/[...path]/route.ts`) that mints Google-signed ID tokens. No credential is exposed to the browser. SSE is proxied with incremental delivery preserved. |
| **Control plane locked down** | `allUsers` removed from `roles/run.invoker`; unauthenticated calls return 403. |
| **Sessions and Memory kept on separate engines** | Chat transcripts, agent run transcripts and Memory Bank are held apart. They hold different things and are written at different rates, so a retention or deletion decision about one must not be able to reach another. Chat sessions and Memory Bank each have their own engine; run sessions sit on the `caserelay-orchestrator` engine. |
| **The run event log stays on Firestore, not Sessions** | The activity feed, timeline rail and audit trail need an ordered, live, permanent record. Sessions orders events by timestamp alone, with no sequence field and no documented tiebreak; offers no streaming or watch API; caps appends at 300 per minute per project, which a five-way fan-out can reach on its own; and requires every session to carry an expiry. Cloud Trace retains 30 days non-configurably and Cloud Logging's `entries.list` is capped at 60 requests per minute and explicitly not intended for bulk retrieval, so neither is a home for it either. The log is therefore one Firestore document per event under its run, keyed by the position it was pushed at (`backend/runtime/event_log.py`). Only the wire format is AG-UI; storage is untouched. |
| **Durable run history written off the hot path** | A phase narrates itself by pushing an event, and the SSE stream serves those events from memory, so a slow write can never surface as a stalled agent. A background writer drains one FIFO queue, preserving push order, and a run flushes it once it has finished. History survives a Cloud Run restart; deleting a case deletes its events with it. |

---

## Portal

The portal is deployed to Cloud Run as `caserelay-portal` and also runs locally via `npm run dev`. The hosted service is public at the network level. The judging revision is behind a session login page: navigate to `/login`, choose a role, and sign in with `admin@caserelay.com` and the password in the Devpost testing instructions — see the [README](../README.md#submission-at-a-glance), which is the authoritative statement of how to reach it.

Two things about that are worth knowing before quoting it, because the deployed revision and this source tree do not match:

- `portal/src/middleware.ts` in this tree is an HTTP Basic gate — one shared credential, no session store, matcher covering `/api` as well as the pages so the BFF proxy that actually carries case data is not left outside it. `infra/deploy_portal.sh` sets `PORTAL_AUTH_USER` and mounts `PORTAL_AUTH_PASSWORD` from the Secret Manager secret `caserelay-portal-password`. With no password configured it stands aside in development and refuses to serve anything at all in a production build, so a secret that fails to mount cannot quietly publish the case list. It is not what gates the judging revision, and that is measured rather than assumed: `gcloud run services describe` shows both `PORTAL_AUTH_USER` and `PORTAL_AUTH_PASSWORD` present on `caserelay-portal-00008-p8w`, which takes 100% of traffic, so if this file were executing every uncredentialed request would come back 401 with `WWW-Authenticate: Basic` — and with the secret absent it would 503 rather than serve. Instead `/`, `/cases` and `/admin` return 307 to `/login?next=…`, `/api/control-plane/v1/cases` returns 401 `{"error":"Not signed in."}`, `/login` returns 200, and no `WWW-Authenticate` header appears on any of them. Treat it as the gate for restricted deployments rather than as the control in front of the hosted URL.
- The session login the judging revision serves is not built from anything in `portal/src`. `portal/src/components/auth/useSignIn.ts` says there is no auth backend behind the sign-in screen: it writes the chosen persona to `sessionStorage`/`localStorage` and navigates, and no server-side session check exists in the tree. Whatever enforces the login on the deployed revision is not committed here.

Separately, Next.js 16 deprecates the `middleware` file convention in favour of `proxy`, and there is no `proxy.ts` in the tree or its history. On the pinned 16.3.2 the framework still detects `src/middleware.ts` and only warns, so the rename is an upgrade hazard rather than a current break.

Firebase Hosting was never used — `caserelay-portal.web.app` is not live and is not the deployment target. Per the official hackathon rules a hosted URL is optional in any case ("Your app does not need to be publicly accessible or live at the exact moment of submission or judging").

Portal screens:

1. **Case Inbox** — overdue, blocked, approval-needed, and recently completed cases
2. **Continuity Timeline** — commitments, owners, evidence, deadlines, handoffs
3. **Approval Center** — proposed action, evidence, disclosed/withheld fields, policy basis
4. **Agent Registry** — owner, version, purpose, tools, scopes, endpoint, health
5. **Audit Trace** — correlated delegation, access, model/tool calls, retry, approval, completion events
6. **Synthetic Data Lab** (`/admin`) — create a case from a named scenario, run the fleet, and watch the AG-UI event stream. An operator copilot sits beside it, driven by the ADK chat agent over AG-UI, with `list_scenarios`, `list_cases`, `create_case`, `start_outreach` and `case_report` as CopilotKit frontend tools

The cases list, case detail, approvals, registry, audit and admin screens read live control-plane data (run records persisted to Firestore). The overview (`/`) and guidelines (`/guidelines`) screens still render from `portal/src/lib/mock/`, and the case detail page mixes live run data with mock policy fixtures.

Persona switching between the three views (advocate, supervisor, admin) is a view-switcher rather than an access-control boundary: the select records which view to render, and signing in as one role rather than another does not change what the control plane returns.

---

## Continuous autonomous operation record

Four cases were created on 31 August 2026 through `POST /v1/cases` against the deployed control plane, each from a named scenario, and activated by a named supervisor through the activation gate. The referral packets are synthetic — they come from `backend/state/synthetic.py` — but everything after case creation is real execution: intake extracted the commitments, the fan-out ran, and the orchestrator's own `schedule_wake` tool wrote the per-commitment checkpoints during the `4-checkpoint` phase. Nothing wrote a checkpoint document directly.

Those checkpoints now sleep in Firestore. Cloud Scheduler fires an hourly sweep (`caserelay-sweep`, `0 * * * * Etc/UTC`) that publishes any overdue checkpoint to Pub/Sub, which delivers a push message to the control plane and starts a new orchestrator run with a fresh `run_id`. No human is present for any of these wakes.

**Cases created 2026-08-31:**

| Case ID | Scenario | Expected autonomous wake dates |
|---|---|---|
| CR-0831120614 | kai (cascade: health timeout + legal malformed) | 31 Aug (edu, health, legal), 14 Sep (shelter), 15 Sep (family) |
| CR-0831120932 | amara (long horizon, staggered) | 31 Aug (edu, health), 4 Sep (legal), 11 Sep (shelter), 15 Sep (family) |
| CR-0831121245 | theo (malformed reply from legal) | 31 Aug (edu, legal), 7 Sep (health), 14 Sep (shelter), 15 Sep (family) |
| CR-0831121606 | ellis (duplicate callback idempotency) | 31 Aug (edu, legal), 7 Sep (health), 14 Sep (shelter), 15 Sep (family) |

Each wake produces a `run_id` that differs from the checkpoint run's `run_id` for the same case, confirming it is a genuinely new Cloud Run invocation rather than a continuation of an existing one. The sweep picks up nothing when no checkpoint is due, and those sweeps cost nothing.

**Verified wake on 2026-08-31:** the 13:00 UTC sweep (delivered at 13:03 UTC via Pub/Sub) fired four wakes. For case CR-0831120614 (kai), the checkpoint run that wrote the sleep record was `7702b90ee88d` (state: suspended, phase: checkpoint). The sweep-triggered wake run was `5f2738588aaf` (state: completed, phase: done, started 13:03:09 UTC) — a fresh invocation with a distinct `run_id` and nobody at the keyboard.

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
