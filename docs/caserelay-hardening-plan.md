# CaseRelay — Hardening Plan

**Written:** 2026-08-24 · **Submission deadline:** 2026-08-31 17:00 PDT
**Goal of this plan:** every GEAP capability backed by the real Google product, every claim in
the repo true, the mesh exposing a stable API the portal can be built against, and no scripted
outcomes anywhere in the demo path.

This is an ordered execution list, not a calendar. **It is sequenced around one milestone: the
handover point at Stage 3, where the API contract freezes and portal work can start in parallel.**
Everything before it either changes the shape of the API or the truth of the data behind it.
Everything after it is depth the portal never sees. Each step states what changes, which files, and
the check that proves it landed.

---

## Part 1 — Analysis

### 1.1 What is genuinely real

Verified against the live `caserelay` project and by executing the code, not by reading docs.

| Claim | Evidence |
|---|---|
| 8 ADK agents on `gemini-3.5-flash` | `backend/agents/*/agent.py`. The model resolves on the `global` Vertex endpoint (confirmed by direct `generateContent` call); it does **not** exist in `us-central1`, and `GOOGLE_CLOUD_LOCATION=global` is set correctly everywhere. The Stage One model gate is satisfied. |
| 8 endpoints live on Vertex AI Agent Runtime | 8 `reasoningEngines` in `us-central1`, all `agentFramework: google-adk`. |
| 8 distinct IAM service accounts, one per agent | Live `spec.serviceAccount`, bound by `infra/deploy_fleet.sh:58`. |
| 8 real Agent Registry entries with A2A cards | Live `agentregistry.googleapis.com` returns 8 × `A2A_AGENT_CARD`. |
| Authenticated A2A over the `/api` passthrough | `backend/runtime/a2a_auth.py:14-32` mints real ADC bearer tokens. |
| Deterministic field projection with per-access audit | `backend/policy/projection.py`, `backend/gateway/gateway.py:36-61`. Education sees 3 of 14 fields, family services sees 1 of 14. |
| One-image / one-identity serving | `app/agent_server.py:45-88`. Genuinely clever and worth showing. |
| The documented local journey runs | `run_maya()` completes in ~190s against real Vertex, outcome-stable across runs. |

This is a real Fortified Enterprise Fleet spine. The problem is everything layered on top.

### 1.2 Custom code standing in for a real Google product

| Capability | What exists | Why it fails a Google judge |
|---|---|---|
| **Model Armor** | `backend/gateway/armor.py` — 15 lines, one regex | The pattern is tuned to the exact strings in `fixtures/cr-1042/poisoned_school_payload.json`. The attack and the catch are both predetermined. `modelarmor.googleapis.com` is already enabled on the project and never called. |
| **Agent Observability** | `TRACE_ID = "trace-7821"`, a string literal in three files | Every audit event in every case carries the same fake trace id. ADK's real Cloud Trace export exists at `app/agent_server.py:102` gated on `CASERELAY_TRACE_TO_CLOUD`, which `deploy_fleet.sh` never sets — all eight agents run with telemetry off. |
| **Memory Bank** | `backend/memory/bank.py` — denylist-filtered dict on a Firestore field | The engines have `contextSpec.memoryBankConfig` provisioned and `VertexAiMemoryBankService` is installed. Neither is used. |
| **Agent Identity** | `dict.get()` on `education-agent@caserelay.iam` | Not a valid service-account format. Worse, `gateway.py:12` derives identity from the *purpose string argument* — any caller naming a purpose receives that agent's fields. `assert_scope()`, the only function reading `denied_data_scopes`, is never called. |
| **Agent Gateway** | In-process function imported by the agents it governs | No network boundary, no caller authentication, no registry routing. |
| **Sessions** | `InMemorySessionService` (`backend/runtime/invoke.py:17`) | Context dies with the process. On `max-instances 2`, "weeks of context" survives until the first scale event. |
| **Agent Registry** | Roster loaded from `fixtures/cr-1042/agent_cards.json` | The real registry has the correct data. The orchestrator resolves specialists from `CASERELAY_URL_*` env vars instead. |

### 1.3 Scripted outcomes in the demo path

- **The day-17 wake is a prompt.** `backend/runtime/fleet.py:47-50` contains the literal string
  telling the orchestrator that day 17 arrived. Checked against the live project: the
  `caserelay-wakes` Cloud Tasks queue is RUNNING and has **never held a task**; `caserelay-events`
  and `caserelay-dead-letter` exist with **zero subscriptions**, so every message the one publish
  at `durable.py:26-39` ever sent went nowhere — and that publish is wrapped in a bare
  `except: return` besides. The **Cloud Scheduler API is not enabled** on the project. There are
  **zero Cloud Run services**, so there is no HTTP endpoint a scheduler or a push subscription
  could target even if they existed. Nothing about the timed event has ever run. This is the
  headline Innovation beat.
- **Delegation is scripted.** `PHASES` is a hardcoded 10-step list naming exactly one specialist
  per turn. The honest comment at `fleet.py:31-32` explains why — asked for all five, the model
  drops some. The mitigation is a Python `for` loop, not orchestration.
- **The harness picks the happy ending.** Phase 8 instructs the education agent to call
  `query_school` with `variant='enroll'`, so the agent is told which reply to receive.

### 1.4 Dead code that implements claims the docs make

All confirmed unreferenced. Four of these are the *good* implementation of something the README
asserts, which makes wiring them up the cheapest defensibility gain available.

| Module | Claim it would make true |
|---|---|
| `backend/audit/writer.py` | Append-only audit. The live path is `store.append_row` → `.set()`, which silently overwrites. |
| `backend/infra/idempotency.py` | Exactly-once partner callbacks. |
| `backend/identity/registry.py::assert_scope` | Cross-scope denial. |
| `contracts/envelope.py` | Typed inter-agent contracts. Specialists take `status: str` free-form from the LLM. |
| `backend/state/seed.py`, `workspace.claim_update`, `memory.bank.read` | — |

### 1.5 Correctness bugs a reviewer will find

1. **The supervisor gate does not gate.** `workspace.py:141` accepts
   `grant.get("status") in {"granted", "proposed", None}`. Intake writes grants as `"proposed"`,
   so specialists can read the child's name and DOB **before any supervisor approves**. Case
   status is never checked either, so a `draft` case discloses data.
2. **Hallucinated commitment IDs are a silent success.** `workspace.set_commitment:154-163` loops
   and returns implicitly on no match. The tool reports success; the status stays stale.
3. **Two of five API routes 500 on a fresh process.** `GET /demo/maya/{case_id}` and `POST /wake`
   raise unhandled `CaseNotFound` instead of returning 404.
4. **`POST /wake` regresses state** — it moves `education` from `completed` back to `unresolved`.
5. **Deployed specialists leak raw Firestore 400s** to the caller when a case id is empty.
6. **`agent_server.py` stalls ~60s at boot** printing an 80-line `RetryError` traceback before
   reporting healthy. Cloud Run startup-probe risk.
7. **`infra/cloud_e2e.py` fails on its own default invocation.** With no arguments it builds a
   synthetic case, and `backend/state/synthetic.py:104-113` never sets `inject_callback` — only
   `fixtures/cr-1042/referral_packet.json:25` has it. So the verifier screens a clean payload, no
   quarantine fires, no approval is opened, `decide_approval` returns `{"decision": "none"}`, and
   the assertion at `cloud_e2e.py:76` **fails**. The green-light script goes red for anyone who
   runs it as documented. Its other assertion (`:74`) is also too weak to be useful — it only
   fails if *every* commitment is still pending, so a run where four of five specialists silently
   died still prints `CLOUD-E2E-OK`.
8. **The documented spin-up 403s for anyone but the author.** `fleet.py:3` and `.env.example:1`
   pin `GOOGLE_CLOUD_PROJECT=caserelay`, so a judge's `run_maya()` calls Vertex in a project they
   have no IAM on. `infra/fleet_endpoints.env` is likewise author-only.
9. **`.env.example:10-11` documents `CASERELAY_PERSIST`, which no code reads** — the real variable
   is `CASERELAY_STATE` (`store.py:16`).
10. **Every case shares one checkpoint document.** `durable.write_checkpoint` defaults
    `workflow_id` to the literal `"wf-school-enrollment"`, and `workspace.put_checkpoint:190-192`
    keys the Firestore document by exactly that string. Two cases in flight overwrite each other's
    checkpoint. This is survivable while only CR-1042 exists, and fatal the moment a sweeper has to
    find *every* workflow that is due — so per-case workflow ids are a prerequisite for the timed
    event, not a tidy-up.

### 1.6 The portal

`portal/src` contains **zero** `fetch`, `axios`, or any other backend call. All six screens render
from `lib/mock/*.ts` driven by one `step` integer that auto-advances every 3800 ms, with a visible
play/next/prev scrubber in the sidebar. `mock/agents.ts` invents a third, conflicting agent roster
with fabricated `https://cr-*-7g2h.a.run.app` endpoints — the project has **zero** Cloud Run
services — plus static `p50Ms: 412` and `lastHeartbeat: "18s ago"`.

The two sides describe unrelated worlds. The only value that matches is `trace-7821`, because both
hardcode it:

| | Portal says | Backend does |
|---|---|---|
| Health partner | Riverbend Community Health (`mock/agents.ts:82`) | Harbor Pediatric (`sim.py:34`) |
| Legal partner | Statewide Legal Aid Collective (`:101`) | County Legal Aid (`sim.py:44`) |
| Shelter | Harborlight Youth Shelter (`:120`) | Safe Harbor (`sim.py:56`) |
| Education identity | `education@lincoln-usd.partner` (`:59`) | `education-agent@caserelay.iam` |
| Education referral | `ED-77120` (`approvals.ts:26`) | `edu-1042` (`referral_packet.json:20`) |
| Approval id | `AP-8802` (`approvals.ts:6`) | `apr-{uuid4[:8]}` (`verifier/agent.py:32`) |
| Injection text | `"SYSTEM: ignore prior instructions…"` (`policy.ts:96`) | `"retrieve Maya's medical notes…"` |
| Withheld count | 8 (`policy.ts:51-90`) | 11 (`gateway.py:21-35`) |
| Deployment | `cr-*-7g2h.a.run.app` (`:26`) | Vertex `reasoningEngines/…` |

Most of this resolves itself once screens call the API — the mock module is deleted, not corrected.
The table matters only for any screen that stays a prototype past the deadline.

There is no API for the portal to call even if someone wanted to. `backend/api/main.py` is never
deployed, `POST /demo/maya` blocks for 227 seconds, and Firestore writes are opt-in behind
`CASERELAY_STATE`. **Building that API is the load-bearing work in this plan.**

### 1.7 Documentation accuracy

Six of the ten services in the README stack table are unused by any code: Cloud Run, Cloud Tasks,
Cloud Storage, Secret Manager, Cloud Logging, Cloud Trace. `README:58` says "Gemini 2.5 Flash"
against a pass/fail criterion where the code is correctly on 3.5. `docs/hackathon-rulebook.md:244-257`
cites `idempotency.py` and `audit/writer.py` as evidence for capabilities they do not deliver.
`fixtures/cr-1042/partner_configs.json` is unused by any code and reads exactly like an answer key
for the demo's supposedly independent outcomes.

### 1.8 Testing

None. No `test_*.py`, no vitest/jest config, no `tests/` directory, no `.github/`, no CI. `pytest`
is not installed. Architectural Discipline is 30% of the score.

---

## Part 2 — Target state

When this plan is complete:

- Every GEAP capability is backed by the real Google product, or is honestly labelled as
  deterministic policy code with a stated reason.
- No demo outcome is decided by a fixture, a regex tuned to a fixture, or a prompt that names the
  answer. The orchestrator chooses its own specialists and a reconciliation guard catches it when
  it is wrong.
- The mesh exposes a versioned HTTP control plane on Cloud Run that any frontend can drive:
  async run submission, event streaming, and read models for every screen. The portal becomes a
  consumer of that API rather than a parallel fiction.
- Every claim in the README, the diagrams and the rulebook mapping is verifiable from the repo or
  the Cloud Console.

### GEAP coverage, before and after

| Capability | Now | After |
|---|---|---|
| Agent Registry | JSON fixture | Live registry resolution at orchestrator startup (Step 20) |
| Agent Runtime | Real deploy, fake durability | Real deploy + Vertex Sessions + Cloud Scheduler wake (Steps 11, 18) |
| Memory Bank | Firestore dict | `VertexAiMemoryBankService` + `PreloadMemoryTool` (Step 17) |
| Agent Identity | ~~String compare on fake emails~~ | **Done.** `--agent-identity` on all eight engines; `google.oauth2.id_token` verification in deployed mode. |
| Agent Gateway | ~~In-process function~~ | **Done.** Caller-authenticated and deny-by-default; `PURPOSE_TO_IDENTITY` deleted. |
| Model Armor | 15-line regex | `google-cloud-modelarmor` as an ADK plugin (Step 16) |
| Agent Observability | Hardcoded `trace-7821` | Real OTel context exported to Cloud Trace (Steps 4, 19) |

---

## Part 3 — Execution plan

> Two notes before starting. First, these products have changed names and surfaces repeatedly —
> confirm each SDK signature against current docs before writing against it rather than trusting
> the snippets below. Second, resist the urge to start with the interesting GEAP work in Stage 4.
> It is the most enjoyable part of this plan and the least urgent: none of it changes the API, so
> all of it can happen while your teammate builds against a frozen contract. Getting to Stage 3
> quickly is worth more than any single capability behind it.

### Why this order

| Stage | Question it answers | Blocks the portal? |
|---|---|---|
| **0 · Unblock** | Can a judge see the repo at all? | No — but it is pass/fail |
| **1 · Real data** | Is what the API would serve actually true? | Yes |
| **2 · Control plane** | Is there an API, deployed, that drives live agents? | Yes |
| **3 · Handover** | Is the contract frozen and published? | **This is the milestone** |
| **4 · Depth** | Are the GEAP capabilities real rather than simulated? | No — runs in parallel |
| **5 · Prove it** | Can a stranger verify all of it? | No |

The dividing line is simple: a step belongs before Stage 3 if it changes the **shape of the API**
or the **truth of the data behind it**. Swapping a regex for Model Armor changes neither — the
quarantine event has the same shape either way — so it waits.

---

### Stage 0 — Unblock (do these first; under an hour, all of it)

**Step 1 · Make the submission viewable.** *(pass/fail, not scoring)*
`github.com/akhil-bot/CaseRelay` returns **HTTP 404 unauthenticated**: it is private and not
shared, so there is currently no repository for a judge to open. Make it public, or share it with
`testing@devpost.com` **and** `cloudhackathons@google.com`. Post the social update with
`#AllThingsAgenticHackathon` while you are here — that is 0.2 bonus for twenty minutes.

**Step 2 · Fix the two pass/fail claims and delete the answer key.**
`README:58` says "Gemini 2.5 Flash" against a criterion where the code is correctly on 3.5 — fix it
to `Gemini 3.5 Flash (gemini-3.5-flash)`. Delete `fixtures/cr-1042/partner_configs.json`, which no
code reads and which looks exactly like a script for outcomes the demo presents as independent,
along with the empty `frontend/` directory. Delete the fabricated evidence in the portal now rather
than later — `p50Ms: 412`, `lastHeartbeat: "18s ago"`, `health: "degraded"`
(`mock/agents.ts:28-29, 50-51, 73-75`) and the `CAPABILITY_PROOFS` strings at
`mock/policy.ts:189-246` (`"Quarantine event evt-2051"`, `"26 correlated spans"`), which are
invented evidence on the one screen whose entire job is evidence.

The rest of the documentation truth pass is Step 29; it is deferred because most of those claims
become true as the plan lands, and correcting them twice is wasted work. These three are different:
they are wrong in a way that no later step fixes.

---

### Stage 1 — Make the data real

Nothing can be served over an API until the data behind it is true. Every step here is a
prerequisite for Stage 2 rather than an improvement to it.

**Step 3 · Make Firestore unconditional.**
`backend/state/store.py:15-16` currently no-ops every write unless `CASERELAY_STATE=firestore`.
Invert it: Firestore is the default, and an explicit `CASERELAY_STATE=memory` opts out for offline
development. A silent no-op that makes the demo appear to work while persisting nothing is the most
dangerous failure mode in the repo, and an API reading from an empty database is the second.
*Check:* a fresh `run_maya()` with no env set leaves a populated case document in Firestore.

**Step 4 · Give every run a real identity and a real trace id.**
Introduce `RunContext` (`backend/runtime/context.py`) carrying `run_id`, `case_id`, `workflow_id`
and `trace_id`, held in a `contextvars.ContextVar` so it propagates through async tool calls without
threading a parameter through every signature. Delete the `TRACE_ID = "trace-7821"` literal from
`backend/runtime/trace.py:5`, `backend/runtime/workspace.py:8` and `backend/api/main.py:32`. Every
audit event, memory write and checkpoint reads its ids from the context.

Derive `trace_id` from the **active OTel span context** rather than generating a UUID, so the id
stored in Firestore is the same id Cloud Trace indexes — otherwise `GET /v1/traces/{trace_id}`
returns a deep link to nothing. Wrap each phase and each Gateway disclosure in
`tracer.start_as_current_span()` with `caserelay.case_id`, `caserelay.commitment_type` and
`caserelay.workflow_id` attributes. Keep the in-process `TraceLog` — it is what makes the terminal
output legible on camera — but have it read the real ids.

This is in Stage 1 rather than with the observability work because `trace_id` is a **field in the
API response**. Shipping a contract whose trace ids are all the same literal string means changing
the portal's behaviour later.
*Check:* two concurrent runs on different cases produce disjoint `trace_id` values in Firestore, and
one pasted into Cloud Trace opens the matching span tree.

**Step 5 · Per-case workflows and checkpoints.**
Per §1.5 item 10, every case currently writes to the same checkpoint document. Key checkpoints by a
per-case `workflow_id` (`wf-{case_id}-{kind}`), and give the checkpoint the two fields a sweeper
needs: `due_at` as a real timestamp rather than the current unread `next_wake` string, and a `state`
of `waiting | running | done`. Add the composite Firestore index for
`state == 'waiting' AND due_at <= now` to `infra/firestore.indexes.json` — which, while you are in
there, currently declares an index on a `partner_updates` collection nothing writes.

Concurrent cases are the premise of both the admin page and the sweeper, so this cannot wait.
*Check:* two cases created back to back have distinct checkpoint documents and neither clobbers the
other.

**Step 6 · Route audit writes through the immutable writer.**
`backend/audit/writer.py` already rejects mutation via `ref.create()` and catches `AlreadyExists`.
Point `workspace.append_audit` at it instead of `store.append_row`, which `.set()`s and silently
overwrites. This deletes dead code and makes an existing README claim true in about ten minutes —
and the audit trail is the single most-read read model in the API, so it should be trustworthy
before anything renders it.
*Check:* writing the same `event_id` twice raises `AuditMutationRejected`.

**Step 7 · Scenario factory.**
`backend/state/synthetic.py` and `backend/state/dataset.py` are already the right shape —
deterministic packets derived from a case id, a `test_case: True` flag that `purge` keys off, and a
`temporary_case` context manager. What is missing is **variation**: every synthetic case is
identical (education always 17 days stale, same due offsets, and critically `inject_callback` never
set, which is why `cloud_e2e.py` fails by default per §1.5).

Add `backend/state/scenarios.py` holding named, declarative scenario specs, and give
`synthetic.build_packet(case_id, scenario=...)` a scenario parameter that varies which service goes
stale and by how long, the deadlines, and **the partner behaviour per referral**. Behaviour belongs
on the referral row — exactly how `inject_callback` already works — so `backend/partners/sim.py`
reads it off case state. That is the same mechanism Step 23 needs when it drops `variant` from the
education agent's tool surface, so build it once and use it for both.

**Name scenarios after the child, and group them by complexity.** A case is a child, so `noah` reads
better than `partner_timeout_v2` and is far easier to talk about in a demo or a standup. Names come
from the existing `synthetic.NAMES` list. `GET /v1/scenarios` returns them grouped, and the admin
page renders the two groups separately.

**Simple — one condition each.** These are the CI suite: fast, deterministic, each one proving
exactly one mechanism.

| Scenario | Child | What it exercises |
|---|---|---|
| `noah` | Noah | Clean path. Every partner responds, all five commitments close. The baseline. |
| `priya` | Priya | Partner timeout. Health never answers — Step 21's degrade-and-continue. |
| `diego` | Diego | Hallucinated status. Education claims `completed`; the SIS reply says otherwise — Step 22's reconcile. |
| `rosa` | Rosa | Cross-scope request. A specialist reaches outside its grant — Step 15's audited denial. |
| `ellis` | Ellis | Duplicate callback. The same partner update arrives twice — idempotency. |
| `theo` | Theo | Malformed reply. A partner returns garbage that fails the response schema. |

**Complex — composites, and what the demos are shot against.** Each combines several conditions so
the fleet has to make real decisions rather than walk one branch.

| Scenario | Child | What it exercises |
|---|---|---|
| `maya` | Maya | **The flagship.** Stalled enrollment at day 17, prompt injection on the school callback, quarantine, supervisor approval, then a clean re-callback that closes the commitment. The current CR-1042 story, generated rather than fixtured. |
| `kai` | Kai | **Cascade.** Two partners fail at once — one times out, one lies. Reconciliation catches both, one escalates to a human, and the other three commitments still close. Failure tolerance under load. |
| `amara` | Amara | **Long horizon.** Three staggered deadlines, several wakes over weeks, memory recalled across sessions with no user present. This is the scenario that substantiates "safely hold context across weeks of asynchronous operation". |

A scenario spec is therefore a list of per-referral conditions plus a deadline schedule, not a
single enum — which is what makes composites possible without new code per demo.

Keep the generator the single place that manufactures case data. Agents must stay unable to tell a
scenario case from a real one; the moment a scenario name reaches a prompt, the outcome stops being
the agent's.
*Check:* each scenario creates a case, runs to a distinct and correct terminal state, and
`dataset.delete_case` removes it cleanly.

**Step 8 · Fix the verification harness before relying on it.**
`infra/cloud_e2e.py` currently fails on its default invocation (§1.5 item 7) — the one script that
is supposed to prove the system works goes red for anyone who runs it as documented. Step 7 fixes
the root cause by letting synthetic cases carry `inject_callback`; point the harness at the `maya`
scenario so it exercises the quarantine path. Then tighten `cloud_e2e.py:74`: assert each specific
commitment reached its expected terminal state rather than "not all pending". Everything downstream
of this plan is verified by this script, so it has to be trustworthy first.
*Check:* `python infra/cloud_e2e.py` with no arguments prints `CLOUD-E2E-OK`, and deliberately
breaking one specialist makes it print `CLOUD-E2E-FAILED`.

---

### Stage 2 — The control plane the portal consumes

This is the load-bearing work. Design it so the portal is one client among several — the CLI and
the e2e harness should use the same API.

**Deploy a skeleton on the first day of this stage.** A `.run.app` URL serving `/health` and one
read model is worth more to a teammate than a complete API that exists only on your laptop. Then
fill it in.

**Step 9 · Versioned read/write API.**
Rewrite `backend/api/main.py` as a `/v1` control plane. **Delete the `/demo/*` routes outright** —
`/demo/maya`, `/demo/trace` and `/demo/maya/{case_id}` — rather than keeping them alongside `/v1`.
They encode the scripted journey as an API surface, they are the routes that 500 on a fresh
process, and leaving a "demo" endpoint in a submission invites exactly the question you do not want
asked. Everything they did is covered by `POST /v1/cases` with a scenario plus
`POST /v1/cases/{id}/runs`. Also fold the bare `POST /wake` into
`POST /v1/workflows/{workflow_id}/wake` — today it silently regresses `education` from `completed`
back to `unresolved`.

**Purge them from the documentation in the same commit**, not in the Step 29 sweep.
`docs/caserelay-walkthrough.md:466` presents `POST /demo/maya`, `GET /demo/trace`,
`GET /demo/maya/{case_id}`, `POST /wake` and `GET /health` as *the* API surface, so deleting the
routes and leaving that paragraph standing just moves the credibility problem from the code to the
document a judge is more likely to read. Replace it with the `/v1` surface below. From this step
onward nothing in the repo — code, docs, diagrams, CLI, harness or portal — may reference a `/demo`
path, and the only permitted exception is this plan's own analysis sections, which quote the old
routes in order to justify removing them.

Read models, one per portal screen, served from Firestore:

```
GET  /v1/cases                          → inbox rows: status, child, overdue, blocked, needs-approval
GET  /v1/cases/{case_id}                → case, commitments, grants, timeline
GET  /v1/cases/{case_id}/audit          → audit events, filterable by trace_id and event_type
GET  /v1/cases/{case_id}/memory         → memory scopes by purpose
GET  /v1/approvals                      → pending approvals across cases
GET  /v1/registry                       → agent roster (live registry once Step 20 lands)
GET  /v1/traces/{trace_id}              → correlated hops + the Cloud Trace deep link
```

Writes:

```
POST   /v1/cases                          → ingest a referral packet
POST   /v1/cases/{case_id}/activate       → supervisor gate
POST   /v1/approvals/{id}/decide          → {approve|reject, decided_by, note}
POST   /v1/workflows/sweep                → scheduler target (Step 11), OIDC-authenticated;
                                            resolves due checkpoints, returns how many fired
POST   /v1/workflows/{workflow_id}/wake   → Pub/Sub push target, OIDC-authenticated
```

Test-data routes, backed by the Step 7 factory. These are what let anyone spin up a case and drive
the real fleet against it without a fixture:

```
GET    /v1/scenarios                      → [{id, child_name, complexity, title, description,
                                              expected_outcome, deadlines}]
POST   /v1/cases  {scenario, case_id?,    → generates the packet, writes it to Firestore,
                   due_in?}                  returns {case_id, scenario, summary, due_at}
DELETE /v1/cases/{case_id}                → refuses unless the case carries test_case: true
```

`POST /v1/cases` is deliberately one route with two modes — a caller either supplies a referral
packet or names a scenario. The agents cannot tell the difference downstream, which is the whole
point of `dataset.py`. Guard the delete on `test_case` so nothing that arrived through a real intake
path can be swept away, and fix `case_cli.py purge` the same way — it currently keys off `_is_test`,
which `dataset.create_case:42` also sets on fixture cases, so it will happily delete CR-1042
mid-demo.

The optional `due_in` on the create call is what makes Step 11 demonstrable: it overrides the
scenario's deadline schedule, so `{"scenario": "maya", "due_in": "45s"}` produces a case that is
genuinely due in 45 seconds and rides the same sweeper as one due in 17 days. Accept it as a
duration string, echo the resolved `due_at` back, and show that timestamp in the admin UI so nobody
has to take the wake on faith.

Add an exception handler mapping `CaseNotFound` to 404 and `IdentityDenied` to 403, fixing the two
routes that currently 500. **Specify 403 in the contract now even though Step 15 is what starts
returning it** — a client that learns about a new status code after the fact is a client that gets
rewritten. Never let a raw Firestore error reach a caller; the deployed specialists currently return
`400 Document name ... has invalid tr...` as agent replies.

**Step 10 · Asynchronous runs.**
`POST /demo/maya` blocks for 227 seconds and returns 79KB against a 300-second Cloud Run ceiling.
No browser can drive that. Replace it:

```
POST /v1/cases/{case_id}/runs           → 202 {run_id}, work continues in the background
GET  /v1/runs/{run_id}                  → {state, current_phase, commitment_states, trace_id}
GET  /v1/runs/{run_id}/events           → SSE stream of trace hops as they happen
```

Persist run state to Firestore under `runs/{run_id}` so progress survives an instance swap and any
client can attach late. The SSE stream is what lets the portal show the fleet working live — and it
is the honest version of the animation `demo-store.tsx` currently fakes.

**The run must drive the deployed fleet, not an in-process copy.** `orchestrator/agent.py:96-109`
falls back to local `sub_agents` whenever `CASERELAY_URL_*` is unset, which is right for offline
development and wrong for the control plane — a portal click that silently runs eight agents inside
one Cloud Run container is not the multi-agent system being claimed. Fail loudly rather than falling
back. (Resolving those endpoints from the registry instead of env vars is Step 20; it is a swap
behind this boundary, not a change to it, which is why it can wait.) Then every action in the portal
is a real A2A call to a real reasoning engine under its own service account, and the audit trail the
UI renders was written by the agents that did the work.

**Step 11 · A wake that actually fires.**

*Where we are.* Nothing publishes timed events and nothing has ever tested one. `write_checkpoint`
computes `next_wake = now + 17 days`, writes it to Firestore, publishes a single Pub/Sub message
**immediately** — inside a bare `except Exception: return`, so a failed publish is invisible — and
nothing subscribes. The reason the wake appears to work in a demo is that `fleet.PHASES` prompts the
orchestrator to call `wake_workflow` as its next scripted turn. The 17 days are a string in a
document. This is the single largest gap between what the README claims and what runs.

*The design: separate "when it is due" from "when we look."* Do **not** schedule a task 17 days out.
The workflow writes an honest `due_at` (Step 5), and a **sweeper** runs on a fixed cadence asking one
question — `where state == 'waiting' and due_at <= now`. Everything due gets woken. This beats a
long-ETA Cloud Task on every axis that matters here: it survives redeploys, it backfills
automatically if the service was down, it is queryable so the portal can show *"next wake in 6 days,
2 workflows due"*, and — the point for us — **it is testable in seconds without touching the
scheduler**, because the trigger condition lives in data we control.

The chain, end to end:

```
Cloud Scheduler (every 1 min, OIDC)
  └─> POST /v1/workflows/sweep         # queries due checkpoints
        └─> publish to caserelay-events # one message per due workflow
              └─> push subscription (OIDC)
                    └─> POST /v1/workflows/{id}/wake
                          └─> resume_wake -> orchestrator -> A2A
```

None of this infrastructure exists yet: the Scheduler API is disabled, both topics have zero
subscriptions, and the `caserelay-wakes` queue has never held a task. Enable the API, create the job
and the push subscription with a dead-letter policy onto the existing `caserelay-dead-letter` topic,
and put all of it in `infra/bootstrap.sh` (Step 25) so it is reproducible rather than clicked. Either
use the Cloud Tasks queue or delete it — an empty queue in the console is worse than no queue.

Routing the wake through Pub/Sub rather than calling the endpoint directly buys retry with backoff
and dead-lettering, and makes the event backbone in the README true. Delete the bare `except` at
`durable.py:38`; a publish that fails must surface.

*Testing it — three layers, one code path.*

1. **Deterministic, no cloud.** Write a checkpoint with `due_at` in the past, call the sweeper's
   query directly, assert the workflow resumes. Sub-second, no LLM, runs in CI on every push. This
   is the test that stops the wake silently rotting.
2. **Live short horizon — the demo.** The deadline offset is a *property of the scenario*, not a
   constant in the code: `maya` carries `due_in: 17d` for a real case, and the demo variant carries
   `due_in: 45s`. Real Cloud Scheduler, real sweeper, real Pub/Sub, real resume — nothing is faked
   or shortened in the code path, the case genuinely falls due 45 seconds after creation. Close the
   laptop, come back, it happened. Note what this is *not*: no test-only endpoint rewrites a
   deadline, and no clock is stubbed. The only difference between the demo and a real case is a
   number in the create request.
3. **Real horizon, as proof.** Create a case with the true 17-day offset alongside the 45-second one
   and show the sweeper firing the second while leaving the first alone. Demonstrating the system
   *not* firing is what proves the firing is real and not special-cased — worth 15 seconds of video.

*Make the autonomy visible.* A wake has no human behind it, so it must not look like one.
`invoke.py:19` currently hardcodes `user_id="elena-volunteer-001"` on every run, which would stamp an
unattended resume with a volunteer's name. Scheduler-driven runs get a service principal, and the
audit event records `triggered_by: scheduler` with the `due_at` it fired against. The trace then
shows a full A2A fan-out with no session and no user — that is the evidence for asynchronous
operation, and it is the single most valuable half-minute of the demo.

*Check:* CI proves the resume with a past-dated checkpoint; on the deployed fleet, a case created
with a 45-second deadline resumes with nobody watching, and its audit trail names the scheduler.

**Step 12 · Deploy the control plane to Cloud Run.**
Rewrite `backend/Dockerfile` first — **it cannot start in its current form.** Line 12 copies only
`api/`, line 15 runs `uvicorn api.main:app`, and `backend/api/main.py:3-5` imports
`backend.memory.bank`, `backend.runtime.fleet` and `backend.runtime.workspace`, none of which are in
the image. It also pins `google-adk>=1.0.0` inline against the 2.7.1 in the venv, so the image can
drift from what you tested. Install from `pyproject.toml` and `uv.lock` instead of a duplicated
inline list.

The agents stay on Agent Runtime; the control plane is a separate Cloud Run service with its own
service account, holding **read-only** Firestore access plus permission to invoke the orchestrator.
This makes the README's Cloud Run claim true, gives a `.run.app` URL for the submission's hosted-URL
field, and gives the portal one origin to call. Add CORS for the portal origin, and note the
300-second request ceiling is why Step 10 exists.
*Check:* `GET /v1/cases` returns real Firestore data over HTTPS from a `.run.app` URL.

---

### Stage 3 — Handover

**Step 13 · Freeze and publish the contract.**
Check the OpenAPI schema FastAPI already generates into the repo at `contracts/openapi.json`, so
portal work proceeds against a fixed artifact rather than a running server that changes under it.
Include the 403 and 404 shapes, the SSE event types, and the `/v1/scenarios` response — the three
things a client cannot infer.

**This is the milestone.** From here the portal can be built in parallel: everything in Stage 4 sits
behind this boundary and changes no response shape.

Hand over three things: the `.run.app` base URL, `contracts/openapi.json`, and the admin-page spec
below.

**Step 14 · Admin page spec: create a case, run it, watch it.**
The loop a teammate and a judge both need, on one screen at `/admin`:

1. Pick a scenario from `GET /v1/scenarios`, rendered in two columns — **Simple** and **Complex** —
   each card showing the child's name, what it exercises and the expected outcome.
2. `POST /v1/cases {scenario, due_in?}` writes a fresh case to Firestore and returns its id. A
   deadline control offers the scenario's real horizon or a compressed one for demos, and the
   response's `due_at` is displayed next to the case so the pending wake is visible before it fires.
3. Jump straight to `/cases/{case_id}`, hit **Run**, and follow the SSE stream from
   `GET /v1/runs/{run_id}/events` as the live fleet works — commitments flipping, gateway
   disclosures with their withheld-field lists, the quarantine, the approval landing in the queue.
4. Approve or reject from the Approval Center; the decision goes back through
   `POST /v1/approvals/{id}/decide`.
5. Delete the case when finished.

Note what this replaces. `ScenarioControl.tsx:74-95` is today a play/next/prev scrubber over a canned
`step` integer — a slideshow control. The same component position now holds a real scenario picker
driving real agents. That is a straight swap of the repo's most damaging artifact for one of its most
convincing, and it gives the demo video a single unbroken take: pick a scenario, watch eight cloud
agents resolve it, open the audit trail.

Keep `/admin` clearly marked as an operator surface for synthetic cases only, and have it refuse to
show any case without `test_case: true`.

Portal-side sequencing, if time runs short: wire `/admin`, `/cases/[caseId]` and `/audit` first,
delete `portal/src/lib/mock/*` as each screen lands, and label whatever remains "design prototype"
in the UI. The API must be complete and deployed regardless — that is what "the agent works
irrespective of the portal" means.

---

### Stage 4 — Depth behind a frozen contract

Everything here improves how a capability is *implemented* without changing what the API returns, so
it runs concurrently with portal work. Ordered by score-per-hour.

**Step 15 · Make identity real and enforced.** *(highest architectural value in the plan)*
Three changes, in order:
1. Fix the identities. `education-agent@caserelay.iam` is not a service account. Change
   `fixtures/cr-1042/agent_cards.json` and `CANONICAL_GRANTS` in
   `backend/state/intake_service.py:123-154` to the real
   `*-agent@caserelay.iam.gserviceaccount.com` values.
2. Stop deriving identity from the purpose. `gateway.py:12` does
   `target = PURPOSE_TO_IDENTITY[purpose]`, so the answer to "which agent am I" is "whichever Python
   function got called". Replace it: verify the incoming ID token with
   `google.oauth2.id_token.verify_oauth2_token`, take the `email` claim as the caller principal, and
   require it to equal `grant["granted_to"]`. Deny and audit when they disagree.
3. Call `assert_scope`. It is the only code that reads `denied_data_scopes`, and it is dead. Invoke
   it inside `authorized_context` so a cross-scope request produces an audited denial rather than a
   structurally-absent field.

*Check:* a request presenting the health agent's token for `verify_school_enrollment` is denied and
produces a `denial` audit event — the `rosa` scenario. This is also a demo beat: a real, visible
zero-trust refusal.

**Step 16 · Replace `armor.py` with the Model Armor API.**
Create a template with prompt-injection/jailbreak detection, Sensitive Data Protection, and
malicious-URI filters. Add `google-cloud-modelarmor` to `pyproject.toml` and call
`ModelArmorClient.sanitize_model_response` on every partner payload before an agent reasons over it,
and `sanitize_user_prompt` on inbound requests. The regional endpoint is
`modelarmor.{location}.rep.googleapis.com`. Implement it as an **ADK plugin** rather than an inline
call so the guardrail applies to every agent uniformly and cannot be bypassed by a tool that forgets
to call it — see the `safety-plugins` pattern in adk-samples.

Keep the deterministic screen as a documented second layer, clearly labelled as defence in depth
rather than as Model Armor. Delete the fixture-tuned regex in `armor.py:5-8` outright; a pattern
matching `medical notes` when the fixture says `medical notes` is the fastest tell in the repo.
*Check:* the poisoned payload returns a real `MATCH_FOUND` from the API, and a **newly written**
injection string the code has never seen is also caught.

**Step 17 · Real Memory Bank.**
Swap `backend/memory/bank.py` onto `VertexAiMemoryBankService` (already installed) against the
provisioned `memoryBankConfig`, and add ADK's `PreloadMemoryTool` to the orchestrator so
cross-session recall is the framework's, not a dict read. Keep the `FORBIDDEN_RAW` denylist —
filtering clinical fields before they reach durable memory is a genuine product decision worth
narrating.
*Check:* a second run on the same case retrieves memory written by the first run **in a different
process**.

**Step 18 · Real sessions.**
Replace `InMemorySessionService` at `backend/runtime/invoke.py:17` with `VertexAiSessionService`, or
pass `session_service_uri="agentengine://{resource_id}"` to `get_fast_api_app`. Without this, "holds
context across weeks of asynchronous operation" — the track's explicit demand — is false the moment
Cloud Run scales. The `amara` scenario is what proves it.
*Check:* kill the process mid-journey, restart, and resume the same session id.

**Step 19 · Turn on Cloud Trace on the deployed fleet.**
Change `trace_to_cloud=` to `otel_to_cloud=True` at `app/agent_server.py:102` — `trace_to_cloud` is
the legacy parameter and ADK 2.7.1 carries a TODO to remove it. Add to `deploy_fleet.sh:59`:
`GOOGLE_CLOUD_AGENT_ENGINE_ENABLE_TELEMETRY=true`,
`OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental`,
`OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=EVENT_ONLY`. Grant each service account
`roles/cloudtrace.agent`. Step 4 already produces real trace ids locally; this is what makes the
agent-side spans join them.

> **Do not "fix" `GOOGLE_CLOUD_LOCATION=global` to match the engine region.** `gemini-3.5-flash` is
> served from `global` and the `us`/`eu` multi-regions and is **not available in `us-central1`** — I
> confirmed this by direct call, which 404s. The engines live in `us-central1` while the model
> resolves globally, and that mismatch is correct. Aligning them breaks every agent.

*Check:* the Traces tab on an agent shows the `invoke_agent → call_llm → execute_tool` span DAG.

**Step 20 · Resolve specialists from the Agent Registry.**
`backend/agents/orchestrator/agent.py:96-97` reads `CASERELAY_URL_*` env vars produced by a shell
script. Query the registry instead and fall back to env vars only if it is unreachable. You already
have eight correct registry entries; you are showing a fixture instead. Run
`agents-cli publish gemini-enterprise` so publication is reproducible from the repo rather than a
step someone did once by hand. `GET /v1/registry` starts returning live data with no change to its
shape.
*Check:* unset every `CASERELAY_URL_*` and the orchestrator still finds all six specialists.

> Steps 21 and 22 are one piece of work. The reason `PHASES` scripts the fan-out is that the model
> drops specialists. Build the guard that catches a dropped or fabricated commitment and you earn
> the right to delete the script.

**Step 21 · Supervision layer.**
New `backend/runtime/supervision.py` wrapping every specialist invocation:
- **Timeout.** The current `httpx timeout=600.0` is a hang, not a timeout. Set a per-agent deadline
  in the tens of seconds with `asyncio.wait_for`.
- **Bounded retry.** Add `ReflectAndRetryToolPlugin(max_retries=3)` to the Runner — it ships in your
  installed ADK 2.7.1 and is unused. Reuse the same idempotency key across attempts, which is where
  `backend/infra/idempotency.py::claim()` finally becomes live code. Note this is a correctness fix,
  not just tidiness: the dead `claim()` is a real Firestore transaction, while the path actually
  reachable today (`workspace.claim_update:214-219`) is a per-process dict. Across eight endpoints at
  `--max-instances 2`, cross-instance idempotency does not exist at all.
- **Graceful degradation.** After N attempts, mark the commitment `unresolved`, write a `degraded`
  audit event, and **continue with the other specialists**. One dead partner agent must not block a
  child's other four commitments.
- **Loop cap.** A counter per `(case_id, agent, phase)`; on breach, abort, write `loop_detected`, and
  escalate to the Safeguarding Verifier rather than retrying. Set `RunConfig(max_llm_calls=N)` as a
  backstop.
- **Typed output.** Give specialists `output_schema=AgentResponse` from `contracts/envelope.py` so a
  garbage status is a validation error instead of silent state. The contract is written and imported
  by nothing.
- **Fail loudly on no-match.** Make `workspace.set_commitment:154-163` raise instead of returning
  implicitly, so a hallucinated commitment id cannot look like success.

**Step 22 · Grounded status + reconciliation.**
Two guards that are novel, fall straight out of the architecture you already have, and will land
well with Google judges:
- **Grounding.** Require a specialist to pass back the `audit_ref` the Gateway handed it. If no
  matching `disclosure` event exists for that case and purpose, refuse the write. *You cannot report
  on data you were never granted.*
- **Reconciliation.** Give the verifier a `reconcile(case_id)` tool comparing each claimed status
  against the partner system's last stored raw reply. A specialist claiming `completed` while the
  stored reply says `enrollment_found: false` gets reverted to `unresolved` with a `status_reverted`
  event and a human approval.

*Check:* the `diego` scenario — a deliberately lying specialist is caught, reverted and escalated,
visible in Firestore.

**Step 23 · Delete the scripted fan-out.**
Collapse `PHASES` from ten entries to four: activate (supervisor gate), *resolve all open
commitments* (one instruction, model-driven, looping until `get_commitment_states` reports no
`pending` left), wake and re-check, then approve (supervisor gate) and close. Keep the two gates —
they are a real HITL feature, and saying so on camera converts them from a limitation into a design
decision.

Then close the self-serve hole. It is not enough to remove the `variant='enroll'` instruction from
the phase-8 prompt: `query_school(referral_id, variant)` at `backend/agents/education/agent.py:24`
exposes `variant` as a **tool parameter**, so the model can request `enroll` at any point in the
journey and then report `completed`. The agent is choosing its own answer. Drop `variant` from the
tool signature and have the partner simulator decide the reply from case state — which Step 7 has
already built.

Keep the old list behind a `--scripted` flag as a demo-day safety net. Success is three consecutive
green end-to-end runs against the deployed fleet.

**Step 24 · Add a chaos flag.**
`--chaos={timeout,hallucinate,loop,injection}` on `infra/cloud_e2e.py` and `infra/case_cli.py`,
injecting the failure at the partner-simulator boundary so nothing in the production path knows it is
a drill. This is how Steps 21 and 22 get *demonstrated* rather than merely described, and
"failure-tolerant inter-agent routing" is a named sub-criterion almost no competitor will cover.

---

### Stage 5 — Prove it

**Step 25 · Make the deploy reproducible.**
Reproducible setup is explicitly scored, and right now nobody but the author can run it. Four gaps,
all small:
- **`agents-cli` is not in `pyproject.toml`.** `deploy_fleet.sh:52` depends on it, `uv sync` does not
  install it, and the README never mentions it. Add it.
- **Nothing creates the eight service accounts.** `deploy_fleet.sh:58` assumes they exist. Write
  `infra/bootstrap.sh` that enables the required APIs (including Cloud Scheduler, currently
  disabled), creates the eight SAs, grants each its roles (per-agent least privilege, per Step 15),
  creates the Firestore database, deploys `infra/firestore.indexes.json`, and creates the Scheduler
  job and Pub/Sub push subscription from Step 11. Those steps exist today only as prose in
  `caserelay-agent-build-plan.md:49-56`.
- **The deploy loop hides its own failures.** `deploy_fleet.sh:8` uses `set -uo pipefail` without
  `-e`, and passes `--no-wait` to all eight deploys. A failed deploy neither stops the loop nor
  surfaces. Add `-e`, and either drop `--no-wait` or poll the operations and fail on error.
- **Stop hardcoding the project.** `fleet.py:3`, `backend/infra/firestore_client.py:16`,
  `infra/case_cli.py:27-28` and `infra/cloud_e2e.py:17-18` all fall back to the literal `caserelay`,
  so a judge in their own project authenticates against one they cannot see and gets a bare
  permission error. Require the variable and fail with a clear message when it is absent.

*Check:* on a clean project with only `gcloud auth login`, `infra/bootstrap.sh` followed by
`infra/deploy_fleet.sh` produces eight working engines and a firing scheduler.

**Step 26 · Tests.**
Not exhaustive coverage — targeted proof for the claims being scored. Add `pytest` and a `tests/`
directory with: the governance probe (projection allow/deny per identity), audit immutability, the
supervisor gate refusing a `draft` case, grounded-status rejection, reconciliation reverting a lie,
idempotent replay of a duplicate callback, and the past-dated-checkpoint sweep from Step 11. The six
simple scenarios map one-to-one onto these. All run without an LLM call, so they are fast and free.
Add a GitHub Actions workflow running them plus `tsc --noEmit` and `eslint` on the portal.
*Check:* `pytest` green in CI, badge in the README.

**Step 27 · Close the remaining correctness bugs.**
Drop `"proposed"` and `None` from the accepted grant statuses at `workspace.py:141` and require
`case["status"] in {"active", "monitoring"}` — until this lands the supervisor gate is decorative and
the walkthrough's Phase 2 claim is false. Fix the ~60s boot stall and 80-line traceback in
`agent_server.py`. Refresh `uv.lock` (`uv lock --check` currently fails). Load `.env` with
`python-dotenv`, which is installed and never used.

**Step 28 · Redeploy and re-verify end to end.**
`./infra/deploy_fleet.sh` with the new env vars, then `infra/cloud_e2e.py` three times clean, then
each `--chaos` mode once, then every simple scenario. Confirm Firestore holds a **completed**
journey — it currently holds three empty `draft` cases, so a judge running `case_cli.py show` sees
nothing.

**Step 29 · Regenerate the evidence.**
Now that the claims are true, make the docs match. Restore Cloud Run, Cloud Tasks, Cloud Trace and
the rest to the README stack table only for services the code now uses, and delete the ones it still
does not. Replace the `<your-org>` placeholder at `README:140` with the real clone URL. Correct the
four false rows in `docs/hackathon-rulebook.md:244-257`, change "nine agents" to eight, and drop
`deployment_metadata.json` as cited evidence — it is gitignored, so no judge will ever see it. Fix
`.env.example` to name `CASERELAY_STATE` rather than the phantom `CASERELAY_PERSIST`.

Redraw both diagrams as-built. Update the walkthrough, including the stale section 11 (`:596-601`)
which documents four files that never existed in git history, and the `apr-poison` references — the
verifier generates `apr-<uuid8>`. Remove the two hardcoded `/Users/akhil.maddala/...` paths. Rewrite
the README's opening around Elena rather than around systems, and make the argument that ties the two
scored criteria together:

> A corporate user arrives with an employer, an SSO identity, a role, and an access policy someone
> else wrote. Elena has none of that. She is unpaid, employed by none of the five agencies, and her
> only authority is a court order naming one child. That is precisely why CaseRelay records the
> legal basis for every single field disclosure — the audit trail is not compliance overhead, it is
> the only mechanism by which an outsider can be trusted with a child's data at all.

*Check:* every service named in the README returns a hit in `rg` against `backend/ app/ infra/`.

---

## Part 4 — Definition of done

### Portal-ready (Stage 3 — the handover gate)

Your teammate is unblocked when all of these hold:

- [ ] `GET /v1/cases` returns real Firestore data over HTTPS from a `.run.app` URL.
- [ ] `contracts/openapi.json` is checked in and matches the deployed service.
- [ ] `POST /v1/cases/{id}/runs` returns in under a second and streams progress over SSE, and the
      work is done by the deployed reasoning engines rather than in-process fallbacks.
- [ ] Every scenario in `GET /v1/scenarios` can be created, run and deleted over the API.
- [ ] Trace ids in responses are real and open in Cloud Trace; `rg "trace-7821"` returns nothing.
- [ ] Two cases run concurrently without colliding on a checkpoint.
- [ ] The wake fires from a scheduler with no user session and no open browser, its audit event
      names the scheduler rather than a volunteer, and a case dated 17 days out is correctly left
      alone by the same sweeper.
- [ ] No `/demo/*` route exists anywhere, and no code, document, diagram or portal file references
      one — `rg "/demo/"` returns hits only in this plan's analysis sections.

### Submission-ready

- [ ] The repository resolves for an unauthenticated visitor, or is shared with both Devpost and
      Google addresses.
- [ ] `python infra/cloud_e2e.py` with no arguments prints `CLOUD-E2E-OK`, and fails when a
      specialist is deliberately broken.
- [ ] A stranger can follow the README with their own `GOOGLE_CLOUD_PROJECT` and get a run.
- [ ] `infra/bootstrap.sh` then `infra/deploy_fleet.sh` works on a clean project, and a failed
      deploy makes the script exit non-zero.
- [ ] `rg -i "modelarmor"` returns hits in `backend/`; a novel injection string is caught.
- [ ] No dead code: `assert_scope`, `idempotency.claim`, `write_audit` and the envelope contracts
      are all on live paths.
- [ ] A cross-scope request is denied, audited, and visible in the API.
- [ ] `PHASES` has four entries; the orchestrator picks its own specialists.
- [ ] All four `--chaos` modes produce a clean, explainable outcome.
- [ ] The six simple scenarios run as CI assertions; the three complex ones reach their documented
      outcome by hand.
- [ ] `pytest` is green in CI.
- [ ] Every service named in the README appears in the code; every capability in the rulebook
      mapping points at a file that delivers it.
- [ ] Firestore contains at least one **completed** journey.
- [ ] The `/admin` page creates, runs and deletes cases against the live fleet.

## Part 5 — Explicitly out of scope

Cut these from the docs rather than building them. Each is a day or more and none moves a scored
criterion as far as the video does.

- ~~Managed Agent Gateway with PSC/IAP, mTLS and DPoP~~ **Delivered:** all eight engines recreated
  with `--agent-identity` (GEAP's `IdentityType.AGENT_IDENTITY`). The gateway now verifies the
  caller principal from GCP credentials (`google.oauth2.id_token`) in deployed engines and rejects
  any caller whose principal does not match the grant subject. The old `PURPOSE_TO_IDENTITY` lookup
  (which derived identity from the purpose argument) is deleted.
- The conflicting-updates, identity-revocation and case-closure scenarios (S11–S13).
- Fixing the Gemini Enterprise UI `NOT_FOUND` documented at `walkthrough:572-584`.
- Rebuilding the whole portal. The API contract is what matters; screens can follow.

## Part 6 — Bonus, once the above is green

Worth up to 1.0 on a 6.0 scale, and cheap.

| Item | Points | Effort |
|---|---|---|
| Social post with `#AllThingsAgenticHackathon` | 0.2 | 20 min |
| Public build write-up — the walkthrough is already most of the draft | 0.2 | 2 h |
| **Gemma** as a local, cheap pre-screen in the Gateway ahead of Model Armor and Gemini | 0.2 | 4 h |

Gemma is the only additional model with an honest architectural argument: a CASA program cannot
afford a frontier-model call on every inbound partner webhook, so a small always-on model gates
cheaply and Gemini reasons only when the gate opens. **Skip Veo and Lyria** — generated media in a
child-welfare product reads as points-farming and risks the Innovation score more than the 0.4
gains.
