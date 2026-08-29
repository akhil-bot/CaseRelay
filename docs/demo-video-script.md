# Demo Video Script — Product Demo Segment

**Segment length:** 2:20 (hard ceiling 2:30)
**Follows:** intro (~55 s) covering the problem, the CASA volunteer, and the architecture.
**Video total:** ~3:05 plus any outro.

---

## Before you record

> ### Use `10s` as the deadline. Nothing longer. This is the one thing that will ruin a take.
>
> The chat prompt in Beat 1 is `Create a case for maya with deadline 10s`. **Anything longer is a
> race, and you can lose it.** `schedule_wake` spaces the five per-commitment checkpoints across
> the window it is given, at `now + due_in × (i+1)/5`, so the earliest lands at `due_in / 5`. The
> wake phase then has to arrive *after* that moment or it finds nothing due and the run stalls.
> Across three real runs the engine took **7.4 s, 10.5 s and 11.6 s** to get from the checkpoint
> phase to the wake phase — that spread is what you are betting against.
>
> At `10s` the earliest checkpoint is due at +2 s, so it has always lapsed by the time the wake
> phase asks. Safe every time. At `45s` it is +9 s, which lands squarely inside that 7–12 second
> spread: sometimes it works, sometimes it doesn't, and you will not find out until ninety seconds
> into the take. At `60s` it is +12 s and usually fails. When it does fail, quarantine, nudge and
> memory never become reachable and no escalation gate appears.
>
> A longer deadline looks more realistic and gambles the take on engine latency. Do not raise it.
> A run that works once at `45s` has not disproved this — it has won a coin toss.
>
> *(If a run does stall mid-take, do not abandon it immediately. See "Second run stalls" in "If
> something goes wrong during recording" — the scheduler may rescue it within a minute.)*

Every Console page is slow on first load. Open these **before** pressing record.

| Tab | What to load | Used in |
|-----|-------------|---------|
| Portal | `localhost:3000/admin`, chat panel open | Beat 1 |
| Firestore (cases) | Console → Firestore → database **caserelay** → `cases` collection | Beat 5 |
| Firestore (checkpoint) | Deep-link: `https://console.cloud.google.com/firestore/databases/caserelay/data/panel/workflow_checkpoints/wf-CR-0828195744-health?project=caserelay` — confirm the document loads with `state: "waiting"` and a future `due_at` | Beat 5 |
| Cloud Trace | Console → Trace list → filter `span:"MCP send"` → open one trace showing the waterfall (`MCP send tools/call …` root → `apply_guardrail "Google Cloud Model Armor"` → request/response paths). Zoom browser to 150 % for legibility | Beat 6 |
| Agent Engines | Console → Vertex AI → Agent Engines (us-central1) — eight reasoning engines plus three platform stores: `caserelay-run-sessions`, `caserelay-chat-sessions`, and `caserelay-memory-bank`. Eleven rows total | Beat 7 |
| Agent Registry | Console search bar → **Agent Registry** → project picker **caserelay** → **Agents** tab, region `us-central1`. Confirm eight rows, every one at version `1.0.0`. **This is the real GCP console. It is not the portal's `/registry` page, which is mock data.** Before you open it, read the "Safe to delete" warning in Beat 7 | Beat 7 |

If Cloud Trace shows no MCP spans, run the Maya scenario once before recording to generate them.

**Recording plan.** Record beats 1–4 (portal) as one session. Note the case ID. Then record beats 5–7 (Console tabs) as separate clips, navigating Firestore to the case from your run. Assemble and speed-ramp in editing.

---

## The script

Read the narration naturally. If you stumble, use your own words. The pace matters more than exact phrasing.

**A note on the captions.** Beats carry a **Caption:** line where a Google product is doing the thing the viewer is watching. These are added in the edit, not spoken. A judge scoring against the Fortified Enterprise Fleet technology list needs to map each moment to the product behind it; the narration should not do that job, because a voiceover that recites product names stops sounding like a person telling you about a child and starts sounding like a data sheet. Put the product names on screen and keep them out of the voice.

Style: single-line lower third, bottom-left, clear of the browser chrome and of the activity feed column. Sentence case, no more than about seven words, muted — a label, not a chyron. Fade in over ~0.3 s, hold, fade out. Captions cost no runtime.

Only three product names are spoken in the whole film: Model Armor (Beat 3), Memory Bank (Beat 4), and Agent Gateway (Beat 6, again in Beat 7's closing inventory). In each the name is the subject of the sentence rather than an ornament on it — the sentence would lose its meaning without it. Everything else is attributed on screen. Do not add a fourth spoken name.

---

### Beat 1 — Pick up a case already running · [0:00 → 0:12]

**Screen:** Portal admin page, chat panel on the right.

**Action:** Type into chat: `Create a case for maya with deadline 10s` → send. Wait for the case ID (~2 s). Type: `Run it` → send. Portal navigates to the case detail page.

**Edit:** Real speed.

**Narration:**

> Five referrals across five agencies — some already past their deadline. Let's see who followed through and who didn't.

*Write down the case ID — you need it for the proof shots.*

*The case is not new, and the narration must not suggest it is. The referral packet is backdated 17 days: education's deadline lapses the moment the case is created and legal's went three days ago. This is a volunteer inheriting work in flight, which is the real CASA situation. The feed's own opening line says so — "Opening Maya's case and reviewing every open commitment."*

---

### Beat 2 — The system stops · [0:12 → 0:38]

**Screen:** Case detail page. Gate card above the activity feed.

**Action:** Do nothing. Wait for intake to finish and the gate card to appear — **Waiting on you — approve activation for Maya** (amber top stripe, pulsing lock icon). Real time: 15–45 s.

**Edit:** Speed-ramp the intake scroll to ~5 s. Hold at real speed once the gate card is visible. Frame the gate card explicitly and hold there.

**Caption** (fades in as the intake rows begin scrolling, holds ~3 s):

> `Agent Runtime — intake_authority engine`

**Narration** (over the speed-ramp):

> Intake found five commitments in Maya's case file.

**Narration** (gate card visible, real speed):

> And it stops. It will not contact a single agency until a human approves. No agent in this fleet can approve its own work. The gate is a full-width card — nothing can bypass it.

**Action:** Click **Approve & activate**.

> Approved.

*Staging: you play one operator for both gates. The portal has a single persona (`advocate`) — no supervisor login exists. The card displays "Deciding as advocate," and `"advocate"` is what Firestore records. Do not pretend to switch roles or open a second window. The claim is that agents cannot self-approve and the gate requires an explicit human identity; one person taking both decisions is the honest version of that claim. Important: `useLiveRunEvents` marks the run terminal on `run_completed` (the gate's state), but the activity feed can still show "All steps complete" while the gate says "Waiting on you" — frame the gate card and make clear which is on screen.*

---

### Beat 3 — Five agencies, one bad reply, one chase · [0:38 → 1:19]

**Screen:** Same page. Second run starts. Five completion lines appear in the feed — education, health, legal, shelter, family services — showing outcomes in arbitrary order. After those, in this order: the wake rows, the quarantine row, then two follow-up rows, then the feed stops at a second gate card — **Waiting on you — approve escalation for Maya** (amber top stripe, pulsing lock icon).

**Action:** Do nothing. Real time: 2–5 min.

**Edit:** Speed-ramp the completion rows to ~10 s (they show organization names and outcomes, not "Contacting" states). Hold 2 s on the red education row when it appears. Speed-ramp through the wake and quarantine rows. **Then hold at real speed for ~4 s on the two follow-up rows: "Chasing Lincoln Unified on Maya's school enrollment." and "Sarah Miller has taken on Maya's school enrollment."** Hold at real speed for ~10 s once the escalation gate card is visible. Frame the gate card explicitly.

**Caption** (fades in as the first completion row lands, holds ~3 s):

> `Five Agent Runtime engines · A2A over published agent cards`

**Caption** (only if a "Recalled _N_ notes from earlier work on Maya's case" row appears near the top of the run — it is conditional on the previous run having written memories; holds ~3 s over that row and its quoted previews):

> `Memory Bank — recall from the previous run`

**Narration** (over the completion rows speed-ramp):

> Five agents, five agencies, running concurrently. Each one sees only the fields its scope allows. These are the results as they came back — not the agencies' names disappearing and reappearing.

**Narration** (red education row):

> Education came back blocked.

**Narration** (the two follow-up rows, real speed):

> Nobody had to ask. The deadline had already lapsed, so the fleet chased the school on its own — and this time Sarah Miller picked the referral up.

**Narration** (escalation gate card, real speed):

> The school's response asked for Maya's medical records — outside its scope. Model Armor caught it, fail-closed. The verifier quarantined the reply. The system stopped and is now waiting for a human decision on what to do next.

**Action:** Click **Approve escalation**.

*Why this beat is worth 4 extra seconds: those two rows are the only place in the film where the fleet notices a missed deadline and acts on it without being asked. They are also why Beat 4 can say "five for five" — the fifth commitment closes here, not in the third run. Do not cut them to save time; cut Beat 6's hold instead.*

*Captions in this beat: **do not caption the fan-out with Agent Gateway.** The Gateway governs egress from the deployed engines; the fan-out you are watching is A2A from the control plane and does not pass through it. The Gateway's evidence is Beat 6 and only Beat 6. Also note that the caption cue points here are pinned to the current event order — when the escalation gate moves to fire immediately after the quarantine, re-check where the fan-out caption lands before the edit is locked.*

---

### Beat 4 — Closed · [1:19 → 1:24]

**Screen:** Third run starts. Memory and close-out phases. The latest run summary card expands with all five commitments and their status badges.

**Edit:** Speed-ramp to the final run summary card. Hold at real speed once fully visible.

**Narration:**

> Third run. The session is summarized and written to Memory Bank. Five for five — all commitments completed.

*Note: Gemma generates a natural-language session summary stored in the run record, but the portal does not display it. The summary is maintained in the data layer only. The visible proof of completion is the run summary card in the feed, which lists all five commitments with their final statuses.*

---

### Beat 5 — Proof: who decided, and what persists · [1:24 → 1:52]

**Screen:** Firestore console, database `caserelay`.

**Action:** Navigate to `cases/{your case ID}/authority_grants/` → click any grant document.

**Edit:** Real speed. Hold 3 s on the `granted_by` field.

**Narration:**

> `granted_by: advocate`. That's who clicked the button. Until a person acts, this field doesn't exist.

**Action:** Navigate to `human_approvals/` → click the escalation record. Hold 3 s on the `decided_by` field.

**Narration:**

> `decided_by: advocate`. A named agent enforced it. A named human released it.

**Action:** Switch to the pre-opened checkpoint tab (`wf-CR-0828195744-health`). Hold 3 s — the viewer reads `state: "waiting"` and `due_at: September 4, 2026`.

*This checkpoint is from `CR-0828195744`, the preserved demo asset, not the case you just recorded. It has `waiting` checkpoints with real future dates. The fresh case's 10 s deadline means its checkpoints were consumed inside the run you filmed, so it has nothing left in `waiting` to show. The narration does not name either case ID, so a viewer watching at normal speed will not notice the switch.*

**Narration** (start it over the tab switch — the navigation is dead air today):

> `state: waiting`, due September 4th. Cloud Scheduler sweeps every minute for checkpoints that have come due, and pushes a wake through Pub/Sub. When this one fires, the case resumes with nobody at the keyboard.

*This is the only place in the film that claims deferred execution, and this document is the only evidence offered for it. That is deliberate. Say it as a described capability — a sweep that runs, a wake that will fire — never as something the viewer just watched happen. Nothing in Beats 1–4 demonstrates an autonomous wake: at a 10 s deadline the wake is serviced inside the run, and the run boundaries in the feed are the two moments you clicked a gate. See "What this film does not claim" below before you improvise around this line.*

---

### Beat 6 — Proof: the infrastructure vouches · [1:52 → 2:05]

**Screen:** Cloud Trace console, pre-opened on the waterfall trace. Browser at 150 % zoom.

**Action:** The waterfall shows 4–5 spans: `MCP send tools/call …` as the root, `apply_guardrail "Google Cloud Model Armor"` underneath, request/response paths below that. Point at (or let the viewer read) `gen_ai.security.policy.name: caserelay-screen` and `gen_ai.security.decision.type` on the guardrail span.

**Edit:** Real speed. Hold 8–11 s — shortened from 12–15 s to pay for the follow-up hold in Beat 3. The narration is the same length; what goes is the silent tail after it, not any of the reading time.

**Caption** (fades in with the waterfall, holds ~4 s):

> `Agent Observability — spans emitted by the platform`

**Narration:**

> These spans are Google's, not ours. Agent Gateway intercepted the MCP call, ran Model Armor inline, and recorded the policy and the ruling. The guardrail is handled by the platform. The infrastructure enforces the boundary — not the agents for themselves.

*The narration already names Agent Gateway and Model Armor, so the caption names the thing it doesn't: the trace itself. Do not stack a second caption naming the two products the voice has already said — the point of a caption is to add an attribution the ear did not get.*

---

### Beat 7 — Close · [2:05 → 2:20]

**Screen:** Three shots inside the beat. **(a)** Vertex AI Agent Engines list — eight reasoning engines (orchestrator, intake, verifier, and five specialists) plus three platform stores: `caserelay-run-sessions`, `caserelay-chat-sessions`, and `caserelay-memory-bank`. Eleven rows total. **(b)** Agent Registry console, **Agents** tab. **(c)** The completed case page in the portal.

**Edit:** 4 s on the engines list → cut → 4 s on the Registry Agents tab → cut → 7 s on the completed case page. 15 s total, unchanged.

**Caption** (a) — a static block on the cut to the engines list, holds the full 4 s:

> ```
> Agent Runtime · 8 engines
> Agent Platform Sessions · 2 stores
> Memory Bank · 1 store
> Agent Identity · one platform principal per engine
> ```

**Caption** (b) — on the cut to the Registry, holds the full 4 s:

> `Agent Registry — every agent catalogued and versioned`

*These are the scoring shots — five product names across two cuts. It is the one place in the film where that density is right, because the viewer is looking at an inventory and a judge is filling in a checklist. Keep the names on screen and out of the voice.*

**The Registry shot — what is actually there.** Verified against `agentregistry.googleapis.com` for `projects/caserelay/locations/us-central1`. **24 services total**, in three kinds:

| Kind | Count | What they are |
|---|---|---|
| Agents (`agentSpec`, type `A2A_AGENT_CARD`) | **8** | `education_liaison`, `family_services`, `health_coordination`, `intake_authority`, `legal_aid`, `continuity_orchestrator`, `shelter_status`, `safeguarding_verifier` — display names read "CaseRelay Education Liaison (A2A)" and so on. Every one at version **`1.0.0`**, all last updated 2026-08-28 |
| MCP servers (`mcpServerSpec`) | **2** | "CaseRelay Partner MCP (fleet hostname)" and "CaseRelay School Partner (Lincoln Unified SIS)" |
| Endpoints (`endpointSpec`, `caserelay-ep-*`) | **14** | The Gateway's egress destinations: Vertex AI (5 regional/global/mTLS variants), Firestore ×2, Cloud Logging ×2, Telemetry ×2, Model Armor, Resource Manager, Agent Registry |

**Shoot the Agents tab, not the full service list.** Per Google's documentation the Agents tab lists name, identifier, type, description, version, runtime and location — so eight rows and a version column, which is exactly the claim. The Endpoints tab is a separate tab and is not this shot.

> **Before you record, look at the education row.** Its Registry description currently reads
> **"EXPERIMENTAL manual A2A registration test. Safe to delete."** It is left over from the first
> manual registration and it will appear in the description column on camera. Either fix it or frame
> the shot so the description column is off-screen. The fix is one call and does not touch any code:
>
> ```bash
> curl -X PATCH -H "Authorization: Bearer $(gcloud auth print-access-token)" \
>   -H "Content-Type: application/json" \
>   "https://agentregistry.googleapis.com/v1/projects/caserelay/locations/us-central1/services/caserelay-education-a2a?updateMask=description" \
>   -d '{"description":"School enrollment specialist. Name, DOB, referral ID only."}'
> ```
>
> Also **do not click into the education agent card.** Its `query_school` skill description still
> reads "variant: status | poison | enroll" — stale, and the word "poison" on screen invites a
> question you do not want to answer in fifteen seconds. The list view is the shot.

*What this shot claims and does not. Agent Registry is a catalogue: `deploy_fleet.sh` writes each engine's `agentSpec` to it, versions are carried there, and the partner MCP servers are registered alongside with per-agent IAM. It is **not** how agents find each other at runtime — that is `CASERELAY_URL_*` environment variables. The caption says "catalogued and versioned" for that reason and must never say routing, discovery-at-runtime, or service mesh. What the shot answers is the category's first question: how would an organisation discover the agents you are running? By opening this page.*

**Narration** (same length as before; the Registry cut lands on the second sentence):

> Eight agent engines, coordinated across a platform holding two session stores and a memory bank. Platform-managed identities, and a catalogue of every agent the organisation runs. All outbound traffic from every engine routes through Agent Gateway — every call is identity-authenticated, policy-checked, and logged. Twice in this run, the system stopped and waited for a court-appointed volunteer to decide.

---

## Timing total: 2:20

| Beat | In → out | Length |
|------|----------|--------|
| 1 — Pick up a case already running | 0:00 → 0:12 | 12 s |
| 2 — The system stops | 0:12 → 0:38 | 26 s |
| 3 — Five agencies, one bad reply, one chase | 0:38 → 1:19 | 41 s |
| 4 — Closed | 1:19 → 1:24 | 5 s |
| 5 — Who decided, and what persists | 1:24 → 1:52 | 28 s |
| 6 — The infrastructure vouches | 1:52 → 2:05 | 13 s |
| 7 — Close | 2:05 → 2:20 | 15 s |
| | | **140 s = 2:20** |

*The follow-up hold added 4 s to Beat 3 and Beat 6's hold gave 4 s back, so the total is unchanged. Beat 5 absorbs its longer checkpoint narration by starting it over the tab switch, which is currently silent. Beat 7 stays at 15 s and now splits three ways internally — 4 s engines list, 4 s Agent Registry, 7 s completed case page — the Registry shot paid for by the portal tail, which was a soft landing under a 4-second closing sentence and did not need eleven. There is 10 s of headroom against the 2:30 ceiling and it should stay there — heavy speed-ramping on Beats 2–4 is what buys it. If a take overruns, cut Beat 6's hold further or tighten Beat 5's three holds from 3 s to 2 s. Do not cut the Beat 3 follow-up rows.*

---

## What this film does not claim

Read this once before recording. Some things are true of the system and **not** true of the footage, and others are true of a different scenario. Conflating either with what is on screen is the easiest way to make an honest project look overstated.

| The claim | Status | Where it may be made |
|---|---|---|
| The fleet wakes itself on a schedule, with no user session | Real, deployed: Cloud Scheduler sweeps every minute, publishes to Pub/Sub, an authenticated push starts a resumed run | **Beat 5 only**, narrated as a capability, evidenced by the `state: "waiting"` checkpoint document |
| An autonomous wake occurs during the recorded run | **False at a 10 s deadline**, which is the deadline you are recording at. The earliest checkpoint has already lapsed when the wake phase asks for it, so the wake is serviced in-process inside the second run and Cloud Scheduler and Pub/Sub never fire on camera. The one exception is a sweep-rescued take (see troubleshooting) — there the scheduler genuinely does wake the case on screen, but that take has a dead gap in it and you are unlikely to ship it | Nowhere, in a clean take |
| The "Checked back _N_s later" separators between runs prove the case slept and resumed on its own | **False.** A separator is drawn at every `run_id` transition and its number is the wall-clock gap. In this demo the successor run is started immediately by the gate approval, so that number is how long you took to click the button | Nowhere — do not point at one, do not zoom on one, do not narrate one |
| The case is new, and the five referrals go out during the demo | **False.** The packet is backdated 17 days. Education's deadline lapses at creation and legal's lapsed three days ago; the referrals were sent long before the volunteer arrived. This is inherited work, and it is the stronger story — the fleet's job is catching up on promises someone else made | Beat 1, as "some already past their deadline." Never "let's start a case" or "watch it send five referrals" |
| An agency went silent and the supervisor was told about it | **False for Maya.** Her school *replies* — with a cross-scope request for medical records, which is why it is quarantined rather than chased for silence. `unanswered()` and `notify_supervisor` never fire in this run | Nowhere. **If a judge asks:** the silent-provider path is fully implemented and uses the same follow-up infrastructure you just watched — same chase, same grant, same audit trail. It fires on a different trigger, a provider that does not answer the follow-up at all, and it is demonstrated by the Priya scenario, where the clinic times out. Maya's school is the opposite failure: it answers, and answers out of scope |

The three runs are real and the run boundaries are real. What separates them is a human decision, not a timer. Say "the system stopped and waited for a person" — which is Beat 2, Beat 3 and Beat 7, and is a strength — and leave the sleeping-and-resuming claim to Beat 5 where there is a document backing it.

**Attributions deliberately withheld.** Where a product is not named, the omission is a choice rather than an oversight. **Agent Gateway** is captioned only in Beat 6, because it governs egress from the deployed engines and the Beat 3 fan-out does not pass through it. **Agent Registry** has its own shot and caption in Beat 7, but only as a catalogue — it holds every engine's `agentSpec` at version `1.0.0`, two partner MCP servers and fourteen egress endpoints, and it is not consulted at runtime, so its caption may sit over the list page and nowhere else, and never over a moment of routing. **The evaluation run** is attributed nowhere: it was created by direct API call, no console page lists it, and a caption pointing at a product the viewer cannot see is worse than silence. If a judge asks about evaluation, answer it out of band.

Maya's own story is narrower than the fleet's capabilities, and narrating the capabilities over her footage is what turns a true claim into an overstated one. What she actually demonstrates: inherited work with lapsed deadlines, a partner that answers out of scope, a quarantine, two human gates, and a self-initiated chase that closes the last commitment. That is enough.

---

## Optional beat — Memory Bank (adds ~15 s)

Include only if you land under 2:00. Uses case **CR-0828195744**, the preserved demo asset — the only case with surviving Memory Bank memories.

**Screen:** Terminal.

**Action:** Run:

```bash
curl -s -X POST \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  "https://us-central1-aiplatform.googleapis.com/v1beta1/projects/caserelay/locations/us-central1/reasoningEngines/8631858420611284992/memories:retrieve" \
  -d '{"scope":{"app_name":"caserelay","user_id":"CR-0828195744"},"simple_retrieval_params":{"page_size":5}}'
```

**Narration:**

> Three weeks from now, when Maya's case wakes up, the fleet remembers. Each fact scoped to her case, nobody else's.

*Honest constraint: the recalled content is process-level observations, not operational specifics. Show that the mechanism works; don't claim it changed behavior.*

---

## Do not show on camera

| Screen | Why |
|--------|-----|
| `/registry` (the **portal** page) | Renders mock data from `portal/src/lib/mock/agents.ts`. Beat 7 has a genuine Agent Registry shot — that one is the **GCP console**, reached from the console search bar, and it is a different tab entirely. If you find yourself on `localhost:3000/registry`, you are on the wrong one |
| `/approvals` | Renders mock data from `portal/src/lib/mock/approvals.ts` |
| Any case ID from `portal/src/lib/mock/cases.ts` (e.g. CR-1042) | Routes to the scripted walkthrough, not live data |
| Left-nav "Approvals" item | Links to the mock approvals page |
| Any Vertex AI Evaluation page (Models → Evaluation, Agent Builder → Agents → Evaluation tab) | Our evaluation run was created by direct API call, not through the console flow, so no console evaluation page will list it |

---

## If something goes wrong during recording

| What you see | What to do |
|-------------|-----------|
| Feed sits on "Opening the case…" for 30+ s | Normal cold start. Let the speed-ramp absorb it. |
| Stream ends with only intake events | That's the activation gate. Go to `/cases/CR-XXXX` and approve. |
| Feed stops after nudge, no escalation gate card | Give it ~20 s for the poll. If nothing, reload the page — it stops polling once the run parks. |
| Second run stalls — no quarantine, no follow-up rows, no escalation gate | You used a deadline longer than `10s` and lost the race: the earliest checkpoint was still in the future when the wake phase asked, so nothing woke. **Do not abandon the take yet.** Those checkpoints are still sitting in Firestore and they do come due — the once-a-minute Cloud Scheduler sweep will find them and push a wake that starts a fresh run. In an observed `60s` run the rescue landed 21 s after the empty wake and the arc then completed normally: quarantine, escalation gate, follow-up, all five commitments closed. **Wait up to a minute before deciding.** Rescued footage has a conspicuous dead gap in the middle, so whether it is usable is your judgement call — but a take that was going well is worth a minute of waiting. If it does not recover, or the gap is unusable, start a fresh case at `10s`. |
| Education shows "unresolved" instead of "blocked" | Either outcome is valid. The quarantine still fires in phase 6. |
| "4 of 5 commitments fulfilled" at the end | A timing race. Refresh the case detail — the stored state is correct. |
| Cloud Trace waterfall is hard to read at your resolution | Zoom browser to 150 % before recording the trace tab. The waterfall is only 4–5 spans — at 150 % the `apply_guardrail` span and its labels are legible. |
| Third run ends with "Some steps still open" instead of "All steps complete" | A Model Armor 403 hit the memory phase (occurs on ~29% of runs). The run is trapped in `partial_failure` state and the gate card will never appear. Reload the page, wait for the dust to settle, and start a fresh case for a clean take. The run state persists, but does not block future runs on the case. |

---

## Appendix — agent roster (INTERNAL REFERENCE, NOT NARRATION)

> **Do not read this on camera and do not show it on screen.** It is a crib sheet for answering
> questions about the fleet, not part of the film. Nothing here belongs in the 2:20 runtime.

Eight agents, all `gemini-3.5-flash`, all deployed as separate Vertex AI reasoning engines.
Verified against `backend/agents/` — if a claim here disagrees with the source, the source wins.

| Agent (ADK `name`) | Does | Tools (exact) | Reached by | In the Maya run |
|---|---|---|---|---|
| `continuity_orchestrator` | Drives the run phase by phase. Holds no raw records. | Per-phase grant from `CONTROL_PLANE_TOOLS`: `schedule_wake`, `wake_workflow`, `check_overdue`, `send_followup`, `notify_supervisor`, `preload_memory`. `get_commitment_states` is attached to every phase. Plus the six agents below as `AgentTool`s. | Control plane builds it in-process per phase (`build_for_run`); also published at `/a2a/orchestrator/.well-known/agent-card.json` | Every phase after intake |
| `intake_authority` | Reads the referral packet, extracts commitments, proposes grants. Cannot activate a case. | `read_referral_packet`, `validate_packet`, `add_commitment`, `propose_grant`, `finalize_intake` | Control plane imports and runs it in-process for the intake phase; card at `/a2a/intake/…` (used by the fleet health probe and the operator CLI) | Beat 2 — five commitments, five proposed grants, then the activation gate |
| `safeguarding_verifier` | Screens the school callback through Model Armor and opens the escalation. Fails closed; never changes a commitment status. | `inspect_school_callback`, `open_escalation` | `RemoteA2aAgent` → `$CASERELAY_URL_VERIFIER/a2a/verifier/.well-known/agent-card.json` | Phase `6-quarantine` — Beat 3's escalation gate |
| `education_liaison` | Lincoln Unified enrollment. Refuses out-of-scope asks and reports `blocked`. | `get_authorized_context`, `query_school`, `submit_enrollment_status` | `RemoteA2aAgent` → `$CASERELAY_URL_EDUCATION/a2a/education/…` | The red row in Beat 3; re-chased in the nudge phase |
| `health_coordination` | Riverbend appointment status only. No diagnosis or notes. | `get_authorized_context`, `query_clinic`, `submit_appointment_status` | `RemoteA2aAgent` → `$CASERELAY_URL_HEALTH/a2a/health/…` | Completes in Beat 3 |
| `legal_aid` | Statewide Legal Aid referral status. No strategy or advice. | `get_authorized_context`, `query_legal_aid`, `submit_legal_status` | `RemoteA2aAgent` → `$CASERELAY_URL_LEGAL/a2a/legal/…` | Completes in Beat 3 |
| `shelter_status` | Harborlight bed availability. No placement rankings. | `get_authorized_context`, `query_shelter`, `submit_shelter_status` | `RemoteA2aAgent` → `$CASERELAY_URL_SHELTER/a2a/shelter/…` | Completes in Beat 3 |
| `family_services` | Mesa County assessment scheduling. No findings or risk scores. | `get_authorized_context`, `query_family_services`, `submit_family_status` | `RemoteA2aAgent` → `$CASERELAY_URL_FAMILY/a2a/family/…` | Completes in Beat 3 |

**Scope each specialist is granted** (set by intake, enforced by the Gateway on `get_authorized_context`):

| Specialist | Purpose | Allowed fields | Legal basis |
|---|---|---|---|
| education | `verify_school_enrollment` | `child_name`, `dob`, `referral_id` | `ferpa_court_order` |
| health | `check_appointment_status` | `appointment_status`, `provider_name`, `appointment_date` | `hipaa_signed_authorization` |
| legal | `check_referral_status` | `case_reference`, `deadline` | `state_juvenile_court_order` |
| shelter | `check_availability` | `referral_id`, `scheduling` | `state_juvenile_court_order` |
| family_services | `check_assessment_schedule` | `assessment_scheduling` | `state_juvenile_court_order` |

Notes worth having ready:

- The five specialists and the verifier all set `disallow_transfer_to_peers=True`. They cannot hand work to each other; only the orchestrator routes.
- In control-plane mode (`CASERELAY_CONTROL_PLANE=1`) a missing `CASERELAY_URL_*` raises rather than falling back to an in-process copy, so the deployed fleet can never be silently bypassed.
- The orchestrator is handed only the tools the current phase needs. Withholding the rest is what stops one phase from running ahead into the next.
- Neither the orchestrator nor intake holds a partner tool, and IAM on the partner MCP server deliberately excludes both principals.
