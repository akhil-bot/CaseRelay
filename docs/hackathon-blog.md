---
title: A volunteer inherits a case that is already late
published: false
tags: gemini, googlecloud, agents, hackathon
canonical_url:
---

I created this piece of content for the purposes of entering the All Things Agentic Hackathon. #AllThingsAgenticHackathon

A CASA volunteer does not start a child's services. They inherit them.

Someone else already called the school, the clinic, legal aid, the shelter, and family services. The volunteer sits down with a file that is seventeen days old and has to find out which of those five promises still have an owner.

That is the job I built CaseRelay for. It is a governed agent fleet on [Gemini Enterprise Agent Platform](https://docs.cloud.google.com/gemini-enterprise-agent-platform) — my [Fortified Enterprise Fleet](https://allthingsagentichackathon.devpost.com/) entry. Eight agents chase those agencies. Twice in the run below they refuse to move until a person clicks. Once, nobody is at the keyboard and the case starts itself.

The children, the agencies, and the partner replies are fictional. No real child data. No CASA endorsement.

## The file is already late

Maya's packet is not new work. Education's deadline lapsed the day it was written. Legal's lapsed three days before that. Five referrals are in flight. None of them have a name the volunteer can call.

The real job is not "send five emails." It is: inherit promises someone else already made, then spend the next week asking which ones still have an owner — without handing the school a medical file, and without letting any agent decide that for you.

So the fleet has to do three things a chatbot never has to:

1. Stop, and wait for a named person, before anyone is contacted.
2. End the run on purpose when an agency asks for time, and come back later with nobody watching.
3. Stop again when a reply reaches outside its scope, and leave the commitment open until a person decides.

The rest of this post is that one case. I will name the GEAP product at the moment it fires, not in a catalogue up front.

<!-- screenshot: portal — Maya case header after intake, five commitments, education already overdue -->

## Intake reads the packet, then the fleet stops

Intake opens Maya's file, extracts five commitments, and proposes five authority grants. Then it stops.

The case page puts a card over the feed: **Waiting on you — approve activation for Maya.** Until a named human clicks, nobody contacts a school. The field that will later say who approved does not exist yet. No agent in this fleet can approve its own work.

That intake step is not a prompt in a notebook. It is its own [Agent Runtime](https://docs.cloud.google.com/gemini-enterprise-agent-platform/build/runtime) reasoning engine — `intake_authority` — one of eight, each a separate long-running host in `us-central1`. Agent Runtime is the managed box the agent lives in: deploy the code, get an engine, keep identity and egress on the platform.

<!-- screenshot: portal — Waiting on you, approve activation for Maya -->
<!-- screenshot: GCP — Agent Runtime, intake_authority engine -->

Click **Approve & activate**. A second run starts. Firestore writes `granted_by: advocate` onto each grant. That string is the identity the portal sent from the button. `POST /v1/approvals/{id}/decide` returns 400 without `decided_by`. There is no default.

<!-- screenshot: GCP — Firestore authority_grants, granted_by: advocate -->

## Five agencies at once, each on a short leash

Five specialist engines go out together, over A2A. Each one has its own [Agent Identity](https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/agent-identity-overview) — a platform-managed, SPIFFE-based principal (`identityType: AGENT_IDENTITY`), not a shared service account. The education engine cannot answer as the health engine. The quarantine later will name the verifier, not "system".

Each specialist also sees only the fields its grant allows. That cut is ours: an authority gateway in application code. Grant in, fields out. Education gets name, date of birth, referral id. Not medical notes. Not legal strategy. If it asks for a field it does not hold, the call is denied and a `denial` event is written. Maya never hits that path — her failure is inbound, not outbound — but the same rule is sitting under every call in this run.

Four agencies come back named and done, in any order: David Chen at the clinic, Anna Reed at legal aid, Tom Barnes at the shelter, Maria Lopez at family services.

Education comes back neither done nor refused. Lincoln Unified asks for more time. Its counsellor is not free. It wants to be given longer.

<!-- screenshot: portal — four agencies named; Lincoln Unified asked for more time -->

## The run ends on purpose

The fleet does not push. Education goes to `deferred`. An audit event records the promise to return. The last line in the feed is *Checkpoint saved — this run is ending. 5 scheduled pushes will resume Maya's case as each commitment comes due.*

The run process is gone. The case is not. Durable state lives in Firestore: the commitments, the grants, the wake times. Agent Runtime hosted the engines. It is not what persisted this case, and it is not what will wake it.

<!-- screenshot: portal — Checkpoint saved, this run is ending -->
<!-- screenshot: GCP — Firestore workflow_checkpoints, state waiting, a future due_at -->

Then the feed goes quiet. That silence is the point.

[Cloud Scheduler](https://cloud.google.com/scheduler) sweeps once a minute, finds the checkpoints that have come due, and publishes to [Pub/Sub](https://cloud.google.com/pubsub). An authenticated push starts a third run. Nobody clicked anything. On the reference run the gap was 23 seconds. It can be anything up to a minute.

A separator lands — *Checked back Ns later* — then a reconciliation (1 overdue, 4 on track) and the line the last run promised: *Checking back with Lincoln Unified School District on Maya's school enrollment — they asked for more time.*

The return time is the fleet's own deadline, written before the previous run died. The school said "end of week." Nothing parsed that string.

<!-- screenshot: portal — Checked back Ns later, then the school check-back -->
<!-- screenshot: GCP — Cloud Scheduler job that publishes the sweep -->

## The school answers the wrong question

The reply comes back. Before anyone acts on it, the safeguarding verifier fetches the callback.

The text is an instruction to retrieve Maya's medical records. Nothing to do with enrolling her.

That payload goes through [Model Armor](https://docs.cloud.google.com/model-armor/overview) — Google Cloud's screen for model prompts and responses against injection, jailbreak, and sensitive-data rules. The template is `caserelay-screen`. It uses [Sensitive Data Protection](https://docs.cloud.google.com/sensitive-data-protection/docs/sensitive-data-protection-overview) Advanced Config against inspect template `caserelay-cross-scope`: custom dictionary detectors plus a hotword rule, so "medical notes" in a summary does not trip, but "retrieve Maya's medical notes" does.

Screening fails closed. The verifier opens an escalation in its own platform identity. The instruction is never carried out.

<!-- screenshot: portal — verifier screening, then quarantine -->
<!-- screenshot: GCP — Model Armor template caserelay-screen -->

Then the system stops a second time. **Waiting on you — approve escalation for Maya.** School enrollment is still open. Nobody has chased the district. No coordinator has been found. Nothing further happens until a person decides.

<!-- screenshot: portal — Waiting on you, approve escalation for Maya -->

## A named person at the school, and what the platform remembers

Click **Approve escalation**. Firestore writes `decided_by: advocate`. A fourth run picks the case up on the same grant that covered the original request.

The first try comes back unresolved: *Lincoln Unified could not resolve Maya's school enrollment.* Then *Sarah Miller has taken on Maya's school enrollment.* That name, Enrollment Coordinator, is written back onto the packet. Education closes. Five for five.

<!-- screenshot: portal — could not resolve, then Sarah Miller has taken on -->
<!-- screenshot: GCP — Firestore human_approvals, decided_by: advocate -->

The session is written to [Memory Bank](https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/memory-bank) — Agent Platform's long-term store. Facts are extracted from a session, scoped to an identity, recalled on a later one. CaseRelay maps `case_id` onto that identity slot, so Maya's notes cannot leak into another child's file. Recalled facts are injected only on wake, nudge, and follow-up. A `memory_injected` audit event records which ones entered which phase.

Be honest about this run: a case you created two minutes ago has almost nothing to recall. The reference Maya walkthrough showed no *Recalled N notes* row. The write is real. The recall that changes a later decision is proven on a longer-lived case, not on this compressed one.

<!-- screenshot: GCP — Memory Bank retrieve, scoped to one case_id -->

Four runs. Three seams. Two of the seams are a person clicking. The one in the middle is a timer. That is the only claim in this project that is shown rather than described: the run that ends in Firestore is not the run that comes back.

## The receipt the fleet did not write

Every specialist engine's outbound traffic is bound to [Agent Gateway](https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/gateways/agent-gateway-overview) — Google's egress control point, `caserelay-egress`. TLS is intercepted. If the call is MCP, the method name is parsed. Policy is checked. The result is logged.

[Cloud Trace](https://docs.cloud.google.com/gemini-enterprise-agent-platform/optimize/observability/traces) shows a waterfall the platform emitted: `MCP send tools/call` as the root, then `apply_guardrail "Google Cloud Model Armor"`, with `gen_ai.security.policy.name: caserelay-screen` and the decision type on the span. Those spans are Google's. [Agent Observability](https://docs.cloud.google.com/gemini-enterprise-agent-platform/optimize/observability/overview) is the layer that collects them. [Cloud Logging](https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/runtime/logging) holds the gateway request log.

This is not a picture of the agents thinking. ADK does not export an execution trace. It is a picture of the calls leaving them, and of Model Armor ruling on those calls. The same `caserelay-screen` template the verifier called in application code also runs in-line on egress, fail-closed.

Two different things are called a gateway. The authority gateway is ours: grant in, fields out. Agent Gateway is Google's: every engine's outbound call, intercepted and logged. Fan-out from the control plane to the specialist engines does not pass through it. Egress from those engines does.

<!-- screenshot: GCP — Cloud Trace waterfall, apply_guardrail Google Cloud Model Armor -->
<!-- screenshot: GCP — Agent Gateway caserelay-egress, engines bound -->

## Eight agents, one job each

All eight agents run `gemini-3.5-flash`. Each is its own Agent Runtime engine.

| Agent | What it does on Maya | What it must not do |
| --- | --- | --- |
| Continuity orchestrator | Drive the phases. Hold no raw partner records. | Contact an agency. Approve anything. |
| Intake | Read the packet. Extract five commitments. Propose five grants. | Activate the case. |
| Education | Ask Lincoln Unified about enrollment. Name, DOB, referral id. | Read health, legal, or family fields. |
| Health | Ask the clinic about the appointment. | Diagnose. Read clinical notes. |
| Legal | Ask legal aid about the referral. | Give advice or strategy. |
| Shelter | Ask about a bed. | Rank placements. |
| Family services | Ask about the assessment slot. | Score risk. Publish findings. |
| Safeguarding verifier | Screen the school callback. Open the escalation. | Clear its own quarantine. |

A Maya run puts six of those on the wire over A2A: the five specialists and the verifier. Orchestrator and intake run in-process on the control plane for this scenario. Their engines are deployed and their cards resolve. They do not log during this run. The honest sentence is: eight engines, six of them on the wire here.

The control plane is Cloud Run. The engines are Agent Runtime. Specialists are reached through `CASERELAY_URL_*`, each resolving its own A2A card. They cannot transfer the turn to a sibling.

[Agent Platform Sessions](https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/sessions) hold turn history for one interaction — `caserelay-chat-sessions` for the operator chat, `caserelay-run-sessions` for each orchestrator phase. A deployed control plane refuses to start without both. The activity feed is not stored there. Sessions have no watch API and a 300-append-per-minute cap a five-way fan-out can hit, so run events live in Firestore, one document per event, written off the hot path.

[Agent Registry](https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/agent-registry) is the organisation catalogue: eight A2A cards at version `1.0.0`, two partner MCP servers, fourteen Gateway egress endpoints. Nothing in a run reads it. The catalogue answers "how would another team find these agents?" It does not route them.

![CaseRelay multi-agent mesh](diagrams/caserelay-multi-agent-mesh.png)

How the GEAP products sit on that path:

![CaseRelay GEAP path](diagrams/caserelay-geap-e2e-light.png)

<!-- screenshot: GCP — Agent Engines list, eight reasoning engines plus two session stores and Memory Bank -->
<!-- screenshot: GCP — Agent Registry, Agents tab, eight cards at version 1.0.0 -->

## The stack

| Layer | What we used |
| --- | --- |
| Models | Gemini 3.5 Flash on Vertex AI. Gemma 4 writes a short run summary onto some records — not shown in the portal, never a decision. |
| Agents | Google ADK. Eight reasoning engines on Agent Runtime in `us-central1`. A2A to the specialists. |
| Platform | Agent Identity, Agent Gateway, Agent Registry, Agent Platform Sessions, Memory Bank, Model Armor + Sensitive Data Protection, Agent Observability. |
| Control plane | Python, FastAPI, Cloud Run (auth-required). |
| State and wake | Firestore. Cloud Scheduler once a minute. Pub/Sub to resume a parked case. |
| Portal | Next.js, local. AG-UI for chat and the run stream. |
| Partners | Simulated. Not live school or clinic systems. |

The model can draft the next chase. It cannot approve a case, clear a quarantine, or read a field it was not granted.

## Building it

Maya's packet is seventeen days old. I could not wait seventeen days to see if the case came back. The first version of the demo just told the orchestrator it was "day 17" and hoped that counted. It did not — nothing was waiting, so nothing woke. The fix was boring: write a real checkpoint with a short due time, let Cloud Scheduler sweep it, and resume from Firestore. That is why the film uses a 10-second window. The packet is still the inherited one. The clock is compressed so a person can watch the same path.

The other thing that bit us was treating a running process as the case. Redeploy Cloud Run and the activity feed went empty, even though the case was still there. So each run event became its own Firestore document, and the wake is Scheduler → Pub/Sub → a new run against that store. Agent Runtime hosts the engines. It is not what held Maya while nobody was looking.

We also dropped the `/demo/maya` shortcuts and the silent in-process fallback. If the control plane cannot reach a specialist, it fails at startup. The laptop can still assemble the fleet in one process. Cloud Run cannot pretend it did.

## The same rule, two other failures

Maya's school answers, and answers out of scope. That is one failure. Two others are implemented. They are not this film.

**Rosa.** The education agent asks for a field outside its grant. The authority gateway strips it and writes a `denial` with `denied_field` set. Education received `child_name`, `dob`, and `referral_id`. No medical fields left the store. Maya's school *sends* a cross-scope ask; Model Armor stops the inbound payload. Rosa's specialist *requests* a cross-scope field; the grant denies it before any partner sees the extra data. Same child-protection rule. Opposite direction.

**Priya.** The clinic does not reply. It does not reply to the chase either. The follow-up ladder Maya uses has nowhere to land. The supervisor is told, as a notice, that health is still silent. "Nobody replied" and "the reply reached outside its scope" need different things from a volunteer, so this is not a safeguarding gate. The other four commitments still close.

<!-- screenshot: rosa — denial audit event with denied_field -->
<!-- screenshot: priya — supervisor_notice, health unanswered, four others closed -->

## Disclosures

Maya, Rosa, and Priya are fictional. The agencies are fixtures. No real child data, and no CASA or court endorsement. CaseRelay follows up on referrals; it does not place a child, file a petition, or make a welfare decision. The portal runs locally. Partners are simulated. Memory Bank is on, but a two-minute Maya run has almost nothing useful to recall yet.

## What I learned

The part worth keeping is not five agencies lighting up. It is that the run can end, wait, and come back with nobody at the keyboard — and that a person still has to click before anyone is contacted, and again when a reply goes out of scope. Everything else is in service of those two stops and that one restart.

## Video, repo, Cloud Run

The demo film is the same Maya path: inherit the late case, hold both gates, hold the silence where the case wakes itself, hold the chase that names Sarah Miller, then the console receipts — `granted_by`, `decided_by`, a waiting checkpoint, the Model Armor span, the eight engines and the three platform stores.

**Demo video:** not recorded yet. Add the public YouTube or Vimeo URL here before submission.

**Repo:** [github.com/akhil-bot/CaseRelay](https://github.com/akhil-bot/CaseRelay) (private). Setup is in the [README](https://github.com/akhil-bot/CaseRelay/blob/main/README.md).

**Control plane:** [caserelay-control-plane-6nwo7o4bbq-uc.a.run.app](https://caserelay-control-plane-6nwo7o4bbq-uc.a.run.app) — Cloud Run, auth-required. Unauthenticated calls return 403.

**Portal:** local only. `npm run dev` on port 3000.
