# Google Cloud console proofs

Thirteen stills from the live `caserelay` project (`us-central1`, Firestore database `caserelay`),
captured 2026-09-01. They back the claims in the
[GEAP capabilities](../../README.md#geap-capabilities) table, and stand in for a console tab that
is slow to paint during a live walkthrough.

Each caption says what the screen shows **and** what it does not. Numbers in a console panel are
easy to over-read; the "does not prove" lines are there so nobody has to guess.

---

## Platform — the fleet is real

### [`01-agent-runtime-deployments.png`](01-agent-runtime-deployments.png)
**Agent Platform → Deployments on Agent Runtime.** Eight deployments in `us-central1`, framework
`google-adk`, telemetry collection **Enabled** on every row. This is the count behind "eight
reasoning engines".
*Does not prove:* that all eight were invoked in any particular run. Orchestrator and intake run
in-process on the control plane.

### [`02-agent-registry-fleet.png`](02-agent-registry-fleet.png)
**Agent Registry → Agents tab**, 19 rows. Eight `A2A` entries are the fleet agent cards
(`education_liaison`, `health_coordination`, `legal_aid`, `shelter_status`, `family_services`,
`intake_authority`, `continuity_orchestrator`, `safeguarding_verifier`, all `v1.2.0`/`v1.1.0`).
The eleven `Non A2A` rows are registered by the platform itself — the eight fleet engines plus
`caserelay-chat-sessions`, `caserelay-run-sessions` and `caserelay-memory-bank`.
*Read the tab, not a total:* this is one of four registry tabs. The full registry is 24 services
registered by `agents-cli deploy` (8 A2A + 2 MCP + 14 endpoints) alongside the 11 platform rows.
"Show system-created agents" is off, which hides Google's own global `Workspace Agent`.

### [`03-agent-registry-partner-mcp-server.png`](03-agent-registry-partner-mcp-server.png)
**Agent Registry → MCP Servers → CaseRelay Partner MCP.** Registered MCP server pointing at
`caserelay-partners-….us-central1.run.app/mcp`, with the ADK snippet that resolves the toolset
from the registry.
*Does not prove:* that partner calls took this path in a given run. The default configuration
(`CASERELAY_PARTNER_MCP=0`) routes them through the in-process simulator.

---

## Governance — Google sat on the call

### [`04-agent-gateway-iam-allow-policies.png`](04-agent-gateway-iam-allow-policies.png)
**Agent Platform → Policies → IAM Allow**, 92 rules binding agent identities to Agent Registry
and Firestore resources.
**Important:** these are enforced through IAP, and the IAP authz extension
`caserelay-iap-authz-ext` is in **`iamEnforcementMode: DRY_RUN`** with `failOpen: true`. The
grants are **audited, not enforced** — see `infra/policies/apply.sh` (note 3). Do not present this
screen as access enforcement. The enforcing controls are the A2A bearer-token check at the
transport layer and the `DENY` MCP-method policy.

### [`05-agent-gateway-egress-observability.png`](05-agent-gateway-egress-observability.png)
**`caserelay-egress` gateway → Observability**, last 7 days: 17.63k authorizations, 31
authorization failures, 0.029 req/s. The `Agent → Endpoint (403 Denials)` panel shows
`gw_is_authorized: false` with `denied_count: 28`.
Note `iap_is_authorized` is **`Null`** in that row — consistent with the dry-run extension above.
The denials are the gateway's own policy, not IAP.

### [`06-model-armor-monitoring.png`](06-model-armor-monitoring.png)
**Security → Model Armor → Monitoring**, last 7 days: 7.001k total interactions, 188 flagged,
**188 blocked**. Template `caserelay-screen` appears twice by integration point — Agent Gateway
(6.7k interactions, 43 violations) and Direct Integration (0.301k, 145 violations).
This is the screening claim: flagged equals blocked, so nothing flagged was allowed through.
*Does not prove:* which prompt was blocked. For the Maya medical-records attempt, pair this with
`12-cloud-trace-span-explorer.png`.

---

## State — a named human decided, and the fleet slept

### [`07-firestore-case-memory-scopes.png`](07-firestore-case-memory-scopes.png)
**Firestore → `cases/CR-0830155742`**, `memory_scopes.check_appointment_status` expanded. Three
`disclosed_fields` (`appointment_status`, `provider_name`, `appointment_date`) against eight
`withheld_fields` including `child_name`, `dob`, `diagnosis`. `legal_basis:
hipaa_signed_authorization`, `status: context_granted`, `verdict: allow`.
This is minimum-necessary disclosure as stored data, not as a policy document.

### [`08-firestore-workflow-checkpoints.png`](08-firestore-workflow-checkpoints.png)
**Firestore → `workflow_checkpoints/wf-CR-0830155742`.** `current_step: wake`, `state:
completed`, `retry_count: 0`, with a tz-aware `due_at`. The per-service children
(`-education`, `-health`, `-legal`, `-shelter`, `-family`) are visible in the list.
This is the sleep/wake cycle: the run ended on a checkpoint rather than holding a session open.

### [`09-firestore-usage-insights.png`](09-firestore-usage-insights.png)
**Firestore → Usage Insights**, 7 days: 12,050,336 reads, 56,412 writes, 0 TTL deletes, broken
down per collection.
*Context, not a virtue:* the read volume is dominated by portal polling, not agent work.

---

## Memory and sessions

### [`10-memory-bank-memories.png`](10-memory-bank-memories.png)
**`caserelay-memory-bank` → Memories.** Real extracted facts scoped `app_name: caserelay`,
`user_id: CR-…` (one scope per case), with generate-token and LRO-latency panels.
*Honest reading:* the facts are general process observations ("the assigned officer for the
Education service is…", "when case deadlines have passed…"), not operationally specific recall.
Retrieved-memories count reads `0/s` at this instant.

### [`11-agent-engine-sessions.png`](11-agent-engine-sessions.png)
**`caserelay-run-sessions` → Sessions.** One session per orchestrator phase invocation
(`continuity-orchestrator-…`, `intake-authority-…`), keyed by `run_…` user id, Aug 25–29.
**Caveat:** this is engine `6576598509414252544`, and `infra/run_sessions.env` currently sets
`CASERELAY_RUN_SESSION_ENGINE_ID=1247643881583935488` — the orchestrator engine. So these are
historical sessions in an engine the current deployment no longer writes to, which is what the
main README means by "`caserelay-run-sessions` was provisioned but is unused". A shot of the
orchestrator engine's Sessions tab would be the better proof for current runs.

---

## Observability

### [`12-cloud-trace-span-explorer.png`](12-cloud-trace-span-explorer.png)
**Trace explorer**, last 7 days, 183,349 spans. The service facet lists `modelarmor` (9,985
spans) as its own OpenTelemetry service alongside the engine ids — these are Google-generated
spans, not CaseRelay's.
*Limitation:* ADK Agent Runtime does not export agent-reasoning spans, so this is not end-to-end
tracing of agent thought. Expand a `MCP send tools/call` root with a nested
`apply_guardrail "Google Cloud Model Armor"` child for the guardrail proof.

### [`13-cloud-logging-logs-explorer.png`](13-cloud-logging-logs-explorer.png)
**Logs Explorer**, 7 days, 779,780 entries. The field panel shows the gateway payload keys that
carry the security verdict — `enforcedGatewaySecurityP…` (23,560), `mtls.clientCertChainVerified`,
`authzPolicyInfo.policies` (17,214) — which is what makes the TLS-intercept claim checkable.

---

## Reproducing the counts

```bash
# registry, by type
gcloud alpha agent-registry agents      list --location=us-central1 --project=caserelay
gcloud alpha agent-registry mcp-servers list --location=us-central1 --project=caserelay
gcloud alpha agent-registry endpoints   list --location=us-central1 --project=caserelay

# the dry-run caveat on 04 and 05
gcloud service-extensions authz-extensions describe caserelay-iap-authz-ext \
  --location=us-central1 --project=caserelay
```
