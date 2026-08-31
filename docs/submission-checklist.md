# Hackathon submission components

Where each submission component lives. Requirements are from the
[official rules](https://allthingsagentichackathon.devpost.com/rules) §3–§5.

**Deadline: Aug 31, 2026, 5:00 PM PDT.**

---

## Stage One — pass/fail viability

| # | Requirement | Status | Notes |
|---|---|---|---|
| 1 | Gemini 3.5 or newer, via Gemini API or Vertex AI | **Done** | All eight agents on `gemini-3.5-flash`. |
| 2 | At least one Google agent framework | **Done** | Google ADK throughout `backend/agents/`; A2A runtime in `backend/runtime/` |
| 3 | At least one Google Cloud infrastructure service | **Done** | Three Cloud Run services, eight Vertex AI reasoning engines, Firestore, Pub/Sub, Cloud Scheduler |
| 4 | Exactly one track selected | **Done** | **Fortified Enterprise Fleet** selected in the Devpost form |
| 5 | New project, built during the submission period | **Done** | No pre-existing code incorporated |
| 6 | English, or English subtitles on all materials | **Done** | All materials in English; video is English |

## Stage Two — the six required submission fields

| # | Field | Status | Evidence |
|---|---|---|---|
| 1 | **Demo video** | **Done** | [https://www.youtube.com/watch?v=Bp2PKUXg_PQ](https://www.youtube.com/watch?v=Bp2PKUXg_PQ) — public, 234 seconds, `#AllThingsAgenticHackathon` in description |
| 2 | **Text description** | **Done** | [devpost-description.md](devpost-description.md) pasted into the Devpost description field |
| 3 | **Code repository** | **Done** | [github.com/akhil-bot/CaseRelay](https://github.com/akhil-bot/CaseRelay) — public |
| 4 | **Hosted URL** | **Done** | `https://caserelay-portal-6nwo7o4bbq-uc.a.run.app` — session login, returns 401 on case data without session cookie |
| 5 | **Spin-up instructions** | **Done** | [README quick start](../README.md#quick-start) plus [deploy.md](deploy.md) |
| 6 | **Architecture diagram** | **Done** | `docs/diagrams/caserelay-multi-agent-mesh.png`, embedded at the top of the README |

### Portal access for judges

The portal is behind a session login. Login steps for the Devpost testing-instructions field:

1. Go to `https://caserelay-portal-6nwo7o4bbq-uc.a.run.app/login`
2. Choose any role (e.g. "CASA volunteer advocate")
3. **Clear the pre-filled email** and enter `admin@caserelay.com`
4. Enter the password supplied in the Devpost submission's testing instructions
5. Click "Sign in"

The pre-filled email on each role page is a persona placeholder and will not authenticate.

---

## Stage Three — bonus points (max 1.0 on a 6.0 scale)

| Bonus | Max | Status | Evidence |
|---|---|---|---|
| Public build write-up stating it was created for this hackathon | 0.2 | **Done** | [DEV.to post](https://dev.to/akill_m_8f67cabd174364802/caserelay-a-governed-agent-fleet-that-follows-up-on-a-childs-court-ordered-services-for-weeks-3hnf) — published, carries `#AllThingsAgenticHackathon` |
| Public social post with `#AllThingsAgenticHackathon` on X or LinkedIn | 0.2 | **Done** | [LinkedIn post](https://lnkd.in/p/dNfhw8qu) — published with hashtag |
| Each additional Google AI model integrated (Gemma, Veo, Lyria) | 0.6 | **0.2 of 0.6** | Gemma 4 (`gemma-4-26b-a4b-it-maas`) writes the end-of-run session narrative: `backend/narration/gemma.py`, called from `backend/runtime/invoke.py:224`. Observed on serving revision. Veo and Lyria are not integrated. |

---

## Do not claim

The submission has been through several accuracy audits. These are the lines that were fixed
deliberately; do not let a Devpost description walk them back.

- **Agent Runtime does not provide the sleep/wake cycle.** The checkpoint / sleep /
  deadline-triggered resume is Firestore plus Pub/Sub push plus Cloud Scheduler. Saying Agent
  Runtime does it is the single easiest overclaim to make here.
- **The Agent Registry is a catalogue, not a routing layer.** The orchestrator resolves specialists
  from fixed environment variables on the control-plane revision. Nothing in a run reads the
  registry.
- **Agent reasoning is not traced end to end.** Cloud Trace carries Google-generated spans for MCP
  tool calls and Model Armor evaluations that traverse the Agent Gateway. ADK Agent Runtime does not
  export its own execution spans, and the control-plane trace and engine traces share no trace id.
  That is a documented platform limitation, not a CaseRelay bug — and not something to bridge with
  custom spans.
- **The Diego scenario is not a caught failure.** Neither Model Armor nor the gateway detected the
  false enrollment status. It is evaluation fodder for GEAP Agent Evaluation HALLUCINATION scoring.
- **Agent Evaluation HALLUCINATION has not been run.** It needs an eval dataset that does not exist.
- **Memory Bank recall is thin.** The mechanism is deployed and observed; the recalled content is
  general process observation rather than named contacts or institutional shortcuts. A compressed
  run does not accumulate the history that would produce those.
- **Field-level access control is CaseRelay's own code**, called the "authority gateway" to
  distinguish it from Google's Agent Gateway, which is the egress control point.
- **Nothing in [post-video-geap-deploy.md](post-video-geap-deploy.md) is done** unless that file
  says so explicitly. It is a queue of work that has not been applied.
- **Compressed runs use the same machinery.** `due_in` compresses the deadlines, not the execution path. The run that writes checkpoints ends and is recorded `suspended`; Cloud Scheduler sweeps once an hour, finds it, and publishes to Pub/Sub; an authenticated push starts a new run with a new `run_id`. In `CR-0830203440` the checkpoint run was `84bd42c6b0c4` and the wake run was `411d07c94595`. The gap is whatever remains of the hour. Do not cite the old "23-second" figure; it came from a run whose records have been purged.
