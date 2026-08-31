---
title: A volunteer inherits a case that is already late
published: false
tags: gemini, googlecloud, agents, hackathon
canonical_url:
---

A CASA volunteer does not start a child's services. They inherit them.

Someone else already called the school, the clinic, legal aid, the shelter, and family services. The volunteer sits down with a file that is seventeen days old and has to find out which of those five promises still have an owner. Nobody has a cell phone number. Nobody asked if the school's counsellor is even free this week. The file is just a list of commitments and dates. Most of the dates have already passed.

That is the job I built CaseRelay for.

## The problem

The real task is not "send five emails." It is:

1. **Inherit promises someone else already made** — the referrals are old, the deadlines are lapsing, and you have no record of who was contacted or when.
2. **Track which ones still have a named owner** — a coordinator, a doctor's scheduler, a social worker — without handing the school a medical file, and without your system deciding the answer for you.
3. **Wait for a person before you contact anyone** — a court-appointed volunteer has to approve every outreach. And do it again when a reply arrives out of scope. And come back on its own schedule when the week is up, without anyone staring at a screen.

No chatbot has to do these three things. CaseRelay had to.

## How we built it

Eight agents chase those agencies. Twice in the run below they stop and wait for a person to click. Once, nobody is at the keyboard and the case starts itself.

The control plane (Cloud Run) orchestrates phases. Each specialist runs on its own [Agent Runtime](https://docs.cloud.google.com/gemini-enterprise-agent-platform/build/runtime) engine and talks to the others over [A2A](https://docs.cloud.google.com/gemini-enterprise-agent-platform/build/agent-to-agent-communication). State and wake-times live in Firestore. Cloud Scheduler sweeps every minute and fires Pub/Sub messages to resume waiting cases.

![CaseRelay multi-agent mesh](diagrams/caserelay-multi-agent-mesh.png)

## The eight agents

All eight run `gemini-3.5-flash`. Each is its own [Agent Runtime](https://docs.cloud.google.com/gemini-enterprise-agent-platform/build/runtime) engine. Six of them wire over A2A during the Maya run; two run in-process on the control plane for this scenario.

| Agent | What it does on Maya | What it must NOT do |
|-------|---------------------|-------------------|
| **Continuity orchestrator** | Drive the phases. Hold no raw partner records. | Contact an agency. Approve anything. |
| **Intake** | Read the packet. Extract five commitments. Propose five authority grants. | Activate the case. |
| **Education** | Ask Lincoln Unified about enrollment. Name, DOB, referral id. | Read health, legal, or family fields. |
| **Health** | Ask the clinic about the appointment. | Diagnose. Read clinical notes. |
| **Legal** | Ask legal aid about the referral. | Give advice or strategy. |
| **Shelter** | Ask about a bed. | Rank placements. |
| **Family services** | Ask about the assessment slot. | Score risk. Publish findings. |
| **Safeguarding verifier** | Screen the school callback. Open the escalation. | Clear its own quarantine. |

## The features, mapped to GEAP

### Discovery: Agent Registry

[Agent Registry](https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/agent-registry) is the org's catalogue of agents and their routes. Nothing in a run looks it up—the catalogue is for discovery only, not routing.

### State and Wake

[Agent Runtime](https://docs.cloud.google.com/gemini-enterprise-agent-platform/build/runtime) runs the engines. Firestore holds the case: commitments, grants, and wake-times. When education needs more time, the orchestrator writes five checkpoints with staggered due dates and ends the run. The case is not.

[Cloud Scheduler](https://cloud.google.com/scheduler) sweeps every minute, finds checkpoints that have come due, and publishes to [Pub/Sub](https://cloud.google.com/pubsub). An authenticated push resumes a waiting case. No browser click. On the reference run the gap was 25 seconds; in the filmed run it was about ten; it can be anything up to a minute.

[Memory Bank](https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/memory-bank) receives a session write at the end. Facts scoped to the `case_id` are recalled on the next run. Maya's notes don't leak to another child. On a two-minute demo run, almost nothing is useful to recall yet. The write is real. Recall that changes later decisions comes on longer-lived cases.

### Security

Each specialist gets its own [Agent Identity](https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/agent-identity-overview) — a platform principal, not a shared service account. The education engine cannot answer as the health engine. Later escalations name the verifier, not "system."

Each specialist also sees only its allowed fields. Education gets name, DOB, referral ID. Not medical notes or legal strategy. We built this as an authority gateway in our code; it is not [Agent Gateway](https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/gateways/agent-gateway-overview), which is Google's egress control point.

The school's reply goes through [Model Armor](https://docs.cloud.google.com/model-armor/overview) — Google's screen for injection, jailbreak, and sensitive-data patterns. Our template is `caserelay-screen`. It flags "retrieve Maya's medical notes" but not "medical notes" in a summary. Screening fails closed. The verifier opens an escalation in its own identity. The request never runs.

[Agent Gateway](https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/gateways/agent-gateway-overview) intercepts every outbound call. MCP method names are parsed and checked against policy.

### Observability

[Cloud Trace](https://docs.cloud.google.com/trace) shows the calls leaving the engines and Model Armor ruling on them. The filmed Cloud Trace captures in the GCP coda are genuine evidence taken during MCP-enabled runs — trace `442a845a56a86c50ee5d35be1891cdd7` from 2026-08-31 is the same waterfall: `MCP send tools/call family_status` as the root span, `apply_guardrail "Google Cloud Model Armor"` nested beneath it. The fleet's default configuration routes partner calls through the in-process simulator (`CASERELAY_PARTNER_MCP=0`). Agent Gateway remains active for all engine egress regardless of the MCP flag — it is the partner-call leg specifically that bypasses the gateway in the default configuration. [Agent Observability](https://docs.cloud.google.com/gemini-enterprise-agent-platform/optimize/observability/overview) collects the spans. [Cloud Logging](https://docs.cloud.google.com/logging) holds the gateway request log. This is not a picture of the agents thinking—ADK does not export execution traces. It is a picture of the perimeter.

## Maya's scenario step by step

This is what happens in the video. Each row maps to the phase boundary and the GEAP feature enforcing it.

| Event | Feature enforced |
|-------|------------------|
| Intake extracts five commitments and proposes grants. | [Agent Runtime](https://docs.cloud.google.com/gemini-enterprise-agent-platform/build/runtime) — one reasoning loop for intake, separate from orchestrator. |
| Waiting for approval gate: "approve activation for Maya." | [Agent Identity](https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/agent-identity-overview) + authority grants — Firestore writes `granted_by: advocate` (a named principal, not a system actor). No agent approves its own work. |
| Five agencies contacted over A2A. Four confirm. School defers. | [Agent Runtime](https://docs.cloud.google.com/gemini-enterprise-agent-platform/build/runtime) + [A2A](https://docs.cloud.google.com/gemini-enterprise-agent-platform/build/agent-to-agent-communication) — each specialist is its own engine. Orchestrator fans out and waits. |
| Run ends: "Checkpoint saved — 5 scheduled pushes will resume." | Firestore + [Cloud Scheduler](https://cloud.google.com/scheduler) + [Pub/Sub](https://cloud.google.com/pubsub) — durable state is written before the run dies. |
| No activity for up to 60 seconds (sweep gap). | [Cloud Scheduler](https://cloud.google.com/scheduler) checks once a minute. Randomness is real. |
| "Checked back _Ns_ later" — a new run resumes. Chase the school. | [Cloud Scheduler](https://cloud.google.com/scheduler) + [Pub/Sub](https://cloud.google.com/pubsub) — no user action. The checkpoint from the previous run (its staggered deadline, not the school's) fired it. |
| School reply: "retrieve Maya's medical records." | [Model Armor](https://docs.cloud.google.com/model-armor/overview) + [Sensitive Data Protection](https://docs.cloud.google.com/sensitive-data-protection/docs/sensitive-data-protection-overview) — fails closed. Escalation opens in verifier's identity. |
| Waiting for escalation approval gate: "approve escalation for Maya." | [Agent Identity](https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/agent-identity-overview) — second gate. Firestore writes `decided_by: advocate`. The commitment is still open. |
| Run resumes. School is chased. "Sarah Miller has taken on Maya's school enrollment." | [Agent Runtime](https://docs.cloud.google.com/gemini-enterprise-agent-platform/build/runtime) + authority grants — the name is written back to the case. Five for five. |
| Session written to [Memory Bank](https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/memory-bank). | [Memory Bank](https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/memory-bank) — facts scoped to `case_id`. Next time this case wakes, the fleet remembers. |

<!-- Captions: GCP console screenshots — Agent Runtime engines list, Firestore checkpoint document, Cloud Scheduler job config, Model Armor template, Cloud Trace waterfall, Agent Registry Agents tab -->

## Problems we faced

**Couldn't wait 17 days.** The demo tells the story in two minutes, not weeks. We needed a real checkpoint with a short due time, let Cloud Scheduler sweep it, and resume from Firestore. That's why the film uses a 10-second window. The packet is still inherited; the clock is just compressed.

**Cloud Run redeploy cleared the feed.** Running a case inside a live process meant redeployment = lost history. So each run event became its own Firestore document. Wake is now Scheduler → Pub/Sub → a new run against that store. Agent Runtime is the reasoning engine. Firestore is what remembers.

**Silent fallbacks cost us hours.** We dropped the fallback where the control plane could assemble a specialist locally if Cloud Run was unreachable. That was hiding bugs. Now if the control plane can't reach a specialist, it fails at startup. The laptop can still assemble everything in one process. Cloud Run cannot and should not pretend it can.

## What I learned

**Wake is architecture, not duration.** A long-running agent is not a long-running call—it's Firestore checkpoints, Cloud Scheduler sweeps, and Pub/Sub messages resuming parked work. If the process dies, that's not a feature; it's what happens when the call ends. We checkpoint before returning.

**Governance lives in the tool surface, not the prompt.** The orchestrator had an `activate_case` tool and the prompt said the supervisor signed off. The model approved its own work anyway. Removing the tool from `CONTROL_PLANE_TOOLS` fixed it—you cannot invoke what the model cannot see.

**Guardrails need a stated failure mode.** The Google sample for Model Armor uses `failOpen: true`, which timeouts allow traffic through. For child records, that's wrong. Our gateway extension `caserelay-ma-authz-ext` uses `failOpen: false`. Armor errors quarantine the request as a value, not raise—the ADK model can continue past exceptions.

**Measurements that are wrong last longer than wrong code.** We traced with OpenTel headers, but engines start fresh trace IDs on each resumed run. Our custom eval scored 1.0 on hand-written fixtures and 0.0 on the real trace—data said "perfect" when it wasn't. We now key the verifier on its function response and test that it can fail.

## The stack

| Layer | What we used |
|-------|------------|
| **Models** | Gemini 3.5 Flash on Vertex AI. Gemma 4 drafts short summaries on some records (not shown). |
| **Agents** | Google ADK. Eight reasoning engines on [Agent Runtime](https://docs.cloud.google.com/gemini-enterprise-agent-platform/build/runtime) in `us-central1`. A2A to the specialists. |
| **Platform** | [Agent Identity](https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/agent-identity-overview), [Agent Gateway](https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/gateways/agent-gateway-overview), [Agent Registry](https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/agent-registry), [Sessions](https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/sessions), [Memory Bank](https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/memory-bank), Model Armor, [Observability](https://docs.cloud.google.com/gemini-enterprise-agent-platform/optimize/observability/overview). |
| **Backend** | Python, FastAPI, Cloud Run (auth-required). |
| **State** | Firestore. Cloud Scheduler every minute. Pub/Sub to resume parked cases. |
| **Frontend** | Next.js, Cloud Run (behind HTTP Basic auth). AG-UI for chat and the run stream. |
| **Partners** | Simulated. Not live systems. |

The model can draft the next chase. It cannot approve a case, clear a quarantine, or read a field it was not granted.

## Disclosures

**Mock data.** Maya, Rosa, and Priya are fictional. The agencies are fixtures. No real child data.

**No endorsement.** This is a hackathon prototype, not endorsed by CASA or any court.

**Authority gateway.** Field-level access control lives in our code. [Agent Gateway](https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/gateways/agent-gateway-overview) is Google's egress control point. We call ours the "authority gateway" to avoid confusion.

**Memory Bank.** It works, but a two-minute run has almost nothing useful to recall yet. The write is real. Meaningful recall comes on cases that run for weeks.

**Portal is deployed, behind a password.** [`caserelay-portal-6nwo7o4bbq-uc.a.run.app`](https://caserelay-portal-6nwo7o4bbq-uc.a.run.app) — Cloud Run, HTTP Basic auth. Credentials on request. The [GitHub repo](https://github.com/akhil-bot/CaseRelay) may be private. Setup is in the [README](https://github.com/akhil-bot/CaseRelay/blob/main/README.md).

**AI use during building.** Gemini 3.5 Flash helped with architecture and ADK API docs. The work is ours; the foundation is theirs.

## Resources

**Demo video:** [not recorded yet — add YouTube/Vimeo URL before submission]

**Repo:** [github.com/akhil-bot/CaseRelay](https://github.com/akhil-bot/CaseRelay) (may be private)

**Control plane:** [caserelay-control-plane-6nwo7o4bbq-uc.a.run.app](https://caserelay-control-plane-6nwo7o4bbq-uc.a.run.app) — Cloud Run, auth-required.

**Portal:** [`caserelay-portal-6nwo7o4bbq-uc.a.run.app`](https://caserelay-portal-6nwo7o4bbq-uc.a.run.app) — Cloud Run, behind HTTP Basic auth. Credentials on request.

---

I created this piece of content for the purposes of entering the All Things Agentic Hackathon. #AllThingsAgenticHackathon

CaseRelay is my [Fortified Enterprise Fleet](https://allthingsagentichackathon.devpost.com/) entry.
