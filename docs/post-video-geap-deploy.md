# Post-video GEAP deploy checklist

Audience: same person who filmed tonight, deploying after. No fluff; just files, env vars, commands, console paths, and pass/fail checks.

---

## What is already live — do not redo

- `otel_to_cloud=True` in `backend/app/agent_server.py` — OTEL export is on.
- `GOOGLE_CLOUD_AGENT_ENGINE_ENABLE_TELEMETRY=true` — set in `infra/deploy_fleet.sh` and `infra/rollout_gateway.sh` `--update-env-vars` blocks.
- `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental` — same blocks.
- Cloud Trace gateway waterfalls (MCP + `apply_guardrail`) — Beat 8 films these; they are the gateway enforcement evidence.
- **Known limitation**: Agent Runtime starts a fresh trace context on each engine call. The control-plane trace and the engine trace share no trace ID — this is an ADK platform limitation, not a CaseRelay bug. Do not add custom spans to bridge it.

---

## What to deploy (ordered)

### 1. Add the prompt-content env var to all three deploy scripts

Official name: `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=EVENT_ONLY`  
Docs: <https://cloud.google.com/gemini-enterprise-agent-platform/scale/runtime/tracing>

`EVENT_ONLY` emits prompt/response content as span events rather than attributes, keeping span size bounded. The first two vars (already present) enable tracing; this third one is what populates the Traces tab in Agent Platform with actual message content.

**`infra/deploy_fleet.sh`** — in the `--update-env-vars` block inside `_deploy_one()` (around line 281):

```
OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=EVENT_ONLY
```

Add it alongside the existing `GOOGLE_CLOUD_AGENT_ENGINE_ENABLE_TELEMETRY=true` and `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental` entries. Same pattern — comma-separated, no spaces.

**`infra/rollout_gateway.sh`** — two `--update-env-vars` blocks: one in `_deploy_gw_engine()` (around line 236) and one in the orchestrator step which delegates to `deploy_fleet.sh`. The `deploy_fleet.sh` change covers the orchestrator; you only need to add it to `_deploy_gw_engine()` in this file.

**`infra/deploy_control_plane.sh`** — in the `gcloud run deploy` `--set-env-vars` block (around line 88). The control-plane process also uses ADK runners; without this var its spans will not carry message content either. Add alongside the existing `OTEL_SEMCONV_STABILITY_OPT_IN` entry.

### 2. Redeploy

Fleet (all 8 engines — do not subset, every specialist needs the var):

```bash
bash infra/deploy_fleet.sh
```

Or subset if only some engines need refreshing (name the keys: `education health legal shelter family verifier intake orchestrator`):

```bash
bash infra/deploy_fleet.sh education health
```

Before running: `infra/fleet_endpoints.env` and `infra/pinned_identities.env` must exist. If missing, run `bash infra/collect_endpoints.sh` first.

Control plane (after fleet is up — the control plane reads fleet URLs from `infra/fleet_endpoints.env`):

```bash
bash infra/deploy_control_plane.sh
```

This script does a canary deploy → A2A probe → traffic shift. It will fail fast if `infra/fleet_endpoints.env`, `infra/chat_sessions.env`, or `infra/run_sessions.env` are missing.

### 3. Confirm `roles/cloudtrace.agent` on agent identities

Already handled: `infra/grant_fleet_iam.sh` includes `roles/cloudtrace.agent` in its `ROLES` array (line 44). `deploy_fleet.sh` calls `grant_fleet_iam.sh` automatically for every engine that deploys successfully. No manual action needed unless an engine deployed with `CREATED_IAM_ABORTED` status — if so, run:

```bash
bash infra/grant_fleet_iam.sh <key>
```

where `<key>` is the engine key (e.g. `education`).

### 4. Optional / gated — Agent Evaluation: HALLUCINATION metric + Automatic Loss Analysis

Do **not** create eval cases without explicit approval. When approved:

- Score criterion: `HALLUCINATION` / Incorrect Tool Output Processing.
- Reference run: a Diego case where the SIS returns `enrollment_found: false` and the specialist still reports completed.
- Automatic Loss Analysis links that HALLUCINATION score back to the specific span where the model accepted a false tool output.
- This requires creating an eval dataset in Agent Platform → Evaluation → Datasets. Do this in a separate session, not tonight.

### 5. Do not stand up Semantic Governance (Preview)

Semantic Governance Policy (SGP) is in Preview and requires engines to be recreated with `identity_type=AGENT_IDENTITY` and `agent_gateway_config`. See `docs/agent-gateway-adoption-plan.md` Phase 3 for the full adoption path. One-sentence judge answer: confident wrong enrollment status is scored by Agent Evaluation HALLUCINATION; runtime denial of a tool call based on output content is SGP, which is Preview and not bound.

### 6. Remove the control-plane deferral override

Today the feed says "Lincoln Unified asked for more time" at fan-out, but the school did not say that. Maya runs `partner_behaviours={"education": "inject"}`, whose simulator branch returns the poisoned payload on **first** contact. The deferral is manufactured afterwards: `first_contact_defer` on the referral makes the control plane rewrite the specialist's status to `deferred` before the `phase_complete` message is built (`backend/api/main.py`, the `if label.startswith("3-fanout-")` block).

It is a compensator, not a design. The `defer_then_inject` simulator branch already produces a genuine two-stage partner — it defers while education is `pending` and returns the poisoned payload once education is `deferred` — but the deployed education agent has no instruction for reading `deferred: True`, so it would report `unresolved` and the arc would break. Rather than redeploy the fleet, the status was overridden in the control plane.

Two changes still outstanding, plus a redeploy:

| File | Change | Status |
|---|---|---|
| `backend/state/scenarios.py` | maya: `partner_behaviours={"education": "defer_then_inject"}`; drop `defer_first=["education"]` | **outstanding** |
| `backend/agents/education/agent.py` (and shelter, health, legal, family) | `INSTRUCTION` maps `deferred: True` → status `deferred` | **already applied in tree** — pending fleet redeploy only |
| `backend/api/main.py` | delete the `first_contact_defer` override block | **outstanding** |

The agent instruction change has been made to all five specialist agents (`education`, `shelter`, `health`, `legal`, `family`) in the current working tree. It does not take effect in the cloud until the fleet is redeployed. The two outstanding changes (`scenarios.py` and the `main.py` override block) must still be written and deployed — without them, the control-plane override is still active and the new agent instruction is never exercised.

Requires a **fleet redeploy** (education engine minimum) plus control-plane redeploy — fold both into whichever deploy happens first after the outstanding code changes are applied.

**Verify after:** run a fresh maya case and confirm the fan-out row still reads as a deferral, that it now originates from the specialist rather than the override, and that the check-back still produces the quarantine. If education comes back `unresolved` at fan-out, the instruction change did not land on the engine.

### 7. Clear `CASERELAY_STATE=memory` off the verifier engine

The safeguarding quarantine currently survives on luck. `backend/state/store.py` reads `CASERELAY_STATE` into a module-level constant at import time; the verifier engine has it set to `memory`, so `enabled()` is false and `save_screening_verdict` is a silent no-op. No case in Firestore has a `screening_verdicts/latest` document, including genuinely quarantined ones.

The beat still works because `inspect_partner_callback` and `open_escalation` run in one session on one replica, and the in-process `_verdict_cache` carries the verdict between them. Land those two calls on different replicas and `open_escalation` finds no verdict on record and refuses — the quarantine silently does not happen. That is a scaling fragility, not a cosmetic gap.

The Dockerfile does not set the variable, so it arrived at deploy time — most likely a local `.env` carrying the recommended `CASERELAY_STATE=memory` was sourced and passed through as Cloud Run env vars.

`os.environ.setdefault("CASERELAY_STATE", "firestore")` has been added to `app/agent_server.py`, matching the pattern in `infra/case_cli.py` and `cloud_e2e.py`. That only protects the absent-var case. If the variable is explicitly set on the service, also run:

```bash
gcloud run services update <verifier-service> --remove-env-vars CASERELAY_STATE
```

then redeploy the fleet. **Verify after:** run a maya case to the quarantine and confirm `cases/{case_id}/screening_verdicts/latest` now exists with a `rules` list. That document is also the artifact that proves Model Armor genuinely matched rather than failing closed — worth having for the write-up.

### 8. Re-apply the phase 8 prompt generalisation

The sweep generalized the orchestrator's phase 8 (escalation-resume chase) prompt. The change was reverted before filming because phase 8 is a load-bearing demo beat and replacing a fixed specialist call with LLM discretion introduces the same class of nondeterminism that previously caused duplicate escalation approvals. It is a correct generalisation; it was deferred, not discarded.

**Edit to reapply** — in `backend/runtime/fleet.py`, the `PhaseSpec(label="8-followup", ...)` block:

Replace:
```
"may now go out. Ask education_liaison to re-check its commitment for case {case_id} "
"using only the fields it has been granted. Then stop."
```

With:
```
"may now go out. Call get_commitment_states to identify which specialist's commitment "
"is still open, then re-ask that specialist — passing the case id so it uses only "
"its granted fields. Then stop."
```

Requires a **fleet redeploy** (orchestrator engine only) to take effect in the cloud.

**Verify after:** run a full Maya case through to the escalation-resume beat. Confirm:
1. The orchestrator calls `get_commitment_states` exactly once.
2. It then chases the specialist whose commitment is open (education, in the standard Maya run) exactly once.
3. No duplicate specialist calls appear — the orchestrator must not re-ask a specialist whose commitment is already resolved.

If the orchestrator chases both or neither specialist, or calls `get_commitment_states` more than once in the same session, the prompt is still producing nondeterministic routing and should be reverted again pending further refinement.

---

## How to test after deploy (human console checks — no browser automation)

### Traces tab

1. Agent Platform → your project → Agent Engines → pick the education engine (or whichever specialist just ran).
2. Click **Traces**.
3. Expect a session DAG showing `invoke_agent → call_llm → execute_tool` spans.
4. Expand a `call_llm` span. If `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=EVENT_ONLY` landed, you will see span events containing the prompt and model response content.
5. If the Traces tab is empty after the redeploy: this is the documented Agent Runtime limitation (engine traces do not share trace context with the control plane). Do not add custom spans. Keep Beat 8's gateway waterfall caption as the gateway enforcement evidence.

### Cloud Trace regression

1. Cloud Trace → Trace explorer.
2. Filter span name `MCP send`. You should still see the MCP + `apply_guardrail` waterfall that Beat 8 films.
3. If it is gone: the gateway env var (`CASERELAY_AGENT_GATEWAY`) was likely cleared during the redeploy. Check `deploy_fleet.sh` output for `Agent Gateway binding: OFF`.

### Diego scenario — start and verify

Create a Diego case via the portal UI or API:

```bash
# Via API (control plane must be reachable):
curl -s -X POST "$CONTROL_PLANE_URL/v1/cases" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -H "Content-Type: application/json" \
  -d '{"scenario": "diego"}' | python3 -m json.tool
```

This returns `{"case_id": "...", ...}`. Then activate it:

```bash
curl -s -X POST "$CONTROL_PLANE_URL/v1/cases/<case_id>/activate" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Or use the portal admin page (Admin → Cases → Create → Scenario: diego → Activate).

**What to confirm:**

- In partner sim logs or audit events: the SIS payload contains `"enrollment_found": false` and no `"school_name"` field. (Changed in `backend/partners/sim.py` `hallucinate` branch — this is now the real contradiction.)
- The education specialist still processes the run and may report completed — that is expected. There is no runtime revert.
- We do **not** claim Model Armor or the gateway caught this; they did not. This is a post-hoc scoring scenario.

### Loop cap

No prod test needed tonight. The `RunConfig(max_llm_calls=20)` cap is on the shared `_run` path in `backend/runtime/invoke.py` and ships with the control plane redeploy. A specialist happy path uses ~4 LLM calls; one retry loop uses ~6–8; 20 leaves headroom for orchestrator/intake without approaching the ADK default of 500.

---

## What NOT to do

- Do not build `backend/policy/reconcile.py`.
- Do not claim Model Armor or SCC caught Diego's false enrollment — they did not.
- Do not caption the MCP gateway traces as "the fleet thinking" — they are the gateway enforcing policy on outbound tool calls.
- Do not recreate the 8 engines just to bind Semantic Governance Policy (Preview, separate approved step).
- Do not change `GOOGLE_CLOUD_LOCATION=global` — gemini-3.5-flash is a global model; engine location in `us-central1` is correct.

---

## Judge-safe claims after this work

- **Can say**: every in-process ADK invoke is capped at 20 LLM calls via the official `RunConfig(max_llm_calls=20)` API — no custom loop counter.
- **Can say**: the Diego SIS fixture now returns `enrollment_found: false`, creating a real contradiction for the education agent to process. The scenario is honest: there is no runtime revert.
- **Can say**: after the redeploy, Agent Platform Traces tab will show `call_llm` span events with prompt/response content, attributed to the official `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=EVENT_ONLY` env var.
- **Can say**: `roles/cloudtrace.agent` is already on all agent identities via `infra/grant_fleet_iam.sh`.
- **Cannot say**: Agent Evaluation HALLUCINATION has been run — that requires a separate approved eval dataset creation step.
- **Cannot say**: the control-plane trace and engine trace share a trace context — they do not; this is a documented Agent Runtime limitation.
