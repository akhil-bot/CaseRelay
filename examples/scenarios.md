# The nine scenarios

Each scenario is a named specification in `backend/state/scenarios.py` that generates a synthetic
case: five referrals to five partner organisations, each with a per-service *partner behaviour*
that decides how that partner's simulated system replies. **The agents are never told a scenario
is running.** They read a case out of Firestore and react to whatever the partner returns.

Run any of them:

```bash
bash examples/cloud-scenario-run.sh priya     # against the deployed control plane
```

Read this page before drawing a conclusion from a run. Four of the nine do not demonstrate what
their own definition claims, and that is documented rather than hidden.

---

## What holds up

| Scenario | Verdict | Wall clock | What it exercises that the others do not |
|---|---|---|---|
| **noah** | Works as specified | ~1.5 min | The clean path — the control that shows the ladder only fires when something is wrong |
| **priya** | Works as specified | ~2.5 min | The escalation ladder run to its end: a silent provider, chased, still silent, handed to a named human |
| **rosa** | Works | ~2 min | A partner asking for data outside the referral's scope, refused at fan-out, then recovered |
| **theo** | Works | 2–3 min | A partner reply that cannot be parsed at all, recovered by the same follow-up ladder |
| **maya** | The flagship | ~3 min | Deferral → check-back → Model Armor quarantine → supervisor escalation → scoped follow-up → all five close |

**priya** is the strongest single piece of evidence on this page, and it is not the flagship. It is
the only scenario that reaches `10-unanswered`, the last rung of the ladder. Maya's district
answers its follow-up, so Maya never gets there. Priya's provider is configured to time out on the
original request *and* on the chase, which is the only way to make the ladder run out of rungs and
reach a human. What arrives is a `supervisor_notice` document in Firestore — a machine handing work
to a person, with the recipient, the policy basis and the reason on it.

**rosa** is the layer underneath Maya's quarantine. The education liaison refuses an out-of-scope
request on the strength of its own scope, before any safeguarding machinery is reached. What makes
the refusal robust is not the refusal: the authority gateway had already projected the case down to
three fields before the agent saw anything, so `clinical_notes` and `diagnosis` were among the
eleven fields withheld. An agent cannot leak what was never handed to it.

## What does not

Listed here rather than quietly dropped, because someone who finds one of these in the source and
runs it should find this section first.

| Scenario | Why it does not demonstrate its claim |
|---|---|
| **kai** | Both failures do occur (legal returns garbage, health times out) and the health escalation now fires. But legal did not recover through the nudge on the verified run, so it ends with two open commitments rather than the single health escalation its spec claims. |
| **diego** | The SIS returns `enrollment_found: false` and the education specialist may still close the commitment. That is the hallucination the scenario surfaces — but nothing in the activity feed identifies the false basis, and **neither Model Armor nor the gateway caught it.** It is evaluation fodder for GEAP Agent Evaluation HALLUCINATION scoring, not a visible guardrail. |
| **ellis** | Claims a duplicate callback is discarded by idempotency logic. The `duplicate` branch in the partner simulator is a no-op that falls through to the normal reply, so the callback only ever arrives once and the idempotency path is never reached. The claimed behaviour was not observed. |
| **amara** | Claims three staggered deadlines across several weeks with memory carried across sessions. Under a compressed deadline all five partners answer during fan-out, nothing is left open, and no wake fires. Run uncompressed it would take five weeks. A limitation of the demonstration, not a defect in the code. |

Full captured evidence for every row above — Firestore documents, Cloud Logging output, Agent
Gateway request logs, Cloud Trace waterfalls, Memory Bank contents, and the console path for each —
is in [../docs/scenario-showcase.md](../docs/scenario-showcase.md).

---

## Two things that decide whether a run reaches anything interesting

### `due_in` must be short

This is not a commitment deadline. It is the window across which the five per-commitment
checkpoints are spread, at `now + due_in × (i+1)/5`, computed during the checkpoint phase. The wake
phase asks for already-due checkpoints seven to twelve seconds later.

At `10s` the earliest checkpoint has fired and the run continues into the wake, quarantine,
follow-up and memory phases. At `60s` it has not, and the run ends early with the interesting half
of the arc unreachable. Ten seconds is what makes a seventeen-day story fit in two minutes.

Both example scripts default to `DUE_IN=10s`. Overriding it upward is the most common way to get a
run that looks broken and is not.

### Every scenario stops at the activation gate

The first run does intake, emits `awaiting_supervisor`, parks with
`current_phase="gate:activation"` and closes its stream. It resumes as a **new run with a new run
id** only when a real `POST /v1/cases/{id}/activate` arrives carrying the identity of whoever
decided. That is the same gate on all nine scenarios, and it is the reason a CaseRelay run is never
one run.

No phase can release it. The orchestrator has no `activate_case` tool — the capability was removed
from the tool surface rather than forbidden in the prompt, because with the tool present and the
prompt saying a supervisor signs off, the model approved its own work anyway.

---

## What is compressed, and what that costs

Because the deadline window is squeezed into seconds, the wake phase runs inside the same run that
set the checkpoint. **Nothing in a compressed run is woken autonomously by Cloud Scheduler** — the
one-minute Pub/Sub sweep is the real mechanism, and it is what runs the uncompressed case, but it
is not what a two-minute demo shows. Read a compressed run as proof that the *ladder* works, not
that the *timer* does.

The timer has been observed separately: a Maya run ended on its checkpoints and a sweep restarted
it with a 23-second gap and nobody at the keyboard.
