# Hackathon submission checklist

What the Devpost submission still needs. Requirements are from
[hackathon-rulebook.md](hackathon-rulebook.md) §3–§5, which mirrors the
[official rules](https://allthingsagentichackathon.devpost.com/rules).

**Deadline: Aug 31, 2026, 5:00 PM PDT.** After the submission period closes, no changes to the
submission are permitted. Drafts can be edited freely until then, so create the Devpost draft
early and fill it in — a draft that exists is one fewer thing that can go wrong at 4:55.

Statuses below are as verified on **31 Aug 2026**. Where a status was not checked in this pass it
says so rather than guessing.

---

## Stage One — pass/fail viability

Fail any of these and nothing else is scored.

| # | Requirement | Status | Notes |
|---|---|---|---|
| 1 | Gemini 3.5 or newer, via Gemini API or Vertex AI | **Done** | All eight agents on `gemini-3.5-flash`. This is pass/fail, so the model string is not a free choice. |
| 2 | At least one Google agent framework | **Done** | Google ADK throughout `backend/agents/`; A2A runtime in `backend/runtime/` |
| 3 | At least one Google Cloud infrastructure service | **Done** | Verified live: three Cloud Run services (`caserelay-control-plane`, `caserelay-portal`, `caserelay-partners`), eight Vertex AI reasoning engines, Firestore named database `caserelay`, Pub/Sub, Cloud Scheduler |
| 4 | Exactly one track selected | **Outstanding** | Decided — **Fortified Enterprise Fleet** — but must actually be selected in the Devpost form |
| 5 | New project, built during the submission period | **Done** | No pre-existing code incorporated |
| 6 | English, or English subtitles on all materials | Pending the video | Text materials are in English |

## Stage Two — the six required submission fields

| # | Field | Status | What is left |
|---|---|---|---|
| 1 | **Demo video** | **Outstanding — the critical path** | Not recorded. Max 4 minutes; only the first four are evaluated. Must be public on YouTube or Vimeo. See [what the video must contain](#what-the-video-must-contain) below. |
| 2 | **Text description** | **Outstanding** | The content exists in [hackathon-blog.md](hackathon-blog.md) and the [README](../README.md); it has not been entered into the Devpost description field. Must cover features and functionality, technologies used, other data sources, and findings/learnings. |
| 3 | **Code repository** | **Outstanding** | The repo is private. The rules require sharing a private repo with **`testing@devpost.com`** and **`cloudhackathons@google.com`**. Either do that or make it public before the deadline. |
| 4 | **Hosted URL** | **Done** | `https://caserelay-portal-6nwo7o4bbq-uc.a.run.app` — verified live, returns 401 on case data without the password. Encouraged, not mandatory. |
| 5 | **Spin-up instructions** | **Done** | [README](../README.md#quick-start) quick start plus [deploy.md](deploy.md), which states plainly what an outsider cannot reproduce and gives them the local path instead |
| 6 | **Architecture diagram** | **Done** | `docs/diagrams/caserelay-multi-agent-mesh.png`, embedded at the top of the README |

### The one that is easy to miss

The portal is behind a password gate, and the rules require that **testing access is free and
unrestricted for the sponsor, administrator and judges until judging ends, including credentials if
the deployment is private.** Put the username and password in the Devpost submission notes:

```bash
gcloud secrets versions access latest --secret=caserelay-portal-password --project=caserelay
```

Username is `admin@caserelay.com` unless `CASERELAY_PORTAL_USER` was overridden at deploy time.
Judging runs to **Oct 1, 2026**, so the services need to stay up until then, or the video has to
carry the proof on its own — which the rules explicitly allow.

---

## What the video must contain

Four things, per the rules. All four are scored under Demo & Production Readiness (30%).

| Must show | Where it comes from |
|---|---|
| The problem being solved | The inherited-case framing — a volunteer opens a file that is already seventeen days old |
| The value proposition | Five commitments, two human gates, one autonomous wake |
| A demo of the app in action | The Maya arc in the portal. **Unedited, live execution** is what "proof of action" means — terminal logs, database updates or UI changes visible on screen |
| Proof the backend runs on Google Cloud | Cloud Console: Agent Engines list, Cloud Run dashboard, Firestore documents, Cloud Trace waterfall, Agent Registry. A `.run.app` URL on screen also counts. |

The runtime budget, beat list and console paths are in
[demo-day-checklist.md](demo-day-checklist.md) and [demo-video-script.md](demo-video-script.md).

**Video blockers previously listed in `demo-day-checklist.md` that are now resolved** — verified by
reading the tree on 31 Aug 2026:

- The `case_report` frontend tool exists in `portal/src/components/copilot/CopilotProvider.tsx` with
  a `render` declared, and `case_report` is in `WIDGET_TOOLS`.
- `ReportStoreProvider` and `ReportPrintRoot` are both mounted — inside `CopilotProvider` rather
  than `layout.tsx`, which is why a grep of `layout.tsx` still looks like they are missing.
- `portal/Dockerfile` exists and the portal is deployed to Cloud Run, so the "host the frontend"
  item is done and the recording no longer has to fall back to `localhost:3000`.

Items 2, 3 and 6 of that checklist — chat formatting, the `10s` dry run, and the script rewrite —
were **not** verified in this pass. Treat them as open.

---

## Stage Three — bonus points (max 1.0 on a 6.0 scale)

| Bonus | Max | Status |
|---|---|---|
| Public build write-up stating it was created for this hackathon | 0.2 | **Outstanding.** [hackathon-blog.md](hackathon-blog.md) is written and carries the `#AllThingsAgenticHackathon` statement, but its front matter is `published: false` and there is no DEV.to URL. Publishing it is a few minutes for a fifth of a point. |
| Public social post with `#AllThingsAgenticHackathon` on X or LinkedIn | 0.2 | **Outstanding.** Not written. |
| Each additional Google AI model integrated (Gemma, Veo, Lyria) | 0.6 | **0.2 of 0.6 claimable.** Gemma 4 (`gemma-4-26b-a4b-it-maas`) writes the end-of-run session narrative and has been observed on the serving revision. Veo and Lyria are not integrated and there is no reason to add them now. |

Both 0.2 items are cheap and independent of the video. Do them while a render is running.

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
- **Compressed runs do not demonstrate the timer.** Under `due_in=10s` the wake phase runs inside
  the same run that set the checkpoint. The Cloud Scheduler sweep has been observed separately, with
  a 23-second gap and nobody at the keyboard; that is the claim to make, and only that one.

---

## Order of work, given the clock

1. **Record and publish the video.** It is the only item that cannot be done in minutes, it is 30%
   of the score, and Stage One fails without it.
2. **Create the Devpost draft** and select the Fortified Enterprise Fleet track. Drafts are editable
   until the deadline; the submission is not.
3. **Share the repo** with `testing@devpost.com` and `cloudhackathons@google.com`, or make it public.
4. **Paste the description** from the blog and README, and add the portal credentials to the notes.
5. **Publish the blog** and post to LinkedIn or X with `#AllThingsAgenticHackathon` (+0.4 for maybe
   twenty minutes of work).
6. **Confirm** the Google Cloud product list in the submission matches what the video actually shows.
