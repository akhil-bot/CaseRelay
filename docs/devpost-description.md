# CaseRelay — Devpost Submission Text

## The Problem

When a child in foster care is referred to a school, a clinic, legal aid, and a shelter simultaneously, no single system tracks whether all of those commitments were acted on. A referral can sit unowned for weeks. A CASA volunteer inherits a case whose referrals were made by someone else and has to find out which of five promises from five agencies still have an owner — without leaving a spreadsheet in their car or checking email three times a day. Handoffs disappear not through negligence, but through lack of coordination infrastructure.

## What It Does

CaseRelay closes that gap with an accountable, governed multi-agent fleet.

**The cycle:** A volunteer activates monitoring after verifying court authority. Eight ADK agents on Vertex AI Agent Runtime delegate scoped tasks to five simulated partner agencies over authenticated A2A. Four confirm. One defers and the system writes down when to come back. The run ends there on its checkpoints rather than holding a session open. No user prompt arrives. Cloud Scheduler sweeps every minute, finds checkpoints that have come due, publishes to Pub/Sub, and the case resumes itself — the same checkpoint logic, same authority grant, no human at the keyboard. The Education Agent requests only enrollment-status fields through Agent Gateway. The partner tries to retrieve medical notes. Model Armor quarantines it. The Safeguarding Verifier opens an escalation showing evidence, recipient, and policy basis, and records the quarantine against its own platform identity. The run parks with school enrollment still open. A supervisor approves. Only then does the scoped follow-up go out. The district is chased once within the same authority grant that covered the original request. It names the enrollment coordinator who has taken the referral on. That name is written back. The commitment closes. Had nobody answered, the supervisor would have been told instead.

The flagship case is called Maya. She is not the only scenario. A provider that goes silent ends up in front of a named human. A school asks for medical records while answering a question about enrollment. A partner reply cannot be parsed. Each scenario was run end to end against the deployed control plane on 29 August 2026, verified twice on two serving revisions. Where a scenario does not do what its definition claims, that is stated rather than omitted.

**Boundaries:** CaseRelay makes no placement, custody, safety-risk, clinical, or eligibility decisions. It neither replaces existing case-management systems nor creates an unrestricted cross-agency child profile. It is not autonomous emergency response.

**Architecture discipline:** Eight agents deployed as Vertex AI reasoning engines, each with a platform-managed Agent Identity and a scoped data projection. None of the eight runs on Cloud Run; the control plane, the portal and the partner MCP server do. The eight have:
- **Continuity Orchestrator** — operational facts only; cannot activate or contact anyone
- **Intake & Authority Agent** — extracts commitments; cannot activate without supervisor
- **Education Liaison Agent** — enrollment status only; no health/legal/family data
- **Health Coordination Agent** — appointment status only; no diagnoses or clinical notes
- **Legal Aid Agent** — referral/status only; no legal advice or strategy
- **Shelter Status Agent** — availability/status only; cannot rank placements
- **Family Services Agent** — scheduling/status only; no risk scores or findings
- **Safeguarding Verifier** — policy enforcement; cannot approve its own actions

The control plane is auth-required. The portal is deployed to Cloud Run behind a session login page. Both are production deployments; both stay live through the judging period (Oct 1, 2026).

## How It Was Built

**Runtime cycle:** Agent Runtime runs the engines. Firestore holds the case state — commitments, grants, checkpoints. Cloud Scheduler sweeps every minute, finds checkpoints that have come due, and publishes to Pub/Sub. An authenticated push resumes a waiting case. The checkpoint / sleep / deadline-triggered resume cycle is Firestore plus Pub/Sub push and Cloud Scheduler, not Agent Runtime itself.

**Security:** Each specialist gets its own Agent Identity — a platform principal, not a shared service account. The education engine cannot answer as the health engine. Field-level access control is CaseRelay's own code, called the authority gateway — it is not Agent Gateway, which is Google's egress control point.

Each specialist sees only its allowed fields. Education gets name, DOB, referral ID. Not medical notes or legal strategy.

The school's reply goes through Model Armor with Advanced Config referencing a Cloud DLP template that uses custom dictionary detectors and hotword proximity rules. Screening fails closed. Agent Gateway intercepts every outbound call. MCP method names are parsed and checked against policy.

**Observability:** Cloud Trace shows the calls leaving the engines and Model Armor ruling on them. Agent Observability collects the spans. Cloud Logging holds the gateway request log. This is a picture of the perimeter — ADK Agent Runtime does not export its own execution spans, and the control plane and engine traces do not share a trace context.

**State and wake:** The run event log stays on Firestore, not Agent Platform Sessions, because the activity feed and audit trail need an ordered, live, permanent record. Sessions orders events by timestamp alone with no sequence field and no documented tiebreak; offers no streaming API; caps appends at 300 per minute per project; and requires every session to carry an expiry.

Agent Platform Sessions hold the operator chat transcript and every orchestrator agent turn, one session per phase invocation. The chat transcript uses `caserelay-chat-sessions`; the agent run sessions use the `caserelay-orchestrator` engine (the reasoning engine already deployed for agent execution also serves as the session host). A deployed control plane refuses to start without both engine IDs configured rather than falling back to in-memory sessions that look identical until the instance recycles.

**Memory:** Memory Bank is scoped per case, with three custom memory topics. The recalled content so far is general process observations rather than operationally specific intelligence, because a compressed end-to-end demo re-executes orchestrator phases that the specialists already handled. A two-minute case has little worth recalling yet. The write is real.

**Production code:** Python, FastAPI, Cloud Run for control and portal. Next.js, TypeScript for the frontend. An authenticated BFF proxy mints Google-signed ID tokens server-side; no credential reaches the browser. AG-UI carries both the operator chat endpoint and the run event stream.

## Google Cloud Technologies Used

- **Agent Runtime** — eight reasoning engines in `us-central1` hosting the fleet
- **Agent Identity** — platform-managed identity per agent; SPIFFE-style principals; caller principal verified at the gateway
- **Agent Gateway** — all eight engines bound to `caserelay-egress`; outbound traffic TLS-intercepted; MCP method deny policy enforcing
- **Agent Registry** — 24 registered services, auto-registered and updated by `agents-cli deploy`
- **Agent Platform Sessions** — `caserelay-chat-sessions` for chat transcripts; `caserelay-orchestrator` engine for agent run transcripts
- **Memory Bank** — instance `8631858420611284992` via ADK's `VertexAiMemoryBankService`, scoped per case
- **Model Armor** — template `caserelay-screen` with SDP Advanced Config referencing a Cloud DLP inspect template; fails closed
- **Agent Observability** — Cloud Trace carries Google-generated spans for MCP tool calls and Model Armor evaluations traversing Agent Gateway; demonstrated end-to-end on 2026-08-31 (trace `442a845a56a86c50ee5d35be1891cdd7`); the current serving configuration routes partner calls through the in-process simulator (`CASERELAY_PARTNER_MCP=0`)
- **ADK** — Agent Development Kit; reasoning engines, A2A, MCP integration
- **A2A** — Agent-to-Agent communication; authenticated cross-engine routing
- **Gemini 3.5 Flash** — all eight agents; model string `gemini-3.5-flash`
- **Gemma 4** — end-of-run session narrative (`gemma-4-26b-a4b-it-maas`); observed on serving revision
- **Cloud Run** — control plane and portal
- **Firestore** — named database `caserelay`; checkpoint storage, event log, audit trail
- **Cloud Scheduler** — one-minute sweep for checkpoint due dates
- **Pub/Sub** — authenticated push delivery to resume parked cases
- **Cloud Trace** — MCP tool call spans and Model Armor guardrail evaluation spans (demonstrated end-to-end; see trace `442a845a56a86c50ee5d35be1891cdd7`)
- **Cloud Logging** — gateway request log
- **Sensitive Data Protection** — Cloud DLP integration with Model Armor template

## Challenges

**Silence is the failure mode.** Nothing in a run looks it up — the catalogue is for discovery only, not routing. A missing reply looks exactly like a reply that has not come yet, and it keeps looking like that until a court date arrives. Any system that only reacts to inbound events will never notice. CaseRelay uses Cloud Scheduler to sweep on its own schedule, fired by Pub/Sub, with nobody staring at a screen.

**Wake is architecture, not duration.** A long-running agent is not a long-running call. It is Firestore checkpoints, Cloud Scheduler sweeps, and Pub/Sub messages resuming parked work. If the process dies, the call ends; the case does not.

**Governance lives in the tool surface, not the prompt.** The orchestrator had an `activate_case` tool and the prompt said the supervisor signed off. The model approved its own work anyway. Removing the tool from the available set fixed it — you cannot invoke what the model cannot see.

**Guardrails need a stated failure mode.** Google's sample for Model Armor uses `failOpen: true`, which timeouts allow traffic through. For child records, that is wrong. The authority gateway uses `failOpen: false`. Armor errors quarantine the request as a value, not raise — the ADK model can continue past exceptions.

**Measurements that are wrong last longer than wrong code.** Traces were keyed on OpenTel headers, but engines start fresh trace IDs on each resumed run. Custom eval scored 1.0 on hand-written fixtures and 0.0 on the real trace — data said "perfect" when it was not. The verifier is now keyed on its function response and tested to fail.

**Firestore locking.** Agent Platform Sessions row-level-lock only for `DatabaseSessionService`, not `VertexAiSessionService`. Chat transcripts and agent run transcripts each get their own engine to avoid contention.

## What We Learned

Wake is architecture, not duration. Governance lives in the tool surface. Guardrails fail closed. Measurements matter more than the code they measure. The control-plane trace and engine traces share no trace context — that is a platform limitation, not a bug. ADK Agent Runtime does not export its own execution spans. The registry is a catalogue, not a routing layer. Nothing in a run reads it. The eight agents find each other through fixed environment variables on the control-plane revision.

## Demo Video

**[INSERT YOUTUBE/VIMEO URL HERE]**

The video runs the flagship case — intake, activation gate, five-way fan-out, checkpoint, autonomous wake, Model Armor quarantine, escalation gate, supervisor approval, follow-up, and name retrieval. It covers:
- The problem being solved: a volunteer inheriting an already-late case
- The value proposition: five commitments, two human gates, one autonomous wake
- A demo of the app in action: the Maya arc in the portal, with unedited live execution
- Proof the backend runs on Google Cloud: Agent Engines list, Cloud Run dashboard, Firestore documents, Cloud Trace waterfall, Agent Registry

## Resources

- **Repository:** [github.com/akhil-bot/CaseRelay](https://github.com/akhil-bot/CaseRelay)
- **Control plane:** [`caserelay-control-plane-6nwo7o4bbq-uc.a.run.app`](https://caserelay-control-plane-6nwo7o4bbq-uc.a.run.app) — Cloud Run, auth-required
- **Portal:** [`caserelay-portal-6nwo7o4bbq-uc.a.run.app`](https://caserelay-portal-6nwo7o4bbq-uc.a.run.app) — Cloud Run, behind a session login page
- **Architecture diagram:** `docs/diagrams/caserelay-multi-agent-mesh.png` in the repo
- **Spin-up instructions:** [docs/deploy.md](https://github.com/akhil-bot/CaseRelay/blob/main/docs/deploy.md)
- **Full write-up:** [docs/hackathon-blog.md](https://github.com/akhil-bot/CaseRelay/blob/main/docs/hackathon-blog.md)

## Disclosures

**Mock data.** Maya, Rosa, Priya, and all other scenarios use fictional cases and simulated partner agencies, not live school or clinic systems. No real child data.

**No endorsement.** This is a hackathon prototype, not endorsed by CASA or any court.

**Portal is deployed, behind a session login.** Navigate to `/login`, choose any role, and sign in with email `admin@caserelay.com` and the password supplied in the Devpost submission's testing instructions. The pre-filled email on the role pages is a persona placeholder — use `admin@caserelay.com` regardless of which role you choose.

**Compressed runs use the same machinery.** `due_in` compresses the checkpoint deadlines — not the execution path. The run that writes the checkpoints ends and is recorded `suspended`. Cloud Scheduler sweeps once a minute, finds the due checkpoints, and publishes to Pub/Sub. An authenticated push starts a new run with a new `run_id` and new Firestore records. In the filmed case (`CR-0830203440`) the checkpoint run was `84bd42c6b0c4`; the wake run started by the sweep was `411d07c94595`. The gap is whatever remains of the minute: 25 seconds on the reference run (`CR-0830212122`), about ten in the filmed run, never more than 60.

**Memory Bank recall is thin on short runs.** The mechanism is deployed and observed; the recalled content is general process observation rather than named contacts or institutional shortcuts. A compressed demo does not accumulate the history that would produce those.

**Agent reasoning is not traced end to end.** Cloud Trace carries Google-generated spans for MCP tool calls and Model Armor evaluations that traverse the Agent Gateway. ADK Agent Runtime does not export its own execution spans, and the control-plane trace and engine traces share no trace ID. That is a documented platform limitation, not a CaseRelay bug.

**AI use during building.** Gemini 3.5 Flash helped with architecture and ADK API documentation. The work is ours; the foundation is theirs.
