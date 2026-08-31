# Running and deploying CaseRelay

Two paths. Pick by what you actually need.

| Path | What you get | What it costs you |
|---|---|---|
| **[Local](#local-run)** | The whole Maya arc — intake, activation gate, five-way fan-out, checkpoint, wake, quarantine, escalation gate, follow-up — in one process | ADC on any GCP project with `roles/aiplatform.user`. About five minutes. |
| **[Full cloud deploy](#full-cloud-deploy)** | Eight reasoning engines, the control plane, the portal, Agent Gateway, Model Armor, Memory Bank, Sessions | A GCP project with GEAP access, roughly two hours, and several resources that no script in this repo creates. See [What an outsider cannot reproduce](#what-an-outsider-cannot-reproduce). |

**If you are judging this submission, take the local path.** It exercises the agent logic, the
approval gates and the escalation ladder without needing anything allowlisted. The cloud
deployment is already running; its URLs are in the [README](../README.md#submission-at-a-glance) and the
console evidence for it is captured in [scenario-showcase.md](scenario-showcase.md).

---

## Local run

Nothing here touches Firestore, Pub/Sub or a deployed engine. With every `CASERELAY_URL_*` unset
the orchestrator assembles the six specialists in-process.

**Prerequisites:** Python 3.12+, [`uv`](https://docs.astral.sh/uv/), the `gcloud` CLI, and a Google
Cloud project you hold `roles/aiplatform.user` on. Node 20+ as well if you want the portal. There
is no key file to obtain.

```bash
git clone git@github.com:akhil-bot/CaseRelay.git && cd CaseRelay
uv sync && source .venv/bin/activate

gcloud auth application-default login          # every model call goes to Vertex AI
gcloud config set project YOUR_PROJECT

cp .env.example .env                           # then set CASERELAY_PROJECT_ID / GOOGLE_CLOUD_PROJECT
set -a; source .env; set +a                    # nothing loads .env for you — no dotenv in the tree

PYTHONPATH=. uvicorn backend.api.main:app --port 8000
```

`curl -s localhost:8000/health` returns `{"ok":true}` once it is up. The startup log also carries
`AG-UI chat endpoint mounted at /agui`; if that line is missing the chat panel will not answer.

Then drive a case. [`examples/local-maya-run.sh`](../examples/local-maya-run.sh) does the whole
sequence in one command:

```bash
bash examples/local-maya-run.sh
```

The portal is optional and separate — see [the portal](#the-portal) below.

---

## Full cloud deploy

### Prerequisites the scripts do not create

Have all of these before you start. Every one of them is a hard failure partway through otherwise.

| Prerequisite | Why | How |
|---|---|---|
| GEAP access on the project | Agent Registry, Agent Identity and Agent Gateway are the whole submission | Allowlist request to Google; not self-serve |
| `agents-cli` 1.4.0 | `infra/deploy_fleet.sh` shells out to it; it is **not** a `pyproject.toml` dependency | From the `google-agents-cli` package, e.g. `uv tool install google-agents-cli` |
| Docker with `buildx` | The control-plane and partner images are built `linux/amd64` locally | Docker Desktop or equivalent |
| Artifact Registry repo `caserelay` in `us-central1` | Every image pushes to `us-central1-docker.pkg.dev/$PROJECT/caserelay/...` | `gcloud artifacts repositories create caserelay --repository-format=docker --location=us-central1` |
| Firestore database **named** `caserelay` | Not `(default)` — Agent Runtime's proxy URL-encodes the parentheses and Firestore rejects the result with HTTP 400 | `gcloud firestore databases create --database=caserelay --location=us-central1` |
| Project owner or equivalent | `bootstrap.sh` enables APIs and edits the project IAM policy | — |

`infra/bootstrap.sh` handles the rest of the provisioning: API enablement, Pub/Sub topics and
subscriptions, the dead-letter policy, the Cloud Scheduler sweep job, the Firestore composite
index, the Memory Bank instance and its three custom topics, and the two Agent Engines that host
Agent Platform Sessions.

### The sequence

```bash
export CASERELAY_PROJECT=your-project           # default: caserelay
export CASERELAY_REGION=us-central1             # the fleet lives here; do not change casually
export CASERELAY_PROJECT_NUMBER=123456789012    # deploy_fleet.sh uses it to build /api URLs
export CASERELAY_SWEEP_CRON="0 * * * *"        # Cloud Scheduler sweep schedule; default hourly. Use "* * * * *" for near-immediate wakes at the cost of keeping the control plane warm.

bash infra/bootstrap.sh                         # 1. provision
bash infra/deploy_fleet.sh                      # 2. create the eight engines
bash infra/collect_endpoints.sh                 # 3. write infra/fleet_endpoints.env
bash infra/deploy_fleet.sh                      # 4. redeploy, now that URLs and identities exist
bash infra/deploy_control_plane.sh              # 5. Cloud Run control plane
bash infra/bootstrap.sh                         # 6. again — now the push subscription can be made
CASERELAY_BUILD=cloud bash infra/deploy_portal.sh   # 7. Cloud Run portal
```

Or, the same thing with the ordering and the fail-fast checks encoded:

```bash
bash infra/deploy_all.sh                        # runs 1–7 above
bash infra/deploy_all.sh --from control-plane    # resume at step 5
bash infra/deploy_all.sh --list                  # print the stages and stop
```

`infra/deploy_all.sh` is a wrapper and nothing more. It calls the same scripts in the same order
and stops at the first non-zero exit. Every stage remains individually runnable, which is what you
want when one of them fails.

### Why that order, and the two non-obvious parts

**Steps 2–4 are one logical step split by a chicken-and-egg.** `deploy_fleet.sh` refuses to deploy
the orchestrator unless all six `CASERELAY_URL_*` specialist variables are set, and those URLs
contain engine ids that do not exist until the specialists have been created. `collect_endpoints.sh`
reads them back off the live engines — along with each engine's platform-managed
`effectiveIdentity`, which the fleet needs to verify callers. The second `deploy_fleet.sh` pass is
also what bakes each engine's own public URL into its A2A agent card, so a specialist advertises
the address it is actually reachable at.

On a project where `infra/fleet_endpoints.env` is already committed and current, step 2 wires
itself correctly on the first pass and step 4 is a no-op refresh. On a genuinely fresh project the
orchestrator fails in step 2 and succeeds in step 4. That failure is expected; do not chase it.

**Step 6 is not a typo.** `bootstrap.sh` creates the authenticated Pub/Sub push subscription that
points at `$CONTROL_PLANE_URL/v1/pubsub/push`, and it needs `infra/control_plane_url.txt` to know
that URL. On the first pass the file does not exist and the script prints
`SKIP: control_plane_url.txt not found`. `deploy_control_plane.sh` writes the file on success, so
re-running `bootstrap.sh` afterwards is what completes the wake path. Without it, Cloud Scheduler
publishes every hour and nothing is subscribed to receive it.

### What each script does and refuses to do

| Script | Creates | Refuses to run when |
|---|---|---|
| `bootstrap.sh` | APIs, Pub/Sub topics + pull/push subscriptions, dead-letter, Cloud Scheduler `caserelay-sweep` (`0 * * * *`), Firestore index, Memory Bank instance + custom topics + IAM, `caserelay-chat-sessions` and `caserelay-run-sessions` engines | A recorded Memory Bank or Sessions engine id no longer resolves — delete the matching `infra/*.env` and re-run |
| `deploy_fleet.sh` | Eight reasoning engines with `--agent-identity`, plus Agent Registry entries and the IAM roles `--agent-identity` does not provision | Any pinned identity in `infra/pinned_identities.env` is empty, or the orchestrator's specialist URLs are missing |
| `collect_endpoints.sh` | `infra/fleet_endpoints.env` — eight A2A base URLs, eight resource names, eight identity principals | — |
| `deploy_partners.sh` | `caserelay-partners` on Cloud Run (five partner simulators as MCP tools) and five Agent Registry entries | Registration fails for any partner |
| `deploy_control_plane.sh` | `caserelay-control-plane` on Cloud Run — canary revision, no traffic, A2A probe, then traffic shift | `fleet_endpoints.env`, `chat_sessions.env` or `run_sessions.env` is missing or empty |
| `deploy_portal.sh` | `caserelay-portal` on Cloud Run, the portal service account, and a Secret Manager password | `infra/control_plane_url.txt` is missing |

A failed `deploy_control_plane.sh` probe leaves production traffic on the previous revision and
prints the canary URL. That is the design, not a broken deploy.

### Optional stages

**Partner MCP server.** `bash infra/deploy_partners.sh` deploys the five partner simulators as one
MCP service and registers them. It is only needed if you want partner calls to leave the engines
over MCP — which is what produces the Agent Gateway request logs and the Cloud Trace
`apply_guardrail` waterfalls. Without it, `CASERELAY_PARTNER_MCP=0` keeps the in-process simulator
in `backend/partners/sim.py`, and everything still runs:

```bash
bash infra/deploy_partners.sh
CASERELAY_PARTNER_MCP=1 CASERELAY_PARTNER_MCP_URL=https://... bash infra/deploy_fleet.sh
```

Note the ordering dependency: `deploy_fleet.sh` exits immediately if `CASERELAY_PARTNER_MCP=1` is
set without a URL. Also ensure `sim._behaviour()` in the partners service can reach the case
packet — without workspace access it silently defaults every partner to `"normal"` behaviour.

**Agent Gateway binding.** Binding is explicit opt-in, and the flag is omitted entirely rather
than passed empty when it is off — `--agent-gateway-egress=""` silently *unbinds* an engine.

```bash
CASERELAY_AGENT_GATEWAY=projects/$CASERELAY_PROJECT/locations/us-central1/agentGateways/caserelay-egress \
  bash infra/deploy_fleet.sh
```

**Gateway policies.** `infra/policies/apply.sh` is a dry run by default and prints the exact
commands it would execute. It requires an explicit step name to apply anything:

```bash
bash infra/policies/apply.sh                    # print, change nothing
bash infra/policies/apply.sh --apply deny       # one named step
```

### The portal

Every command runs from `portal/`, not the repo root — npm resolves the wrong `package.json` from
above, which is why `npm run typecheck` in particular misbehaves when run from the wrong directory.

```bash
cd portal
cp .env.local.example .env.local
npm install
npm run dev
```

Next.js reads `.env.local` on its own, so there is no sourcing step on this side. The portal has no
data of its own: it proxies everything to a control plane and shows empty screens if it cannot
reach one. `.env.local.example` offers two targets and you must pick one:

- **Deployed control plane** (the default) needs `roles/iam.serviceAccountTokenCreator` on the
  portal service account so the BFF can mint an ID token as it.
- **`http://localhost:8000`** talks to the control plane you started above, and an `http://` URL
  makes the BFF skip auth entirely — no Google credentials involved.

It worked when [localhost:3000](http://localhost:3000) renders the overview and `/admin` lists the
scenarios. That list comes from the control plane's `/v1/scenarios` through the BFF proxy, so it
appearing proves the authenticated hop and not just the UI.

The dev server owns port 3000 and a second one does not queue behind it — it exits with
`Another next dev server is already running`. Stop the first, or pass `-- --port 3001`, which the
control plane's CORS allowlist already covers.

---

## What an outsider cannot reproduce

Stated plainly so nobody wastes an afternoon on it.

1. **GEAP is allowlisted.** Agent Registry, platform-managed Agent Identity and Agent Gateway are
   not self-serve. Without access, `deploy_fleet.sh` fails at the `--agent-identity` flag and there
   is no workaround in this repo.

2. **The Agent Gateway itself is not created by any script here.** `caserelay-egress` was created
   by hand. `rollout_gateway.sh` only *describes* it to discover its resource name, and
   `policies/apply.sh` imports policies that assume it already exists. Same for the Model Armor
   template `caserelay-screen` and the Cloud DLP inspect template `caserelay-cross-scope` — the
   JSON definitions are committed in `infra/policies/`, but creating the resources from them is a
   manual step.

3. **`infra/pinned_identities.env` is project-specific.** The committed principals belong to this
   project's organisation (`org-126484209344`). A fresh project produces different ones, and the
   guard in `deploy_fleet.sh` refuses to deploy rather than shipping engines whose grants would
   silently fail. Regenerate with `collect_endpoints.sh --identities-only` after the engines exist.

4. **`infra/fleet_endpoints.env` describes whichever fleet was deployed last.** The committed copy
   points at this project's engine ids. Regenerate it after any deploy of your own.

5. **Engine builds are slow.** Each `agents-cli deploy` packages source, uploads it and builds a
   container: 10–20 minutes per engine, four in parallel by default. Two passes over eight engines
   is most of an hour before the control plane is even started.

The local path has none of these constraints, which is why it is the one recommended above.

---

## Verifying a deployment

```bash
bash infra/fleet_status.sh                  # engine id, display name, agent, identity
bash infra/collect_endpoints.sh             # regenerate endpoints and identities
source infra/fleet_endpoints.env
python infra/case_cli.py ls                 # operator CLI against the deployed fleet
python infra/cloud_e2e.py                   # the whole journey plus assertions
```

After a redeploy, wait about four minutes. A stale instance keeps serving the old image and there
is no signal that this is what you are talking to. If a result looks impossible, check the clock
before you check the code.

Full expected outputs, per-phase detail and the console paths for each piece of evidence are in
[caserelay-walkthrough.md](caserelay-walkthrough.md) and
[scenario-showcase.md](scenario-showcase.md).
