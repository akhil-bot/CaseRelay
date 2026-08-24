# Harness

Runs a coding agent unattended until CaseRelay is ready for portal integration — Steps 1–14 of
`docs/caserelay-hardening-plan.md`.

Three files:

| File | What it is |
|---|---|
| `gate.py` | 34 executable acceptance checks. The definition of done. |
| `GUARDRAILS.md` | Injected into every agent turn. Overrides the task. |
| `run.sh` | The loop: gate → fix → commit → repeat. |

## Run it

```bash
./harness/run.sh              # fast checks only, no cloud calls, no spend
./harness/run.sh --stage 1    # one stage at a time if you want to watch
./harness/run.sh --slow       # include cloud gates: real deploys, real money
```

Work lands on `harness/portal-ready`, one commit per fix, so you can review or revert
individually. Ctrl-C any time and re-run; progress is in git.

Before the first run, do the four items in `human/CHECKLIST.md` — two of them are pass/fail for the
submission and none of them can be automated.

## Check state without running anything

```bash
python3 harness/gate.py --all          # what is still broken
python3 harness/gate.py t5.1           # one check, with full diagnostics
python3 harness/gate.py --stage 2      # one stage
```

Exit code is 0 only when everything passes, so it composes into anything.

## Why the gates matter

The plan exists because this repo is full of work that was declared finished and was not: a day-17
wake that is a prompt, a Model Armor that is a regex tuned to its own fixture, an audit writer with
no callers. An unattended loop whose stop condition is the agent's own judgement produces more of
that, faster.

So a gate passes only when it has positively observed the behaviour. It imports the app and reads
the route table, runs two concurrent cases and asserts their checkpoints do not collide, creates a
case due in 45 seconds beside one due in 17 days and asserts the sweeper fires exactly one. A gate
that cannot run fails. Absence of evidence is never a pass.

`gate.py` is read-only to the agent, and `run.sh` reverts it if touched — otherwise the cheapest
path to green is weakening the check.

## Coverage

Gate ids map onto plan steps: `t5.2` is the second task of Step 5. Stages match the plan.

| Stage | Steps | Gates |
|---|---|---|
| 0 · Unblock | 2 | `t2.1` – `t2.3` |
| 1 · Real data | 3–8 | `t3.1`, `t4.1`–`t4.4`, `t5.1`–`t5.3`, `t6.1`, `t7.1`–`t7.3`, `t8.1` |
| 2 · Control plane | 9–12 | `t9.1`–`t9.5`, `t10.1`–`t10.3`, `t11.1`–`t11.5`, `t12.1`–`t12.3` |
| 3 · Handover | 13–14 | `t13.1`, `t14.1` |

Step 1 is human-only, so it has no gate — see `human/CHECKLIST.md`.

Four gates need cloud access and are skipped without `--slow`: `t8.1` (end-to-end against the live
fleet), `t11.5` (Scheduler and Pub/Sub provisioning), `t12.2` (Cloud Run deploy). They report SKIP,
never PASS.

## When it finishes

Hand your teammate three things:

- `infra/control_plane_url.txt` — the deployed base URL
- `contracts/openapi.json` — the frozen contract
- `docs/admin-page-spec.md` — what to build against it

Then read `harness/NOTES.md` for anything the agent hit and could not resolve.
