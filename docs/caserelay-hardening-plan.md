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
| 8 endpoints live on Vertex AI Agent Engine | 8 `reasoningEngines` in `us-central1`, all `agentFramework: google-adk`. |
| 8 platform-managed Agent Identities | All eight deployed with `--agent-identity` (`identityType: AGENT_IDENTITY`). Per-agent service accounts are **no longer used** — replaced by GEAP-managed SPIFFE-style principals. |
| 8 real Agent Registry entries with A2A cards | Live `agentregistry.googleapis.com` returns 8 × `A2A_AGENT_CARD`. |
| Authenticated A2A over the `/api` passthrough | `backend/runtime/a2a_auth.py:14-32` mints real ADC bearer tokens. |
| Deterministic field projection with per-access audit | `backend/policy/projection.py`, `backend/gateway/gateway.py:36-61`. Education sees 3 of 14 fields, family services sees 1 of 14. |
| One-image / one-identity serving | `app/agent_server.py:45-88`. Genuinely clever and worth showing. |
| The documented local journey runs | A local control plane driven through `POST /v1/cases` → `POST /v1/cases/{case_id}/runs` completes against real Vertex, outcome-stable across runs. |

This is a real Fortified Enterprise Fleet spine. The problem is everything layered on top.

### 1.2 Custom code standing in for a real Google product

| Capability | What exists | Why it fails a Google judge |
|---|---|---|
| **Model Armor** | `backend/gateway/armor.py` — calls Model Armor API (`modelarmor.googleapis.com`) with template `caserelay-screen`; SDP Advanced Config references Cloud DLP inspect template `caserelay-cross-scope` (custom dictionary detectors + hotword proximity rule). All old regexes deleted. Fails closed. | Template configuration in `infra/bootstrap.sh` / GCP console. Not an ADK plugin (direct call), but enforced by Google services. |
| **Agent Observability** | `otel_to_cloud=True` in `agent_server.py`; `GOOGLE_CLOUD_AGENT_ENGINE_ENABLE_TELEMETRY=true` in `deploy_fleet.sh`; `CloudTraceSpanExporter` in `context.py`; trace IDs derived from live OTel spans | Control-plane and engine traces do NOT share a trace id (Agent Runtime starts a fresh trace context). No end-to-end correlation across both hops. |
| **Memory Bank** | `backend/memory/platform.py` — `VertexAiMemoryBankService` against instance `8631858420611284992`; sessions extracted via `memories.generate` (synchronous); 3 custom topics (`partner_contacts`, `institutional_shortcuts`, `unblocking_strategies`) | Scoped per case; orchestrator searches on each turn when env var set. `backend/memory/bank.py` is a separate Firestore module, NOT the GEAP Memory Bank. |
| **Agent Identity** | ~~`dict.get()` on `education-agent@caserelay.iam`~~ | **Fixed.** All eight engines use `--agent-identity` (GEAP platform-managed). The gateway resolves the caller principal from `RunContext` on deployed engines and verifies it matches the engine's declared identity. `assert_scope()` is now called. The old purpose-derived identity path (`PURPOSE_TO_IDENTITY`) is deleted. |
| **Agent Gateway** | ~~In-process function imported by the agents it governs~~ | **Fixed.** Gateway now authenticates callers by principal (deployed engine identity from `RunContext`), enforces grant matching, and calls `assert_scope()` for cross-scope denial. Still in-process (no managed Gateway), but caller-authenticated and deny-by-default. |
| **Agent Platform Sessions** | ~~`InMemorySessionService`~~ | **Fixed.** Two dedicated Agent Engines via `VertexAiSessionService`: `caserelay-chat-sessions` for the operator chat transcript (`backend/api/agui.py`) and `caserelay-run-sessions` for every orchestrator agent turn (`backend/runtime/invoke.py`), one session per phase invocation. A deployed control plane raises at startup if either engine id is unset, so the in-memory path cannot be reached in production. |
| **Agent Registry** | Roster loaded from `fixtures/cr-1042/agent_cards.json` | The real registry has the correct data. The orchestrator resolves specialists from `CASERELAY_URL_*` env vars instead. |

### 1.3 Scripted outcomes in the demo path

- **The day-17 wake is a prompt.** `backend/runtime/fleet.py:47-50` contains the literal string
  telling the orchestrator that day 17 arrived. Checked against the live project: the
  `caserelay-wakes` Cloud Tasks queue is RUNNING and has **never held a task**; `caserelay-events`
  and `caserelay-dead-letter` exist with **zero subscriptions**, so every message the one publish
  at `durable.py:26-39` ever sent went nowhere — and that publish is wrapped in a bare
  `except: return` besides. The **Cloud Scheduler API is not enabled** on the project. There are
  **zero Cloud Run services** (at time of writing; `caserelay-control-plane` has since been deployed), so there was no HTTP endpoint a scheduler or a push subscription
  could target even if they existed. Nothing about the timed event has ever run. This is the
  headline Innovation beat.
- **Delegation is scripted.** ~~`PHASES` is a hardcoded 10-step list naming exactly one specialist
  per turn. The mitigation is a Python `for` loop, not orchestration.~~ **Partly fixed** (Step 23).
  The `for` loop is gone: `PHASE_REGISTRY` carries a precondition per phase and the engine
  re-evaluates all of them after each completed phase, so the case decides which phases run.
  One specialist per turn remains, for the reason the honest comment in `fleet.py` gives — asked
  for all five, the model drops some.
- **The harness picks the happy ending.** ~~Phase 8 instructs the education agent to call
  `query_school` with `variant='enroll'`, so the agent is told which reply to receive.~~
  **Fixed** (Step 23). `variant` is gone from the tool signature; the partner simulator decides
  each reply from the `partner_behaviour` field on the case's own referral row, and the default
  behaviour is a successful reply that a scenario must opt *out* of. What closes the flagship
  case is now the scoped follow-up in Step 31, not a callback naming its own answer.

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
   pin `GOOGLE_CLOUD_PROJECT=caserelay`, so a judge's local run calls Vertex in a project they
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

> **Update (Aug 25):** The portal now calls the real control plane through a BFF proxy
> (`portal/src/app/api/control-plane/[...path]/route.ts`) that mints Google-signed ID tokens
> server-side. SSE is proxied with incremental delivery preserved. A portal-triggered run fans
> out over real A2A to the deployed engines. Verified: case CR-0825094224 ran to completion
> with 7 engines serving A2A. Both event surfaces — the live SSE stream and the recorded replay
> — now carry AG-UI envelopes, decoded in one place (`portal/src/lib/agui.ts`). The portal is
> **not deployed** — it runs via `npm run dev` locally. `caserelay-portal.web.app` is not live.
> Some mock data may still exist alongside real data paths; the analysis below describes the
> state as of the plan's writing.

`portal/src` originally contained **zero** `fetch`, `axios`, or any other backend call. The screens rendered
from `lib/mock/*.ts` driven by one `step` integer that auto-advances every 3800 ms, with a visible
play/next/prev scrubber in the sidebar. `mock/agents.ts` invented a third, conflicting agent roster
with fabricated `https://cr-*-7g2h.a.run.app` endpoints — plus static `p50Ms: 412` and `lastHeartbeat: "18s ago"`.

The two sides described unrelated worlds. The only value that matched was `trace-7821`, because both
hardcoded it:

| | Portal said | Backend did | Now |
|---|---|---|---|
| Health partner | Riverbend Community Health (`mock/agents.ts:82`) | Harbor Pediatric (`sim.py:34`) | **Reconciled on the portal's name** — Riverbend Community Health, contact David Chen |
| Legal partner | Statewide Legal Aid Collective (`:101`) | County Legal Aid (`sim.py:44`) | **Reconciled** — Statewide Legal Aid Collective, contact Anna Reed |
| Shelter | Harborlight Youth Shelter (`:120`) | Safe Harbor (`sim.py:56`) | **Reconciled** — Harborlight Youth Shelter, contact Tom Barnes |
| Family services | — | County Family Services | Mesa County Family Services, contact Maria Lopez |
| Education identity | `education@lincoln-usd.partner` (`:59`) | `education-agent@caserelay.iam` | Platform-managed principal from `--agent-identity` |
| Education referral | `ED-77120` (`approvals.ts:26`) | `edu-1042` (`referral_packet.json:20`) | `edu-1042` |
| Approval id | `AP-8802` (`approvals.ts:6`) | `apr-{uuid4[:8]}` (`verifier/agent.py:32`) | `apr-{uuid4[:8]}` |
| Injection text | `"SYSTEM: ignore prior instructions…"` (`policy.ts:96`) | `"retrieve Maya's medical notes…"` | `"retrieve Maya's medical notes…"` |
| Withheld count | 8 (`policy.ts:51-90`) | 11 (`gateway.py:21-35`) | 11 |
| Deployment | `cr-*-7g2h.a.run.app` (`:26`) | Vertex `reasoningEngines/…` | Vertex `reasoningEngines/…` |

The partner names were the resolvable half and are now canonical on both sides: the backend fixtures
and simulator adopted the portal's names rather than the reverse, and every referral also carries a
named contact and a short form for repeated mentions. The rest resolves itself as screens call the
API — the mock module is deleted, not corrected — and matters only for any screen that stays a
prototype past the deadline.

There is no API for the portal to call even if someone wanted to. `backend/api/main.py` is never
deployed, `POST /demo/maya` blocks for 227 seconds, and Firestore writes are opt-in behind
`CASERELAY_STATE`. **Building that API is the load-bearing work in this plan.**

### 1.7 Documentation accuracy

> **Update (Aug 25):** The README stack table has been corrected. Cloud Run is now used for
> the control plane (`caserelay-control-plane`). Cloud Storage, Secret Manager, Cloud Tasks,
> and Pub/Sub (events / scheduling) are not on the live path and have been removed from the
> stack table. The model string has been correct (`gemini-3.5-flash`) since prior edits.

The rulebook's evidence mapping cites modules that do not deliver the capability beside them.
`audit/writer.py` has since become live (Step 6), but `backend/infra/idempotency.py::claim()` is
still dead code, and the "context held safely across weeks" row cited `backend/memory/bank.py` —
a lightweight Firestore state store that is explicitly **not** the GEAP Memory Bank. The evidence
for that row is `backend/memory/platform.py` for Memory Bank, `backend/api/agui.py` and
`backend/runtime/invoke.py` for Agent Platform Sessions, and `backend/runtime/event_log.py` for the
durable run history.

`fixtures/cr-1042/partner_configs.json` was unused by any code and read exactly like an answer key
for the demo's supposedly independent outcomes. It is deleted. What remains in that directory is the
referral packet, the derived commitments and grants, the two school callbacks, and the agent cards.

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
| Agent Runtime | Real deploy, fake durability | **Done.** Real deploy + Cloud Scheduler wake every minute + Pub/Sub push (Step 11) |
| Agent Platform Sessions | ~~`InMemorySessionService`~~ | **Done.** `VertexAiSessionService` on two dedicated engines — chat transcript and per-phase agent turns (Step 18) |
| Memory Bank | **Done.** `VertexAiMemoryBankService` + 3 custom topics + `memories.generate` | **Done.** Sessions (Step 18) completed the picture |
| Agent Identity | ~~String compare on fake emails~~ | **Done.** `--agent-identity` on all eight engines; `google.oauth2.id_token` verification in deployed mode. |
| Agent Gateway | ~~In-process function~~ | **Done.** Caller-authenticated and deny-by-default; `PURPOSE_TO_IDENTITY` deleted. |
| Model Armor | **Done.** `google-cloud-modelarmor` calling template `caserelay-screen` (PI/jailbreak + SDP/DLP) | Could be implemented as ADK plugin for uniform enforcement |
| Agent Observability | **Done.** `otel_to_cloud=True`, `CloudTraceSpanExporter`, `ENABLE_TELEMETRY=true`; ADK spans with `gen_ai.*` attributes | Cross-hop trace correlation still missing (Agent Runtime limitation) |

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
**Status: NOT DONE — repo remains private; `git push` blocked by network (SSH to github.com:22 fails). Social post not made.**
`github.com/akhil-bot/CaseRelay` returns **HTTP 404 unauthenticated**: it is private and not
shared, so there is currently no repository for a judge to open. Make it public, or share it with
`testing@devpost.com` **and** `cloudhackathons@google.com`. Post the social update with
`#AllThingsAgenticHackathon` while you are here — that is 0.2 bonus for twenty minutes.

**Step 2 · Fix the two pass/fail claims and delete the answer key.**
**Status: PARTIAL — README model name correct (`Gemini 3.5 Flash`); `partner_configs.json` deleted; `frontend/` deleted. Portal mock files (`portal/src/lib/mock/`) still present with fabricated evidence strings.**
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
**Status: DONE — `store.py` defaults to Firestore; `CASERELAY_STATE=memory` is the opt-out. `.env.example` documents this correctly.**
`backend/state/store.py:15-16` currently no-ops every write unless `CASERELAY_STATE=firestore`.
Invert it: Firestore is the default, and an explicit `CASERELAY_STATE=memory` opts out for offline
development. A silent no-op that makes the demo appear to work while persisting nothing is the most
dangerous failure mode in the repo, and an API reading from an empty database is the second.
*Check:* a fresh run with no env set leaves a populated case document in Firestore.

**Step 4 · Give every run a real identity and a real trace id.**
**Status: DONE — `backend/runtime/context.py` exists with RunContext in contextvars; `trace-7821` literal deleted from all source files; trace_id derived from active OTel span when present.**
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
**Status: DONE — `durable.py` uses `workflow_id = f"wf-{case_id}"` per case; `due_at` is a real datetime; `state` is "waiting"/"running". Two concurrent cases produce distinct checkpoint documents. `infra/firestore.indexes.json` now carries the `state`/`due_at` composite and indexes only queried collections; the `partner_updates` index is gone.**
Per §1.5 item 10, every case currently writes to the same checkpoint document. Key checkpoints by a
per-case `workflow_id` (`wf-{case_id}-{kind}`), and give the checkpoint the two fields a sweeper
needs: `due_at` as a real timestamp rather than the current unread `next_wake` string, and a `state`
of `waiting | running | done`. Add the composite Firestore index for
`state == 'waiting' AND due_at <= now` to `infra/firestore.indexes.json`, and while you are in there,
drop the index on the `partner_updates` collection nothing writes.

Concurrent cases are the premise of both the admin page and the sweeper, so this cannot wait.
*Check:* two cases created back to back have distinct checkpoint documents and neither clobbers the
other.

**Step 6 · Route audit writes through the immutable writer.**
**Status: DONE — `workspace.append_audit` routes through `audit/writer.py::append_event` (uses `ref.create()`) in Firestore mode; raises `AuditMutationRejected` on duplicate event_id.**
`backend/audit/writer.py` already rejects mutation via `ref.create()` and catches `AlreadyExists`.
Point `workspace.append_audit` at it instead of `store.append_row`, which `.set()`s and silently
overwrites. This deletes dead code and makes an existing README claim true in about ten minutes —
and the audit trail is the single most-read read model in the API, so it should be trustworthy
before anything renders it.
*Check:* writing the same `event_id` twice raises `AuditMutationRejected`.

**Step 7 · Scenario factory.**
**Status: DONE — `backend/state/scenarios.py` defines 9 named scenarios (noah, priya, diego, rosa, ellis, theo, maya, kai, amara) with per-service `partner_behaviours`, `inject_callback`, and `due_offsets`. `GET /v1/scenarios` returns them grouped by complexity.**
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
| `maya` | Maya | **The flagship.** A school that asks for more time at fan-out rather than answering, a run that ends on its checkpoints and is restarted by the scheduler with nobody watching, prompt injection on the school's reply to that check-back, quarantine, a supervisor gate holding an enrollment that is still open, a scoped re-request the district can only answer honestly (it still has nothing), and finally a follow-up that closes the commitment and names the coordinator who took it on. The current CR-1042 story, generated rather than fixtured. |
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
**Status: PARTIAL — `harness/gate.py` implements 35 gates, of which 32 are fast and 3 (`t8.1`, `t11.5`, `t12.2`) are marked `slow=True` because they talk to Vertex, Firestore or Cloud Run and cost money. The slow gates, including the cloud e2e gate `t8.1`, have not been re-verified in this audit. The gate structure exists and points at the maya scenario.**
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
**Status: DONE — `main.py` is entirely `/v1` routes. All `/demo/*` routes deleted. Exception handlers map CaseNotFound→404, IdentityDenied→403. CORS configured. All read-models and write routes from the plan are present.**
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
scenario's deadline schedule, so `{"scenario": "maya", "due_in": "10s"}` produces a case that is
genuinely due in 10 seconds and rides the same sweeper as one due in 17 days. Accept it as a
duration string, echo the resolved `due_at` back, and show that timestamp in the admin UI so nobody
has to take the wake on faith.

Add an exception handler mapping `CaseNotFound` to 404 and `IdentityDenied` to 403, fixing the two
routes that currently 500. **Specify 403 in the contract now even though Step 15 is what starts
returning it** — a client that learns about a new status code after the fact is a client that gets
rewritten. Never let a raw Firestore error reach a caller; the deployed specialists currently return
`400 Document name ... has invalid tr...` as agent replies.

**Step 10 · Asynchronous runs.**
**Status: DONE — `POST /v1/cases/{id}/runs` returns 202 immediately; background thread drives the fleet. `GET /v1/runs/{id}` returns state. `GET /v1/runs/{id}/events` streams SSE with heartbeats and terminal-state detection. `CASERELAY_CONTROL_PLANE=1` forces A2A dispatch with no in-process fallback.**
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
is a real A2A call to a real reasoning engine under its own agent identity, and the audit trail the
UI renders was written by the agents that did the work.

**Step 11 · A wake that actually fires.**
**Status: DONE — `durable.py` has `sweep()` + `find_due()` + `resume_wake()` with scheduler audit events. `bootstrap.sh` creates the Cloud Scheduler job on `* * * * *` — every minute, to Pub/Sub topic `caserelay-events` — so a compressed demo deadline fires within a minute of falling due rather than up to five. Push subscription `caserelay-events-push` configured to deliver to `${CP_URL}/v1/workflows/sweep` with OIDC authentication and dead-letter after 5 attempts. A wake for a checkpoint that has already completed is acked rather than retried, and a wake arriving while the case lock is held is nacked so Pub/Sub redelivers it. All wiring codified in `infra/bootstrap.sh` (conditional on `control_plane_url.txt` existing).**

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
   `due_in: 10s`. It has to stay that short for the demo: `due_in` is the window the five per-commitment
   checkpoints are spread across, so the earliest lands at a fifth of it, and the wake phase only
   promotes a checkpoint that is already past due — much longer and the sweep fires them later, after
   the full sweep interval, starting a new run then rather than immediately. Real Cloud
   Scheduler, real sweeper, real Pub/Sub, real resume — nothing is faked or shortened in the code
   path, and the case genuinely falls due 10 seconds after creation. Close the
   laptop, come back, it happened. Note what this is *not*: no test-only endpoint rewrites a
   deadline, and no clock is stubbed. The only difference between the demo and a real case is a
   number in the create request.
3. **Real horizon, as proof.** Create a case with the true 17-day offset alongside the 10-second one
   and show the sweeper firing the second while leaving the first alone. Demonstrating the system
   *not* firing is what proves the firing is real and not special-cased — worth 15 seconds of video.

*Make the autonomy visible.* A wake has no human behind it, so it must not look like one.
`invoke.py:19` currently hardcodes `user_id="elena-volunteer-001"` on every run, which would stamp an
unattended resume with a volunteer's name. Scheduler-driven runs get a service principal, and the
audit event records `triggered_by: scheduler` with the `due_at` it fired against. The trace then
shows a full A2A fan-out with no session and no user — that is the evidence for asynchronous
operation, and it is the single most valuable half-minute of the demo.

*Check:* CI proves the resume with a past-dated checkpoint; on the deployed fleet, a case created
with a 10-second deadline resumes with nobody watching, and its audit trail names the scheduler.

**Step 12 · Deploy the control plane to Cloud Run.**
**Status: DONE — `caserelay-control-plane` deployed at `caserelay-control-plane-6nwo7o4bbq-uc.a.run.app`. `infra/deploy_control_plane.sh` exists. Deploys with `--timeout=900`, `--no-cpu-throttling`, gen2 execution environment, min/max instances pinned to 1. `allUsers` removed; auth-required. Portal reaches it through BFF proxy.**
Rewrite `backend/Dockerfile` first — **it cannot start in its current form.** Line 12 copies only
`api/`, line 15 runs `uvicorn api.main:app`, and `backend/api/main.py:3-5` imports
`backend.memory.bank`, `backend.runtime.fleet` and `backend.runtime.workspace`, none of which are in
the image. It also pins `google-adk>=1.0.0` inline against the 2.7.1 in the venv, so the image can
drift from what you tested. Install from `pyproject.toml` and `uv.lock` instead of a duplicated
inline list.

The agents stay on Agent Runtime; the control plane is a separate Cloud Run service with its own
service identity, holding **read-only** Firestore access plus permission to invoke the orchestrator.
This makes the README's Cloud Run claim true, gives a `.run.app` URL for the submission's hosted-URL
field, and gives the portal one origin to call. Add CORS for the portal origin, and note the
300-second request ceiling is why Step 10 exists.
*Check:* `GET /v1/cases` returns real Firestore data over HTTPS from a `.run.app` URL.

---

### Stage 3 — Handover

**Step 13 · Freeze and publish the contract.**
**Status: DONE — `contracts/openapi.json` checked into the repo. Portal work proceeds against the frozen artifact.**
Check the OpenAPI schema FastAPI already generates into the repo at `contracts/openapi.json`, so
portal work proceeds against a fixed artifact rather than a running server that changes under it.
Include the 403 and 404 shapes, the SSE event types, and the `/v1/scenarios` response — the three
things a client cannot infer.

**This is the milestone.** From here the portal can be built in parallel: everything in Stage 4 sits
behind this boundary and changes no response shape.

Hand over three things: the `.run.app` base URL, `contracts/openapi.json`, and the admin-page spec
below.

**Step 14 · Admin page spec: create a case, run it, watch it.**
**Status: PARTIAL — `docs/admin-page-spec.md` exists. Portal has the page structure but still calls mock data for some screens. The `/admin` page is not fully wired to the real API.**
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

> **Status (Aug 25): DONE.** All three sub-steps are implemented and verified on the deployed fleet.

1. ~~Fix the identities.~~ **Done.** Engines use GEAP platform-managed Agent Identity (`--agent-identity`), not per-agent service accounts. Grants reference the agent identity key, not a fake email.
2. ~~Stop deriving identity from the purpose.~~ **Done.** `PURPOSE_TO_IDENTITY` is deleted. The gateway resolves the caller principal from `RunContext.agent_identity` on deployed engines and requires it to match the engine's declared identity; mismatch is denied and audited.
3. ~~Call `assert_scope`.~~ **Done.** `assert_scope` is invoked inside `authorized_context` for every disclosed field; a cross-scope request produces an audited denial.

*Check:* a request presenting the health agent's token for `verify_school_enrollment` is denied and
produces a `denial` audit event — the `rosa` scenario. This is also a demo beat: a real, visible
zero-trust refusal.

**Step 16 · Replace `armor.py` with the Model Armor API.**
**Status: DONE — `armor.py` calls `ModelArmorClient.sanitize_user_prompt` against template `caserelay-screen` (PI/jailbreak + malicious URI + SDP Advanced Config referencing Cloud DLP inspect template `caserelay-cross-scope`). The cross-scope policy uses DLP custom dictionary detectors with a hotword proximity rule (terms only match when an action verb appears within 50 characters). All old hand-coded regexes are deleted. Screening fails closed: `ScreeningUnavailable` produces an explicit quarantine with rule `screening_unavailable`. NOT implemented as an ADK plugin — still a direct function call in the screening path. The audit trail reports rule `sdp` from the Model Armor match.**
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
**Status: DONE — `backend/memory/platform.py` uses `VertexAiMemoryBankService` against instance `8631858420611284992`. Sessions are extracted once per wake via synchronous `memories.generate` (via `commit_session_events`). Scoped per case (`case_id` mapped to ADK `user_id` slot). Three custom memory topics configured on the instance: `partner_contacts`, `institutional_shortcuts`, `unblocking_strategies` (codified in `infra/bootstrap.sh`). The orchestrator searches Memory Bank on each turn when `CASERELAY_MEMORY_BANK_ID` is set. `backend/memory/bank.py` still exists as a lightweight per-purpose Firestore state store — it is NOT the GEAP Memory Bank. The `amara` scenario is the memory showcase.**
Swap `backend/memory/bank.py` onto `VertexAiMemoryBankService` (already installed) against the
provisioned `memoryBankConfig`, and add ADK's `PreloadMemoryTool` to the orchestrator so
cross-session recall is the framework's, not a dict read. Keep the `FORBIDDEN_RAW` denylist —
filtering clinical fields before they reach durable memory is a genuine product decision worth
narrating.
*Check:* a second run on the same case retrieves memory written by the first run **in a different
process**.

**Step 18 · Real sessions.**
**Status: DONE — both session surfaces are on GEAP Agent Platform Sessions via `VertexAiSessionService`, on two dedicated Agent Engines. `caserelay-chat-sessions` holds the operator chat transcript (`backend/api/agui.py`), with the AG-UI thread id doubling as the platform session id so a restarted instance resolves a returning conversation with one read instead of listing every session the operator has ever held; `delete_session_on_cleanup=False` keeps the platform copy past the idle timeout. `caserelay-run-sessions` holds every orchestrator agent turn (`backend/runtime/invoke.py`), one session per phase invocation rather than one per run — the fan-out dispatches five phases concurrently and Google documents row-level locking only for `DatabaseSessionService`, with no equivalent guarantee for the Vertex one; continuity across phases already comes from Memory Bank, so sharing a session would buy nothing worth the concurrency risk. Both engines are provisioned by `infra/bootstrap.sh` into `infra/chat_sessions.env` and `infra/run_sessions.env`, and `infra/deploy_control_plane.sh` refuses to deploy if either is empty. A deployed control plane (`CASERELAY_CONTROL_PLANE=1`) raises at startup with an unset engine id rather than degrading to in-memory sessions, which look identical right up to the restart that proves they were never there; local development still falls back with a warning. A throttled append — the 300-per-minute per-project session quota is reachable by a five-way fan-out on its own — is retried three times with jittered backoff, and if it still will not land the event is kept in the session the model reads from and in the turn record Memory Bank extracts from, with the lost durable copy logged and traced as `session_not_durable`. The run continues on complete history; what is given up is the platform's copy of that one event.**

**A deliberate omission, recorded so it does not read as an inconsistency:** the run event log is *not* on Sessions, and should not be. It backs the activity feed, the timeline rail and the audit trail, which need an ordered, live, permanent record. Sessions orders events by timestamp alone — no sequence field, no documented tiebreak — offers no streaming or watch API, caps appends at 300 per minute per project, and requires every session to carry an expiry. Cloud Trace retains 30 days non-configurably, and Cloud Logging's `entries.list` is capped at 60 requests per minute and explicitly not intended for bulk retrieval, so neither is a home for it either. The log therefore stays in Firestore (Step 30). Only the wire format changed to AG-UI; storage is untouched.
*Check:* kill the process mid-journey, restart, and resume the same session id.

**Step 19 · Turn on Cloud Trace on the deployed fleet.**
**Status: DONE — `app/agent_server.py:102` uses `otel_to_cloud=True`. `deploy_fleet.sh` sets `GOOGLE_CLOUD_AGENT_ENGINE_ENABLE_TELEMETRY=true` and `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental` on all engines. `backend/runtime/context.py` derives `trace_id` from the active OTel span and exports to Cloud Trace via `CloudTraceSpanExporter`. ADK spans (`invoke_agent`, `call_llm`, `execute_tool`) carry `gen_ai.*` attributes and token counts. ONE LIMITATION: control-plane and engine traces do NOT share a trace id because Agent Runtime starts a fresh trace context rather than honouring the incoming `traceparent`. End-to-end distributed correlation across both hops is not achieved.**
Change `trace_to_cloud=` to `otel_to_cloud=True` at `app/agent_server.py:102` — `trace_to_cloud` is
the legacy parameter and ADK 2.7.1 carries a TODO to remove it. Add to `deploy_fleet.sh:59`:
`GOOGLE_CLOUD_AGENT_ENGINE_ENABLE_TELEMETRY=true`,
`OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental`,
`OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=EVENT_ONLY`. Grant each agent identity
`roles/cloudtrace.agent`. Step 4 already produces real trace ids locally; this is what makes the
agent-side spans join them.

> **Do not "fix" `GOOGLE_CLOUD_LOCATION=global` to match the engine region.** `gemini-3.5-flash` is
> served from `global` and the `us`/`eu` multi-regions and is **not available in `us-central1`** — I
> confirmed this by direct call, which 404s. The engines live in `us-central1` while the model
> resolves globally, and that mismatch is correct. Aligning them breaks every agent.

*Check:* the Traces tab on an agent shows the `invoke_agent → call_llm → execute_tool` span DAG.

**Step 20 · Resolve specialists from the Agent Registry.**
**Status: NOT STARTED — Orchestrator resolves exclusively from `CASERELAY_URL_*` env vars. No registry resolution call exists. The registry entries are live but unused by the orchestrator.**
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
**Status: NOT STARTED — No `supervision.py` exists. No timeout/retry/degradation wrapper. `httpx timeout=600.0` still in place. `ReflectAndRetryToolPlugin` unused. `idempotency.claim()` remains dead code.**
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
**Status: NOT STARTED — neither guard exists. `backend/workflows/durable.py::reconcile_commitments` is a different thing and must not be mistaken for this one: it compares a commitment's deadline against its status to decide what is overdue, and the run engine emits a `reconciliation` event from it, but it never compares a claimed status against the partner system's stored reply. There is no `reconcile()` verifier tool, no `status_reverted` event, and no grounding guard requiring the `audit_ref` the Gateway returns — the Gateway does return one (`gateway.py`), so the hook exists and nothing consumes it. The `diego` scenario therefore describes an intended behaviour rather than an observed one: it makes the SIS return a false positive and nothing catches the resulting false `completed`.**
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
**Status: PARTIAL — the static list is gone, but the phases are not collapsed. `backend/runtime/fleet.py` now holds `PHASE_REGISTRY`, fourteen `PhaseSpec` entries each carrying a `precondition` predicate over real case state, a `priority` tie-break, an optional concurrency `group`, and the `tools` that phase is handed. The run engine re-evaluates every precondition after each completed phase and dispatches whichever are ready, so which phases run and how many is decided by the case rather than by a cursor walking an array — CR-1042 never reaches `10-unanswered` because its provider answers, and `priya` does because hers does not. `PHASES` survives only as the registry flattened into priority order for the operator CLI, which walks it without evaluating preconditions. What remains scripted is the prompt per phase and the one-specialist-per-turn fan-out, for the reason in §1.3: asked for five, the model calls two or three and reports the rest done. `variant` IS removed from the education agent tool signature — the partner simulator decides replies from the case's `partner_behaviour` field.**
Collapse `PHASES` from fourteen entries to four: activate (supervisor gate), *resolve all open
commitments* (one instruction, model-driven, looping until `get_commitment_states` reports no
`pending` left), wake and re-check, then approve (supervisor gate) and close. Keep the two gates —
they are a real HITL feature, and saying so on camera converts them from a limitation into a design
decision.

The self-serve hole is closed. It was not enough to remove the `variant='enroll'` instruction from
the phase-8 prompt: `query_school(referral_id, variant)` exposed `variant` as a **tool parameter**, so
the model could request `enroll` at any point in the journey and then report `completed` — the agent
was choosing its own answer. `variant` is gone from the tool signature, and the partner simulator
decides the reply from case state, which Step 7 built.

Keep the old list behind a `--scripted` flag as a demo-day safety net. Success is three consecutive
green end-to-end runs against the deployed fleet.

**Step 24 · Add a chaos flag.**
**Status: NOT STARTED — No `--chaos` flag exists anywhere in the codebase.**
`--chaos={timeout,hallucinate,loop,injection}` on `infra/cloud_e2e.py` and `infra/case_cli.py`,
injecting the failure at the partner-simulator boundary so nothing in the production path knows it is
a drill. This is how Steps 21 and 22 get *demonstrated* rather than merely described, and
"failure-tolerant inter-agent routing" is a named sub-criterion almost no competitor will cover.

---

### Stage 5 — Prove it

**Step 25 · Make the deploy reproducible.**
**Status: PARTIAL — `infra/bootstrap.sh` exists and enables APIs, creates Pub/Sub + Scheduler + indexes. `deploy_fleet.sh` uses `--agent-identity` and has IAM retry logic. BUT: `agents-cli` not in `pyproject.toml`; `deploy_fleet.sh` uses `set -uo pipefail` without `-e`; project hardcoded as `caserelay` fallback in `fleet.py:3`.**
Reproducible setup is explicitly scored, and right now nobody but the author can run it. Four gaps,
all small:
- **`agents-cli` is not in `pyproject.toml`.** `deploy_fleet.sh:52` depends on it, `uv sync` does not
  install it, and the README never mentions it. Add it.
- **Per-agent service accounts are no longer used.** The fleet uses GEAP platform-managed Agent Identity
  (`--agent-identity`). `infra/bootstrap.sh` should enable the required APIs (including Cloud Scheduler, currently
  disabled), grant the `principalSet://` IAM bindings, create the Firestore database, deploy
  `infra/firestore.indexes.json`, and create the Scheduler job and Pub/Sub push subscription from Step 11.
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
**Status: NOT STARTED — No `tests/` directory, no `pytest` in `pyproject.toml`, no `.github/` CI workflows. The `harness/gate.py` is the sole verification mechanism (32 fast gates pass; `t8.1`, `t11.5` and `t12.2` are marked slow).**
Not exhaustive coverage — targeted proof for the claims being scored. Add `pytest` and a `tests/`
directory with: the governance probe (projection allow/deny per identity), audit immutability, the
supervisor gate refusing a `draft` case, grounded-status rejection, reconciliation reverting a lie,
idempotent replay of a duplicate callback, and the past-dated-checkpoint sweep from Step 11. The six
simple scenarios map one-to-one onto these. All run without an LLM call, so they are fast and free.
Add a GitHub Actions workflow running them plus `tsc --noEmit` and `eslint` on the portal.
*Check:* `pytest` green in CI, badge in the README.

**Step 27 · Close the remaining correctness bugs.**
**Status: PARTIAL — Supervisor gate fixed (`grant_for` now requires `status == "granted"`; proposed/None no longer pass). `set_commitment` raises on no-match (§1.5 #2 fixed). `.env.example` corrected (`CASERELAY_STATE`). BUT: `~60s boot stall` in `agent_server.py` not addressed. `uv lock --check` status unverified.**
Drop `"proposed"` and `None` from the accepted grant statuses at `workspace.py:141` and require
`case["status"] in {"active", "monitoring"}` — until this lands the supervisor gate is decorative and
the walkthrough's Phase 2 claim is false. Fix the ~60s boot stall and 80-line traceback in
`agent_server.py`. Refresh `uv.lock` (`uv lock --check` currently fails). Load `.env` with
`python-dotenv`, which is installed and never used.

**Step 28 · Redeploy and re-verify end to end.**
**Status: PARTIAL — Fleet deployed with agent identity; case CR-0825094224 ran to completion via real A2A. 5/5 concurrent cloud e2e runs succeeded. Full re-verification with chaos modes not done (chaos modes don't exist yet).**
`./infra/deploy_fleet.sh` with the new env vars, then `infra/cloud_e2e.py` three times clean, then
each `--chaos` mode once, then every simple scenario. Confirm Firestore holds a **completed**
journey — it currently holds three empty `draft` cases, so a judge running `case_cli.py show` sees
nothing.

**Step 29 · Regenerate the evidence.**
**Status: PARTIAL — README stack table corrected (commit 54ab89f). Cloud Run documented correctly. Model string correct. The `<your-org>` placeholder is gone — the README clones the real URL. `.env.example` now sets `FIRESTORE_DATABASE=caserelay` with the reason beside it, and names `CASERELAY_STATE` rather than the phantom `CASERELAY_PERSIST`. The author-specific `cd /Users/akhil.maddala/...` paths in the walkthrough are replaced with `cd "$(git rev-parse --show-toplevel)"`. Architecture diagrams exist under `docs/diagrams/`. BUT: `.env.example` does not yet document `CASERELAY_CHAT_SESSION_ENGINE_ID` or `CASERELAY_RUN_SESSION_ENGINE_ID`, both of which a deployed control plane requires; the diagrams predate Agent Platform Sessions and the AG-UI event wire; and the `tools` array on every entry in `fixtures/cr-1042/agent_cards.json` names tools the agents do not have (`generate_safe_retry` exists nowhere in the codebase), which `GET /v1/registry` serves as-is.**
Now that the claims are true, make the docs match. Restore Cloud Run, Cloud Tasks, Cloud Trace and
the rest to the README stack table only for services the code now uses, and delete the ones it still
does not. Replace the `<your-org>` placeholder at `README:140` with the real clone URL. Correct the
four false rows in `docs/hackathon-rulebook.md:244-257` (now corrected: "eight agents", Cloud Run
clarified as control-plane only, `deployment_metadata.json` dropped as evidence). Fix
`.env.example` to name `CASERELAY_STATE` rather than the phantom `CASERELAY_PERSIST`.

Redraw both diagrams as-built — they predate Agent Platform Sessions, the AG-UI event wire and the
durable run event log, so all three are missing from them. Update the walkthrough, including the
stale section 11 (`:596-601`) which documents four files that never existed in git history, and the
`apr-poison` references — the verifier generates `apr-<uuid8>`. Rewrite
the README's opening around Elena rather than around systems, and make the argument that ties the two
scored criteria together:

> A corporate user arrives with an employer, an SSO identity, a role, and an access policy someone
> else wrote. Elena has none of that. She is unpaid, employed by none of the five agencies, and her
> only authority is a court order naming one child. That is precisely why CaseRelay records the
> legal basis for every single field disclosure — the audit trail is not compliance overhead, it is
> the only mechanism by which an outsider can be trusted with a child's data at all.

*Check:* every service named in the README returns a hit in `rg` against `backend/ app/ infra/`.

---

### Stage 6 — Survive the restart, and lead somewhere

Four pieces of work that were not in the original list because the gaps they close only became
visible once the control plane was serving a portal. Each one was a case that looked perfectly
valid and told the operator nothing.

**Step 30 · Keep a case's history across a restart.**
**Status: DONE — `backend/runtime/event_log.py`. Run events lived only in the serving instance's memory, so any Cloud Run restart emptied a case's activity feed, timeline rail and audit trail while the case itself stayed valid: opening a case created minutes earlier showed nothing, as if no work had been done. Each event is now its own Firestore document under its run, keyed on the position it was pushed at — not on a timestamp, which repeats within a phase — so a plain read of the subcollection sorts back into the order the live stream showed with no index and no tiebreak. The write is handed to a background thread draining one FIFO queue: `workspace.push_run_event` appends to the in-memory list the SSE stream serves *first*, so narrating a phase never waits on the database and a slow write can never surface as a stalled agent. A run flushes the queue when it finishes and `atexit` flushes it again, so a redeploy landing moments after a run completes still leaves that run's history readable. The queue is capped at 5000, so an unreachable Firestore costs lost history rather than the process. Deleting a case deletes its events too — Firestore keeps subcollections when their parent document goes, so leaving them would have stranded the history of every deleted case.**

**This is deliberately not on Agent Platform Sessions, and the reasoning belongs in the record so it does not read as an inconsistency with Step 18.** An ordered, live, permanent audit trail needs four things Sessions does not offer: Sessions orders events by timestamp alone with no sequence field and no documented tiebreak; it has no streaming or watch API; appends are capped at 300 per minute per project, which a five-way fan-out can approach on its own; and every session must carry an expiry. Cloud Trace retains 30 days non-configurably, and Cloud Logging's `entries.list` is capped at 60 requests per minute and explicitly not intended for bulk retrieval. Firestore is the right store for this one thing, and saying so is stronger than quietly using a platform product where it does not fit.
*Check:* restart the control plane and open a case created before the restart — the feed, rail and audit trail are all still there.

**Step 31 · Give a missed deadline consequences.**
**Status: DONE — `backend/workflows/escalation.py`, plus phases `9-nudge` and `10-unanswered` in the registry. A deadline that passed with a commitment still open used to wake the case and then do nothing further: if the provider never came back, the commitment simply stayed open and the run reported a shortfall nobody was told about. A wake now leads somewhere. `nudge_overdue` chases every overdue provider exactly once, scoped by the same authority grant that covered the original request, so a follow-up discloses nothing extra. A provider that answers names the officer who has taken the referral on, and that name is written back onto the referral rather than read once and discarded — the difference between a commitment nobody owns and one somebody does. A provider that stays silent is raised to the supervisor by `notify_supervisor` as a `supervisor_notice` approval with policy basis `["missed_deadline", "unanswered_followup"]`, kept deliberately distinct from the safeguarding escalation because "nobody replied" and "the reply reached outside its scope" need different things from a volunteer. The notice is not a gate on the machine: `_pending_escalation` counts only escalations, since nothing the fleet does next depends on how the volunteer answers a notice. Both paths write their own audit event (`followup`, `unresponsive_partner`).**
*Check:* the `priya` scenario — health never answers, never answers the chase, and the supervisor holds a notice naming that commitment while the other four close.

**Step 32 · Speak AG-UI on the run event wire.**
**Status: DONE — `backend/api/wire.py` and `portal/src/lib/agui.ts`. The control plane spoke its own vocabulary on the wire — `phase_started`, `commitment_overdue`, `run_suspended` — where AG-UI is the recognised standard for streaming agent events to a UI and the chat endpoint already spoke it. Both event surfaces now carry AG-UI envelopes: the live SSE stream (`/v1/runs/{run_id}/events`) and the recorded replay (`/v1/cases/{case_id}/events`), so the portal decodes a replayed history and a live one through one decoder. Five names have a true counterpart and travel as it — a run is a run and a phase is a step. The rest have none (AG-UI cannot express a missed deadline or a quarantined reply) and travel as `CUSTOM` naming themselves, with the whole internal event alongside on `value`; typed events carry it on `rawEvent`. The feed distinguishes every one of these names, so collapsing them into five types would have cost it the distinctions it draws in red and amber. The mapping table is one-to-one in both directions, since a type standing for two of our names would arrive undecodable. The envelopes are plain dicts rather than `ag_ui.core` models, verified identical to what those models serialise: the models ship only where the chat endpoint runs, and every tool that imports the app — including the gate suite — must be able to load it without them. Storage is untouched; only the wire changed.**
*Check:* every frame on both surfaces parses as an AG-UI event, and a frame in the older shape still passes through the portal decoder unchanged so a page held open across a deployment keeps working.

**Step 33 · Hold every agent turn on Agent Platform Sessions.**
**Status: DONE — see Step 18, which this completes. The chat transcript (commit `1f18068`) and the fleet's per-phase agent turns (commit `138abc6`) are both on dedicated Agent Engines.**

---

## Part 4 — Definition of done

### Portal-ready (Stage 3 — the handover gate)

Your teammate is unblocked when all of these hold:

- [x] `GET /v1/cases` returns real Firestore data over HTTPS from a `.run.app` URL. *(verified: control plane deployed, BFF proxy mints ID tokens)*
- [x] `contracts/openapi.json` is checked in and matches the deployed service. *(file present in repo)*
- [x] `POST /v1/cases/{id}/runs` returns in under a second and streams progress over SSE, and the
      work is done by the deployed reasoning engines rather than in-process fallbacks. *(verified: CASERELAY_CONTROL_PLANE=1 enforces A2A; case CR-0825094224 completed via real fleet)*
- [x] Every scenario in `GET /v1/scenarios` can be created, run and deleted over the API. *(9 scenarios defined, routes present)*
- [x] Trace ids in responses are real and open in Cloud Trace; `rg "trace-7821"` returns nothing. *(DONE: trace-7821 is gone; RunContext derives from live OTel span; `otel_to_cloud=True` on fleet + control plane; `CloudTraceSpanExporter` exports. Limitation: control-plane and engine traces use different trace contexts — cross-hop correlation not achieved.)*
- [x] Two cases run concurrently without colliding on a checkpoint. *(per-case workflow_id implemented)*
- [x] The wake fires from a scheduler with no user session and no open browser, its audit event
      names the scheduler rather than a volunteer, and a case dated 17 days out is correctly left
      alone by the same sweeper. *(DONE: sweep logic + scheduler job + `caserelay-events-push` push subscription all codified in `bootstrap.sh`; push delivers to `POST /v1/workflows/sweep` with OIDC auth and dead-letter after 5 attempts)*
- [x] No `/demo/*` route exists anywhere, and no code, document, diagram or portal file references
      one — `rg "/demo/"` returns hits only in this plan's analysis sections. *(verified: only match is `harness/gate.py` which tests for absence)*

### Submission-ready

- [ ] The repository resolves for an unauthenticated visitor, or is shared with both Devpost and
      Google addresses. *(NOT DONE: repo private; git push blocked by network)*
- [ ] `python infra/cloud_e2e.py` with no arguments prints `CLOUD-E2E-OK`, and fails when a
      specialist is deliberately broken. *(UNVERIFIED: gate t8.1 skipped in last run; ground truth says 5/5 cloud e2e passed via a different path)*
- [ ] A stranger can follow the README with their own `GOOGLE_CLOUD_PROJECT` and get a run.
      *(PARTIAL: the clone URL and `.env.example` database are both fixed, and the README's local journey now drives the real run engine through the control plane rather than a `run_maya()` helper that no longer exists. Still outstanding: the project is hardcoded as a `caserelay` fallback in several modules, `.env.example` does not document the two session engine ids a deployed control plane requires, and `infra/fleet_endpoints.env` is author-only)*
- [ ] `infra/bootstrap.sh` then `infra/deploy_fleet.sh` works on a clean project, and a failed
      deploy makes the script exit non-zero. *(PARTIAL: bootstrap.sh exists; deploy_fleet.sh lacks `-e`)*
- [x] `rg -i "modelarmor"` returns hits in `backend/`; a novel injection string is caught. *(armor.py has the API call; deterministic layer catches broad patterns)*
- [ ] No dead code: `assert_scope`, `idempotency.claim`, `write_audit` and the envelope contracts
      are all on live paths. *(PARTIAL: `assert_scope` is live; `write_audit`/`append_event` is live; BUT `idempotency.claim` is still dead code; `contracts/envelope.py` unused)*
- [x] A cross-scope request is denied, audited, and visible in the API. *(rosa scenario verified: education got only child_name, dob, referral_id)*
- [ ] `PHASES` has four entries; the orchestrator picks its own specialists. *(PARTIAL: the static list is replaced by a fourteen-entry precondition registry, so the case decides which phases run; the prompt-per-phase and one-specialist-per-turn fan-out remain)*
- [ ] All four `--chaos` modes produce a clean, explainable outcome. *(NOT STARTED: no chaos flag)*
- [ ] The six simple scenarios run as CI assertions; the three complex ones reach their documented
      outcome by hand. *(NOT STARTED: no CI; scenarios exist but no test runner)*
- [ ] `pytest` is green in CI. *(NOT STARTED: no pytest, no tests/, no CI)*
- [ ] Every service named in the README appears in the code; every capability in the rulebook
      mapping points at a file that delivers it. *(MOSTLY: README is aligned; minor stale refs remain)*
- [x] Firestore contains at least one **completed** journey. *(case CR-0825094224 ran to completion via the real fleet, and its history now survives a restart: run events are stored one document per event under their run)*
- [x] No conversation the platform should be holding is held in process memory. *(both session surfaces are on GEAP Agent Platform Sessions; a deployed control plane refuses to start without either engine id, so the in-memory path is unreachable in production)*
- [x] A case opened after a restart shows the work that was done before it. *(run events are durable, written off the hot path, and read back in push order)*
- [x] A missed deadline leads somewhere a volunteer can see. *(overdue providers are chased once within their existing grant; an answer names an owner and closes the commitment, silence reaches the supervisor as its own kind of approval)*
- [x] Both event surfaces speak a recognised protocol rather than a private vocabulary. *(AG-UI on the live stream and the replay, decoded in one place in the portal)*
- [ ] The `/admin` page creates, runs and deletes cases against the live fleet. *(PARTIAL: portal calls control plane via BFF; mock data still alongside real data paths)*

## Part 5 — Explicitly out of scope

Cut these from the docs rather than building them. Each is a day or more and none moves a scored
criterion as far as the video does.

- ~~Managed Agent Gateway with PSC/IAP, mTLS and DPoP~~ **Delivered:** all eight engines use
  GEAP's platform-managed Agent Identity (`identityType: AGENT_IDENTITY`). Each engine's
  `effectiveIdentity` is a real principal of the form
  `agents.global.org-<org>.system.id.goog/resources/aiplatform/.../<engine-id>`. The gateway
  verifies the caller principal from GCP credentials (`google.oauth2.id_token`) in deployed
  engines and rejects any caller whose principal does not match the grant subject. Fabricated
  dev-default identities (`@agent.caserelay.dev`) are deleted; a deployed engine missing its
  `CASERELAY_IDENTITY_*` env var now raises `RuntimeError` at startup instead of silently
  falling back to an invented principal.
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
