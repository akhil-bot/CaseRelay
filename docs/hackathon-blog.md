---
title: A volunteer inherits a case that is already late
published: false
tags: gemini, googlecloud, agents, hackathon
canonical_url:
---

I created this piece of content for the purposes of entering the All Things Agentic Hackathon. #AllThingsAgenticHackathon

CaseRelay is my [Fortified Enterprise Fleet](https://allthingsagentichackathon.devpost.com/) entry. It is a governed agent fleet for CASA and GAL programs: court-appointed volunteers who inherit a child's referrals and have to find out which agencies actually followed through.

The volunteer portal is local (`localhost:3000`). It is not hosted. The control plane is on Cloud Run at [caserelay-control-plane-6nwo7o4bbq-uc.a.run.app](https://caserelay-control-plane-6nwo7o4bbq-uc.a.run.app). That URL is real and auth-required. Unauthenticated calls return 403. The GitHub repo is [github.com/akhil-bot/CaseRelay](https://github.com/akhil-bot/CaseRelay). It is private today. Share it with `testing@devpost.com` and `cloudhackathons@google.com` for judging.

Everything below is fictional children, fictional agencies, and a simulated partner layer. No real child data. No CASA endorsement.

<!-- screenshot: admin chat — Create a case for maya with deadline 10s -->

## A volunteer inherits a case that is already late

Maya's file is not new work.

A CASA volunteer opens it and finds five referrals already in flight: school, clinic, legal aid, shelter, family services. Education's deadline lapsed the day the packet was written. Legal's lapsed three days before that. The case is seventeen days old when a person finally sits down with it.

That is the real job. A court-appointed volunteer does not start a child's services. They inherit promises someone else already made, then spend the next week asking which ones still have an owner.

CaseRelay's flagship run is this inherited case. In the demo it is the `maya` scenario. The portal's scripted walkthrough labels it CR-1042. A live create from the admin lab mints a new case id. Either way the packet is the same: five commitments, some already late, and a school that will answer the wrong question.

<!-- screenshot: Maya case header after intake — five commitments, education already overdue -->

## It stops twice, then chases without being asked

Intake reads the packet. It extracts five commitments and proposes five grants. Then it stops.

The case page shows a full-width card: **Waiting on you — approve activation for Maya.** No agent in the fleet can approve its own work. Until a named human clicks, nobody contacts a school. The field that will later say who approved does not exist yet.

Click **Approve & activate**. A second run starts.

Five specialist engines go out at once. Each one sees only the fields its grant allows. Health comes back with a named clinic contact. Legal names a legal-aid officer. Shelter and family services close. Education comes back red. Lincoln Unified answered — and asked for Maya's medical records.

That reply is refused twice. The education liaison is instructed to reject an out-of-scope ask and report the commitment blocked. Then the safeguarding verifier fetches the same callback and sends it through [Model Armor](https://docs.cloud.google.com/model-armor/overview), Google Cloud's service for screening model prompts and responses against injection, jailbreak, and sensitive-data rules. The template is `caserelay-screen`. It uses [Sensitive Data Protection](https://docs.cloud.google.com/sensitive-data-protection/docs/sensitive-data-protection-overview) Advanced Config against inspect template `caserelay-cross-scope`: custom dictionary detectors plus a hotword rule, so "medical notes" in a summary does not trip, but "retrieve Maya's medical notes" does. Screening fails closed. The verifier opens an escalation in its own platform identity. The instruction is never carried out.

The deadline had already lapsed, so the fleet does not wait to be asked. It chases Lincoln Unified on the same grant that covered the original request. This time Sarah Miller, Enrollment Coordinator, takes the referral. That name is written back onto the packet. Education closes.

Then the system stops a second time. **Waiting on you — approve escalation for Maya.** A quarantined reply needs a person. The run parks. Nothing further happens until someone decides.

<!-- screenshot: gate card — Waiting on you, approve escalation for Maya -->
<!-- screenshot: red education row, then the two follow-up lines naming Sarah Miller -->

Approve the escalation. A third run writes the session into memory. Five for five.

The three runs are real. What separates them is a human decision, not a timer. At the compressed demo deadline the wake is serviced inside the second run. Cloud Scheduler still sweeps every minute in the deployed project, and a `waiting` checkpoint is the proof that deferred work exists. The film should not pretend the volunteer watched an overnight wake.

## Who decided, who was denied, what the platform remembers

Open Firestore, database `caserelay`, after a live Maya run.

`cases/{id}/authority_grants/{grant}` has `granted_by: advocate`. That is the identity the portal sent from the activation button. Until the click, the field is absent and the case stays in draft.

`cases/{id}/human_approvals/{approval}` has `decided_by: advocate`. The verifier opened the escalation. A named human released it. `POST /v1/approvals/{id}/decide` returns 400 without `decided_by`. There is no default.

Each specialist engine has its own [Agent Identity](https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/agent-identity-overview) — a platform-managed, SPIFFE-based principal (`identityType: AGENT_IDENTITY`), not a shared service account. The quarantine audit event names the verifier engine, not "system".

The same run leaves a receipt the fleet did not write. [Agent Gateway](https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/gateways/agent-gateway-overview) is Google's egress control point: every bound engine's outbound traffic is TLS-intercepted and policy-checked. All eight CaseRelay engines bind to `caserelay-egress`. [Cloud Trace](https://docs.cloud.google.com/gemini-enterprise-agent-platform/optimize/observability/traces) shows a waterfall the platform emitted: `MCP send tools/call` as the root, then `apply_guardrail "Google Cloud Model Armor"`, with `gen_ai.security.policy.name: caserelay-screen` and the decision type on the span. Those spans are Google's. [Agent Observability](https://docs.cloud.google.com/gemini-enterprise-agent-platform/optimize/observability/overview) is the GEAP layer that collects them, with [Cloud Logging](https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/runtime/logging) holding the gateway request log (`method`, TLS interception, policy result).

<!-- screenshot: Firestore granted_by / decided_by on a live case -->
<!-- screenshot: Cloud Trace waterfall — apply_guardrail Google Cloud Model Armor -->

[Memory Bank](https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/memory-bank) is Agent Platform's long-term store: facts extracted from a session, scoped to an identity, recalled on a later one. CaseRelay maps `case_id` onto that identity slot so Maya's notes cannot leak into another child's file. Recalled facts are injected only on wake, nudge, and follow-up, and a `memory_injected` audit event records which ones entered which phase.

On the compressed Maya walkthrough, recall is not guaranteed. Run 1 is intake only and writes nothing to the bank. The place this is proven end to end is a different case, below.

## Two other failures

Maya's school answers, and answers out of scope. That is one failure mode. Two others are implemented and checked. They are not the film.

### Rosa — the field the school is not allowed to see

Rosa's education agent asks for a field outside its grant.

CaseRelay's authority gateway — application code, not Google's Agent Gateway — strips what the caller cannot have and writes a `denial` audit event with `denied_field` set. On the verified rosa run, education received only `child_name`, `dob`, and `referral_id`. No medical fields were disclosed.

This is the zero-trust check Maya never hits. Maya's school *sends* a cross-scope ask; Model Armor quarantines the inbound payload. Rosa's specialist *requests* a cross-scope field; the grant denies it before any partner sees the extra data. Same child-protection rule. Opposite direction.

<!-- screenshot: rosa denial audit event with denied_field -->

### Priya — the clinic that never answers

Priya's clinic does not reply. It does not reply to the chase either.

The same follow-up ladder Maya uses now has nowhere to land. Phase `10-unanswered` fires. The supervisor is told, as a `supervisor_notice`, that health is still silent. Policy basis is `missed_deadline` and `unanswered_followup`, kept separate from a safeguarding escalation because "nobody replied" and "the reply reached outside its scope" need different things from a volunteer. The notice is not a gate on the machine. The other four commitments still close.

Maya's school is the opposite failure: it answers. Narrating Priya over Maya footage would be a lie. The path is the same chase, the same grant, the same audit trail. The trigger is silence.

<!-- screenshot: priya supervisor_notice — health unanswered, four others closed -->

### CR-0828195744 — what the platform actually recalled

Do not delete `CR-0828195744`. It is the only case with surviving memories on Memory Bank instance `8631858420611284992`.

On run `de73dabce1d4`, one recalled memory (topic `unblocking_strategies`) was injected into `5-wake` at 2026-08-28T20:22:57Z and into `8-followup` at 20:23:21Z. The retrieve call is the Vertex API against that engine, scoped to `app_name: caserelay` and `user_id: CR-0828195744`.

The recalled content is a process-level observation, not a named contact or an institutional shortcut. The compressed demo re-runs orchestrator phases the specialists already handled, so the bank sees procedure, not partner detail. The mechanism is deployed, audited, and observed. It has not yet been shown to change a later decision. Say that.

<!-- screenshot: memories:retrieve JSON for CR-0828195744 -->

## Eight engines, one gateway

Eight agents, all `gemini-3.5-flash`, each a separate [Agent Runtime](https://docs.cloud.google.com/gemini-enterprise-agent-platform/build/runtime) reasoning engine in `us-central1`. Agent Runtime is the managed host for long-running agents: deploy the code, get a reasoning engine, keep identity and egress on the platform.

| Engine | Job | What it must not do |
| --- | --- | --- |
| Continuity orchestrator | Drive phases. Hold no raw partner records. | Contact an agency. Approve anything. |
| Intake | Extract commitments. Propose grants. | Activate a case. |
| Education | Enrollment status. Name, DOB, referral id. | Read health, legal, or family fields. |
| Health | Appointment status. | Diagnose. Read clinical notes. |
| Legal | Referral status. | Give advice or strategy. |
| Shelter | Bed availability. | Rank placements. |
| Family services | Assessment scheduling. | Score risk. Publish findings. |
| Safeguarding verifier | Screen the school callback. Open the escalation. | Clear its own quarantine. |

A Maya run invokes six of those over A2A: the five specialists and the verifier. Orchestrator and intake run in-process on the control plane. Their engines are deployed and their cards resolve. They do not log during this scenario. "Eight engines, six of them on the wire here" is the sentence that survives a log check.

[Agent Registry](https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/agent-registry) is the organisation catalogue: publish, version, discover. CaseRelay writes eight A2A agent cards (version `1.0.0`), two partner MCP servers, and the Gateway egress endpoints. Nothing in a run reads the registry. Specialists are reached through `CASERELAY_URL_*`. The catalogue answers "how would another team find these agents?" It does not route them.

[Agent Platform Sessions](https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/sessions) hold turn history for one interaction. CaseRelay uses two dedicated engines: `caserelay-chat-sessions` for the operator chat, `caserelay-run-sessions` for each orchestrator phase. A deployed control plane refuses to start without both. The activity feed is not stored there. Sessions have no sequence field, no watch API, and a 300-append-per-minute cap a five-way fan-out can hit. Run events live in Firestore, one document per event, written off the hot path.

The mesh:

![CaseRelay multi-agent mesh](diagrams/caserelay-multi-agent-mesh.png)

How the GEAP products sit on that path:

![CaseRelay GEAP path](diagrams/caserelay-geap-e2e-light.png)

Two different things are called a gateway. The authority gateway is ours: grant in, fields out. Agent Gateway is Google's: every engine's outbound call, intercepted, method-parsed if it is MCP, policy-checked, logged. Fan-out from the control plane to the specialist engines does not pass through it. Egress from those engines does.

## What it is not

Partners are simulated. Lincoln Unified, Riverbend, Statewide Legal Aid, Harborlight, and Mesa County Family Services are fixtures. They prove routing, grants, quarantine, and chase — not school-district operations.

The portal is local. `caserelay-portal.web.app` is not live. Several portal screens still render mock data: `/registry`, `/approvals`, and case ids from the fixture list including CR-1042. Live cases are the ones the admin lab or the chat creates. Do not open the mock pages and call them proof.

Recalled memories so far are process-level. Memory Bank is real. The content is not yet operationally specific.

The fleet must not file a petition, pay a bill, place a child, close a claim, write a diagnosis, or rank a shelter bed. It coordinates minimum-necessary follow-up and stops when a person has to decide. No agent can self-approve. No unrestricted cross-agency child profile. No emergency response.

Gemma 4 writes a two-to-four-sentence run summary onto the run record (`gemma_summary`) after some live runs — observed on `4732b1f2c9d8`, `de73dabce1d4`, and `e8f76a62c196`. The portal does not display it. It is a rewrite of structured events, not a decision.

## Video, repo, Cloud Run

The demo film is the same Maya path this post walks: inherit the late case, hold both gates, hold the chase that names Sarah Miller, then show `granted_by`, `decided_by`, a waiting checkpoint, the Model Armor span, and the eight engines.

**Demo video:** not recorded yet. Add the public YouTube or Vimeo URL here before submission. First four minutes only.

**Repo:** [github.com/akhil-bot/CaseRelay](https://github.com/akhil-bot/CaseRelay) (private). Setup is in the [README](https://github.com/akhil-bot/CaseRelay/blob/main/README.md).

**Control plane:** [caserelay-control-plane-6nwo7o4bbq-uc.a.run.app](https://caserelay-control-plane-6nwo7o4bbq-uc.a.run.app) — Cloud Run, auth-required.

**Portal:** local only. `npm run dev` on port 3000.

**DEV.to:** publish this file. Paste the live article URL back into the README when it exists.

What I would keep on the next build is the same line the gates already enforce. The product is not the five agencies lighting up. It is the two times the fleet refuses to move, and the one time it chases a lapsed deadline without being asked.
