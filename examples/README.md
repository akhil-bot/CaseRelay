# Examples

Runnable ways to make CaseRelay do something, for readers who want more than the
[README](../README.md).

| | What it does | Needs |
|---|---|---|
| **[`local-maya-run.sh`](local-maya-run.sh)** | The flagship case end to end against a control plane on your laptop: activation gate, five-way fan-out, checkpoint, wake, Model Armor quarantine, escalation gate, scoped follow-up | ADC + `roles/aiplatform.user` on any GCP project |
| **[`cloud-scenario-run.sh`](cloud-scenario-run.sh)** | Any of the nine named scenarios against the deployed control plane and its eight reasoning engines | `roles/run.invoker` on `caserelay-control-plane` |
| **[`scenarios.md`](scenarios.md)** | What each scenario demonstrates, which four do not demonstrate their own claim, and the two settings that decide whether a run reaches anything interesting | — |

---

## Start here

```bash
# shell 1 — the control plane
uv sync && source .venv/bin/activate
gcloud auth application-default login
cp .env.example .env            # edit it: CASERELAY_PROJECT_ID and GOOGLE_CLOUD_PROJECT
set -a; source .env; set +a
PYTHONPATH=. uvicorn backend.api.main:app --port 8000

# shell 2 — the case
bash examples/local-maya-run.sh
```

With every `CASERELAY_URL_*` unset the orchestrator assembles the six specialists in-process, so no
deployed endpoint is involved and nothing is written to Firestore. Full setup notes, including the
portal, are in [docs/deploy.md](../docs/deploy.md).

## Against the deployed fleet

```bash
bash examples/cloud-scenario-run.sh priya
```

This reads the target URL from `infra/control_plane_url.txt`, which
`infra/deploy_control_plane.sh` writes on its last successful deploy, so it cannot drift from what
was actually shipped. Override with `CASERELAY_CONTROL_PLANE_URL` if you need a different one.

Both scripts create **synthetic** cases. Every case is fictional and contains no real child data.
Each script prints the `DELETE` command for the case it made; deleting a case deletes its run
events with it.

---

## Doing it by hand

Nine endpoints cover the whole journey. The full contract is
[`contracts/openapi.json`](../contracts/openapi.json).

```bash
CP=http://localhost:8000                    # or the deployed URL, with a bearer token

# what scenarios exist
curl -s "$CP/v1/scenarios"

# create, run, and release the activation gate
curl -s -X POST "$CP/v1/cases" -H 'content-type: application/json' \
  -d '{"scenario":"maya","due_in":"10s"}'
curl -s -X POST "$CP/v1/cases/$CASE/runs"
curl -s -X POST "$CP/v1/cases/$CASE/activate" -H 'content-type: application/json' \
  -d '{"supervisor_id":"supervisor-001"}'

# watch a run as it happens (SSE), or read the whole history back afterwards
curl -N "$CP/v1/runs/$RUN/events"
curl -s "$CP/v1/cases/$CASE/events"

# the approval queue, and ruling on one
curl -s "$CP/v1/approvals"
curl -s -X POST "$CP/v1/approvals/$APPROVAL/decide" -H 'content-type: application/json' \
  -d '{"decision":"approve","decided_by":"supervisor-001"}'

# the audit trail: delegation, disclosure, quarantine, approval, completion
curl -s "$CP/v1/cases/$CASE/audit"
```

Against the deployed control plane every call needs
`-H "Authorization: Bearer $(gcloud auth print-identity-token)"`. It is auth-required; anonymous
requests return 403.

Locally there is no Pub/Sub, so the wake has to be stood in for once the deadline has passed —
`local-maya-run.sh` does this and explains why it is possible at all:

```bash
curl -s -X POST "$CP/v1/workflows/sweep"
curl -s -X POST "$CP/v1/pubsub/push" -H 'content-type: application/json' \
  -d "{\"message\":{\"data\":\"$(printf '{"event_type":"workflow_wake","case_id":"%s"}' "$CASE" | base64)\"}}"
```

## Also worth knowing about

`infra/case_cli.py` is the operator CLI for the deployed fleet, and `infra/cloud_e2e.py` runs the
whole journey with assertions. Both need `source infra/fleet_endpoints.env` first. See
[docs/deploy.md](../docs/deploy.md#verifying-a-deployment).
