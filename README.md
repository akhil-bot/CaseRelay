# CaseRelay

**A governed multi-agent fleet that stops a foster child's next step disappearing between agencies.**

Eight ADK agents on Google's Gemini Enterprise Agent Platform help CASA/GAL programs detect stalled
services, coordinate minimum-necessary follow-up across schools, clinics, courts and shelters, and
escalate missing handoffs to a named human — without making decisions about children.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Track: Fortified Enterprise Fleet](https://img.shields.io/badge/track-Fortified%20Enterprise%20Fleet-4285F4)](https://allthingsagentichackathon.devpost.com/)
[![Gemini 3.5 Flash](https://img.shields.io/badge/model-gemini--3.5--flash-1a73e8)](https://cloud.google.com/vertex-ai)
[![Google Cloud](https://img.shields.io/badge/cloud-Agent%20Engine%20%7C%20Cloud%20Run%20%7C%20Firestore-34A853)](https://cloud.google.com)

![CaseRelay multi-agent mesh — eight ADK agents on Gemini Enterprise Agent Platform, A2A between engines, MCP egress through Agent Gateway, and the GEAP governance layer underneath](docs/diagrams/caserelay-multi-agent-mesh.png)

---

## Submission at a glance

| | |
|---|---|
| **Hackathon** | [All Things Agentic](https://allthingsagentichackathon.devpost.com/) (Google) |
| **Track** | Fortified Enterprise Fleet |
| **Demo video** | *(URL to be added — video recorded, pending upload)* |
| **Repository** | [github.com/akhil-bot/CaseRelay](https://github.com/akhil-bot/CaseRelay) |
| **Control plane** | [`caserelay-control-plane-6nwo7o4bbq-uc.a.run.app`](https://caserelay-control-plane-6nwo7o4bbq-uc.a.run.app) — Cloud Run, auth-required (anonymous requests return 403) |
| **Portal** | [`caserelay-portal-6nwo7o4bbq-uc.a.run.app`](https://caserelay-portal-6nwo7o4bbq-uc.a.run.app) — Cloud Run, behind a session login. Go to `/login`, choose any role, enter email `admin@caserelay.com` and the password supplied in the Devpost submission's testing instructions. |
| **Architecture diagram** | The image above, sources in [`docs/diagrams/`](docs/diagrams/) |
| **Spin-up instructions** | [docs/deploy.md](docs/deploy.md) |
| **Write-up** | [docs/hackathon-blog.md](docs/hackathon-blog.md) — source of truth for the contest blog. DEV.to: publish from this file (URL TBD). |

---

## Verify without credentials

Clone and run — no GCP project, no service account, no API key:

```bash
git clone git@github.com:akhil-bot/CaseRelay.git && cd CaseRelay
uv sync && source .venv/bin/activate
cd portal && npm install && cd ..   # needed for t2.3 (TypeScript typecheck)
python harness/gate.py --all
```

Expected output: **34 passed, 0 failed, 3 skipped**. The 3 skips are marked `slow=True` in the
source and name themselves; they talk to Vertex, Cloud Run and Cloud Scheduler and are excluded
unless you pass `--slow`. A skip is never counted as a pass.

**Without `npm install`** (skip the `cd portal` step): t2.3 announces itself as a skip and the
result is **33 passed, 0 failed, 4 skipped**. **Without a Docker daemon** running: t12.1
announces itself as a skip; without both it is **32 passed, 0 failed, 5 skipped**. No gate
silently fails because a prerequisite is absent.

What the 34 offline gates verify:

| Gates | What they prove |
|---|---|
| t2.1 – t2.3 | No false model-version claims; no leaked answer key; TypeScript compiles |
| t3.1 – t3.2 | Store selects Firestore by default; `CASERELAY_STATE=memory` overrides it; 14 state-machine unit tests pass |
| t4.1 – t4.4 | `RunContext` carries all four IDs; context isolates between concurrent tasks; trace ids are real OTel hex strings; gateway disclosures emit the three `caserelay.*` span attributes |
| t5.1 – t5.3 | Two cases get distinct checkpoints; checkpoints carry a tz-aware `due_at`; Firestore index covers `state + due_at` |
| t6.1 | Audit log rejects duplicate `event_id` (immutability enforced in code, not policy) |
| t7.1 – t7.3 | All nine scenarios exist; maya injects, noah is clean; simulator resolves behaviour from case state |
| t9.1 – t9.6 | API routes exist and are wired; scenario-backed create works; 403/404 in schema; agent card tool lists match deployed tools |
| t10.1 – t10.3 | Run submission returns 202 in under a second; SSE stream delivers events queued before and after connect; control plane fails closed with no specialist endpoints |
| t11.1 – t11.4, t11.6 | Sweeper returns overdue checkpoints and skips future ones; idempotent double-sweep; wake audit names the scheduler not a volunteer; `due_in` sets a real deadline; case deletion removes checkpoints, locks and run events |
| t12.1, t12.3 | Docker image builds clean; CORS is configured and not a wildcard-with-credentials |
| t13.1, t14.1 | Checked-in OpenAPI contract matches the live app schema; admin spec names all required endpoints |

To run a single gate: `python harness/gate.py t5.1`. To run a stage: `python harness/gate.py --stage 1`.

---

## Quick start

The local path runs the whole flagship case — intake, activation gate, five-way fan-out,
checkpoint, wake, Model Armor quarantine, escalation gate, follow-up — in one process. It needs
application default credentials and `roles/aiplatform.user` on any GCP project. Nothing
allowlisted, no Firestore, no deployed engine.

```bash
git clone git@github.com:akhil-bot/CaseRelay.git && cd CaseRelay
uv sync && source .venv/bin/activate
gcloud auth application-default login

cp .env.example .env            # edit it: CASERELAY_PROJECT_ID and GOOGLE_CLOUD_PROJECT
set -a; source .env; set +a     # nothing loads .env for you — there is no dotenv in the tree

PYTHONPATH=. uvicorn backend.api.main:app --port 8000
```

Then, in a second shell:

```bash
bash examples/local-maya-run.sh
```

That is the whole local journey. **[docs/deploy.md](docs/deploy.md)** has everything else in one
place — the portal, the full cloud deploy sequence, what each `infra/` script does, and an honest
account of [what an outsider cannot reproduce](docs/deploy.md#what-an-outsider-cannot-reproduce).
More invocations, including running named scenarios against the deployed fleet, are in
**[examples/](examples/)**.

---

## The problem

When a child in foster care is referred to a school, a healthcare provider, a shelter, and a legal-aid organization simultaneously, no single system tracks whether all of those commitments were actually acted on. A referral can sit unowned for weeks. A court-appointed volunteer manually chases down each partner. Handoffs disappear not through negligence, but through lack of coordination infrastructure.

CaseRelay closes that gap with an accountable, audited agent fleet — one where every agent has a visible owner, a bounded data scope, and a human-in-the-loop for consequential decisions.

---

## The agent fleet

Eight agents deployed as Vertex AI reasoning engines (`gemini-3.5-flash`), each with a platform-managed Agent Identity (`identityType: AGENT_IDENTITY`, `--agent-identity`) and a scoped data projection. None of the eight runs on Cloud Run; the control plane, the portal and the partner MCP server do.

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

Component wiring, the technology stack and the engineering decisions behind them are in
**[docs/architecture.md](docs/architecture.md)**.

---

## The flagship case

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

## GEAP capabilities

Every row links to the full account, including the limitations, in
[docs/architecture.md](docs/architecture.md#geap-capabilities-demonstrated).

| Component | In CaseRelay |
|---|---|
| **Agent Registry** | 24 registered services, auto-registered and updated by `agents-cli deploy`. A live catalogue, not a runtime routing layer — agents find each other through environment variables, not registry lookups. |
| **Agent Runtime** | Eight reasoning engines in `us-central1` hosting the fleet. The checkpoint / sleep / deadline-triggered resume cycle around them is Firestore plus Pub/Sub push and Cloud Scheduler rather than Agent Runtime itself. |
| **Memory Bank** | Instance `8631858420611284992` via ADK's `VertexAiMemoryBankService`, scoped per case, with three custom memory topics. The recalled content so far is general process observations rather than operationally specific intelligence. |
| **Agent Platform Sessions** | `caserelay-chat-sessions` for the operator chat transcript; the `caserelay-orchestrator` reasoning engine for agent run sessions, one session per phase invocation. A deployed control plane refuses to start without both engine IDs configured. (`caserelay-run-sessions` was provisioned but is unused; `CASERELAY_RUN_SESSION_ENGINE_ID` points to the orchestrator engine.) |
| **Agent Identity** | Platform-managed identity per agent (`--agent-identity`); SPIFFE-style principals; caller principal verified at the gateway; cross-scope denial demonstrated. |
| **Agent Gateway** | All eight engines bound to `caserelay-egress`; outbound traffic TLS-intercepted; MCP method deny policy enforcing; Model Armor extension fail-closed. |
| **Model Armor** | Template `caserelay-screen` with SDP Advanced Config referencing a Cloud DLP inspect template using custom dictionary detectors and a hotword proximity rule; fails closed. |
| **Agent Observability** | Cloud Trace carries Google-generated spans for MCP tool calls and Model Armor guardrail evaluations that traverse Agent Gateway. Demonstrated end-to-end on 2026-08-31: trace `442a845a56a86c50ee5d35be1891cdd7` shows `MCP send tools/call family_status` as the root span with nested `apply_guardrail "Google Cloud Model Armor"` and `/mcp`. The fleet's default configuration routes partner calls through the in-process simulator (`CASERELAY_PARTNER_MCP=0`); setting the flag to `1` reproduces fresh gateway spans from partner calls. Agent Gateway remains active for all engine egress regardless of the MCP flag. **Limitation:** ADK Agent Runtime does not export its own execution spans, so end-to-end tracing of agent reasoning is not achieved. |

Two things beyond the seven components: **AG-UI** carries both event surfaces (the operator chat
endpoint and the run event stream), and **Gemma 4** writes the end-of-run session narrative.

---

## Verified security properties

These have been demonstrated on the deployed fleet, not merely asserted.

- **Cross-scope denial** — in the `rosa` scenario the education agent received ONLY `child_name`, `dob`, `referral_id`; no medical fields disclosed.
- **A2A transport auth** — calls with no credentials or an invalid bearer token are refused with HTTP 401; valid token returns 200.
- **Gateway identity model** — on a deployed engine the caller principal is resolved from `RunContext` and must match that engine's own deployed identity, preventing an engine from claiming to be a different engine. Cross-engine protection comes from A2A bearer-token auth at the transport layer.
- **Quarantine → escalation** — 5/5 concurrent cloud end-to-end runs had the verifier agent itself call `open_escalation`.

---

## Boundaries (what CaseRelay does not do)

- No placement, custody, safety-risk, clinical, or eligibility decisions
- No real child data and no claim of CASA endorsement
- No replacement for existing case-management systems (Optima, Casebook, state systems)
- No unrestricted cross-agency child profile
- No autonomous emergency response

Persona switching in the portal (advocate vs. platform view) is UI-only and carries no
authorization implications — role-switching changes the view, not the data access. The portal
login gate is a single shared credential for judges and testing contacts, not per-user auth.

---

## Documentation

| Document | What it is for |
|---|---|
| [docs/deploy.md](docs/deploy.md) | Running it locally, the full cloud deploy sequence, and what is not reproducible from outside |
| [examples/](examples/) | Runnable invocations and a one-page guide to the nine scenarios |
| [docs/architecture.md](docs/architecture.md) | Component wiring, technology stack, GEAP capability detail, engineering decisions |
| [docs/scenario-showcase.md](docs/scenario-showcase.md) | The non-Maya scenarios with captured cloud evidence — and the ones that do not hold up |
| [docs/caserelay-walkthrough.md](docs/caserelay-walkthrough.md) | Per-phase detail, expected outputs, the control-plane API surface |
| [docs/hackathon-blog.md](docs/hackathon-blog.md) | The contest write-up |
| [docs/submission-checklist.md](docs/submission-checklist.md) | What the Devpost submission still needs |
| [contracts/openapi.json](contracts/openapi.json) | The control-plane OpenAPI contract |

---

## License

Apache 2.0 — see [LICENSE](LICENSE).
