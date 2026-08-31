# Guardrails

These are injected into every agent invocation. They override anything in the task description.

## The gates are not yours to edit

`harness/gate.py` is **read-only**. After every task the driver checks it for modification and
reverts any edit before the next gate run, so weakening a gate cannot make a task pass — it can
only waste an attempt.

If a gate looks wrong, do not edit it. Write the argument into `harness/NOTES.md` under
`## Gate disputes` and move on. A human will read it.

## Do not fake the thing you are being asked to build

This plan was written against code that looked finished and was not. Adding more of that is worse
than leaving the task undone. Specifically, never:

- hardcode an id, timestamp, status or outcome that the system is supposed to compute
- stub, freeze or inject a clock in a production code path
- add a test-only endpoint or flag that mutates state so a demo works
- tune a pattern, threshold or branch to the exact contents of a fixture
- catch an exception and return a success-shaped value
- mark a commitment, run or workflow complete without the work having happened

If you cannot make a gate pass honestly, stop and record why in `NOTES.md`. A blocked task with a
clear explanation is a good outcome. A passing task with a faked implementation is not.

## Blast radius

Never, under any circumstances:

- run `infra/deploy_fleet.sh` or otherwise redeploy the eight reasoning engines — they work, they
  are out of scope until Stage 4, and a bad redeploy costs hours
- delete Firestore data unless the document carries `test_case: true`
- run `gcloud ... delete` against any resource you did not create in this run
- force-push, rewrite history, or commit to `main`
- change `GOOGLE_CLOUD_LOCATION=global` to match the engine region — `gemini-3.5-flash` is not
  served from `us-central1` and "fixing" the mismatch breaks all eight agents
- add a `/demo/*` route back

## Scope

Work only on the current task. Touch only the files it names, plus whatever they directly require.
If the task cannot be completed without changing a file it does not name, do it, but say so in your
final message so the next iteration knows.

Do not opportunistically fix unrelated problems you notice. Add them to `NOTES.md` under
`## Observed, out of scope` instead. Another task probably owns them.

## Style

- No new markdown files unless the task explicitly asks for one.
- No code comments that narrate the change or explain what the next line does. Comment only a
  constraint the code cannot express.
- Match the surrounding code's naming and idiom.
- Do not add tests unless the task says to. The gates are the verification.

## Finishing

Before you finish, run your own task's gate:

```
python harness/gate.py <task_id>
```

If it fails, keep working. If it passes, append one line to `harness/NOTES.md` under `## Progress`
saying what you did and anything the next task needs to know. The driver commits for you.
