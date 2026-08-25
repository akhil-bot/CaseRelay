# Agent Gateway Adoption Plan — CaseRelay

Executable runbook. All commands use actual project values. Run from the repo root.

**Honest framing:** Phase 0 alone creates a gateway resource but governs nothing — it is not yet "using Agent Gateway." Phase 1 routes fleet egress through the gateway with real Model Armor screening on LLM/A2A traffic. Phase 2 is the real prize: partner services become MCP servers, making all partner traffic gateway-governed and removing `armor.py` from application code entirely.

---

## Pre-flight

| Check | Command | Expected |
|---|---|---|
| gcloud auth | `gcloud auth list --filter=status:ACTIVE --format='value(account)'` | Your account |
| Correct project | `gcloud config get project` | `caserelay` |
| Fleet healthy | `source infra/fleet_endpoints.env && curl -sf -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $(gcloud auth print-access-token)" "${CASERELAY_URL_SHELTER%/api}/api/a2a/shelter/.well-known/agent-card.json"` | `200` |
| Working tree | `git status --porcelain` | Clean (stash or commit first) |
| fleet_endpoints.env sourced | `echo $CASERELAY_IDENTITY_SHELTER` | Non-empty principal |

**Before every phase:** source fleet endpoints:
```
source infra/fleet_endpoints.env
```

**Important:** run demo cases one at a time. Concurrent runs hit Vertex AI per-engine 429 rate limits.

---

## Reference: Fleet IDs

| Agent | Engine ID | Identity Principal |
|---|---|---|
| orchestrator | `1247643881583935488` | `agents.global.org-126484209344.system.id.goog/resources/aiplatform/projects/189353698936/locations/us-central1/reasoningEngines/1247643881583935488` |
| education | `6205121908900364288` | `agents.global.org-126484209344.system.id.goog/resources/aiplatform/projects/189353698936/locations/us-central1/reasoningEngines/6205121908900364288` |
| health | `2657974252392677376` | `agents.global.org-126484209344.system.id.goog/resources/aiplatform/projects/189353698936/locations/us-central1/reasoningEngines/2657974252392677376` |
| legal | `3107630527687950336` | `agents.global.org-126484209344.system.id.goog/resources/aiplatform/projects/189353698936/locations/us-central1/reasoningEngines/3107630527687950336` |
| shelter | `8689420053348614144` | `agents.global.org-126484209344.system.id.goog/resources/aiplatform/projects/189353698936/locations/us-central1/reasoningEngines/8689420053348614144` |
| family | `7993613910919872512` | `agents.global.org-126484209344.system.id.goog/resources/aiplatform/projects/189353698936/locations/us-central1/reasoningEngines/7993613910919872512` |
| verifier | `3044580132904763392` | `agents.global.org-126484209344.system.id.goog/resources/aiplatform/projects/189353698936/locations/us-central1/reasoningEngines/3044580132904763392` |
| intake | `8701101264882106368` | `agents.global.org-126484209344.system.id.goog/resources/aiplatform/projects/189353698936/locations/us-central1/reasoningEngines/8701101264882106368` |

---

## Phase 0 — Gateway Infrastructure (no fleet impact)

**Time:** ~15 min  
**Risk:** None — creates cloud resources only, does not touch any running engine  
**If it goes wrong:** delete the gateway resource, extensions, and policies. Fleet is unaffected.

### 0.1 Enable required APIs

```bash
gcloud services enable \
  networkservices.googleapis.com \
  networksecurity.googleapis.com \
  dns.googleapis.com \
  --project=caserelay
```

**Verify:**
```bash
gcloud services list --project=caserelay --enabled --filter="NAME:(networkservices OR networksecurity OR dns)" --format="value(NAME)" | sort
```
Expected: three lines — `dns.googleapis.com`, `networksecurity.googleapis.com`, `networkservices.googleapis.com`.

### 0.2 Create the Agent Gateway (egress)

```bash
cat > /tmp/caserelay-egress-gateway.yaml <<'EOF'
name: caserelay-egress
protocols:
  - MCP
googleManaged:
  governedAccessPath: AGENT_TO_ANYWHERE
registries:
  - //agentregistry.googleapis.com/projects/caserelay/locations/us-central1
EOF

gcloud network-services agent-gateways import caserelay-egress \
  --source=/tmp/caserelay-egress-gateway.yaml \
  --location=us-central1 \
  --project=caserelay
```

**Verify:**
```bash
gcloud network-services agent-gateways describe caserelay-egress \
  --location=us-central1 --project=caserelay \
  --format="value(name,state)"
```
Expected: resource name containing `caserelay-egress` and state not `ERROR`.

### 0.3 Create IAP authorization extension (DRY_RUN)

```bash
cat > /tmp/caserelay-iap-authz-ext.yaml <<'EOF'
name: caserelay-iap-authz-ext
service: iap.googleapis.com
failOpen: true
timeout: 1s
metadata:
  iapPolicyVersion: "V1"
  iamEnforcementMode: "DRY_RUN"
EOF

gcloud beta service-extensions authz-extensions import caserelay-iap-authz-ext \
  --source=/tmp/caserelay-iap-authz-ext.yaml \
  --location=us-central1 \
  --project=caserelay
```

**Verify:**
```bash
gcloud beta service-extensions authz-extensions describe caserelay-iap-authz-ext \
  --location=us-central1 --project=caserelay \
  --format="value(name)"
```

### 0.4 Create IAP authorization policy

```bash
cat > /tmp/caserelay-iap-authz-policy.yaml <<'EOF'
name: caserelay-iap-authz-policy
target:
  resources:
    - "projects/caserelay/locations/us-central1/agentGateways/caserelay-egress"
policyProfile: REQUEST_AUTHZ
action: CUSTOM
customProvider:
  authzExtension:
    resources:
      - "projects/caserelay/locations/us-central1/authzExtensions/caserelay-iap-authz-ext"
EOF

gcloud network-security authz-policies import caserelay-iap-authz-policy \
  --source=/tmp/caserelay-iap-authz-policy.yaml \
  --location=us-central1 \
  --project=caserelay
```

**Verify:**
```bash
gcloud network-security authz-policies describe caserelay-iap-authz-policy \
  --location=us-central1 --project=caserelay \
  --format="value(name)"
```

### 0.5 Create Model Armor authorization extension

```bash
cat > /tmp/caserelay-ma-authz-ext.yaml <<'EOF'
name: caserelay-ma-authz-ext
service: modelarmor.us-central1.rep.googleapis.com
metadata:
  model_armor_settings: '[
    {
    "response_template_id": "projects/caserelay/locations/us-central1/templates/caserelay-screen",
    "request_template_id": "projects/caserelay/locations/us-central1/templates/caserelay-screen"
    }
  ]'
failOpen: true
timeout: 1s
EOF

gcloud beta service-extensions authz-extensions import caserelay-ma-authz-ext \
  --source=/tmp/caserelay-ma-authz-ext.yaml \
  --location=us-central1 \
  --project=caserelay
```

**Verify:**
```bash
gcloud beta service-extensions authz-extensions describe caserelay-ma-authz-ext \
  --location=us-central1 --project=caserelay \
  --format="value(name)"
```

### 0.6 Create Model Armor content authorization policy

```bash
cat > /tmp/caserelay-ma-authz-policy.yaml <<'EOF'
name: caserelay-ma-authz-policy
target:
  resources:
    - "projects/caserelay/locations/us-central1/agentGateways/caserelay-egress"
policyProfile: CONTENT_AUTHZ
action: CUSTOM
customProvider:
  authzExtension:
    resources:
      - "projects/caserelay/locations/us-central1/authzExtensions/caserelay-ma-authz-ext"
httpRules:
  - to:
      operations: [ { "paths": [ { "prefix": "/" } ] } ]
    when: >
      request.headers['content-type'] == 'application/json' ||
      request.headers['content-type'].startsWith('text/')
EOF

gcloud network-security authz-policies import caserelay-ma-authz-policy \
  --source=/tmp/caserelay-ma-authz-policy.yaml \
  --location=us-central1 \
  --project=caserelay
```

**Verify:**
```bash
gcloud network-security authz-policies describe caserelay-ma-authz-policy \
  --location=us-central1 --project=caserelay \
  --format="value(name)"
```

### 0.7 Grant gateway service account Model Armor roles

The gateway's service agent is `service-189353698936@gcp-sa-dep.iam.gserviceaccount.com`.

```bash
gcloud projects add-iam-policy-binding caserelay \
  --member=serviceAccount:service-189353698936@gcp-sa-dep.iam.gserviceaccount.com \
  --role=roles/modelarmor.calloutUser \
  --condition=None --quiet

gcloud projects add-iam-policy-binding caserelay \
  --member=serviceAccount:service-189353698936@gcp-sa-dep.iam.gserviceaccount.com \
  --role=roles/serviceusage.serviceUsageConsumer \
  --condition=None --quiet

gcloud projects add-iam-policy-binding caserelay \
  --member=serviceAccount:service-189353698936@gcp-sa-dep.iam.gserviceaccount.com \
  --role=roles/modelarmor.user \
  --condition=None --quiet
```

Also grant the Agent Runtime service agent for ingress Model Armor (if you add ingress later):
```bash
gcloud projects add-iam-policy-binding caserelay \
  --member=serviceAccount:service-189353698936@gcp-sa-aiplatform-re.iam.gserviceaccount.com \
  --role=roles/modelarmor.calloutUser \
  --condition=None --quiet

gcloud projects add-iam-policy-binding caserelay \
  --member=serviceAccount:service-189353698936@gcp-sa-aiplatform-re.iam.gserviceaccount.com \
  --role=roles/modelarmor.user \
  --condition=None --quiet
```

**Verify:**
```bash
gcloud projects get-iam-policy caserelay --flatten="bindings[].members" \
  --filter="bindings.members:gcp-sa-dep AND bindings.role:modelarmor" \
  --format="table(bindings.role, bindings.members)"
```

### Phase 0 checkpoint

At this point you have: a real Agent Gateway with IAP (dry-run) + Model Armor policies attached. The fleet is untouched. You can show the gateway in the Cloud Console under Agent Gateway. **This does not constitute using Agent Gateway** until engines are bound in Phase 1.

---

## Phase 1 — Bind Fleet to Gateway

**Time:** ~15 min  
**Risk:** Medium — engine traffic routes through gateway. DRY_RUN IAP means nothing is blocked, but Model Armor screening activates on LLM/A2A calls.  
**If it goes wrong:** PATCH the engine back to empty config (rollback command given inline).

### Pre-flight: engine creation date check

Gateway binding requires engines created AFTER April 29, 2026 (per [Route Runtime traffic docs](https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/runtime/agent-gateway-runtime-deploy)). If any engine was created before that date, the PATCH will fail. Verify:

```bash
TOKEN=$(gcloud auth print-access-token)
for ENGINE_ID in 8689420053348614144 1247643881583935488 6205121908900364288 2657974252392677376 3107630527687950336 7993613910919872512 3044580132904763392 8701101264882106368; do
  CREATE_TIME=$(curl -s -H "Authorization: Bearer $TOKEN" \
    "https://us-central1-aiplatform.googleapis.com/v1/projects/caserelay/locations/us-central1/reasoningEngines/$ENGINE_ID" \
    | python3 -c "import json,sys; print(json.load(sys.stdin).get('createTime','UNKNOWN'))")
  echo "$ENGINE_ID: created $CREATE_TIME"
done
```

All dates must be after `2026-04-29`. If ANY engine is older, it must be redeployed via `deploy_fleet.sh` before proceeding.

### 1.1 Canary: bind shelter engine

```bash
curl -s -X PATCH \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d '{
    "spec": {
      "deploymentSpec": {
        "agentGatewayConfig": {
          "agentToAnywhereConfig": {
            "agentGateway": "projects/caserelay/locations/us-central1/agentGateways/caserelay-egress"
          }
        }
      }
    }
  }' \
  "https://us-central1-aiplatform.googleapis.com/v1/projects/caserelay/locations/us-central1/reasoningEngines/8689420053348614144?updateMask=spec.deploymentSpec.agentGatewayConfig"
```

**Verify binding took effect:**
```bash
curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://us-central1-aiplatform.googleapis.com/v1/projects/caserelay/locations/us-central1/reasoningEngines/8689420053348614144" \
  | python3 -c "import json,sys; cfg=json.load(sys.stdin).get('spec',{}).get('deploymentSpec',{}).get('agentGatewayConfig',{}); print(json.dumps(cfg, indent=2) if cfg else 'NOT BOUND')"
```
Expected: JSON with `agentToAnywhereConfig.agentGateway` containing `caserelay-egress`.

**Verify shelter still serves:**
```bash
curl -sf -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "${CASERELAY_URL_SHELTER%/api}/api/a2a/shelter/.well-known/agent-card.json"
```
Expected: `200`.

> **ROLLBACK** — if shelter breaks, unbind immediately:
> ```bash
> curl -s -X PATCH \
>   -H "Authorization: Bearer $(gcloud auth print-access-token)" \
>   -H "Content-Type: application/json; charset=utf-8" \
>   -d '{"spec":{"deploymentSpec":{"agentGatewayConfig":{}}}}' \
>   "https://us-central1-aiplatform.googleapis.com/v1/projects/caserelay/locations/us-central1/reasoningEngines/8689420053348614144?updateMask=spec.deploymentSpec.agentGatewayConfig"
> ```

### 1.2 Bind remaining seven engines

Only proceed if shelter canary is healthy.

```bash
TOKEN=$(gcloud auth print-access-token)
for ENGINE_ID in 1247643881583935488 6205121908900364288 2657974252392677376 3107630527687950336 7993613910919872512 3044580132904763392 8701101264882106368; do
  echo "Binding $ENGINE_ID..."
  curl -s -X PATCH \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json; charset=utf-8" \
    -d '{
      "spec": {
        "deploymentSpec": {
          "agentGatewayConfig": {
            "agentToAnywhereConfig": {
              "agentGateway": "projects/caserelay/locations/us-central1/agentGateways/caserelay-egress"
            }
          }
        }
      }
    }' \
    "https://us-central1-aiplatform.googleapis.com/v1/projects/caserelay/locations/us-central1/reasoningEngines/$ENGINE_ID?updateMask=spec.deploymentSpec.agentGatewayConfig" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('spec',{}).get('deploymentSpec',{}).get('agentGatewayConfig',{}).get('agentToAnywhereConfig',{}).get('agentGateway','FAILED'))"
  sleep 2
done
```

**Verify all eight bound:**
```bash
TOKEN=$(gcloud auth print-access-token)
for ENGINE_ID in 8689420053348614144 1247643881583935488 6205121908900364288 2657974252392677376 3107630527687950336 7993613910919872512 3044580132904763392 8701101264882106368; do
  GW=$(curl -s -H "Authorization: Bearer $TOKEN" \
    "https://us-central1-aiplatform.googleapis.com/v1/projects/caserelay/locations/us-central1/reasoningEngines/$ENGINE_ID" \
    | python3 -c "import json,sys; print(json.load(sys.stdin).get('spec',{}).get('deploymentSpec',{}).get('agentGatewayConfig',{}).get('agentToAnywhereConfig',{}).get('agentGateway','NOT BOUND'))")
  echo "$ENGINE_ID: $GW"
done
```
All eight should show `projects/caserelay/locations/us-central1/agentGateways/caserelay-egress`.

### 1.3 Register essential API endpoints for gateway allowlist

The gateway adopts default-deny. Agents need egress to Vertex AI, Agent Registry, telemetry, and Firestore. Register each:

```bash
# Vertex AI (LLM calls + sessions + memory)
gcloud agent-registry endpoints create caserelay-vertexai \
  --project=caserelay --location=us-central1 \
  --display-name="Vertex AI" \
  --uri="https://us-central1-aiplatform.googleapis.com"

gcloud agent-registry endpoints create caserelay-vertexai-mtls \
  --project=caserelay --location=us-central1 \
  --display-name="Vertex AI mTLS" \
  --uri="https://us-central1-aiplatform.mtls.googleapis.com"

# Agent Registry discovery
gcloud agent-registry endpoints create caserelay-agent-registry \
  --project=caserelay --location=us-central1 \
  --display-name="Agent Registry" \
  --uri="https://agentregistry.googleapis.com"

# Telemetry
gcloud agent-registry endpoints create caserelay-telemetry \
  --project=caserelay --location=us-central1 \
  --display-name="Telemetry" \
  --uri="https://telemetry.googleapis.com"

gcloud agent-registry endpoints create caserelay-telemetry-mtls \
  --project=caserelay --location=us-central1 \
  --display-name="Telemetry mTLS" \
  --uri="https://telemetry.mtls.googleapis.com"

# Logging
gcloud agent-registry endpoints create caserelay-logging \
  --project=caserelay --location=us-central1 \
  --display-name="Cloud Logging" \
  --uri="https://logging.googleapis.com"

# Firestore
gcloud agent-registry endpoints create caserelay-firestore \
  --project=caserelay --location=us-central1 \
  --display-name="Firestore" \
  --uri="https://firestore.googleapis.com"

# Model Armor (agents call this directly too)
gcloud agent-registry endpoints create caserelay-modelarmor \
  --project=caserelay --location=us-central1 \
  --display-name="Model Armor" \
  --uri="https://modelarmor.us-central1.rep.googleapis.com"
```

Grant all 8 agents `roles/iap.egressor` on each endpoint. Since IAP is in DRY_RUN, missing grants won't block traffic yet, but they will generate audit log entries showing what would be denied:

```bash
ENDPOINTS=(caserelay-vertexai caserelay-vertexai-mtls caserelay-agent-registry caserelay-telemetry caserelay-telemetry-mtls caserelay-logging caserelay-firestore caserelay-modelarmor)
IDENTITIES=(
  "principal://agents.global.org-126484209344.system.id.goog/resources/aiplatform/projects/189353698936/locations/us-central1/reasoningEngines/1247643881583935488"
  "principal://agents.global.org-126484209344.system.id.goog/resources/aiplatform/projects/189353698936/locations/us-central1/reasoningEngines/6205121908900364288"
  "principal://agents.global.org-126484209344.system.id.goog/resources/aiplatform/projects/189353698936/locations/us-central1/reasoningEngines/2657974252392677376"
  "principal://agents.global.org-126484209344.system.id.goog/resources/aiplatform/projects/189353698936/locations/us-central1/reasoningEngines/3107630527687950336"
  "principal://agents.global.org-126484209344.system.id.goog/resources/aiplatform/projects/189353698936/locations/us-central1/reasoningEngines/8689420053348614144"
  "principal://agents.global.org-126484209344.system.id.goog/resources/aiplatform/projects/189353698936/locations/us-central1/reasoningEngines/7993613910919872512"
  "principal://agents.global.org-126484209344.system.id.goog/resources/aiplatform/projects/189353698936/locations/us-central1/reasoningEngines/3044580132904763392"
  "principal://agents.global.org-126484209344.system.id.goog/resources/aiplatform/projects/189353698936/locations/us-central1/reasoningEngines/8701101264882106368"
)

for EP in "${ENDPOINTS[@]}"; do
  for IDENT in "${IDENTITIES[@]}"; do
    gcloud iap web add-iam-policy-binding \
      --resource-type=agent-registry \
      --endpoint="$EP" \
      --region=us-central1 \
      --project=caserelay \
      --member="$IDENT" \
      --role=roles/iap.egressor 2>/dev/null || echo "WARN: grant failed for $EP / $IDENT"
    sleep 1
  done
done
```

### 1.4 E2E verification

Run a single clean-path demo case and verify it completes normally. The gateway is in DRY_RUN for IAP, so nothing should be blocked. Model Armor screens LLM calls and A2A calls passing through the gateway.

> **FLEET ROLLBACK** — if the fleet is broken after binding:
> ```bash
> TOKEN=$(gcloud auth print-access-token)
> for ENGINE_ID in 8689420053348614144 1247643881583935488 6205121908900364288 2657974252392677376 3107630527687950336 7993613910919872512 3044580132904763392 8701101264882106368; do
>   curl -s -X PATCH \
>     -H "Authorization: Bearer $TOKEN" \
>     -H "Content-Type: application/json; charset=utf-8" \
>     -d '{"spec":{"deploymentSpec":{"agentGatewayConfig":{}}}}' \
>     "https://us-central1-aiplatform.googleapis.com/v1/projects/caserelay/locations/us-central1/reasoningEngines/$ENGINE_ID?updateMask=spec.deploymentSpec.agentGatewayConfig"
>   sleep 1
> done
> ```

### Phase 1 checkpoint

After Phase 1: all 8 agents route egress through Agent Gateway. Gateway Model Armor screens LLM/A2A traffic using `caserelay-screen` (which includes the DLP custom infoTypes). IAP logs identity/endpoint decisions in audit-only mode. This is genuine GEAP adoption — the gateway is governing real traffic.

What the gateway does NOT govern yet: in-process `sim.school_callback()` inside the verifier — the partner payload never traverses the network, so Model Armor at the gateway cannot see it. That is Phase 2's job.

---

## Phase 2 — Partner Simulator as MCP Server

**Time:** ~2-4 hours  
**Risk:** High — changes agent tool bindings and deployment. Requires fleet redeploy.  
**If it goes wrong:** revert the code changes, redeploy the fleet with `deploy_fleet.sh`.

### Design decisions

#### One MCP server or five?

**Recommendation: five separate MCP servers** (school, clinic, legal-aid, shelter, family-services).

Reasoning: the entire point of IAP at the gateway is per-identity per-endpoint access control. If all five partner services are tools on a single MCP server, every agent gets `roles/iap.egressor` on that one server — which means the education agent CAN reach the clinic tool. You'd need MCP tool-level authz policies to restrict further (the gateway supports this via `mcp.methods.params` conditions), but separating into five servers gives you clean identity-level isolation without extra policy complexity. Each agent identity gets `roles/iap.egressor` only on its own partner MCP server.

| MCP Server | Partner functions | Agents granted access |
|---|---|---|
| `caserelay-partner-school` | `school_status`, `school_callback` | education, verifier |
| `caserelay-partner-clinic` | `clinic_status` | health |
| `caserelay-partner-legal` | `legal_status` | legal |
| `caserelay-partner-shelter` | `shelter_status` | shelter |
| `caserelay-partner-family` | `family_status` | family |

#### How `case_id` and scenario control survive

Today, `sim.school_callback(referral_id, case_id=case_id)` calls `_behaviour(case_id, "education")` which reads `partner_behaviour` from the Firestore case packet. The transport changes from function call to MCP tool call, but the logic is identical:

1. MCP tool call includes `referral_id` and `case_id` as arguments
2. The MCP server imports `backend.partners.sim` and calls the same function
3. `_behaviour()` reads Firestore — the MCP server needs Firestore access (same `roles/datastore.user` grant)
4. The MCP server's Cloud Run service account needs the same IAM grants as the agents

The `partner_behaviours` set at case-creation time by the scenario factory continue to work unchanged. The MCP server is just a transport wrapper.

#### What happens to `sim.py`

`backend/partners/sim.py` remains as-is — it contains the domain logic (behaviour lookup, response construction). The new MCP server imports and wraps it. No logic is duplicated.

#### How ADK's McpToolset is wired into agents

Each specialist agent replaces its direct `sim.*` import with an `McpToolset` that connects to the remote MCP server. Example for the education agent:

```python
# Before (current)
from backend.partners import sim

def query_school(referral_id: str, case_id: str | None = None) -> dict:
    return sim.school_callback(referral_id, case_id=case_id)

# After (Phase 2)
from google.adk.tools.mcp_tool import McpToolset, SseServerParams

school_tools = McpToolset(
    connection_params=SseServerParams(
        url=os.environ["CASERELAY_PARTNER_SCHOOL_URL"],
    )
)
# school_tools is passed to Agent(tools=[...]) — ADK handles the MCP call
```

The agent no longer defines a local `query_school` function. ADK's `McpToolset` exposes the MCP server's tools directly. The agent instruction references the tool by its MCP name (`school_callback`).

#### How the verifier changes

Today `inspect_school_callback` in `backend/agents/verifier/agent.py`:
1. Calls `sim.school_callback()` (in-process)
2. Calls `screen(raw)` from `armor.py` (in-process Model Armor API call)
3. Caches and stores the verdict

After Phase 2:
1. Calls `school_callback` via MCP toolset (network call through gateway)
2. Gateway Model Armor screens the MCP response automatically using `caserelay-screen` template
3. If Model Armor quarantines, the gateway blocks the response before it reaches the agent
4. The agent receives either a clean response or a gateway-level block

The `inspect_school_callback` function simplifies to just calling the MCP tool and interpreting the result. The `screen()` call is deleted. The `armor.py` import is removed.

**Caveat:** when gateway Model Armor blocks, it returns an error to the agent, not a structured verdict. The verifier's instruction needs to be updated to recognize a gateway block as a quarantine event. The `_verdict_cache` and Firestore verdict storage logic remains — it just gets fed from the gateway block signal instead of from `screen()`.

#### What can be deleted from `backend/gateway/armor.py`

After Phase 2, `armor.py` is no longer called by the verifier. It can be:
- **Kept as defense-in-depth** for any remaining in-process screening needs
- **Deleted entirely** if all screening is at the gateway

Recommendation: keep the file but remove the verifier's import of it. Delete it in a follow-up once you've validated the gateway path works reliably.

### Implementation steps

#### 2.1 Create the MCP server wrapper

Create `backend/partners/mcp_server.py` — a FastMCP server that wraps `sim.py`:

Each MCP server is a separate Cloud Run service. They share the same codebase but are started with different `--partner` flags to expose only the relevant tools.

#### 2.2 Deploy partner MCP servers to Cloud Run

One Cloud Run service per partner, or one service with different entry points. Each needs:
- `roles/datastore.user` on the caserelay Firestore database
- `roles/serviceusage.serviceUsageConsumer`
- The service URL recorded for environment variable injection

#### 2.3 Register each partner MCP server in Agent Registry

```bash
# Example for school partner (repeat for clinic, legal, shelter, family)
gcloud agent-registry mcp-servers create caserelay-partner-school \
  --project=caserelay --location=us-central1 \
  --display-name="CaseRelay School Partner" \
  --uri="https://SCHOOL_CLOUD_RUN_URL"
```

#### 2.4 Create per-agent IAP egressor grants

This is the cross-scope policy expressed as identity-level access control:

```bash
# Education agent → school partner ONLY
gcloud iap web add-iam-policy-binding \
  --resource-type=agent-registry \
  --mcp-server=caserelay-partner-school \
  --region=us-central1 --project=caserelay \
  --member="principal://agents.global.org-126484209344.system.id.goog/resources/aiplatform/projects/189353698936/locations/us-central1/reasoningEngines/6205121908900364288" \
  --role=roles/iap.egressor

# Verifier → school partner (needs access to inspect the callback)
gcloud iap web add-iam-policy-binding \
  --resource-type=agent-registry \
  --mcp-server=caserelay-partner-school \
  --region=us-central1 --project=caserelay \
  --member="principal://agents.global.org-126484209344.system.id.goog/resources/aiplatform/projects/189353698936/locations/us-central1/reasoningEngines/3044580132904763392" \
  --role=roles/iap.egressor

# Health agent → clinic partner ONLY
gcloud iap web add-iam-policy-binding \
  --resource-type=agent-registry \
  --mcp-server=caserelay-partner-clinic \
  --region=us-central1 --project=caserelay \
  --member="principal://agents.global.org-126484209344.system.id.goog/resources/aiplatform/projects/189353698936/locations/us-central1/reasoningEngines/2657974252392677376" \
  --role=roles/iap.egressor

# Legal agent → legal-aid partner ONLY
gcloud iap web add-iam-policy-binding \
  --resource-type=agent-registry \
  --mcp-server=caserelay-partner-legal \
  --region=us-central1 --project=caserelay \
  --member="principal://agents.global.org-126484209344.system.id.goog/resources/aiplatform/projects/189353698936/locations/us-central1/reasoningEngines/3107630527687950336" \
  --role=roles/iap.egressor

# Shelter agent → shelter partner ONLY
gcloud iap web add-iam-policy-binding \
  --resource-type=agent-registry \
  --mcp-server=caserelay-partner-shelter \
  --region=us-central1 --project=caserelay \
  --member="principal://agents.global.org-126484209344.system.id.goog/resources/aiplatform/projects/189353698936/locations/us-central1/reasoningEngines/8689420053348614144" \
  --role=roles/iap.egressor

# Family agent → family partner ONLY
gcloud iap web add-iam-policy-binding \
  --resource-type=agent-registry \
  --mcp-server=caserelay-partner-family \
  --region=us-central1 --project=caserelay \
  --member="principal://agents.global.org-126484209344.system.id.goog/resources/aiplatform/projects/189353698936/locations/us-central1/reasoningEngines/7993613910919872512" \
  --role=roles/iap.egressor
```

**What this achieves:** if the education agent somehow tries to reach the clinic MCP server, IAP denies it — deterministic, identity-level cross-scope enforcement entirely in cloud config. No application code.

#### 2.5 Refactor agent code

Files to change:

| File | Change |
|---|---|
| `backend/partners/mcp_server.py` | NEW: FastMCP server wrapping `sim.py` |
| `backend/agents/education/agent.py` | Replace `sim.school_callback` import with McpToolset |
| `backend/agents/health/agent.py` | Replace `sim.clinic_status` import with McpToolset |
| `backend/agents/legal/agent.py` | Replace `sim.legal_status` import with McpToolset |
| `backend/agents/shelter/agent.py` | Replace `sim.shelter_status` import with McpToolset |
| `backend/agents/family/agent.py` | Replace `sim.family_status` import with McpToolset |
| `backend/agents/verifier/agent.py` | Replace `sim.school_callback` + `armor.screen()` with McpToolset; update instruction to handle gateway blocks |
| `infra/deploy_fleet.sh` | Add `CASERELAY_PARTNER_*_URL` env vars to each agent's deploy command |
| `infra/bootstrap.sh` | Add partner MCP server Cloud Run deployment + Agent Registry registration |
| `infra/grant_fleet_iam.sh` | Add `roles/iap.egressor` grants per agent per partner |

Files unchanged:
| File | Why |
|---|---|
| `backend/partners/sim.py` | Remains as domain logic, imported by MCP server |
| `backend/gateway/armor.py` | Kept as fallback (no longer imported by verifier) |
| `backend/runtime/a2a_client.py` | A2A calls between agents are unchanged; gateway governs them at the network level |
| `infra/collect_endpoints.sh` | Engine endpoints don't change; partner URLs are separate |
| `infra/fleet_endpoints.env` | Engine endpoints unchanged |

#### 2.6 Redeploy fleet

```bash
bash infra/deploy_fleet.sh
```

#### 2.7 E2E verification

1. Run a clean-path case → all commitments resolve normally
2. Run a `cross_scope` scenario case → gateway Model Armor screens the school MCP response, blocks it, verifier sees the block and opens escalation
3. Run a `poison`/`inject` scenario case → same screening path

### Phase 2 checkpoint

After Phase 2: all partner interactions are MCP calls through Agent Gateway. Model Armor screens every partner response using the `caserelay-screen` template with DLP custom infoTypes. IAP enforces per-agent per-partner access control. `armor.py` is no longer called by the verifier. The entire screening pipeline is in cloud config.

**What moves out of code:**

| Concern | Before | After |
|---|---|---|
| Cross-scope content screening | `armor.py` calls Model Armor API | Gateway Model Armor on egress MCP traffic |
| Cross-scope access control | Not implemented | IAP per-agent per-partner egressor grants |
| Partner call monitoring | Partial OTel | Full gateway audit logs + Model Armor findings |

**What stays in code:**

| Concern | Why |
|---|---|
| Agent instructions | Domain logic, not policy |
| Scenario/behaviour lookup | Application logic (`_behaviour()` in `sim.py`) |
| Verdict caching + Firestore storage | Application state management |
| Escalation workflow | Business logic (`open_escalation`) |

---

## Phase 3 — Semantic Governance Policies (Optional, DRY_RUN)

**Time:** ~20-40 min (provisioning time is unpredictable: 2-20 min)  
**Risk:** Low (dry-run only — logs verdicts, never blocks)  
**Known risk:** The SGP doc states `agentGatewayConfig` must be set at deploy time and is immutable for SGP eligibility. The Route Runtime doc shows a PATCH API. This is an unresolved contradiction. If PATCHed engines are not SGP-eligible, you must redeploy via `deploy_fleet.sh` with `agentGatewayConfig` in the create call.

### 3.1 Provision SGP engine (Google-managed binding)

```bash
gcloud beta ai semantic-governance-policy-engine update \
  --location=us-central1 \
  --project=caserelay \
  --gateway-config="name='caserelay-egress',network=default,subnetwork=default,dns-zone-name=caserelay-sgp-zone"
```

This may take 2-20 minutes. Poll status:
```bash
curl -s \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://us-central1-aiplatform.googleapis.com/v1beta1/projects/caserelay/locations/us-central1/semanticGovernancePolicyEngine" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('State:', d.get('state','UNKNOWN'))"
```
Wait until `state` is `ACTIVE`.

### 3.2 Create SGP authz extension

After provisioning, capture the DNS hostname from the engine response:
```bash
SGP_DNS=$(curl -s \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://us-central1-aiplatform.googleapis.com/v1beta1/projects/caserelay/locations/us-central1/semanticGovernancePolicyEngine" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); configs=d.get('gatewayConfigs',{}); c=configs.get('caserelay-egress',{}); print(c.get('dnsHostname',''))")
echo "SGP DNS hostname: $SGP_DNS"
```

```bash
cat > /tmp/caserelay-sgp-authz-ext.yaml <<EOF
name: caserelay-sgp-authz-ext
service: $SGP_DNS
authority: $SGP_DNS
failOpen: false
loadBalancingScheme: LOAD_BALANCING_SCHEME_UNSPECIFIED
metadata:
  sgpEnforcementMode: "DRY_RUN"
EOF

gcloud service-extensions authz-extensions import caserelay-sgp-authz-ext \
  --source=/tmp/caserelay-sgp-authz-ext.yaml \
  --location=us-central1 \
  --project=caserelay
```

### 3.3 Create SGP authorization policy

```bash
cat > /tmp/caserelay-sgp-authz-policy.yaml <<'EOF'
name: caserelay-sgp-authz-policy
target:
  loadBalancingScheme: LOAD_BALANCING_SCHEME_UNSPECIFIED
  resources:
  - projects/caserelay/locations/us-central1/agentGateways/caserelay-egress
httpRules:
- to:
    operations:
    - paths:
      - prefix: /
  when: "!request.headers['content-type'].startsWith('application/grpc') && (request.path.endsWith(':generateContent') || request.path.endsWith(':streamGenerateContent'))"
action: CUSTOM
policyProfile: CONTENT_AUTHZ
customProvider:
  authzExtension:
    resources:
    - projects/caserelay/locations/us-central1/authzExtensions/caserelay-sgp-authz-ext
EOF

gcloud network-security authz-policies import caserelay-sgp-authz-policy \
  --source=/tmp/caserelay-sgp-authz-policy.yaml \
  --location=us-central1 \
  --project=caserelay
```

### 3.4 Create the cross-scope SGP policy

Find the education agent's Agent Registry ID:
```bash
gcloud alpha agent-registry agents list \
  --project=caserelay --location=us-central1 \
  --format="table(name, displayName)"
```

Capture the agent ID for the education agent, then create the policy:
```bash
gcloud beta ai semantic-governance-policies create caserelay-cross-scope-education \
  --location=us-central1 \
  --project=caserelay \
  --display-name="Education cross-scope guard" \
  --description="Prevents the education agent from requesting or handling medical, legal, or shelter data" \
  --agent=EDUCATION_AGENT_REGISTRY_ID \
  --natural-language-constraint="This agent handles school enrollment only. It must never request, retrieve, transmit, or act on medical records, psychiatric notes, health information, legal case details, court orders, shelter placement data, or family assessment findings. If any tool response contains such information, the agent must refuse to process it."
```

**Verify in logs:**
```
logName="projects/caserelay/logs/semantic-governance-policy"
```

In DRY_RUN mode, verdicts are logged but nothing is blocked.

---

## Decision Log

### Correction 1: Basic Agent Gateway does not require private networking

The private-networking stack (VPC, proxy-only subnet, network attachment, static IP, PSC endpoint, private DNS zone) is required **only for SGP's policy engine connectivity** and optionally for VPC egress. A basic Agent Gateway for IAP + Model Armor is Google-managed and needs none of it.

Source: [Set up Agent Gateway](https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/gateways/set-up-agent-gateway) — the egress gateway YAML contains only `name`, `protocols`, `googleManaged.governedAccessPath`, and `registries`. VPC connectivity is documented under "Optional: Configure VPC connectivity."

### Correction 2: `agentGatewayConfig` is PATCHable

The Route Runtime traffic doc shows a REST PATCH API for existing engines:
```
curl -X PATCH ... ?updateMask=spec.deploymentSpec.agentGatewayConfig
```
This avoids full redeployment.

Source: [Route Agent Runtime traffic through Agent Gateway](https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/runtime/agent-gateway-runtime-deploy), section "For existing agents."

**Limitation:** "An Agent Gateway can't be bound to Runtime Reasoning Engines created before April 29, 2026." Engines created before that date must be fully redeployed.

**Contradiction:** The [SGP configuration doc](https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/policies/configure-semantic-governance) states: "Both fields are immutable on an existing reasoning engine, so an agent deployed without them must be redeployed — patching will not work." This contradicts the Route Runtime doc's PATCH. For basic gateway binding, the PATCH is documented and should work. For SGP eligibility specifically, the PATCH may or may not satisfy the eligibility check — this is an unresolved documentation conflict.

### Finding 3: Gateway Model Armor screens only MCP, OpenAI-format, and A2A traffic

> "Egress integration compatibility: Model Armor's inline protection on egress traffic is limited to integrations with MCP servers, services following the OpenAI format, and A2A through Agent Gateway."

Source: [Integrate Model Armor with Agent Gateway](https://docs.cloud.google.com/model-armor/model-armor-agent-gateway-integration).

This is why the partner simulator must be deployed as MCP servers, not plain REST endpoints. A REST endpoint would be registered and governed by IAP, but Model Armor would not screen its response content.

---

## Theatre vs Substance Assessment

| Action | Verdict |
|---|---|
| Phase 0: gateway + policies exist but no engines bound | **Presentational.** The resource exists but governs nothing. |
| Phase 1: fleet bound, IAP in DRY_RUN, Model Armor on LLM/A2A | **Substantive.** All egress routes through the gateway. Model Armor screens LLM prompts and A2A payloads. Audit logs capture every identity/endpoint decision. Real governance. |
| Phase 1 IAP grants on API endpoints | **Substantive infrastructure** but DRY_RUN means no enforcement yet. Switch to enforce when confident. |
| Phase 2: partner simulator as MCP servers | **Deeply substantive.** The demo's money-shot — partner callback screening — moves entirely to cloud config. `armor.py` direct API calls are eliminated. This is genuine platform adoption. |
| Phase 2 IAP per-agent per-partner grants | **Deeply substantive.** Deterministic identity-level cross-scope enforcement. No application code. Auditable. The strongest GEAP story in the submission. |
| Phase 3: SGP in DRY_RUN | **Substantive but unenforceable.** Shows real LLM-as-judge verdicts in logs. Honest as a capability demonstration. Would be theatre if presented as "enforced." |
