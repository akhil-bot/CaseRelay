# Demo day checklist

Everything below has to be done by tomorrow. Ordered by what blocks what: items 1–4 are the
demo itself and have to land first, 5 unblocks the video, 6–9 are the deliverables.

## The runtime budget

| Segment | Length | Running total |
|---|---|---|
| Intro | 0:30 | 0:30 |
| Agent architecture | 0:40 | 1:10 |
| Product demo | 2:00 | 3:10 |
| Google Cloud console proof | 0:40 | 3:50 |
| Thank you | — | ~4:00 |

The 2:00 demo, beat by beat:

1. Create the case in the Synthetic Data Lab (`/admin`).
2. Ask the chat for Maya's details → assistant answers and draws the **case review widget**.
3. Read the widget, click **Start outreach** on it.
4. Chat opens the case page; live trace runs.
5. When it finishes, ask the chat for a report → **report widget** with markdown in the thread and a download.

Note what changed versus `docs/demo-video-script.md`: that script creates the case *from chat*
(`Create a case for maya with deadline 10s`). The new flow creates it in the **lab** and only then
talks to the chat. That difference is the reason item 1 is not just "switch the widgets on" — see
below.

---

## 1. Chat widgets

The wiring is further along than it looks, but the last link is missing, so nothing draws today.

**Already done:**
- `portal/src/components/copilot/chat-widgets.tsx` — `CaseReviewWidget` and `ReportWidget`, both complete, sized for the 492px panel.
- `portal/src/components/copilot/chat-parts.tsx:78` — `WIDGET_TOOLS = {"create_case", "case_report"}`.
- `chat-parts.tsx:192` — `WidgetToolCalls`, mounted as `toolCallsView` at line 299. It filters to `WIDGET_TOOLS` and dispatches through `useRenderToolCall`.

**Missing — this is the whole gap:**
- [ ] `useRenderToolCall` dispatches to a `render` declared **on the tool**, in `CopilotProvider.tsx`. None of the three frontend tools there (`list_scenarios`, `create_case`, `start_outreach`) declares one. Add `render: CaseReviewWidget` to the tool that should draw the review card.
- [ ] The tool named `case_report` **does not exist anywhere** — `WIDGET_TOOLS` is the only mention of it in the repo. It has to be written as a frontend tool in `CopilotProvider.tsx` with `render: ReportWidget`. (See item 4.)
- [ ] **The lab-created case problem.** `CaseReviewWidget` is written to render off a `create_case` result. In the new flow the case comes from the lab, so `create_case` never fires in the chat and the widget never gets a chance to draw. Options, pick one:
  - Add a `case_details` frontend tool (child name, case id, deadline, commitment count) that renders `CaseReviewWidget`, and add it to `WIDGET_TOOLS`. This is the honest fit for "ask the chat about Maya".
  - Or fall back to creating the case from chat, as the old script does, and drop the lab step from the demo.
- [ ] The session registry already works across both entry points — `admin/page.tsx:80` calls `pushCase`, same as the `create_case` tool at `CopilotProvider.tsx:91` — so `findCase("maya")` will resolve a lab-created case. Verify this end to end; it is what makes the first option viable.
- [ ] Check the widget's **Start outreach** button: it calls `useBeginOutreach()` (`lib/copilot/outreach.ts`), the same path the `start_outreach` tool uses, so it should navigate to `/cases/{id}` and show the live trace. Confirm the navigation fires from the button, not only from the tool.

**Acceptance:** create a case in the lab, ask the chat about Maya, get a card with facts and a working button, land on the case page with the trace running.

## 2. Content formatting in chat

- [ ] Assistant messages already render as markdown — CopilotKit v2 pipes them through Streamdown, and `globals.css:238–273` overrides the prose spacing. So this is a *tuning* job, not a build: check headings, bullet lists, bold, and tables at 492px and fix what overflows or stacks badly. Tables are the likely casualty.
- [ ] User messages are plain text (`whitespace-pre-wrap`) by SDK default. Leave that.
- [ ] Tighten the agent's own output. The system prompt lives in `backend/api/agui.py` — tell it to answer short, lead with the answer, use bullets over paragraphs, and never dump JSON into the thread. Long unstructured replies are what will make the 2:00 demo run over.
- [ ] Step lines (`STEP_COPY`, `chat-parts.tsx:51`) cover `list_scenarios`, `create_case`, `start_outreach`. Add copy for any new tool from item 1, otherwise it falls back to "Working on it".

## 3. Create a case from the Synthetic Data Lab

Mostly working already; this is verification plus one guardrail.

- [ ] `/admin` (`portal/src/app/(app)/admin/page.tsx`) loads scenarios from `GET /v1/scenarios`, creates via `POST /v1/cases`, runs via `POST /v1/cases/{id}/runs`. Walk it once against the deployed control plane.
- [ ] **Deadline must be `10s`.** The default `dueIn` in the admin page is already `"10s"` — do not raise it for the take. `schedule_wake` spaces checkpoints at `due_in × (i+1)/5`, and anything above ~10s loses the race against the 7–12s the engine takes to reach the wake phase. `docs/demo-video-script.md` has the full explanation and the observed numbers.
- [ ] Confirm the Maya scenario id is `maya` and still resolves (`backend/state/scenarios.py:114`).
- [ ] Do a full dry run of the Maya arc at `10s`: activation gate → fan-out → quarantine → escalation gate → all five commitments closed. Note the case id.

## 4. Report generation

Same shape as item 1 — the machinery is written, none of it is mounted.

**Already done:**
- `portal/src/lib/copilot/report.ts` — `CaseReport`, `buildReport()`, `reportToMarkdown()`, `reportFilename()`. Reads the case record and audit log; nothing in it can be filled by the model.
- `portal/src/lib/copilot/report-store.tsx` — `ReportStoreProvider`, `downloadText()`, `print()`.
- `portal/src/components/copilot/ReportDocument.tsx` — printable document plus `ReportPrintRoot`.
- `globals.css:469–612` — the print stylesheet.

**Missing:**
- [ ] `ReportStoreProvider` is mounted nowhere. Add it to `portal/src/app/layout.tsx` (currently `ViewerProvider > DemoProvider > CopilotProvider`). `useReportStore()` throws without it, so `ReportWidget` cannot render at all today.
- [ ] `ReportPrintRoot` is mounted nowhere either. It has to be in the tree for `print()` to have a document to print.
- [ ] Write the `case_report` frontend tool: resolve the case ref, call `buildReport()`, store it, return `{ case_id }`, and hand `reportToMarkdown()` back to the model so the markdown lands in the thread. `ReportWidget` looks the report up by `case_id` from the store — if it is not there it renders "no longer in memory".
- [ ] PDF is **client-side only**, which is already how it is built: `print()` calls `window.print()` against the hidden document. No server rendering, no new dependency. Confirm the print output is legible and paginated.
- [ ] Test the `.md` download filename (`reportFilename`).

**Acceptance:** after the run completes, ask the chat for a report; markdown appears in the thread, the card appears under it, both buttons produce a file.

## 5. Host the frontend on Google Cloud

Nothing exists for this yet.

- [ ] There is no `portal/Dockerfile`. The root `Dockerfile` and `Dockerfile.partners` are backend. Write one for the portal.
- [ ] `portal/next.config.ts` has only `turbopack.root`. Add `output: "standalone"` for a sane Cloud Run image.
- [ ] Deploy to Cloud Run alongside the control plane. `infra/` has `deploy_control_plane.sh`, `deploy_fleet.sh`, `deploy_partners.sh` to copy the pattern from.
- [ ] Environment: `CONTROL_PLANE_URL` (server-side, used by `app/api/copilotkit/route.ts` and the control-plane proxy) and `NEXT_PUBLIC_COPILOT_ENABLED`. Check `.env.example` for the rest.
- [ ] The portal calls the control plane with an authenticated fetch — make sure the Cloud Run service account can actually reach it, and that SSE (`/v1/runs/{id}/events`) survives the hop. Streaming through a proxy is the most likely thing to break here; test it before the take, not during.
- [ ] Decide before recording: film against the hosted URL or against `localhost:3000`. Hosted is better for the submission but is one more thing that can fail live.

## 6. Video

- [ ] Rewrite `docs/demo-video-script.md` for the new flow. The current one is a 2:20 seven-beat script built on chat-created cases and has no widget or report beat. Beats 5–7 (Firestore, Cloud Trace, Agent Engines, Agent Registry) map onto the new 0:40 Google Cloud segment and can largely survive.
- [ ] Keep the "What this film does not claim" section — those constraints are still true and are what keep the claims honest.
- [ ] Pre-open every console tab before recording; they are all slow on first load.
- [ ] Record intro + architecture (1:10), then the demo (2:00), then the console clips separately. Assemble and speed-ramp.
- [ ] Fix the Agent Registry education row description before shooting it — it currently reads "EXPERIMENTAL manual A2A registration test. Safe to delete." The one-line `curl` fix is in the old script.

## 7. Blog

- [ ] `docs/hackathon-blog.md` exists — bring it in line with what actually ships, especially the widget and report flow.
- [ ] Embed the video and link the repo.

## 8. LinkedIn post

- [ ] Short version of the blog: the problem, the human gates, one number, the video link.

## 9. Submission

- [ ] Re-read `docs/hackathon-rulebook.md` and check every required field.
- [ ] Hosted URL, repo link, video link, write-up.
- [ ] Confirm the Google Cloud product list in the submission matches what the video actually shows.

---

## Suggested order

1. Items 1 and 4 together — they are the same mechanism (`render` on a frontend tool) and share the `CopilotProvider` edit. Biggest block, do it first.
2. Item 3 dry run, to prove the arc still completes at `10s`.
3. Item 2 formatting pass, once there is real content in the thread to look at.
4. Item 5 hosting — can run in parallel with the above if someone else picks it up.
5. Item 6 script rewrite, then record.
6. Items 7–9.

## Known risks

- **The lab-created case cannot draw the review widget** without a new tool. This is the one item that could force a change to the demo flow, so settle it early.
- **`ReportStoreProvider` is unmounted**, so `ReportWidget` throws rather than degrading. Easy fix, but it means the report beat is currently untestable.
- **Deadline above `10s` loses the take.** Non-negotiable.
- **SSE through Cloud Run** — untested. If the live trace does not stream from the hosted portal, fall back to localhost for the recording.
- **Model Armor 403 on the memory phase** hits roughly 29% of runs and traps the run in `partial_failure` with no gate card. Start a fresh case if it happens.

## Static checks

Run from `portal/`. The user tests the running app; do not drive a browser.

```bash
./node_modules/.bin/tsc --noEmit
npx eslint .
```
