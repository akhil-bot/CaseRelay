# CaseRelay

**No child's next step should disappear between systems.**

CaseRelay is a governed multi-agent fleet that helps CASA/GAL programs detect stalled services, coordinate minimum-necessary follow-up across agencies, and escalate missing handoffs — without making decisions about children.

Built for the [All Things Agentic Hackathon](https://allthingsagentichackathon.devpost.com/) using Google ADK, Vertex AI Gemini, and the Gemini Enterprise Agent Platform (GEAP).

---

## The Problem

When a child in foster care is referred to a school, a healthcare provider, a shelter, and a legal-aid organization simultaneously, no single system tracks whether all of those commitments were actually acted on. A referral can sit unowned for weeks. A court-appointed volunteer manually chases down each partner. Handoffs disappear not through negligence, but through lack of coordination infrastructure.

CaseRelay closes that gap with an accountable, audited agent fleet — one where every agent has a visible owner, a bounded data scope, and a human-in-the-loop for consequential decisions.

---

## Hackathon Track

**Fortified Enterprise Fleet** — demonstrating Agent Registry, Agent Runtime, Memory Bank, Agent Identity, Agent Gateway, Model Armor, and Agent Observability running together on Google Cloud.

---

## Architecture

```
CASA Volunteer / Supervisor
        │
        ▼
  CaseRelay Portal (Next.js, local)
        │  BFF proxy — mints ID tokens server-side;
        │  no credential reaches the browser
        ▼
  Control Plane (FastAPI on Cloud Run, auth-required)
        │
        ├─► Intake & Authority Agent  ──► Firestore (named DB "caserelay")
        │                                       │
        │                              Pub/Sub Events
        │                                       │
        ▼                                       ▼
  Continuity Orchestrator ◄────────── Agent Registry
        │
        ▼
  Agent Gateway  ──► Education Agent ──┐
                 ──► Health Agent     ──┤    All 8 agents on Vertex AI
                 ──► Legal Agent      ──┼──► Agent Engine (reasoning engines)
                 ──► Shelter Agent    ──┤    with platform-managed Agent Identity
                 ──► Family Services  ──┘
                          │
                    Model Armor ──► Safeguarding Verifier
                                          │
                                 Human Approval Queue
                                          │
                                 Firestore / Audit Log
```

**Technology stack:**

| Layer | Technology |
|---|---|
| Agent runtime | Google ADK on Vertex AI Agent Engine (reasoning engines), Gemini 3.5 Flash (`gemini-3.5-flash`) |
| Control plane | Python, FastAPI, Cloud Run (`caserelay-control-plane`; `allUsers` removed, auth-required) |
| Portal | Next.js, TypeScript (local `npm run dev`; not deployed) |
| State | Firestore (named database `caserelay` — see decision note below) |
| Observability | Cloud Logging, Cloud Trace (ADK spans with `gen_ai.*` attributes via `otel_to_cloud`; control-plane spans via `CloudTraceSpanExporter`) |
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
2. Orchestrator discovers partner agents through the Registry and delegates scoped tasks.
3. Legal completes. Healthcare schedules. Education goes 17 days without a verified owner.
4. A Pub/Sub push event (driven by Cloud Scheduler every 5 minutes) wakes the dormant workflow — no user prompt, no open browser.
5. The Education Agent requests only enrollment-status fields through the Gateway.
6. A malicious school response tries to retrieve medical notes; Model Armor quarantines it.
7. The Safeguarding Verifier creates a safe retry and records every withheld field.
8. CaseRelay drafts an escalation showing evidence, recipient, policy basis, and withheld fields. A supervisor approves.
9. The school confirms enrollment. The same workflow resumes idempotently, closes the commitment, and updates Maya's timeline.

---

## GEAP Capabilities Demonstrated

- **Agent Registry** — versioned A2A cards and live discovery for all eight agents, auto-registered by `agents-cli deploy`
- **Agent Runtime** — eight reasoning engines in `us-central1` with checkpoint, sleep, and deadline-triggered resume via Pub/Sub push + Cloud Scheduler (5-minute sweep, dead-letter after 5 attempts, codified in `infra/bootstrap.sh`)
- **Memory Bank** — GEAP Memory Bank (instance `8631858420611284992`) via ADK's `VertexAiMemoryBankService`; sessions extracted once per wake via synchronous `memories.generate`; scoped per case (`case_id` → ADK `user_id`); three custom memory topics: `partner_contacts`, `institutional_shortcuts`, `unblocking_strategies`
- **Agent Identity** — platform-managed identity per agent (`--agent-identity`); SPIFFE-style principals (`principal://agents.global.org-…`); caller principal verified at the gateway; cross-scope denial demonstrated
- **Agent Gateway** — caller-authenticated, deny-by-default, purpose-bound field projection
- **Model Armor** — cross-scope-request quarantine via `modelarmor.googleapis.com` template `caserelay-screen` with SDP Advanced Config referencing a Cloud DLP inspect template (`caserelay-cross-scope`) using custom dictionary detectors + hotword proximity rule; fails closed
- **Agent Observability** — Cloud Trace enabled on fleet (`otel_to_cloud=True`, `GOOGLE_CLOUD_AGENT_ENGINE_ENABLE_TELEMETRY=true`) with ADK spans (`invoke_agent`, `call_llm`, `execute_tool`) carrying `gen_ai.*` attributes and token counts. Limitation: control-plane and engine traces do not share a trace id (Agent Runtime starts a fresh trace context)

### Notable engineering decisions

| Decision | Rationale |
|---|---|
| **mTLS over CAA opt-out** | Agent Identity tokens are certificate-bound (DPoP + mTLS). We hit 401s when calling non-mTLS endpoints and fixed them by setting `GOOGLE_API_USE_CLIENT_CERTIFICATE=true` so traffic routes to `*.mtls.googleapis.com`. We deliberately did NOT set `GOOGLE_API_PREVENT_AGENT_TOKEN_SHARING_FOR_GCP_SERVICES=False` (Google's documented opt-out) because that disables token binding entirely. CAA enforcement remains on. See [troubleshoot-auth-manager](https://docs.google.com/iam/docs/troubleshoot-auth-manager). |
| **Named Firestore database** | Uses the database named `caserelay`, not `(default)`. Agent Runtime's network proxy URL-encodes parentheses in outgoing requests, turning `(default)` into `%28default%29`, which Firestore rejects with HTTP 400. A named database sidesteps this entirely. |
| **BFF proxy for the control plane** | The portal reaches the authenticated Cloud Run service through a Next.js server-side proxy (`portal/src/app/api/control-plane/[...path]/route.ts`) that mints Google-signed ID tokens. No credential is exposed to the browser. SSE is proxied with incremental delivery preserved. |
| **Control plane locked down** | `allUsers` removed from `roles/run.invoker`; unauthenticated calls return 403. |

---

## Portal

The portal runs locally via `npm run dev`. It is not deployed; `caserelay-portal.web.app` is not live. Per the official hackathon rules, a hosted URL is optional ("Your app does not need to be publicly accessible or live at the exact moment of submission or judging").

Portal screens:

1. **Case Inbox** — overdue, blocked, approval-needed, and recently completed cases
2. **Continuity Timeline** — commitments, owners, evidence, deadlines, handoffs
3. **Approval Center** — proposed action, evidence, disclosed/withheld fields, policy basis
4. **Agent Registry** — owner, version, purpose, tools, scopes, endpoint, health
5. **Audit Trace** — correlated delegation, access, model/tool calls, retry, approval, completion events

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

**Prerequisites:** Python 3.12+, `uv`, Google Cloud project with GEAP access, `gcloud` CLI authenticated.

```bash
git clone git@github.com:akhil-bot/CaseRelay.git
cd CaseRelay
uv sync                       # installs from pyproject.toml into .venv
source .venv/bin/activate
```

Set the required environment variables (see `.env.example`), then run the full local journey:

```python
# In a Python shell with PYTHONPATH=.
from backend.runtime.fleet import run_maya
out = run_maya()
```

**Cloud testing requires a prior deploy.** `infra/fleet_endpoints.env` is not committed — it is generated by `infra/collect_endpoints.sh` after the fleet agents are deployed to Vertex AI Agent Engine. Once you have deployed and collected endpoints, use the CLI:

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

Official rules, submission checklist, scoring mechanism, and judging criteria are mirrored in
[docs/hackathon-rulebook.md](docs/hackathon-rulebook.md).

---

## License

Apache 2.0 — see [LICENSE](LICENSE).
