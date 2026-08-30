# Demo Video Script — Product Demo Segment

**Segment length:** 2:45 (hard ceiling 2:50)
**Follows:** intro (~55 s) covering the problem, the CASA volunteer, and the architecture.
**Video total:** ~3:40 against a 3:50 ceiling.

---

## Before you record

> ### Use `10s` as the deadline. Nothing longer. This is the one thing that will ruin a take.
>
> The chat prompt in Beat 1 is `Create a case for maya with deadline 10s`. **Anything longer is a
> gamble on which checkpoints happen to be due when the sweep lands.**
>
> Here is the mechanic you are betting on. During the fan-out run, `schedule_commitment_checkpoints`
> writes one wake per commitment, spaced across the window it is given, at
> `now + due_in × (i+1)/5` — so at `10s` they fall at +2 s through +10 s. That run then saves state
> and **ends on purpose** (Beat 3's last row). Cloud Scheduler sweeps once a minute and fires only
> the checkpoints that are already past due. At `10s`, all five lapsed while the fan-out was still
> talking to agencies, so the very next sweep fires them and the case resumes into the wake phase
> with education overdue. That is Beat 4, and it is the beat the whole film is built on.
>
> At a longer deadline the later checkpoints are still in the future when the run ends. The sweep
> fires whatever is due and the resumed run can arrive *before* education's check-back is due —
> it reconciles nothing, chases nobody, and the arc never reaches the quarantine or the second gate.
> You will not find out until two minutes into the take.
>
> *(The e2e harness at `infra/_maya_e2e.py` does run Maya at `45s` and does pass. It also POSTs
> `/v1/workflows/sweep` by hand every ten seconds. On camera you get one sweep a minute and no way
> to force it. The harness is not evidence that `45s` is safe to film.)*
>
> *(If a run does stall mid-take, do not abandon it immediately. See "The feed ends at 'Checkpoint
> saved'" in "If something goes wrong during recording" — the next sweep may still rescue it.)*

**Budget up to a minute of dead air in the middle of the take.** Between the fan-out run ending and
the wake starting, the case is genuinely waiting on the once-a-minute sweep. In the reference run
that gap was 23 s; it can be anything from a second to a full minute. Do not touch the browser
during it, do not reload, and do not stop recording. That gap is Beat 4's evidence, and you cut it
down in the edit.

Every Console page is slow on first load. Open these **before** pressing record.

| Tab | What to load | Used in |
|-----|-------------|---------|
| Portal | `localhost:3000/admin`, chat panel open | Beat 1 |
| Firestore (cases) | Console → Firestore → database **caserelay** → `cases` collection | Beat 7 |
| Firestore (checkpoint) | Deep-link: `https://console.cloud.google.com/firestore/databases/caserelay/data/panel/workflow_checkpoints/wf-CR-0830155744-health?project=caserelay` — open the document and confirm it still reads `state: waiting` with `due_at: 2026-09-06`. If it has fired, pick any other `waiting` row from `workflow_checkpoints` | Beat 7 |
| Cloud Trace | Console → Trace list → filter `span:"MCP send"` → open one trace showing the waterfall (`MCP send tools/call …` root → `apply_guardrail "Google Cloud Model Armor"` → request/response paths). Zoom browser to 150 % for legibility | Beat 8 |
| Agent Engines | Console → Vertex AI → Agent Engines (us-central1) — eight reasoning engines plus three platform stores: `caserelay-run-sessions`, `caserelay-chat-sessions`, and `caserelay-memory-bank`. Eleven rows total | Beat 9 |
| Agent Registry | Console search bar → **Agent Registry** → project picker **caserelay** → **Agents** tab, region `us-central1`. Confirm eight rows, every one at version `1.0.0`. **This is the real GCP console. It is not the portal's `/registry` page, which is mock data.** Before you open it, read the "Safe to delete" warning in Beat 9 | Beat 9 |

If Cloud Trace shows no MCP spans, run the Maya scenario once before recording to generate them.

**Recording plan.** Record beats 1–6 (portal) as one unbroken session — that is four runs and about
three and a half minutes of wall clock, plus the wake gap. Note the case ID. Then record beats 7–9
(Console tabs) as separate clips, navigating Firestore to the case from your run. Assemble and
speed-ramp in editing.

**What the four runs are**, so you know where you are during the take:

| Run | Starts because | Ends because | Beat |
|---|---|---|---|
| 1 | You clicked **Run it** | Activation gate — parks | 2 |
| 2 | You approved activation | Wakes are scheduled; run ends deliberately | 3 |
| 3 | **Cloud Scheduler sweep** — no human | Escalation gate — parks | 4, 5 |
| 4 | You approved the escalation | All five commitments closed | 6 |

Only the boundary into run 3 happens without you. That is the point of Beat 4.

---

## The script

Read the narration naturally. If you stumble, use your own words. The pace matters more than exact phrasing.

**A note on the captions.** Beats carry a **Caption:** line where a Google product is doing the thing the viewer is watching. These are added in the edit, not spoken. A judge scoring against the Fortified Enterprise Fleet technology list needs to map each moment to the product behind it; the narration should not do that job, because a voiceover that recites product names stops sounding like a person telling you about a child and starts sounding like a data sheet. Put the product names on screen and keep them out of the voice.

Style: single-line lower third, bottom-left, clear of the browser chrome and of the activity feed column. Sentence case, no more than about seven words, muted — a label, not a chyron. Fade in over ~0.3 s, hold, fade out. Captions cost no runtime.

Only three product names are spoken in the whole film: Model Armor (Beat 5), Memory Bank (Beat 6), and Agent Gateway (Beat 8, again in Beat 9's closing inventory). In each the name is the subject of the sentence rather than an ornament on it — the sentence would lose its meaning without it. Everything else is attributed on screen. Do not add a fourth spoken name.

---

### Beat 1 — Pick up a case already running · [0:00 → 0:10]

**Screen:** Portal admin page, chat panel on the right.

**Action:** Type into chat: `Create a case for maya with deadline 10s` → send. Wait for the case ID (~2 s). Type: `Run it` → send. Portal navigates to the case detail page.

**Edit:** Real speed.

**Narration:**

> Five referrals across five agencies — some already past their deadline. Let's see who followed through and who didn't.

*Write down the case ID — you need it for the proof shots.*

*The case is not new, and the narration must not suggest it is. The referral packet is backdated 17 days: education's deadline lapses the moment the case is created and legal's went three days ago. This is a volunteer inheriting work in flight, which is the real CASA situation. The feed's own opening line says so — "Opening Maya's case and reviewing every open commitment."*

---

### Beat 2 — The system stops · [0:10 → 0:32]

**Screen:** Case detail page. Gate card above the activity feed.

**Action:** Do nothing. Wait for intake to finish and the gate card to appear — **Waiting on you — approve activation for Maya** (amber top stripe, pulsing lock icon). In the reference run intake took 36 s; 15–45 s is normal.

**Edit:** Speed-ramp the intake scroll to ~5 s. Hold at real speed once the gate card is visible. Frame the gate card explicitly and hold there.

**Caption** (fades in as the intake rows begin scrolling, holds ~3 s):

> `Agent Runtime — intake_authority engine`

**Narration** (over the speed-ramp):

> Intake found five commitments in Maya's case file.

**Narration** (gate card visible, real speed):

> And it stops. It won't contact a single agency until a person approves. No agent in this fleet can approve its own work.

**Action:** Click **Approve & activate**.

> Approved.

*Staging: you play one operator for both gates. The portal has a single persona (`advocate`) — no supervisor login exists. The card displays "Deciding as advocate," and `"advocate"` is what Firestore records. Do not pretend to switch roles or open a second window. The claim is that agents cannot self-approve and the gate requires an explicit human identity; one person taking both decisions is the honest version of that claim. Note that the gate card renders above the feed, not inside it — the feed can read "Run paused" while the card is what actually holds the case. Frame the card and make clear which is on screen.*

---

### Beat 3 — Four come back done. One asks for more time · [0:32 → 0:58]

**Screen:** Same page. Run 2 starts with "Approved — contacting every service on Maya's case." Four confirmations land within about three seconds, in arbitrary order — Tom Barnes on shelter, Maria Lopez on family services, David Chen on the clinic, Anna Reed on legal aid. Then the fifth row, which is the one that matters:

> Lincoln Unified asked for more time on Maya's school enrollment — the fleet will check back.

About eight seconds later the run ends on its own:

> Checkpoint saved — this run is ending. 5 scheduled pushes will resume Maya's case as each commitment comes due.

Then the feed goes quiet. Do not touch anything.

**Action:** Do nothing. Real time: ~32 s.

**Edit:** Speed-ramp the four confirmations to ~6 s. **Hold at real speed on the Lincoln Unified row for ~6 s** — this is the setup for Beat 4 and the viewer has to read it. Hold ~5 s on the run-ending row.

**Caption** (fades in as the first confirmation lands, holds ~3 s):

> `Five Agent Runtime engines · A2A over published agent cards`

**Caption** (on the run-ending row, holds ~3 s):

> `Durable state in Firestore — the run can end`

**Narration** (over the confirmations speed-ramp):

> Five agents, five agencies, all at once. Each one only sees the fields its scope allows.

**Narration** (Lincoln Unified row, real speed):

> Four came back done. The school didn't say no — it asked for more time. Its counsellor wasn't free, and it asked to be given a bit longer.

**Narration** (run-ending row):

> So the fleet doesn't push. It writes down when to come back, and the run ends. Nothing is left hanging open, and nobody is sitting there waiting.

*Why this beat is worth six seconds of real-time hold: the deferral is the only moment in the film where the fleet is told "not yet" and has to decide what to do about it. Everything Beat 4 claims depends on the viewer having read this row. Do not ramp through it.*

*Captions in this beat: **do not caption the fan-out with Agent Gateway.** The Gateway governs egress from the deployed engines; the fan-out you are watching is A2A from the control plane and does not pass through it. The Gateway's evidence is Beat 8 and only Beat 8.*

---

### Beat 4 — It comes back on its own · [0:58 → 1:18]

**Screen:** The feed sits still — anywhere from a second to a full minute. Then a separator is drawn across the feed reading **"Checked back _N_s later"**, and a new run begins:

> Reconciled Maya's commitments: 1 overdue, 4 on track.
> Checking back with Lincoln Unified School District on Maya's school enrollment — they asked for more time.

Followed shortly by "Followed up on Maya's open commitments."

**Action:** Nothing. Hands off the keyboard — that is the whole point, and if you scroll or reload you have contaminated the shot.

**Edit:** This is the one place in the film where you are cutting *out* the evidence, so leave a trace of it: ramp the silent gap down to ~3 s rather than cutting it clean, and let the separator land visibly. **Then hold at real speed for ~12 s on the two rows.** The viewer needs to read "Checking back" and connect it to the row they read in Beat 3.

**Caption** (fades in with the separator, holds ~4 s):

> `Cloud Scheduler · Pub/Sub — nobody at the keyboard`

**Narration** (over the ramped gap and the separator):

> Nobody clicked anything here. The clock the fleet set for itself ran out, and the case woke up on its own.

**Narration** (the two rows, real speed):

> And the first thing it does is go back to the school. It said it would check back, and it did — without anyone asking it to. That gap in the feed is the case actually waiting.

*This is the strongest single claim in the film and it is the only one you get to make by showing rather than describing. Two guard rails on the wording. **First**, the return time is the fleet's own — it comes from the commitment's deadline, not from parsing the school's note. The school's note says "check back by end of week"; the fleet never read that string. Say "it said it would check back" (the fleet's promise, in Beat 3's row) and never "it came back when the school asked it to." **Second**, "the clock the fleet set for itself" is exact: the fan-out run wrote the wake times before it ended. Do not say the fleet slept, dreamt, or remembered — it ended, and a sweep restarted it.*

*Not captioned Agent Runtime, deliberately. The checkpoint documents live in Firestore (`workflow_checkpoints`, written by `backend/workflows/durable.py`) and the wake is Cloud Scheduler → Pub/Sub → an authenticated push to the control plane. Vertex AI Agent Runtime hosts the engines; it is not what persisted this case or what woke it. Captioning it Agent Runtime here would be the one false attribution in the film.*

---

### Beat 5 — The reply, and the second stop · [1:18 → 1:42]

**Screen:** The school answers:

> A reply came back from the school — the safeguarding verifier is screening it before anyone acts.

About eighteen seconds later:

> The safeguarding verifier stopped that reply — it reached outside its scope. Escalated — held for human review.
> Run paused — a quarantined reply needs a supervisor decision before Maya's case can proceed.

The escalation gate card appears above the feed — **Waiting on you — approve escalation for Maya** (amber top stripe, pulsing lock icon).

**Action:** Do nothing until the gate card is up.

**Edit:** Hold real speed ~5 s on the screening row. Ramp the eighteen-second wait to ~3 s. Hold ~6 s on the quarantine row. Hold ~8 s once the gate card is visible, framed explicitly.

**Narration** (screening row):

> The school answers this time. And before anyone acts on what it sent, the reply goes to the safeguarding verifier.

**Narration** (quarantine row):

> It's wrong. The school asked for Maya's medical records — nothing to do with enrolling her. Model Armor caught it, fail-closed, and the reply was quarantined.

**Narration** (gate card, real speed):

> So the case stops again. School enrollment is still open, and it stays open until a person decides. Nothing moves until the click.

**Action:** Click **Approve escalation**.

*This gate is load-bearing now, which it was not in earlier cuts. The run parks with school enrollment unresolved — no chase has happened, no coordinator has been found. The follow-up rows in Beat 6 exist only in the run that starts after you approve. If you want to prove it to yourself before recording, note that the commitment is still `deferred` in the case state while the card is up. Do not narrate around this; just make sure the wording says the case is held, not that it is tidying up.*

---

### Beat 6 — The chase, and the close · [1:42 → 2:00]

**Screen:** Run 4 opens with "Escalation decided — picking Maya's case back up." Then, over about forty seconds:

> Contacting Lincoln Unified about Maya's school enrollment.
> Lincoln Unified could not resolve Maya's school enrollment.
> Sarah Miller has taken on Maya's school enrollment.
> The follow-ups landed — every commitment on Maya's case is fulfilled.

Then the run summary card expands with all five commitments and their status badges, and the last row lands: "All 5 commitments for Maya are fulfilled."

**Edit:** Ramp to ~4 s to reach the chase. **Hold real speed ~6 s across the "could not resolve" → "Sarah Miller has taken on" pair** — the failure and the recovery only read as a pair. Ramp the twenty-nine-second tail to the summary card. Hold ~5 s once it is fully visible.

**Caption** (only if a "Recalled _N_ notes from earlier work on Maya's case" row appears near the top of run 3 or 4 — see the note below; holds ~3 s over that row):

> `Memory Bank — recall from the previous run`

**Narration:**

> Approved — and the case picks up where it stopped. The first try comes back unresolved. Then Sarah Miller, a named coordinator at the school, takes it on. Five for five. The session gets written to Memory Bank for next time.

*On the conditional caption: recall is scoped per case, so a case you created ninety seconds ago has almost nothing to recall. In the reference run no "Recalled _N_ notes" row appeared at all. Treat the caption as a bonus if the row shows up and drop it silently if it doesn't — do not narrate recall you cannot see.*

*Note: Gemma generates a natural-language session summary stored in the run record, but the portal does not display it. The summary is maintained in the data layer only. The `memory_write` event is likewise hidden from the feed. The visible proof of completion is the run summary card, which lists all five commitments with their final statuses.*

---

### Beat 7 — Proof: who decided, and what persists · [2:00 → 2:18]

**Screen:** Firestore console, database `caserelay`.

**Action:** Navigate to `cases/{your case ID}/authority_grants/` → click any grant document.

**Edit:** Real speed. Hold 3 s on the `granted_by` field.

**Narration:**

> `granted_by: advocate`. That's who clicked. Until a person acts, this field doesn't exist.

**Action:** Navigate to `human_approvals/` → click the escalation record. Hold 3 s on the `decided_by` field.

**Narration:**

> `decided_by: advocate`. A named agent enforced it. A named human released it.

**Action:** Switch to the pre-opened checkpoint tab (`wf-CR-0830155744-health`). Hold 3 s on the document — the viewer reads the `state` and `due_at` fields.

**Narration** (start it over the tab switch — the navigation is dead air today):

> And this is what the waiting looks like underneath. A row with a due date, and a sweep that runs every minute looking for one that's come due.

*This checkpoint is from `CR-0830155744` (Theo), not the case you just recorded. The fresh demo case's 10 s deadline means its checkpoints were fired and consumed during Beat 4, so it has nothing left to show. Theo's health checkpoint is genuinely unfired — `state: waiting`, `due_at: 2026-09-06` — which is the whole point of the shot: the viewer is reading the two fields as you say the line, and on a completed checkpoint they would read `completed` and a past date while hearing "this is what the waiting looks like." Do not substitute a checkpoint from a finished case. The narration does not name either case ID and does not claim this document is the one that woke your case — it describes the shape of the record. Keep it in the general tense. "This is what the waiting looks like," never "this is the one that fired."*

---

### Beat 8 — Proof: the infrastructure vouches · [2:18 → 2:30]

**Screen:** Cloud Trace console, pre-opened on the waterfall trace. Browser at 150 % zoom.

**Action:** The waterfall shows 4–5 spans: `MCP send tools/call …` as the root, `apply_guardrail "Google Cloud Model Armor"` underneath, request/response paths below that. Point at (or let the viewer read) `gen_ai.security.policy.name: caserelay-screen` and `gen_ai.security.decision.type` on the guardrail span.

**Edit:** Real speed. Hold 12 s.

**Caption** (fades in with the waterfall, holds ~4 s):

> `Agent Observability — spans emitted by the platform`

**Narration:**

> These spans are Google's, not ours. Agent Gateway intercepted the MCP call, ran Model Armor inline, and recorded the policy and the ruling. The infrastructure enforces the boundary — not the agents for themselves.

*The narration already names Agent Gateway and Model Armor, so the caption names the thing it doesn't: the trace itself. Do not stack a second caption naming the two products the voice has already said — the point of a caption is to add an attribution the ear did not get.*

*What these spans are and are not: they are Google-generated spans for the MCP tool calls and the Model Armor evaluations. ADK Agent Runtime does not export spans for its own execution, so do not describe the waterfall as the fleet's execution trace. It is the trace of the calls leaving it.*

---

### Beat 9 — Close · [2:30 → 2:45]

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

**Narration** (the Registry cut lands on the second sentence):

> Eight agent engines, coordinated across a platform holding two session stores and a memory bank. Platform-managed identities, and a catalogue of every agent the organisation runs. All outbound traffic from every engine routes through Agent Gateway — every call is identity-authenticated, policy-checked, and logged. Twice in this run, the system stopped and waited for a court-appointed volunteer to decide. Once, it started itself back up.

---

## Timing total: 2:45

| Beat | In → out | Length |
|------|----------|--------|
| 1 — Pick up a case already running | 0:00 → 0:10 | 10 s |
| 2 — The system stops | 0:10 → 0:32 | 22 s |
| 3 — Four come back done. One asks for more time | 0:32 → 0:58 | 26 s |
| 4 — It comes back on its own | 0:58 → 1:18 | 20 s |
| 5 — The reply, and the second stop | 1:18 → 1:42 | 24 s |
| 6 — The chase, and the close | 1:42 → 2:00 | 18 s |
| 7 — Who decided, and what persists | 2:00 → 2:18 | 18 s |
| 8 — The infrastructure vouches | 2:18 → 2:30 | 12 s |
| 9 — Close | 2:30 → 2:45 | 15 s |
| | | **165 s = 2:45** |

**What is held at real time, and what is compressed.** Roughly 3 m 30 s of wall clock plus up to a
minute of wake gap has to land in 1 m 50 s of portal footage, so most of the take is ramped. Four
moments are not:

| Held at real speed | For | Why |
|---|---|---|
| Activation gate card (Beat 2) | ~10 s | The gate has to look like it is stopping something |
| The Lincoln Unified deferral row (Beat 3) | ~6 s | Beat 4 is unreadable if this row wasn't read |
| The wake rows after the separator (Beat 4) | ~12 s | The film's strongest claim, and the only one shown rather than described |
| Quarantine row + escalation gate card (Beat 5) | ~14 s | The second gate, and the reason it is load-bearing |

Everything else is compressed: intake's 36 s → ~5 s, the four confirmations → ~6 s, the wake gap →
~3 s, the eighteen-second screening wait → ~3 s, and run 4's forty-second chase plus its
twenty-nine-second tail → ~9 s. **Ramp the gaps, never the rows.** If a take overruns, take it out
of Beat 8's hold or tighten Beat 7's three holds from 3 s to 2 s. Do not touch the four holds above.

Against a 55 s intro this lands at ~3:40, with 10 s of headroom under the 3:50 ceiling. If your
intro runs to 60 s you are at 3:45 and the headroom is 5 s — recut the intro rather than the four
holds.

---

## What this film does not claim

Read this once before recording. Some things are true of the system and **not** true of the footage, and others are true of a different scenario. Conflating either with what is on screen is the easiest way to make an honest project look overstated.

| The claim | Status | Where it may be made |
|---|---|---|
| The fleet wakes itself on a schedule, with no user session | **Real, deployed, and on camera.** Cloud Scheduler fires every minute, publishes to Pub/Sub, and an authenticated push resumes the run. The boundary between the run ending in Beat 3 and the run starting in Beat 4 is that path, with no browser action in between | **Beat 4**, as something the viewer is watching. Beat 7 shows the shape of the record behind it |
| The "Checked back _N_s later" separator proves the case slept and resumed on its own | **True at exactly one boundary and false at the other two.** A separator is drawn at every `run_id` transition and its number is the wall-clock gap. Into run 3 that gap is the sweep, and the claim holds. Into runs 2 and 4 the gap is how long you took to click a gate | The Beat 4 separator only. Do not point at, zoom on, or narrate either of the others |
| The fleet read the school's note and honoured the date in it | **False.** The partner's reply says "check back by end of week"; nothing parses that string. The return time comes from the commitment's own deadline, written as a wake during the fan-out run | Nowhere. Beat 4 says "it said it would check back" — the fleet's promise in Beat 3's row, not the school's |
| The school's request for more time is a live negotiation with a real institution | **False.** Lincoln Unified is a partner simulator (`backend/partners/sim.py`), and the deferral is a scripted response. What is real is everything on our side of it: the state change to `deferred`, the audit record, the scheduled return, and the check-back | Nowhere explicitly. Do not call it a negotiation, and do not imply a person at the school made a decision |
| The case is new, and the five referrals go out during the demo | **False.** The packet is backdated 17 days. Education's deadline lapses at creation and legal's lapsed three days ago; the referrals were sent long before the volunteer arrived. This is inherited work, and it is the stronger story — the fleet's job is catching up on promises someone else made | Beat 1, as "some already past their deadline." Never "let's start a case" or "watch it send five referrals" |
| An agency went silent and the supervisor was told about it | **False for Maya.** Her school defers, and then *replies* — with a cross-scope request for medical records, which is why it is quarantined rather than chased for silence. `unanswered()` and `notify_supervisor` never fire in this run | Nowhere. **If a judge asks:** the silent-provider path is fully implemented and uses the same follow-up infrastructure you just watched — same chase, same grant, same audit trail. It fires on a different trigger, a provider that does not answer the follow-up at all, and it is demonstrated by the Priya scenario, where the clinic times out. Maya's school is a different failure: it asks for time, then answers out of scope |
| The waterfall in Beat 8 is the fleet's execution trace | **False.** ADK Agent Runtime does not export spans for its own execution. Those spans are Google-generated, for the MCP tool calls and the Model Armor evaluations — the calls leaving the fleet, not the fleet running | Beat 8, as "Agent Gateway intercepted the MCP call." Never "here is the fleet executing" |

Four runs, and three of the four boundaries are a human decision or a click. The fourth — into run 3 — is a timer, and it is the one worth pointing at. Everywhere else, say "the system stopped and waited for a person," which is Beats 2, 5 and 9, and is a strength.

**Attributions deliberately withheld.** Where a product is not named, the omission is a choice rather than an oversight. **Agent Gateway** is captioned only in Beat 8, because it governs egress from the deployed engines and the Beat 3 fan-out does not pass through it. **Agent Registry** has its own shot and caption in Beat 9, but only as a catalogue — it holds every engine's `agentSpec` at version `1.0.0`, two partner MCP servers and fourteen egress endpoints, and it is not consulted at runtime, so its caption may sit over the list page and nowhere else, and never over a moment of routing. **Agent Runtime is not captioned in Beat 4**, even though that beat is the film's best moment, because the durable state is Firestore and the wake is Cloud Scheduler and Pub/Sub — Agent Runtime hosts the engines and did not persist or resume this case. **The evaluation run** is attributed nowhere: it was created by direct API call, no console page lists it, and a caption pointing at a product the viewer cannot see is worse than silence. If a judge asks about evaluation, answer it out of band.

Maya's own story is narrower than the fleet's capabilities, and narrating the capabilities over her footage is what turns a true claim into an overstated one. What she actually demonstrates: inherited work with lapsed deadlines, a partner that asks for more time, a fleet that ends the run and comes back on its own, a reply that arrives out of scope and is quarantined, two human gates — one of which genuinely holds an open commitment — and a chase that closes the last one. That is enough.

---

## Cut — Memory Bank standalone beat (~15 s)

At 2:45 against a 2:50 ceiling there is no room for this. It is kept here because it answers a
question a judge may ask out of band, not because it goes in the film. Only reinstate it if the
intro comes in under 45 s. Use a case that has surviving Memory Bank memories — `CR-0829182814`
(the clean 5/5 Maya) went through `11-memory` and is a good candidate.

**Screen:** Terminal.

**Action:** Run:

```bash
curl -s -X POST \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  "https://us-central1-aiplatform.googleapis.com/v1beta1/projects/caserelay/locations/us-central1/reasoningEngines/8631858420611284992/memories:retrieve" \
  -d '{"scope":{"app_name":"caserelay","user_id":"CR-0829182814"},"simple_retrieval_params":{"page_size":5}}'
```

**Narration:**

> Three weeks from now, when Maya's case wakes up, the fleet remembers. Each fact scoped to her case, nobody else's.

*Honest constraint: the recalled content is process-level observations, not operational specifics. Show that the mechanism works; don't claim it changed behavior.*

---

## Do not show on camera

| Screen | Why |
|--------|-----|
| `/registry` (the **portal** page) | Renders mock data from `portal/src/lib/mock/agents.ts`. Beat 9 has a genuine Agent Registry shot — that one is the **GCP console**, reached from the console search bar, and it is a different tab entirely. If you find yourself on `localhost:3000/registry`, you are on the wrong one |
| `/approvals` | Renders mock data from `portal/src/lib/mock/approvals.ts` |
| Any case ID from `portal/src/lib/mock/cases.ts` (e.g. CR-1042) | Routes to the scripted walkthrough, not live data |
| Left-nav "Approvals" item | Links to the mock approvals page |
| Any Vertex AI Evaluation page (Models → Evaluation, Agent Builder → Agents → Evaluation tab) | Our evaluation run was created by direct API call, not through the console flow, so no console evaluation page will list it |

---

## If something goes wrong during recording

| What you see | What to do |
|-------------|-----------|
| Feed sits on "Opening the case…" for 30+ s | Normal cold start — intake took 36 s in the reference run. Let the speed-ramp absorb it. |
| Stream ends with only intake events | That's the activation gate. Go to `/cases/CR-XXXX` and approve. |
| At fan-out the school comes back **blocked** or **unresolved** instead of asking for more time | The deferral didn't fire, and Beat 3 and Beat 4 have no setup. The rest of the arc will still complete, but you have lost the best two beats in the film. Start a fresh case — do not try to narrate around it. |
| **The feed ends at "Checkpoint saved — this run is ending" and nothing follows** | Expected, briefly. The case is waiting on the once-a-minute sweep, and the gap is anything up to 60 s. **Keep recording and keep your hands off the browser** — this silence is Beat 4's evidence. If nothing has appeared after **two minutes**, two sweeps have missed it: the checkpoints were not due, which means you used a deadline longer than `10s`. Start a fresh case at `10s`. |
| The wake fires but there is no "Checking back with Lincoln Unified" row | The reconciliation found education not overdue, so the check-back never happened. Same root cause as above — the deadline was too long. The run will close out without a quarantine. Start fresh. |
| Quarantine row appears but no escalation gate card | Give it ~20 s for the poll. If nothing, reload the page — the portal stops polling once the run parks. The gate card renders above the feed, so scroll up before deciding it is missing. |
| Gate card says "Waiting on you" while the feed reads "Run paused" or "All steps complete" | Both are correct. `useLiveRunEvents` marks the run terminal on `run_completed`, which is the event that announces the gate. Frame the card, not the feed. |
| "4 of 5 commitments fulfilled" at the end | A timing race. Refresh the case detail — the stored state is correct. |
| Cloud Trace waterfall is hard to read at your resolution | Zoom browser to 150 % before recording the trace tab. The waterfall is only 4–5 spans — at 150 % the `apply_guardrail` span and its labels are legible. |
| Final run ends with "Some steps still open" instead of all five fulfilled | A Model Armor 403 hit the memory phase (occurs on ~29% of runs). The run is trapped in `partial_failure` state. Reload the page, wait for the dust to settle, and start a fresh case for a clean take. The run state persists, but does not block future runs on the case. |

---

## Appendix — agent roster (INTERNAL REFERENCE, NOT NARRATION)

> **Do not read this on camera and do not show it on screen.** It is a crib sheet for answering
> questions about the fleet, not part of the film. Nothing here belongs in the 2:45 runtime.

Eight agents, all `gemini-3.5-flash`, all deployed as separate Vertex AI reasoning engines.
Verified against `backend/agents/` — if a claim here disagrees with the source, the source wins.

| Agent (ADK `name`) | Does | Tools (exact) | Reached by | In the Maya run |
|---|---|---|---|---|
| `continuity_orchestrator` | Drives the run phase by phase. Holds no raw records. | Per-phase grant from `CONTROL_PLANE_TOOLS`: `schedule_wake`, `wake_workflow`, `check_overdue`, `send_followup`, `notify_supervisor`, `preload_memory`. `get_commitment_states` is attached to every phase. Plus the six agents below as `AgentTool`s. | Control plane builds it in-process per phase (`build_for_run`); also published at `/a2a/orchestrator/.well-known/agent-card.json` | Every phase after intake |
| `intake_authority` | Reads the referral packet, extracts commitments, proposes grants. Cannot activate a case. | `read_referral_packet`, `validate_packet`, `add_commitment`, `propose_grant`, `finalize_intake` | Control plane imports and runs it in-process for the intake phase; card at `/a2a/intake/…` (used by the fleet health probe and the operator CLI) | Beat 2 — five commitments, five proposed grants, then the activation gate |
| `safeguarding_verifier` | Screens the school callback through Model Armor and opens the escalation. Fails closed; never changes a commitment status. | `inspect_school_callback`, `open_escalation` | `RemoteA2aAgent` → `$CASERELAY_URL_VERIFIER/a2a/verifier/.well-known/agent-card.json` | Phase `6-quarantine` — Beat 5 |
| `education_liaison` | Lincoln Unified enrollment. Refuses out-of-scope asks and reports its status. | `get_authorized_context`, `query_school`, `submit_enrollment_status` | `RemoteA2aAgent` → `$CASERELAY_URL_EDUCATION/a2a/education/…` | Defers at fan-out (Beat 3); chased again in the nudge phase (Beat 6) |
| `health_coordination` | Riverbend appointment status only. No diagnosis or notes. | `get_authorized_context`, `query_clinic`, `submit_appointment_status` | `RemoteA2aAgent` → `$CASERELAY_URL_HEALTH/a2a/health/…` | Confirms in Beat 3 (David Chen) |
| `legal_aid` | Statewide Legal Aid referral status. No strategy or advice. | `get_authorized_context`, `query_legal_aid`, `submit_legal_status` | `RemoteA2aAgent` → `$CASERELAY_URL_LEGAL/a2a/legal/…` | Confirms in Beat 3 (Anna Reed) |
| `shelter_status` | Harborlight bed availability. No placement rankings. | `get_authorized_context`, `query_shelter`, `submit_shelter_status` | `RemoteA2aAgent` → `$CASERELAY_URL_SHELTER/a2a/shelter/…` | Confirms in Beat 3 (Tom Barnes) |
| `family_services` | Mesa County assessment scheduling. No findings or risk scores. | `get_authorized_context`, `query_family_services`, `submit_family_status` | `RemoteA2aAgent` → `$CASERELAY_URL_FAMILY/a2a/family/…` | Confirms in Beat 3 (Maria Lopez) |

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
- The deferral is recorded as well as narrated: `commitment_deferred` goes into the case audit with an explanation, alongside the commitment state change. If a judge asks whether the "asked for more time" row is cosmetic, that audit entry is the answer.
