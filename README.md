# CaseRelay

**No child's next step should disappear between systems.**

CaseRelay is a governed multi-agent fleet that helps CASA/GAL programs detect stalled services, coordinate minimum-necessary follow-up across agencies, and escalate missing handoffs — without making decisions about children.

Built for the [All Things Agentic Hackathon](https://allthingsagentichackathon.devpost.com/) using Google ADK, Vertex AI Gemini, and the Gemini Enterprise Agent Platform (GEAP).

**Writeup:** [docs/hackathon-blog.md](docs/hackathon-blog.md) — source of truth for the contest blog. DEV.to: publish from this file (URL TBD).

---

## The Problem

When a child in foster care is referred to a school, a healthcare provider, a shelter, and a legal-aid organization simultaneously, no single system tracks whether all of those commitments were actually acted on. A referral can sit unowned for weeks. A court-appointed volunteer manually chases down each partner. Handoffs disappear not through negligence, but through lack of coordination infrastructure.

CaseRelay closes that gap with an accountable, audited agent fleet — one where every agent has a visible owner, a bounded data scope, and a human-in-the-loop for consequential decisions.

---

## Hackathon Track

**Fortified Enterprise Fleet** — demonstrating Agent Registry, Agent Runtime, Agent Platform Sessions, Memory Bank, Agent Identity, Agent Gateway, Model Armor, and Agent Observability running together on Google Cloud.

---

## Architecture

```
CASA Volunteer / Supervisor
        │
        ▼
  CaseRelay Portal (Next.js, local)
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
| Portal | Next.js, TypeScript (local `npm run dev`; not deployed) |
| Agent conversations | GEAP Agent Platform Sessions on two dedicated Agent Engines (`caserelay-chat-sessions`, `caserelay-run-sessions`) |
| State | Firestore (named database `caserelay` — see decision note below) |
| Wire protocol | AG-UI for both the operator chat endpoint and the run event stream |
| Observability | Cloud Logging, Cloud Trace (Google-generated spans for MCP tool calls and Model Armor guardrail evaluations via Agent Gateway; ADK engine telemetry enabled) |
| Security | GEAP Agent Identity (platform-managed, mTLS + DPoP), Model Armor (Cloud DLP-backed SDP with custom dictionary detectors), Safeguarding Verifier |

---

## Agent Fleet

Eight agents deployed as Vertex AI reasoning engines, each with a platform-managed Agent Identity (`identityType: AGENT_IDENTITY`, `--agent-identity`) and a scoped data projection. Only the control plane runs on Cloud Run.

| Agent | Owner | Scope |
|---|---|---|
| Continuity Orchestrator | CASA program | Operational facts only; never raw partner records |
| Intake & Authority Agent | CASA program | Extracts commitments; cannot activate without supervisor |
| Education Liaison Agent | Simulated school district | Enrollment status only; no health/legal/family data |
| Health Coordination Agent | Simulated healthcare provider | Appointment status only; no diagnoses or clinical notes |
| Legal Aid Agent | Simulated legal-aid org | Referral/status only; no legal advice or strategy |
| Shelter Status Agent | Simulated shelter | Availability/status only; cannot rank placements |
| Family Services Agent | Simulated child-welfare agency | Scheduling/status only; no risk scores or findings |
| Safeguarding Verifier | CASA compliance | Policy enforcement; cannot approve its own actions |

---

## Core Scenario

**Case CR-1042 — Maya's stalled school enrollment**

1. Supervisor activates monitoring after verifying court authority.
2. Orchestrator delegates scoped tasks to five partner agents, reaching each over authenticated A2A.
3. Four partners confirm. Lincoln Unified asks for more time on the school enrollment, so that commitment goes to `deferred` and the fleet writes down when to come back — it is also the one referral with nobody named on the other side.
4. The run ends there on its checkpoints rather than holding a session open. A Pub/Sub push event (driven by Cloud Scheduler every minute) wakes the workflow — no user prompt, no open browser — and the resumed run's first act is to check back with the district.
5. The Education Agent requests only enrollment-status fields through the Gateway.
6. The district's reply to that check-back tries to retrieve medical notes; Model Armor quarantines it. The instruction is never carried out.
7. The Safeguarding Verifier opens an escalation showing evidence, recipient, policy basis, and withheld fields, and records the quarantine against its own platform identity. The run parks there with school enrollment still open — nothing has been chased and no coordinator has been found. A supervisor approves.
8. Only then may the scoped follow-up go out. The district is chased once within the same authority grant that covered the original request.
9. The district answers, naming the enrollment coordinator who has taken the referral on. That name is written back onto the referral, the commitment closes, and Maya's timeline updates. Had nobody answered, the supervisor would have been told instead.

**Maya is not the only scenario.** [docs/scenario-showcase.md](docs/scenario-showcase.md) covers the rest — a provider that goes silent and ends up in front of a named supervisor, a school that asks for medical records while answering a question about enrollment, a partner reply that cannot be parsed — each verified end to end against the deployed control plane, with the captured Firestore, Cloud Logging, Agent Gateway and Cloud Trace evidence, and with the scenarios that do *not* hold up listed alongside the ones that do.

---

## GEAP Capabilities Demonstrated

- **Agent Registry** — 24 registered services: eight A2A agent endpoints, one MCP partner server, and fifteen infrastructure dependencies (Firestore, Model Armor, Vertex AI, Telemetry, Cloud Logging), auto-registered and updated by `agents-cli deploy`; Agent Gateway request logs reference the registered entry for each call (`agentRegistryResource`). The registry is a live catalogue, not a runtime routing layer — agents find each other through environment variables, not registry lookups
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

The portal runs locally via `npm run dev`. It is not deployed; `caserelay-portal.web.app` is not live. Per the official hackathon rules, a hosted URL is optional ("Your app does not need to be publicly accessible or live at the exact moment of submission or judging").

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

## Boundaries (What CaseRelay Does Not Do)

- No placement, custody, safety-risk, clinical, or eligibility decisions
- No real child data and no claim of CASA endorsement
- No replacement for existing case-management systems (Optima, Casebook, state systems)
- No unrestricted cross-agency child profile
- No autonomous emergency response

---

## Local Setup

**Prerequisites:** Python 3.12+, `uv`, Node 20+, the `gcloud` CLI, and membership of a Google Cloud project with GEAP access. Ask the project owner for the roles named below; there is no key file to obtain.

```bash
git clone git@github.com:akhil-bot/CaseRelay.git
cd CaseRelay
uv sync                       # installs from pyproject.toml into .venv
source .venv/bin/activate
```

**Authenticate before anything else.** Every model call goes to Vertex AI, so the local journey needs application default credentials and `roles/aiplatform.user` on the project:

```bash
gcloud auth application-default login
gcloud config set project caserelay
```

**Then the environment.** `.env.example` describes every variable the backend reads and which ones a local run actually needs. Nothing loads it for you — there is no dotenv in the dependency tree — so source it into the shell you are about to run `uvicorn` in:

```bash
cp .env.example .env
set -a; source .env; set +a
```

Now run the full local journey. The run engine lives in the control plane, so drive it there. With every `CASERELAY_URL_*` unset the orchestrator assembles the specialists in-process, so no deployed endpoint is involved:

```bash
PYTHONPATH=. uvicorn backend.api.main:app --port 8000
```

`curl -s localhost:8000/health` returns `{"ok":true}` once it is up. The startup log also carries `AG-UI chat endpoint mounted at /agui`; if that line is missing the chat panel will not answer.

```bash
# In a second shell — creates the flagship case and runs the fleet against it
CASE=$(curl -s -X POST localhost:8000/v1/cases -H 'content-type: application/json' \
  -d '{"scenario":"maya","due_in":"10s"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["case_id"])')
RUN=$(curl -s -X POST "localhost:8000/v1/cases/$CASE/runs" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["run_id"])')
curl -N "localhost:8000/v1/runs/$RUN/events"
```

Keep `due_in` at `10s`. `schedule_wake` spreads the five per-commitment checkpoints proportionally across the window it is given, at `now + due_in × (i+1)/5`. At `10s` all five have lapsed by the time the run checkpoints, so the resumed run finds education overdue and checks back with the school. A longer deadline leaves the later checkpoints in the future, the resumed run arrives before education's check-back is due, and the quarantine, follow-up and memory phases never become reachable.

That first run stops after intake at the activation gate. No phase can approve it — release it with the real endpoint, which starts a second run:

```bash
curl -s -X POST "localhost:8000/v1/cases/$CASE/activate" -H 'content-type: application/json' \
  -d '{"supervisor_id":"supervisor-001"}'
```

The second run fans out and then ends at `run_suspended`, which is the point of the design: the case is checkpointed and the work that remains is waiting on a deadline, not on a session. In the cloud, Cloud Scheduler's one-minute sweep publishes the wake and the push handler starts the continuation run. Locally there is no Pub/Sub, so stand in for it once the deadline has passed:

```bash
curl -s -X POST localhost:8000/v1/workflows/sweep     # marks due checkpoints running
curl -s -X POST localhost:8000/v1/pubsub/push -H 'content-type: application/json' \
  -d "{\"message\":{\"data\":\"$(printf '{"event_type":"workflow_wake","case_id":"%s"}' "$CASE" | base64)\"}}"
```

That returns the `run_id` of the resumed run, which streams from the same endpoint. OIDC verification on `/v1/pubsub/push` is skipped when `CASERELAY_CONTROL_PLANE` is unset, which is exactly what makes this local stand-in possible and why the deployed service sets it.

### The portal

The portal is a separate service and every command below runs from `portal/`, not the repo root — npm resolves the wrong `package.json` from up here, which is why `npm run typecheck` in particular misbehaves when run from the wrong directory.

```bash
cd portal
cp .env.local.example .env.local
npm install
npm run dev
```

Next.js reads `.env.local` on its own, so there is no sourcing step on this side. The portal has no data of its own: it proxies everything to a control plane and shows empty screens if it cannot reach one. `.env.local.example` offers two targets and you must pick one. Pointing `CONTROL_PLANE_URL` at the deployed service is the default and needs `roles/iam.serviceAccountTokenCreator` on the portal service account so the BFF can mint an ID token as it. Pointing it at `http://localhost:8000` instead talks to the control plane you just started, and an `http://` URL makes the BFF skip auth entirely — no Google credentials involved.

It worked when [localhost:3000](http://localhost:3000) renders the overview and `/admin` lists the scenarios. That list comes from the control plane's `/v1/scenarios` through the BFF proxy, so it appearing proves the authenticated hop and not just the UI.

The dev server owns port 3000 and a second one does not queue behind it — it exits with `Another next dev server is already running`. Stop the first, or pass `-- --port 3001`, which the control plane's CORS allowlist already covers.

**Cloud testing requires a prior deploy.** `infra/fleet_endpoints.env` is generated by `infra/collect_endpoints.sh` after the fleet agents are deployed to Vertex AI Agent Engine, and the committed copy describes whichever fleet was deployed last. Regenerate it after a deploy of your own, then use the CLI:

```bash
# Run after deploying the fleet and running infra/collect_endpoints.sh
source infra/fleet_endpoints.env
python infra/case_cli.py ls
```

Full instructions, expected outputs, and the deploy procedure are in **[docs/caserelay-walkthrough.md](docs/caserelay-walkthrough.md)**.

---

## Verified Security Properties

These have been demonstrated on the deployed fleet, not merely asserted.

- **Cross-scope denial** — in the `rosa` scenario the education agent received ONLY `child_name`, `dob`, `referral_id`; no medical fields disclosed.
- **A2A transport auth** — calls with no credentials or an invalid bearer token are refused with HTTP 401; valid token returns 200.
- **Gateway identity model** — on a deployed engine the caller principal is resolved from `RunContext` and must match that engine's own deployed identity, preventing an engine from claiming to be a different engine. Cross-engine protection comes from A2A bearer-token auth at the transport layer.
- **Quarantine → escalation** — 5/5 concurrent cloud end-to-end runs had the verifier agent itself call `open_escalation`.

---

## Submission Details

| Field | Value |
|---|---|
| Project name | CaseRelay |
| Hackathon | All Things Agentic (Google) |
| Track | Fortified Enterprise Fleet |
| Demo duration | ≤ 3:50 |
| Demo language | English (with captions) |
| Cloud platform | Google Cloud (Vertex AI Agent Engine, Cloud Run, Firestore, GEAP) |
| Writeup | [docs/hackathon-blog.md](docs/hackathon-blog.md). DEV.to: publish from this file (URL TBD). |

Official rules, submission checklist, scoring mechanism, and judging criteria are mirrored in
[docs/hackathon-rulebook.md](docs/hackathon-rulebook.md).

---

## License

Apache 2.0 — see [LICENSE](LICENSE).
