# Agent Gateway Adoption Plan — CaseRelay

Research findings + executable runbook. All commands use actual project values. Run from the repo root.

**Honest framing (revised 2026-08-28 after a full docs crawl):**

Agent Gateway is GA and real, but it governs *one specific thing*: **outbound network traffic that leaves a Vertex AI Reasoning Engine**. Almost every claim in the marketing — Model Armor guardrails, semantic governance, per-tool policy — is downstream of that one fact. CaseRelay's topology does not currently put much interesting traffic on that path:

- The **orchestrator runs in-process on the Cloud Run control plane** (`CASERELAY_CONTROL_PLANE=1`, `backend/api/main.py:43`), so orchestrator LLM calls and all A2A fan-out originate from Cloud Run, **not** from an engine. An egress Agent Gateway cannot see any of it.
- **Partner calls are in-process Python** (`sim.school_callback()` inside the verifier). They never touch the network, so no network-layer control can screen them.
- What *is* on the engine egress path today: Gemini `:generateContent`, Agent Platform Sessions, Memory Bank, Firestore, Cloud Logging/Trace, Agent Registry. All Google-first-party, all already authenticated.

So Phase 1 (bind the fleet) buys **identity-scoped egress authorization and a complete audit log of every outbound call each engine makes**. That is genuine and demonstrable. It does *not* buy content screening of anything the demo cares about — see [Correction 3](#correction-3-gateway-model-armor-probably-does-not-see-caserelays-llm-traffic). Content screening only becomes real at the gateway once partner services are MCP servers (Phase 2).

Read the [layer-by-layer verdict](#layer-by-layer-verdict) before committing to anything. If the question is specifically *"which of CaseRelay's own policies can we hand to the platform?"*, go straight to [Moving CaseRelay's own policies to the gateway](#moving-caserelays-own-policies-to-the-gateway) — it carries the per-policy verdicts, the verified live state of the project, and pointers to ready-to-apply artifacts in `infra/policies/`.

---

## Layer-by-layer verdict

| Gateway layer | Launch stage | What it actually does | CaseRelay today | Verdict |
|---|---|---|---|---|
| **Egress gateway (Agent-to-Anywhere)** | **GA** ([release notes](https://docs.cloud.google.com/gemini-enterprise-agent-platform/release-notes)) | Google-managed forward proxy for all engine egress. Default-deny: any hostname not in Agent Registry is blocked. TLS-terminates and inspects. | Engines egress directly, unrestricted | **Adopt.** This is the substrate everything else needs. |
| **Ingress gateway (Client-to-Agent)** | **GA** | Fronts an engine for inbound clients. Only governs `query` and `streamQuery`. | Control plane reaches specialists over the `/api/a2a/...` JSON-RPC passthrough, not `streamQuery` | **Skip.** [Documented](https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/runtime/agent-gateway-runtime-deploy) to govern only `query`/`streamQuery`; CaseRelay's A2A path is neither. Zero coverage. |
| **IAP / IAM egress authz** (`REQUEST_AUTHZ`) | **GA** | Per-agent-identity `roles/iap.egressor` on each registered destination. Enforced by IAP; `iap.webServiceVersions.egressViaIAP` is the permission actually checked. Supports dry-run. | `backend/identity/registry.py` does in-app scope checks against agent-card `denied_data_scopes` | **Adopt (dry-run first).** Complements, doesn't duplicate: CaseRelay's registry gates *fields inside a payload*; IAP gates *which host an agent may reach*. Different axes. |
| **Model Armor at the gateway** (`CONTENT_AUTHZ`) | **GA** ([release notes](https://docs.cloud.google.com/gemini-enterprise-agent-platform/release-notes)) | Streams request/response bodies to Model Armor via `ext_proc`. Blocks or logs. | `backend/gateway/armor.py` calls `sanitize_user_prompt` directly with the same `caserelay-screen` template | **Defer.** Egress inline protection is [limited to MCP, OpenAI-format, and A2A](https://docs.cloud.google.com/model-armor/model-armor-agent-gateway-integration) — CaseRelay has none of those on the engine egress path. Also **fails open by default**, which is a safety *regression* vs. `armor.py`. See [Correction 3](#correction-3-gateway-model-armor-probably-does-not-see-caserelays-llm-traffic) and [Risk R4](#risk-register). |
| **MCP attribute authz** (tool-level) | **GA** (part of Agent Gateway GA) | Gateway parses MCP payloads and exposes `mcp.toolName`, `mcp.method`, `mcp.tool.isReadOnly` etc. to IAM CEL conditions and to AuthzPolicy method matchers. | Nothing equivalent | **The real prize — but requires MCP servers to exist.** This is where "write your own policy" is genuinely powerful. See [Custom policies](#custom-policies-the-verified-authoring-surfaces). |
| **Semantic Governance Policies** | **Preview** ([release notes](https://docs.cloud.google.com/gemini-enterprise-agent-platform/release-notes)) | LLM-as-judge intent gate on proposed tool calls. Natural-language constraints. Dry-run available. | Verifier agent + `armor.py` do a narrower version in-app | **Talking point only.** Preview, needs a VPC + proxy-only subnet + PSC endpoint + private DNS zone + a provisioned engine, and requires agents redeployed with `identity_type=AGENT_IDENTITY` **and** `agent_gateway_config` set **at create time** (both immutable). Days of work, days before the deadline. |
| **Custom authz extensions** (your own `ext_proc` service) | **GA** (Service Extensions) | Gateway makes a real-time gRPC callout to a service you run. Full headers + body, can block. | n/a | **Skip for the demo.** Requires a VPC-resolvable FQDN, DNS peering, and a `FULL_DUPLEX_STREAMED` `ext_proc` server. Nothing CaseRelay needs that Model Armor + IAM don't already cover. |
| **Observability** (gateway logs, dashboard, traces) | **GA** | `networkservices.googleapis.com/Gateway` log entries with `mcpInfo`, `agentRegistryResource`, `serviceExtensionsInfo`. Built-in Observability tab with authz-failure scorecards. | OTel → Cloud Trace, plus the portal's own audit trail | **Adopt — this is the cheapest win.** Comes free with Phase 1 and is the most demo-legible artifact the gateway produces. |
| **Agent Identity / mTLS + DPoP** | Agent Identity API is **Preview**; identity itself ships with Agent Runtime | Every engine gets an X.509 cert and certificate-bound token; IAP enforces mTLS to the gateway, Context-Aware Access enforces DPoP beyond it. | Already using `--agent-identity`; principals pinned in `infra/pinned_identities.env` | **Already have it.** Nothing to adopt; worth *saying* on camera because it is genuinely unusual. |
| **VPC Service Controls** | **Not supported** | — | — | Cannot use. [Documented limitation](https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/gateways/agent-gateway-overview). Use custom org policy constraints instead. |
| **SCC Agent Engine Threat Detection** | GA, but **mutually exclusive** | — | Not in use | Note the trade: [binding a gateway disables it](https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/runtime/agent-gateway-runtime-deploy). |

### What the gateway cannot govern in CaseRelay's current topology

This is the single most important architectural fact in this document.

| Traffic | Origin | Gateway sees it? |
|---|---|---|
| Orchestrator → Gemini | Cloud Run control plane (in-process ADK) | **No** — not an engine |
| Orchestrator → specialists (A2A) | Cloud Run control plane | **No** — not an engine |
| Portal → control plane | Next.js BFF → Cloud Run | **No** — Cloud Run ingress, not Agent Runtime |
| Specialist → Gemini | Engine | Yes (IAP/audit); Model Armor almost certainly not — see Correction 3 |
| Specialist → Sessions / Memory Bank / Firestore | Engine | Yes (IAP/audit) |
| Verifier → school partner | **In-process function call** | **No** — never crosses the network |

Everything the demo's security story hangs on — the poisoned school callback — is in the bottom row. Only Phase 2 moves it onto the gateway.

---

## Pricing and quota reality

| Item | Value | Source |
|---|---|---|
| Agent Gateway (Agent-to-Anywhere) billing | Billed on Agent Compute vCPU-hours. **1 vCPU-h ($0.085) ≈ 15,000 gateway API/authorization calls.** Billing effective **July 13, 2026** — so it is live now. | [Agent Platform pricing](https://cloud.google.com/products/gemini-enterprise-agent-platform/pricing) |
| Resources per gateway | 5,000 Agent Registry resources | [Agent Gateway overview](https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/gateways/agent-gateway-overview) |
| Custom authz policies per egress gateway | **4 max**, regardless of profile | [Delegate authorization](https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/gateways/delegate-authorization) |
| `CONTENT_AUTHZ` policies per ingress gateway | **1 max**; Model Armor and SGP are mutually exclusive on ingress | same |
| Reasoning engines per region per project | **100** | [Agent quotas](https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/agent-quotas) |
| Engine create/update per minute | **10** | same — this is why `CASERELAY_MAX_PARALLEL=1` is correct |
| `query`/`streamQuery` per minute | **90** | same — the documented cause of the 429s when running demo cases concurrently |

At demo scale the gateway bill is noise. **The four-policy ceiling is the real constraint**, and **two slots are already spent** on the live IAP and Model Armor policies. See [The four-policy budget](#the-four-policy-budget).

---

## Pre-flight

| Check | Command | Expected |
|---|---|---|
| gcloud auth | `gcloud auth list --filter=status:ACTIVE --format='value(account)'` | Your account |
| Correct project | `gcloud config get project` | `caserelay` |
| Fleet healthy | `source infra/fleet_endpoints.env && curl -sf -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $(gcloud auth print-access-token)" "${CASERELAY_URL_SHELTER%/api}/api/a2a/shelter/.well-known/agent-card.json"` | `200` |
| Working tree | `git status --porcelain` | Clean (stash or commit first) |
| fleet_endpoints.env sourced | `echo $CASERELAY_IDENTITY_SHELTER` | Non-empty principal |

**Before every phase:** `source infra/fleet_endpoints.env`

**Important:** run demo cases one at a time. Concurrent runs hit the documented 90 QPM `streamQuery` limit per project/region.

---

## Reference: Fleet IDs

| Agent | Engine ID | Identity Principal |
|---|---|---|
| orchestrator | `1247643881583935488` | `agents.global.org-126484209344.system.id.goog/resources/aiplatform/projects/189353698936/locations/us-central1/reasoningEngines/1247643881583935488` |
| education | `6205121908900364288` | `.../reasoningEngines/6205121908900364288` |
| health | `2657974252392677376` | `.../reasoningEngines/2657974252392677376` |
| legal | `3107630527687950336` | `.../reasoningEngines/3107630527687950336` |
| shelter | `8689420053348614144` | `.../reasoningEngines/8689420053348614144` |
| family | `7993613910919872512` | `.../reasoningEngines/7993613910919872512` |
| verifier | `3044580132904763392` | `.../reasoningEngines/3044580132904763392` |
| intake | `8701101264882106368` | `.../reasoningEngines/8701101264882106368` |

> **These IDs are load-bearing for IAM.** An agent's identity principal embeds its `reasoningEngines/{id}`. Any redeploy that produces a **new** engine ID produces a **new principal**, and every `roles/iap.egressor` grant made against the old one silently stops applying. Google's own codelab calls this out as the most common cause of `403 PermissionDenied`: *"the most common cause is forgetting to re-grant after redeploying the agent (the `reasoningEngines/` changes each deploy)"* ([codelab](https://codelabs.developers.google.com/cloudnet-agent-gateway)). See [Risk R1](#risk-register) — this is what breaks the blue/green plan.

---

## Custom policies: the verified authoring surfaces

The user asked specifically about writing custom policies. Here is what the docs actually support. **There is no single proprietary policy language.** There are four distinct surfaces with different formats, trigger points, and enforcement actions.

| Surface | Format | Trigger point | Can inspect | Actions | Stage |
|---|---|---|---|---|---|
| **A. IAM allow/deny + CEL condition** | JSON IAM policy, CEL in `condition.expression` | Per request, headers stage (`REQUEST_AUTHZ`, via IAP) | Caller principal, destination registry resource, parsed MCP attributes | Allow / Deny (403). No redact. | GA |
| **B. AuthzPolicy YAML** | YAML `httpRules` with MCP method matchers + CEL `when:` | Per request, headers stage | HTTP headers, path, MCP method + primary param | `ALLOW` / `DENY` / `CUSTOM` | GA |
| **C. Model Armor template** | Model Armor template JSON (+ optional DLP inspect/de-identify templates) | Request and response **bodies** (`CONTENT_AUTHZ`) | Full payload text | Block, or inspect-and-log | GA |
| **D. Semantic Governance Policy** | **Plain English**, ≤5,000 chars, no DSL | Between model response and tool execution | User prompt, chat history, tools manifest, proposed tool call + params | `ALLOW` / `DENY` with rationale; `DRY_RUN` | **Preview** |
| **E. Custom `ext_proc` extension** | Your own gRPC service (Envoy `ext_proc`, `FULL_DUPLEX_STREAMED`) | Headers + body, request and response | Everything | Anything you implement | GA |

**Not verified / does not appear to exist:** any Rego/OPA integration, any gateway-native regex-on-body policy language, or any built-in redact-and-continue action at the gateway (Model Armor's SDP de-identification does **not** pass de-identified content back — it [issues a block verdict instead](https://docs.cloud.google.com/model-armor/model-armor-vertex-integration) when enforcement is `INSPECT_AND_BLOCK`). Do not claim redaction on camera.

### Surface A — verified CEL attributes

Sources: [Policies overview](https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/policies/overview), [Configure IAM agent policies](https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/policies/configure-iam-policies), [codelab](https://codelabs.developers.google.com/cloudnet-agent-gateway).

| Attribute | Meaning |
|---|---|
| `mcp.toolName` | Name of the tool being called |
| `mcp.resourceName` | Resource being accessed |
| `mcp.promptName` | Prompt name being used |
| `mcp.method` | MCP operation, e.g. `tools/call`, `resources/read` |
| `mcp.tool.isReadOnly` / `.isDestructive` / `.isIdempotent` / `.isOpenWorld` | Booleans from the tool's MCP annotations |
| `request.auth.type` | Protocol enum, e.g. `'MCP'` |

> **Documentation inconsistency, flagged:** the Policies overview page renders these as bare CEL variables (`request.mcp.toolName == 'GetCalendarEvents'`), while the Configure-IAM page's actual policy JSON and the codelab both use the accessor form `api.getAttribute('iap.googleapis.com/mcp.toolName', '')`. **Use the accessor form** — it is the one that appears inside real, copy-pasteable policy documents in two independent Google sources. The bare-variable form is unverified.

These booleans come from your MCP server's own `toolspec.json` annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`), which you upload at registration. **You control them**, which means you can make `isReadOnly` mean whatever CaseRelay needs it to mean — and it also means they are self-asserted, not verified by the platform. Say that if asked.

### Four concrete CaseRelay policies

All four target a **child-services case-management system handling minors' PII**. Policies 1–3 use verified, copy-pasteable syntax. Policy 4 is Preview-gated. **All four require Phase 2** (partner services as MCP servers) to have anything to act on — Surfaces A and B only see MCP attributes on MCP traffic.

#### Policy 1 — Scope isolation: the education agent may never reach the clinic

*Intent:* a school-liaison agent has no lawful basis to touch a minor's medical record. Today this is enforced by a prompt instruction and an in-app scope check. Move it to IAM, where it is deterministic and audited.

Surface A, unconditional per-resource binding. Grant `roles/iap.egressor` on `caserelay-partner-school` to education and verifier **only**; never grant it on `caserelay-partner-clinic`. Because a per-resource binding *replaces* a registry-wide binding for that resource ([troubleshooting doc](https://docs.cloud.google.com/gemini-enterprise-agent-platform/troubleshooting/troubleshoot-agent-gateway)), do **not** also hold a registry-wide grant, or you will not be enforcing anything.

```bash
ENDPOINT_ID=$(gcloud agent-registry mcp-servers list \
  --project=caserelay --location=us-central1 \
  --filter="interfaces.url:caserelay-partner-clinic" \
  --format="value(name.basename())")
# education must NOT appear in this policy
gcloud iap web get-iam-policy --resource-type=agent-registry \
  --mcp-server="$ENDPOINT_ID" --region=us-central1 --project=caserelay
```

*Demo value:* high. "The education agent is not told not to call the clinic. It is structurally unable to." The 403 lands in the gateway log with the principal and the target.

#### Policy 2 — The verifier is read-only on partner data

*Intent:* the safeguarding verifier's job is to inspect and quarantine. It must never mutate a partner record — a verifier that can write is a verifier that can be prompt-injected into writing.

Surface A with a CEL condition. Verified format:

```json
{
  "policy": {
    "bindings": [
      {
        "role": "roles/iap.egressor",
        "members": [
          "principal://agents.global.org-126484209344.system.id.goog/resources/aiplatform/projects/189353698936/locations/us-central1/reasoningEngines/3044580132904763392"
        ],
        "condition": {
          "title": "VerifierReadOnlyOnPartners",
          "description": "The safeguarding verifier may only invoke read-only partner tools.",
          "expression": "api.getAttribute('iap.googleapis.com/request.auth.type', '') == 'MCP' && (api.getAttribute('iap.googleapis.com/mcp.tool.isReadOnly', false) == true || api.getAttribute('iap.googleapis.com/mcp.toolName', '') == '')"
        }
      }
    ]
  }
}
```

The `mcp.toolName == ''` clause is load-bearing and comes straight from the codelab: it lets non-tool-call MCP RPCs (session setup, `tools/list`, ping) through. Without it the MCP session cannot be established at all.

Apply with `gcloud iap web set-iam-policy <file> --resource-type=agent-registry --mcp-server=MCP_SERVER_ID --region=us-central1 --project=caserelay`.

#### Policy 3 — No server-authored prompts or resources from partner MCP servers

*Intent:* this is the MCP tool-poisoning / line-jumping attack class. A compromised partner server can serve a `prompts/` template or a `resources/` blob whose content is instructions rather than data. CaseRelay's whole demo narrative is about exactly this attack — and this policy blocks the delivery mechanism at the network layer, before any model sees it. Partner servers in this design expose tools only; nothing legitimate needs `prompts/` or `resources/`.

Surface B, verified `DENY` form:

```yaml
name: caserelay-deny-mcp-prompts-resources
target:
  resources:
  - "projects/caserelay/locations/us-central1/agentGateways/caserelay-egress"
policyProfile: REQUEST_AUTHZ
httpRules:
- to:
    operations:
    - mcp:
        methods:
        - name: "prompts"
        - name: "resources"
action: DENY
```

```bash
gcloud network-security authz-policies import caserelay-deny-mcp-prompts-resources \
  --source=/tmp/caserelay-deny-mcp-prompts-resources.yaml \
  --location=us-central1 --project=caserelay
```

> Counts against the **four-policy ceiling**. IAP and Model Armor are already live, so this is slot 3 and one slot remains. Ready-to-apply artifact: `infra/policies/authzpolicy-mcp-deny-prompts-resources.yaml`. Full budget in [The four-policy budget](#the-four-policy-budget).

*Demo value:* this is the strongest single custom policy available. It is a named attack class, blocked declaratively, in four lines of YAML, with no application code.

#### Policy 4 — Cross-scope intent gate (Preview, dry-run only)

*Intent:* catch the semantic version of Policy 1 — the case where the education agent has a legitimate tool but is being steered to misuse it. IAM cannot see intent; SGP can.

Surface D, natural language:

> "This agent handles school enrollment continuity only. It must never request, retrieve, transmit, or act on medical records, psychiatric or counselling notes, health information, legal case details, court orders, shelter placement addresses, or family assessment findings. If a tool response contains such information, the agent must refuse to process it and must not summarise, paraphrase, or forward it. Never include a minor's home address, date of birth, or case number in a call to any external partner tool."

Deploy with `sgpEnforcementMode: DRY_RUN` and read verdicts from `logName="projects/caserelay/logs/semantic-governance-policy"` — the log carries a `verdict` plus a human-readable `rationale` per tool call. **Preview. Do not put this on the critical path.** Presenting a dry-run verdict log as a capability demonstration is honest; presenting it as enforcement is not.

---

## Moving CaseRelay's own policies to the gateway

The question asked was: *how much of CaseRelay's hand-rolled policy enforcement can honestly be handed to out-of-the-box GEAP capability?* This section answers it per policy. Artifacts live in [`infra/policies/`](../infra/policies/) and are applied by `infra/policies/apply.sh` (dry-run by default).

### Live state, verified 2026-08-28 — read this first, it changes the budget

| Fact | Verified how | Consequence |
|---|---|---|
| `caserelay-egress` exists, `protocols: [MCP]`, `AGENT_TO_ANYWHERE`, bound to the `us-central1` registry | `agent-gateways describe` | Substrate is ready. `protocols: [MCP]` means it is provisioned for exactly the surface Phase 2 creates. |
| **Two of four policy slots are already consumed** — `caserelay-iap-authz-policy` (`REQUEST_AUTHZ`, `CUSTOM`) and `caserelay-ma-authz-policy` (`CONTENT_AUTHZ`, `CUSTOM`) | `authz-policies list` | Only **two** slots remain, not three as [Policy 3](#policy-3--no-server-authored-prompts-or-resources-from-partner-mcp-servers) assumed. |
| **`caserelay-ma-authz-ext` is live with `failOpen: true`, `timeout: 1s`** | `authz-extensions describe` | The fail-open regression is not hypothetical or future — it is deployed right now. See [Model Armor placement](#model-armor-placement-the-fail-open-problem-is-already-live). |
| **The registry-wide IAP IAM policy is empty** — `get-iam-policy` returns an etag and no bindings | `iap web get-iam-policy` | No engine holds `roles/iap.egressor`. Harmless while IAP is `DRY_RUN`; a 403 on every call the instant enforcement is enabled. [1.3](#13-grant-rolesiapegressor--registry-wide-first) has not been done. |
| **All eight engines are `unbound`**, all created 2026-08-24/25 | REST `reasoningEngines` GET | Nothing is governed yet, and every engine is past the April 29 2026 cutoff, so all are PATCH-bindable. |
| Every engine already has `identityType: AGENT_IDENTITY` | same | Half of SGP's create-time eligibility requirement is already met; only `agent_gateway_config` is in question. Narrows [R6](#risk-register) but does not close it. |
| The gateway declares `serviceExtensionsServiceAccount: service-252538273698@gcp-sa-dep.iam.gserviceaccount.com` | `agent-gateways describe` | **Contradicts [0.7](#07-grant-model-armor-roles-to-the-gateway-service-agent).** The doc's formula (`service-<GATEWAY_PROJECT_NUMBER>@gcp-sa-dep…`) yields `service-189353698936@…`; caserelay's project number is 189353698936, so the two differ. Read the SA off the resource, don't derive it. `apply.sh sa-grants` does. |
| No MCP servers registered yet | `agent-registry mcp-servers list` (empty) | Everything MCP-attribute-based is written and ready but inert until registration. |
| `caserelay-screen` is real and references the `caserelay-cross-scope` DLP inspect template — **inspect only, no de-identify template** | Model Armor REST GET | Confirms the "no redact-and-continue" finding from the platform side too: there is nothing configured that *could* return sanitized content. |

Captured for reproducibility: `infra/policies/modelarmor-template-caserelay-screen.json`, `infra/policies/dlp-inspect-caserelay-cross-scope.json`.

### The topology the MCP work is actually building

`backend/partners/mcp_server.py` (in progress, not ours to edit) is **one** MCP server exposing **seven** tools — `school_status`, `school_callback`, `clinic_status`, `legal_status`, `shelter_status`, `family_status`, `followup` — not the five separate servers [Phase 2](#one-mcp-server-or-five) recommended. Its docstring says the five partners will be registered as five Services on "path-prefixed endpoints", but the server currently mounts a single `/sse` route, so there is nothing to path-prefix against yet.

`infra/deploy_partners.sh` then registers five Agent Registry Services — `caserelay-partner-{school,clinic,legal,shelter,family}` — **all with the identical interface URL `${PARTNER_URL}/mcp`**, on the stated rationale that this gives "per-resource IAP authorization without CEL conditions (each registry entry is its own authorization unit)."

> **That rationale is very likely wrong, and this is the single most important policy finding in this section.** The gateway resolves an outbound request to a registry resource by matching its destination — and it [matches hostnames exactly](#12-register-every-destination-hostname--do-this-before-binding). Five resources sharing one URL give the gateway no way to tell which resource a given `tools/call` targets. The plausible outcomes are: registration rejects the duplicate URL; one resource wins arbitrarily; or the grant collapses to per-server, in which case granting education `roles/iap.egressor` on `caserelay-partner-school` also grants it the clinic. **Not verified either way — the docs do not describe duplicate-URL behaviour.** Do not rely on per-resource isolation until you have watched a denied call in the IAP log and confirmed which resource name it names.

**This is why the artifacts take the CEL route.** `infra/policies/iam-partner-mcp-server.json` expresses per-agent isolation as **CEL conditions on `mcp.toolName`**, which is correct whether the gateway sees one resource or five, and does not depend on URL disambiguation working. If the five-Service split does turn out to authorize independently, the same conditions can be split across resources with no change to the expressions. Coupling the demo's isolation story to duplicate-URL behaviour days before the deadline is the avoidable risk here.

Who actually calls what, traced through `backend/partners/mcp_client.py`:

| Tool | Called by | Origin | Gateway sees it? |
|---|---|---|---|
| `school_callback` | education (`query_school`), verifier (`inspect_school_callback`) | Engine | Yes, once bound |
| `clinic_status` | health | Engine | Yes |
| `legal_status` | legal | Engine | Yes |
| `shelter_status` | shelter | Engine | Yes |
| `family_status` | family | Engine | Yes |
| `followup` | `backend/workflows/escalation.py` | **Cloud Run control plane** | **No** — not an engine |
| `school_status` | nobody | — | — |

Two things fall out. First, **`followup` is off-gateway**: the follow-up path that closes the commitment runs from the control plane, so no IAM grant or authz policy here touches it. Do not claim gateway coverage of the follow-up. Second, `school_status` has no caller, so dropping it from the allowlist is a free tightening once the MCP wiring is frozen.

Also note all seven tools are annotated `readOnlyHint: true`, including `school_callback` and `followup`. That makes `mcp.tool.isReadOnly` **true for everything**, so a verifier-read-only CEL clause is currently vacuous — it constrains nothing. It is still worth writing (it becomes load-bearing the day a mutating tool appears) but must not be presented as active enforcement.

### Per-policy verdicts

| # | CaseRelay policy today | Where | Verdict | Mechanism it maps onto |
|---|---|---|---|---|
| 1 | **Field scoping / partial-response projection** — per-case grant `allowed_fields` → `project()` returns payload with fields removed, plus `disclosed_fields` / `withheld_fields` | `backend/gateway/gateway.py:147`, `backend/policy/projection.py` | **Must stay in-app** | Nothing. Three independent blockers — see [below](#field-scoping-the-honest-answer-is-no). |
| 2 | **`assert_scope` denied-field check** — per-agent `denied_data_scopes` from agent cards | `backend/identity/registry.py:116` | **Moves with caveats** (coarsened) | IAM CEL on `mcp.toolName` per principal. Denies the *call*, not the *field*. Keep in-app; gateway is the outer ring. |
| 3 | **Grant / authority check** — supervisor-approved, per-case, per-purpose, with `legal_basis` | `backend/gateway/gateway.py:94-126` | **Must stay in-app** | Nothing. IAM is static config; this is per-case runtime state approved by a human mid-run. |
| 4 | **Caller identity resolution and verification** | `backend/gateway/gateway.py:20`, `registry.py:109` | **Moves cleanly where it applies** | Agent Identity mTLS + IAP. Strictly better than the in-app version, which its own docstring concedes has "no cryptographic verification … for same-process calls". Only covers engine→MCP egress; in-process calls still need the in-app check. |
| 5 | **Cross-scope content screening** — Model Armor + DLP custom infoTypes, fails closed | `backend/gateway/armor.py` | **Runs in both — deliberately** | `CONTENT_AUTHZ` + `caserelay-ma-authz-ext`, with `failOpen: false`. Gateway cannot return the structured verdict the escalation gate needs. See [below](#model-armor-placement-the-fail-open-problem-is-already-live). |
| 6 | **Orchestrator tool gating** — `build_for_run(tools)` hands each phase only its tools | `backend/agents/orchestrator/agent.py:186` | **Must stay in-app** | Nothing. These are in-process Python functions on Cloud Run. The gateway cannot see a Python call. |
| 7 | **Partner tool gating** (does not exist in-app today) | — | **New gateway capability** | AuthzPolicy `ALLOW` with `tools/call` + `params.exact`, plus per-agent IAM CEL. This is the genuine win. |
| 8 | **Escalation precondition** — `open_escalation` refuses without a recorded quarantine verdict | `backend/agents/verifier/agent.py:136` | **Must stay in-app** | Nothing. Stateful check against a Firestore verdict. |
| 9 | **MCP `prompts/` + `resources/` blocking** (does not exist in-app today) | — | **New gateway capability** | AuthzPolicy `DENY`. Four lines of YAML, a named attack class, no application code. |
| 10 | **Human approval gate on `activate_case` / `approve_escalation`** | HTTP endpoints in `backend/api/main.py` | **Must stay in-app** | Nothing. Note: the incident where the orchestrator LLM bypassed this gate was fixed by **removing both tools from `CONTROL_PLANE_TOOLS` entirely** — they are no longer in the model's tool surface at all. A gateway policy could never have prevented it; the calls were in-process. |

### Field scoping: the honest answer is no

`withheld_fields` cannot move to the gateway. Not "with difficulty" — not at all. Three independent reasons, any one of which is sufficient:

1. **Wrong action vocabulary.** Gateway enforcement is allow or deny on a request. Field scoping is a *transformation*: it returns a 200 with a smaller payload and a list naming what was removed. There is no gateway-native redact-and-continue — confirmed twice now, once in the docs (Model Armor's SDP de-identification issues a block rather than passing sanitized content through) and once against the live `caserelay-screen` template, which configures an inspect template and no de-identify template at all.
2. **Wrong inputs.** The decision reads `grant["allowed_fields"]` and `grant["legal_basis"]` from per-case Firestore state that a supervisor approved during the run. CEL at the gateway sees MCP attributes and HTTP headers. It has no path to that state.
3. **Wrong location.** `authorized_context()` is an in-process function inside the specialist engine that reads the case packet and projects it locally. Nothing crosses the network at the moment the field decision is made, so no network-layer control can intercept it — the same reason `build_for_run` gating is unreachable.

The closest honest equivalent is a **coarsening**: "may this identity reach this tool at all", enforced deterministically in IAM and logged with a SPIFFE principal. That is a genuinely stronger statement about *reachability* than anything CaseRelay does in-app, and it is worth showing. But it is a different claim, and it produces a 403, not a `withheld_fields` array.

Since `withheld_fields` is load-bearing on screen, the recommendation is blunt: **do not touch the projection path.** Present it as the layer the platform explicitly does not offer, and present the gateway's IAM decision log beside it as the layer the platform does better than we could. Two layers, two artifacts, one honest sentence each.

### Model Armor placement: the fail-open problem is already live

`failOpen` **is** configurable at the gateway — it is a plain field on the `authzExtension`, and `caserelay-ma-authz-ext` currently has it set to `true` with a 1s timeout. So the safety regression is not a future risk introduced by adopting the gateway; it is deployed today. `infra/policies/authzext-model-armor-failclosed.yaml` flips it to `false`. Extensions don't consume policy slots, so this costs nothing from the budget.

But fixing `failOpen` does **not** make gateway screening a replacement for `armor.py`, for a reason that has nothing to do with fail-open:

- `armor.py` returns `("quarantine", ["CASERELAY_CROSS_SCOPE_MEDICAL", …])`, and `inspect_school_callback` turns that into `{verdict, rules, required_action}`. The verifier's instruction branches on `verdict`; `open_escalation` refuses unless a `quarantine` verdict is on record in Firestore; the audit event and the whole quarantine → escalation → supervisor-decision arc hang off it.
- A gateway block surfaces to the caller as a transport error with no `rules` list and no verdict. Every one of those consumers would need a new feed.

**Recommendation: run in both places, and say so on camera.** Gateway Model Armor `failOpen: false` as the outer ring that stops a poisoned payload before any model sees it; `armor.py` as the inner ring that produces the decision the workflow acts on. The double screening cost is a few hundred milliseconds on one call. The alternative — moving screening out of the application to make a point about managed policy — trades the demo's most important moment for a configuration talking point.

One thing that *did* verify cleanly: the live `caserelay-ma-authz-policy` restricts the callout with `when: request.headers['content-type'] == 'application/json' || request.headers['content-type'].startsWith('text/')`. MCP-over-SSE posts `application/json` and streams `text/event-stream`, so both directions of the partner traffic match. The existing `CONTENT_AUTHZ` policy needs no change to start screening partner traffic the moment the MCP server is registered and an engine is bound.

### The four-policy budget

Ceiling is four `authzPolicies` per egress gateway, regardless of profile. **Two are already spent.**

| Slot | Policy | Profile | Status | Why it earns the slot |
|---|---|---|---|---|
| 1 | `caserelay-iap-authz-policy` | `REQUEST_AUTHZ` / `CUSTOM` | **live** | Delegates to IAP. Everything identity-based depends on it, and it is the only slot that makes IAM conditions mean anything. Non-negotiable. |
| 2 | `caserelay-ma-authz-policy` | `CONTENT_AUTHZ` / `CUSTOM` | **live** | Delegates to Model Armor. Already scoped by content-type. Non-negotiable. |
| 3 | `caserelay-deny-mcp-prompts-resources` | `REQUEST_AUTHZ` / `DENY` | **recommended** | Best value-per-line available: blocks MCP tool-poisoning declaratively, and its match set is disjoint from anything slot 1 governs, so the unguaranteed-ordering caveat cannot bite. |
| 4 | `caserelay-allow-partner-tool-surface` | `REQUEST_AUTHZ` / `ALLOW` | **reserve, written, not recommended before the demo** | Would allowlist the seven partner tools gateway-wide. Held back because it shares `REQUEST_AUTHZ` with slot 1's `CUSTOM` policy and Google documents that ordering between same-profile policies is not guaranteed, without defining how `ALLOW` composes with `CUSTOM`. |

**What was sacrificed, and where it went instead:**

- **Per-agent tool allowlists** were the obvious candidate for slot 4. They moved into **IAM conditions** (`infra/policies/iam-partner-mcp-server.json`), which consume **no** slots, are bound per resource, and — unlike an AuthzPolicy — can discriminate by *caller identity*, which is the whole point. This is a strict improvement, not a compromise. The general rule: prefer IAM CEL (unlimited, identity-aware) and spend AuthzPolicy slots only on identity-*independent* rules.
- **A dedicated `resources/`-only DENY** was folded into slot 3 alongside `prompts/` as a second `methods[]` entry in one policy.
- **Semantic Governance** takes no slot because it is not being attempted: Preview, plus VPC + proxy-only subnet + PSC + private DNS. Unchanged from [Phase 3](#phase-3--semantic-governance-policies-preview-dry-run-optional).
- **A custom `ext_proc` extension** — the only mechanism that could plausibly reproduce field scoping at the gateway, since you implement the action yourself — is out of reach: VPC-resolvable FQDN, DNS peering, `FULL_DUPLEX_STREAMED` gRPC server. Named here so the "why not" is on the record.

> **Unverified, and it matters:** whether a bare `action: ALLOW` / `action: DENY` policy counts against the "four **custom** authorization policies" limit, or whether the limit counts only `action: CUSTOM` policies. The wording is "a maximum of four custom authorization policies per gateway, regardless of policy profile", which reads as all-inclusive. Assume it counts. If it turns out not to, slot 4 is free money.

### Recommended split

**Gateway enforces** (managed, out-of-the-box, no application code):
- Which host each engine may reach at all — default-deny against Agent Registry.
- Which identity may invoke which partner MCP tool — IAM CEL on `mcp.toolName`.
- That no partner server may serve `prompts/` or `resources/` — AuthzPolicy `DENY`.
- mTLS agent identity on every outbound call, and the audit log of every decision.

**Stays in-app** (the platform has no equivalent):
- Field-scoped projection and `withheld_fields`.
- Per-case supervisor-approved authority grants with `legal_basis`.
- Per-phase orchestrator tool gating.
- The escalation precondition and the human approval gates.

**Runs in both, on purpose:**
- Model Armor content screening — gateway `failOpen: false` as the outer ring, `armor.py` fail-closed as the ring that produces the verdict.
- Identity verification — IAP for engine egress, `_resolve_caller_principal` for in-process calls the gateway cannot see.

### Artifacts

| File | What it is | Slot cost |
|---|---|---|
| `infra/policies/authzpolicy-mcp-deny-prompts-resources.yaml` | Slot 3. `DENY` on MCP `prompts` + `resources`. | 1 |
| `infra/policies/authzpolicy-mcp-allow-tool-surface.yaml` | Slot 4, reserve. `ALLOW` allowlist of the seven partner tools, with `baseProtocolMethodsOption: MATCH_BASE_PROTOCOL_METHODS`. | 1 |
| `infra/policies/authzext-model-armor-failclosed.yaml` | Replaces the live `caserelay-ma-authz-ext` with `failOpen: false`. | 0 |
| `infra/policies/iam-registry-wide-egress.json` | `roles/iap.egressor` for all eight engine principals on the registry, unconditioned. | 0 |
| `infra/policies/iam-partner-mcp-server.json` | Six conditioned bindings — one per specialist, each scoped to its own tool by CEL. Orchestrator and intake deliberately absent. | 0 |
| `infra/policies/modelarmor-template-caserelay-screen.json` | The live template captured as config. | 0 |
| `infra/policies/dlp-inspect-caserelay-cross-scope.json` | The live DLP inspect template captured as config. | 0 |
| `infra/policies/apply.sh` | Guarded applier. Dry-run by default; `--apply <step>` to execute one step. | — |

`set-iam-policy` **replaces** the policy for a resource, and a per-resource binding replaces the registry-wide binding rather than merging with it. That is why `iam-partner-mcp-server.json` is one file enumerating every allowed principal rather than one file per agent.

### Application changes this would require — described, not made

None of the following were implemented. All are in files owned by the concurrent MCP work.

| Change | Where | Why |
|---|---|---|
| Split the single `/sse` mount into per-partner paths | `backend/partners/mcp_server.py` | Only needed if you want five registry resources for per-resource IAM instead of CEL on one. Not required — the CEL design works as-is. |
| Give `followup` a real annotation set, or route it from an engine | `backend/partners/mcp_server.py`, `backend/workflows/escalation.py` | It is `readOnlyHint: true` today and called from Cloud Run, so it is both mis-annotated and off-gateway. |
| Set `readOnlyHint: false` on any tool that mutates | `backend/partners/mcp_server.py` | Until then `mcp.tool.isReadOnly` is uniformly true and every CEL clause using it is vacuous. |
| Keep `screen()` in the verifier | `backend/agents/verifier/agent.py` | Deleting it to "move policy to the gateway" removes the structured verdict the escalation gate reads. |

---

## Phase 0 — Gateway infrastructure (no fleet impact)

**Time:** ~15 min · **Risk:** none — creates cloud resources only · **Rollback:** delete the gateway, extensions, and policies.

### 0.1 Enable required APIs

The full documented set is larger than what Phase 0 strictly needs, but enabling the extras is free and avoids a mid-rollout stall:

```bash
gcloud services enable \
  networkservices.googleapis.com \
  networksecurity.googleapis.com \
  dns.googleapis.com \
  agentregistry.googleapis.com \
  modelarmor.googleapis.com \
  iam.googleapis.com \
  compute.googleapis.com \
  --project=caserelay
```

**Verify:**
```bash
gcloud services list --project=caserelay --enabled \
  --filter="NAME:(networkservices OR networksecurity OR dns OR agentregistry OR modelarmor)" \
  --format="value(NAME)" | sort
```

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

> The gateway's tenant project takes ~30s to settle before authz policies can attach ([codelab](https://codelabs.developers.google.com/cloudnet-agent-gateway)). If 0.4 fails with *"resource is being created and therefore can not be updated"*, wait and retry.

### 0.3 Capture the root CA now

Do this immediately, before anything else, because you will need it if any deploy path turns out to be BYOC. See [Risk R2](#risk-register).

```bash
gcloud network-services agent-gateways describe caserelay-egress \
  --location=us-central1 --project=caserelay \
  --format="value[delimiter='\n'](agentGatewayCard.rootCertificates)" > /tmp/agw-ca.pem
head -1 /tmp/agw-ca.pem   # expect: -----BEGIN CERTIFICATE-----
```

### 0.4 IAP authorization extension (DRY_RUN)

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

`iapPolicyVersion: "V1"` is **mandatory**. Removing `iamEnforcementMode` later switches to enforcement.

### 0.5 IAP authorization policy

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

### 0.6 Model Armor extension and policy — **already created; fix `failOpen`**

> **Superseded by live state (2026-08-28).** `caserelay-ma-authz-ext` and `caserelay-ma-authz-policy` both already exist, and the extension carries `failOpen: true`. The advice below to defer creation is moot; what remains actionable is reason 2 — flip `failOpen` to `false` using `infra/policies/authzext-model-armor-failclosed.yaml`. See [Model Armor placement](#model-armor-placement-the-fail-open-problem-is-already-live).

Previous versions of this plan created these in Phase 0. **Don't.** Three reasons:

1. Model Armor's egress inline protection is [limited to MCP, OpenAI-format, and A2A](https://docs.cloud.google.com/model-armor/model-armor-agent-gateway-integration). Until Phase 2 there is no such traffic on the engine egress path, so the extension screens nothing while still consuming one of your four policy slots and adding a callout to every request.
2. The documented sample sets `failOpen: true`. That means a Model Armor timeout or outage **allows the traffic through**. `backend/gateway/armor.py` fails *closed* (`ScreeningUnavailable` → quarantine). Adopting the gateway version as-is is a downgrade in a child-safeguarding system.
3. `timeout: 1s` on a body-streaming callout is tight. If you do adopt it, decide `failOpen` deliberately and write down which way you chose and why.

When you do create it (Phase 2), the verified form is:

```bash
cat > /tmp/caserelay-ma-authz-ext.yaml <<'EOF'
name: caserelay-ma-authz-ext
service: modelarmor.us-central1.rep.googleapis.com
metadata:
  model_armor_settings: '[
    {
      "request_template_id":  "projects/caserelay/locations/us-central1/templates/caserelay-screen",
      "response_template_id": "projects/caserelay/locations/us-central1/templates/caserelay-screen"
    }
  ]'
failOpen: false
timeout: 1s
EOF
```

paired with a `CONTENT_AUTHZ` policy whose `when:` clause restricts the callout to JSON/text bodies (the doc explicitly recommends this to keep gRPC out of Model Armor):

```yaml
httpRules:
  - to:
      operations: [ { "paths": [ { "prefix": "/" } ] } ]
    when: >
      request.headers['content-type'] == 'application/json' ||
      request.headers['content-type'].startsWith('text/')
```

### 0.7 Grant Model Armor roles to the gateway service agent

Needed only once you actually attach the Model Armor extension, but harmless to pre-grant.

> **Corrected against live state.** The doc's formula is `service-<GATEWAY_PROJECT_NUMBER>@gcp-sa-dep.iam.gserviceaccount.com`, which for caserelay (project number 189353698936) gives `service-189353698936@gcp-sa-dep.iam.gserviceaccount.com`. But `caserelay-egress` reports `agentGatewayCard.serviceExtensionsServiceAccount: service-252538273698@gcp-sa-dep.iam.gserviceaccount.com`. **Read the SA off the gateway resource rather than deriving it** — `apply.sh sa-grants` does exactly that. Granting the derived one and not the declared one is a silent way to get Model Armor callout failures, which with `failOpen: true` means silent non-screening.

```bash
for ROLE in roles/modelarmor.calloutUser roles/serviceusage.serviceUsageConsumer roles/modelarmor.user; do
  gcloud projects add-iam-policy-binding caserelay \
    --member=serviceAccount:service-189353698936@gcp-sa-dep.iam.gserviceaccount.com \
    --role="$ROLE" --condition=None --quiet
done
```

The Agent Runtime service agent (`service-189353698936@gcp-sa-aiplatform-re.iam.gserviceaccount.com`) needs `roles/modelarmor.calloutUser` + `roles/modelarmor.user` **only for ingress** Model Armor, which [we are not adopting](#layer-by-layer-verdict). Skip it.

### Phase 0 checkpoint

A real Agent Gateway exists with an IAP dry-run policy attached. The fleet is untouched. **This governs nothing.** Do not describe Phase 0 as "using Agent Gateway."

---

## Phase 1 — Bind the fleet

**Time:** ~30 min if binding in place; hours if redeploying · **Risk:** medium-high · **Rollback:** PATCH `agentGatewayConfig` back to `{}`.

### 1.0 Decide: PATCH in place, or blue/green?

`infra/rollout_gateway.sh` implements a blue/green strategy — deploy `caserelay-<agent>-gw` engines alongside the originals, verify, cut over. **Two documented facts make this the wrong choice here.**

**(a) New engines get new identities.** Blue/green produces new `reasoningEngines/{id}` values, therefore new `principal://` identities, therefore every IAP grant and every value in `infra/pinned_identities.env` refers to engines that are about to be deleted. The pinning guard in `rollout_gateway.sh` protects CaseRelay's *in-app* identity registry (`backend/identity/registry.py` reads `CASERELAY_IDENTITY_*`), which is exactly the right thing for that layer — but it cannot pin the platform's `effectiveIdentity`, which is derived from the resource ID. Both grant sets must be redone after cutover.

**(b) Split-gateway binding is documented as unsupported.** From the [Route Runtime traffic doc](https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/runtime/agent-gateway-runtime-deploy):

> "While a single project and region can host multiple Agent-to-Anywhere (egress) and Client-to-Agent (ingress) Agent Gateway instances, all Agent Runtime agents deployed within that same project and region must bind to the same specific egress and ingress Agent Gateway instances."

The doc's worked example is about two *different* gateways, so whether a bound engine and an unbound engine may coexist is **not explicitly stated and I could not verify it**. But a blue/green window is precisely a period where half the fleet is bound and half is not, in one project and region. That is not a bet worth taking days before a deadline.

**Recommendation: PATCH in place.** It is documented, reversible in one command, preserves every engine ID, and therefore preserves every identity and every grant.

Also note: `--agent-gateway-egress` (used in `deploy_fleet.sh` and `rollout_gateway.sh`) is an `agents-cli` flag. I could not find it in Google's published documentation — the documented surfaces are the SDK's `agent_gateway_config` in `client.agent_engines.create` and the REST PATCH below. **Unverified whether the CLI flag maps to the same field.** Verify the resulting `spec.deploymentSpec.agentGatewayConfig` after any CLI-based deploy rather than trusting the exit code.

### 1.1 Pre-flight: engine creation dates

Gateway binding requires engines created **after April 29, 2026**. Older engines must be fully redeployed — which reintroduces problem (a) above.

```bash
TOKEN=$(gcloud auth print-access-token)
for ENGINE_ID in 8689420053348614144 1247643881583935488 6205121908900364288 2657974252392677376 3107630527687950336 7993613910919872512 3044580132904763392 8701101264882106368; do
  CREATE_TIME=$(curl -s -H "Authorization: Bearer $TOKEN" \
    "https://us-central1-aiplatform.googleapis.com/v1/projects/caserelay/locations/us-central1/reasoningEngines/$ENGINE_ID" \
    | python3 -c "import json,sys; print(json.load(sys.stdin).get('createTime','UNKNOWN'))")
  echo "$ENGINE_ID: created $CREATE_TIME"
done
```

Also confirm each engine already has a platform agent identity — `spec.effectiveIdentity` must start with `agents.global.`:

```bash
gcloud ai reasoning-engines describe 8689420053348614144 \
  --region=us-central1 --project=caserelay \
  --format='value(spec.effectiveIdentity)'
```

### 1.2 Register every destination hostname — do this BEFORE binding

The gateway is default-deny and **matches hostnames exactly**. Register `aiplatform.googleapis.com` and the agent calls `us-central1-aiplatform.googleapis.com`, and the request is denied as an unregistered resource.

> **Correction to earlier versions of this plan:** `gcloud agent-registry endpoints create` and `gcloud agent-registry mcp-servers create` **are not the registration commands.** `Endpoint` and `McpServer` are read-only discovery resources. You create a **`Service`** resource; the registry generates the read-only one. Sources: [Register endpoints](https://docs.cloud.google.com/agent-registry/register-endpoints), [Agent Registry data model](https://docs.cloud.google.com/agent-registry/data-model).

```bash
register_endpoint() {  # name, display, url
  gcloud agent-registry services create "$1" \
    --project=caserelay --location=us-central1 \
    --display-name="$2" \
    --endpoint-spec-type=no-spec \
    --interfaces=url="$3",protocolBinding=http-json
}

register_endpoint caserelay-vertexai        "Vertex AI"          "https://us-central1-aiplatform.googleapis.com"
register_endpoint caserelay-vertexai-mtls   "Vertex AI mTLS"     "https://us-central1-aiplatform.mtls.googleapis.com"
register_endpoint caserelay-vertexai-rep    "Vertex AI rep"      "https://aiplatform.us-central1.rep.googleapis.com"
register_endpoint caserelay-vertexai-global "Vertex AI global"   "https://aiplatform.googleapis.com"
register_endpoint caserelay-agent-registry  "Agent Registry"     "https://agentregistry.googleapis.com"
register_endpoint caserelay-telemetry       "Telemetry"          "https://telemetry.googleapis.com"
register_endpoint caserelay-telemetry-mtls  "Telemetry mTLS"     "https://telemetry.mtls.googleapis.com"
register_endpoint caserelay-logging         "Cloud Logging"      "https://logging.googleapis.com"
register_endpoint caserelay-logging-mtls    "Cloud Logging mTLS" "https://logging.mtls.googleapis.com"
register_endpoint caserelay-firestore       "Firestore"          "https://firestore.googleapis.com"
register_endpoint caserelay-modelarmor      "Model Armor"        "https://modelarmor.us-central1.rep.googleapis.com"
register_endpoint caserelay-crm-mtls        "Resource Manager"   "https://cloudresourcemanager.mtls.googleapis.com"
```

**Why the mTLS variants matter here specifically:** `deploy_fleet.sh` sets `GOOGLE_API_USE_CLIENT_CERTIFICATE=true` on every engine, and the docs state that when that variable is set, the `*.mtls.googleapis.com` hostnames must also be allowed. `cloudresourcemanager.mtls.googleapis.com` is called during SDK init and is a documented cause of startup failures.

**Also note:** `GOOGLE_CLOUD_LOCATION=global` is set on the fleet, so LLM calls may resolve through `aiplatform.googleapis.com` rather than the regional host. Registering both is why `caserelay-vertexai-global` is in the list.

### 1.3 Grant `roles/iap.egressor` — registry-wide first

While IAP is in `DRY_RUN`, missing grants log but do not block. Start registry-wide so nothing is missing, then narrow to per-resource in Phase 2 where it actually expresses policy.

```bash
cat > /tmp/caserelay-registry-egress.json <<'EOF'
{
  "policy": {
    "bindings": [
      {
        "role": "roles/iap.egressor",
        "members": [
          "principal://agents.global.org-126484209344.system.id.goog/resources/aiplatform/projects/189353698936/locations/us-central1/reasoningEngines/1247643881583935488",
          "principal://agents.global.org-126484209344.system.id.goog/resources/aiplatform/projects/189353698936/locations/us-central1/reasoningEngines/6205121908900364288",
          "principal://agents.global.org-126484209344.system.id.goog/resources/aiplatform/projects/189353698936/locations/us-central1/reasoningEngines/2657974252392677376",
          "principal://agents.global.org-126484209344.system.id.goog/resources/aiplatform/projects/189353698936/locations/us-central1/reasoningEngines/3107630527687950336",
          "principal://agents.global.org-126484209344.system.id.goog/resources/aiplatform/projects/189353698936/locations/us-central1/reasoningEngines/8689420053348614144",
          "principal://agents.global.org-126484209344.system.id.goog/resources/aiplatform/projects/189353698936/locations/us-central1/reasoningEngines/7993613910919872512",
          "principal://agents.global.org-126484209344.system.id.goog/resources/aiplatform/projects/189353698936/locations/us-central1/reasoningEngines/3044580132904763392",
          "principal://agents.global.org-126484209344.system.id.goog/resources/aiplatform/projects/189353698936/locations/us-central1/reasoningEngines/8701101264882106368"
        ]
      }
    ]
  }
}
EOF

gcloud iap web set-iam-policy /tmp/caserelay-registry-egress.json \
  --project=caserelay --resource-type=agent-registry --region=us-central1
```

> **Remember:** a per-resource binding *replaces* the registry-wide binding for that resource rather than merging with it. Once you add per-partner grants in Phase 2, the registry-wide grant no longer covers those partners.

Each engine identity also needs the baseline roles the troubleshooting guide lists, or startup fails with `Failed to convert project number to project ID`: `roles/aiplatform.agentDefaultAccess`, `roles/aiplatform.user`, `roles/agentregistry.viewer`, `roles/logging.logWriter`, `roles/monitoring.metricWriter`, `roles/browser`. Check what `infra/grant_fleet_iam.sh` already covers before adding more; **`roles/browser` and `roles/agentregistry.viewer` are the two most likely to be missing.**

### 1.4 Canary: bind the shelter engine

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

**Verify binding:**
```bash
curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://us-central1-aiplatform.googleapis.com/v1/projects/caserelay/locations/us-central1/reasoningEngines/8689420053348614144" \
  | python3 -c "import json,sys; cfg=json.load(sys.stdin).get('spec',{}).get('deploymentSpec',{}).get('agentGatewayConfig',{}); print(json.dumps(cfg, indent=2) if cfg else 'NOT BOUND')"
```

**Verify it still serves, and that it can still reach Gemini** — the agent card returning 200 only proves the HTTP server is up, not that egress works:

```bash
curl -sf -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "${CASERELAY_URL_SHELTER%/api}/api/a2a/shelter/.well-known/agent-card.json"
```
then drive one real shelter turn through the control plane and watch for `CERTIFICATE_VERIFY_FAILED` or `Egress request is not authorized` in:
```bash
gcloud logging read \
  'resource.type="aiplatform.googleapis.com/ReasoningEngine"
   resource.labels.reasoning_engine_id="8689420053348614144"' \
  --project=caserelay --limit=50 --freshness=10m
```

> **ROLLBACK:**
> ```bash
> curl -s -X PATCH -H "Authorization: Bearer $(gcloud auth print-access-token)" \
>   -H "Content-Type: application/json; charset=utf-8" \
>   -d '{"spec":{"deploymentSpec":{"agentGatewayConfig":{}}}}' \
>   "https://us-central1-aiplatform.googleapis.com/v1/projects/caserelay/locations/us-central1/reasoningEngines/8689420053348614144?updateMask=spec.deploymentSpec.agentGatewayConfig"
> ```

### 1.5 Bind the remaining seven

Only if the canary is genuinely healthy — meaning a full shelter turn completed, not just a 200 on the card.

```bash
TOKEN=$(gcloud auth print-access-token)
for ENGINE_ID in 1247643881583935488 6205121908900364288 2657974252392677376 3107630527687950336 7993613910919872512 3044580132904763392 8701101264882106368; do
  echo "Binding $ENGINE_ID..."
  curl -s -X PATCH -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json; charset=utf-8" \
    -d '{"spec":{"deploymentSpec":{"agentGatewayConfig":{"agentToAnywhereConfig":{"agentGateway":"projects/caserelay/locations/us-central1/agentGateways/caserelay-egress"}}}}}' \
    "https://us-central1-aiplatform.googleapis.com/v1/projects/caserelay/locations/us-central1/reasoningEngines/$ENGINE_ID?updateMask=spec.deploymentSpec.agentGatewayConfig" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('spec',{}).get('deploymentSpec',{}).get('agentGatewayConfig',{}).get('agentToAnywhereConfig',{}).get('agentGateway','FAILED'))"
  sleep 6   # engine write quota is 10/min
done
```

### 1.6 Verification and the demo artifact

Run one clean-path case end to end. Then pull the gateway log — **this is the thing worth putting on screen:**

```bash
gcloud logging read \
  'resource.type="networkservices.googleapis.com/Gateway"
   resource.labels.location="us-central1"
   resource.labels.gateway_name="caserelay-egress"' \
  --project=caserelay --limit=40 --freshness=15m \
  --format="table(timestamp, httpRequest.requestUrl, jsonPayload.agentRegistryResource, jsonPayload.authzPolicyInfo.policies.result)"
```

And the IAP decision log, which carries the agent's SPIFFE identity per call:

```bash
gcloud logging read \
  'protoPayload.serviceName="iap.googleapis.com"
   protoPayload.authorizationInfo.permission="iap.webServiceVersions.egressViaIAP"' \
  --project=caserelay --limit=40 --freshness=15m \
  --format="table(timestamp, protoPayload.authenticationInfo.principalSubject, protoPayload.authorizationInfo[0].resource, protoPayload.authorizationInfo[0].granted)"
```

The Cloud console **Agent Gateway → Observability** tab renders the same data as scorecards and charts. It requires the `_Default` log bucket to be upgraded to Observability Analytics — **check that a day before the demo**, not on the day.

### Phase 1 checkpoint — state it accurately

**True after Phase 1:** all eight engines route egress through Agent Gateway. Every outbound call is identity-authenticated over mTLS, checked against IAM (dry-run), matched to an Agent Registry resource, and logged with the agent's SPIFFE identity, the destination, and the verdict.

**Not true after Phase 1, do not claim it:** that Model Armor is screening LLM traffic (see Correction 3); that partner callbacks are governed (they are in-process); that the orchestrator's traffic is governed (it runs on Cloud Run).

---

## Phase 2 — Partner simulator as MCP servers

**Time:** 3–6 hours realistically · **Risk:** high — changes tool bindings, requires fleet redeploy · **Rollback:** revert code, redeploy without gateway.

This is where every interesting policy becomes possible: Model Armor gets MCP traffic to screen, and Surfaces A and B get MCP attributes to match on. It is also the phase that redeploys engines, which regenerates identities, which invalidates grants.

### One MCP server or five?

**Five**, one per partner. IAP's unit of authorization is the registered resource. Five servers gives clean per-identity isolation with no CEL at all; one server would force every access decision into `mcp.toolName` conditions, and one malformed CEL expression silently opens or closes the whole thing.

> **The implementation went with one.** `backend/partners/mcp_server.py` is a single server exposing all seven tools on a single `/sse` mount. That is a defensible call under deadline, and the CEL-per-tool design in `infra/policies/iam-partner-mcp-server.json` accommodates it — but the caveat above stands: every access decision now rides on one CEL expression per agent, so review them rather than trusting them. See [the topology section](#the-topology-the-mcp-work-is-actually-building).

| MCP Server | Tools | Agents granted |
|---|---|---|
| `caserelay-partner-school` | `school_status`, `school_callback` | education, verifier |
| `caserelay-partner-clinic` | `clinic_status` | health |
| `caserelay-partner-legal` | `legal_status` | legal |
| `caserelay-partner-shelter` | `shelter_status` | shelter |
| `caserelay-partner-family` | `family_status` | family |

### `case_id` and scenario control survive unchanged

`sim.school_callback(referral_id, case_id=case_id)` calls `_behaviour(case_id, "education")`, which reads `partner_behaviour` from the Firestore case packet. The transport changes from function call to MCP tool call; the logic does not. The MCP server imports `backend.partners.sim` and calls the same function, so it needs the same `roles/datastore.user`. `backend/partners/sim.py` is unchanged.

### 2.1 Write `toolspec.json` — this is a policy artifact, not boilerplate

The annotations you declare here become the CEL booleans Policy 2 depends on. Get them right.

```json
{
  "tools": [
    {
      "name": "school_status",
      "description": "Read the current enrollment status for a referral.",
      "annotations": { "title": "School Status", "readOnlyHint": true, "idempotentHint": true, "openWorldHint": false }
    },
    {
      "name": "school_callback",
      "description": "Retrieve the school's callback payload for a referral.",
      "annotations": { "title": "School Callback", "readOnlyHint": true, "idempotentHint": true, "openWorldHint": false }
    }
  ]
}
```

Max 10 KB. Schema follows the MCP tool spec.

### 2.2 Deploy the five MCP servers to Cloud Run

Each needs `roles/datastore.user` and `roles/serviceusage.serviceUsageConsumer`.

**Do not use the `--iap --functional-type=mcp-server` Cloud Run integration** described in the [Configure IAM agent policies](https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/policies/configure-iam-policies) doc. It is explicitly labelled **Preview** and pulls in an OAuth client setup that buys nothing here — the gateway authorizes the egress side, which is what CaseRelay's policy story is about. Plain authenticated Cloud Run services are enough.

### 2.3 Register each server

```bash
gcloud agent-registry services create caserelay-partner-school \
  --project=caserelay --location=us-central1 \
  --display-name="CaseRelay School Partner" \
  --mcp-server-spec-type=tool-spec \
  --mcp-server-spec-content=@toolspec-school.json \
  --interfaces=url="https://SCHOOL_URL/mcp",protocolBinding=jsonrpc \
  --format="value(registryResource)"
```

Keep the `registryResource` output — it is the ID you need for IAM bindings, and it is **not** the service name you chose.

### 2.4 Per-agent, per-partner grants

Derive the ID rather than guessing it:

```bash
mcp_id() {
  gcloud agent-registry mcp-servers list --project=caserelay --location=us-central1 \
    --filter="interfaces.url:$1" --format="value(name.basename())"
}
```

Then apply the Policy 1 and Policy 2 bindings from [Custom policies](#four-concrete-caserelay-policies). Education gets `caserelay-partner-school` only; health gets `caserelay-partner-clinic` only; and so on. Verifier gets school with the read-only CEL condition.

**Then remove the registry-wide grant from 1.3 for the partner servers** — or verify that the per-resource bindings have replaced it, since a per-resource binding replaces rather than merges.

### 2.5 Now attach Model Armor

With MCP traffic on the wire, the Model Armor extension from 0.6 finally has something to screen. Create it now, and **decide `failOpen` deliberately**:

- `failOpen: false` — matches `armor.py`'s fail-closed posture. A Model Armor blip breaks the demo.
- `failOpen: true` — matches the doc sample. A Model Armor blip silently lets a poisoned callback through.

For a child-services system the defensible answer is `false`. For a live demo the safe answer is `true`. **You cannot have both — pick one and say which on camera.** The most honest option is `failOpen: false` at the gateway *and* keep `armor.py`'s fail-closed check in the verifier as defence in depth, accepting the double screening cost.

### 2.6 Refactor agent code

| File | Change |
|---|---|
| `backend/partners/mcp_server.py` | NEW — FastMCP server wrapping `sim.py` |
| `backend/agents/{education,health,legal,shelter,family}/agent.py` | Replace direct `sim.*` import with `McpToolset` |
| `backend/agents/verifier/agent.py` | Replace `sim.school_callback` with `McpToolset`; decide whether `screen()` stays |
| `infra/deploy_fleet.sh` | Add `CASERELAY_PARTNER_*_URL` env vars |
| `infra/grant_fleet_iam.sh` | Add per-agent per-partner `roles/iap.egressor` |

Unchanged: `backend/partners/sim.py`, `backend/runtime/a2a_client.py`, `backend/runtime/a2a_auth.py`.

**On `armor.py`:** keep it. Gateway Model Armor returns an *error*, not a structured verdict. `inspect_school_callback` currently returns `{"verdict", "rules", "required_action"}` and the verifier's instruction branches on `verdict`. A gateway block surfaces as an exception with no `rules` list, so `_verdict_cache`, `store.save_screening_verdict`, and `open_escalation`'s quarantine precondition all need a new feed. That is real refactoring work with a real chance of breaking the demo's most important moment. Recommendation: **run both, and let the gateway be the outer ring.**

### 2.7 Redeploy — and re-grant

```bash
bash infra/deploy_fleet.sh
```

**Immediately after any redeploy, re-verify every engine ID and re-run every IAP grant.** If a redeploy produced new engine IDs, the grants from 1.3 and 2.4 now point at engines that no longer exist and the fleet will 403 everywhere the moment you leave dry-run.

---

## Phase 3 — Semantic Governance Policies (Preview, dry-run, optional)

**Time:** unpredictable — 2–20 min provisioning plus VPC/PSC/DNS setup · **Risk:** low to run, high to depend on.

**Prerequisites the earlier version of this plan understated.** SGP is not a policy you write; it is infrastructure you provision:

1. A VPC network, a subnet, and a **proxy-only subnet** (`--purpose=REGIONAL_MANAGED_PROXY --role=ACTIVE`).
2. A private DNS zone.
3. A network attachment with `--connection-preference=ACCEPT_AUTOMATIC`.
4. A reserved static IP, a **PSC forwarding rule** to the engine's service attachment, and an A record.
5. VPC connectivity registered on the Agent Gateway (network attachment + DNS peering).
6. A `CONTENT_AUTHZ` authz extension pointing at the private DNS hostname, plus a matching authz policy.

Google-managed binding automates some of this, but not the gateway-side VPC connectivity.

**The eligibility trap, restated precisely.** From [Configure semantic governance policies](https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/policies/configure-semantic-governance):

> "To appear in a Semantic governance policy's agent selector … an agent's reasoning engine must have been deployed with both `identity_type=AGENT_IDENTITY` and `agent_gateway_config` set. … **Both fields are immutable on an existing reasoning engine, so an agent deployed without them must be redeployed — patching will not work.**"

The Route Runtime doc shows a working PATCH for `agentGatewayConfig`. Both statements can be true: the PATCH binds the gateway for *traffic routing*, while SGP's eligibility check may look at how the engine was *created*. **I could not verify which reading is correct.** The consequence is concrete and bad: if you take the Phase 1 recommendation and PATCH in place, SGP may reject your fleet, and the only remedy is a full redeploy with `agent_gateway_config` in the create call — which regenerates identities and invalidates grants.

**Cheap eligibility test before committing:** provision the engine, then try to create one policy against one agent. `gcloud` and the API return an explicit error (the console just filters the agent out silently, which is why you should use `gcloud`). Watch for `SEMANTIC_GOVERNANCE_POLICY_AGENT_NOT_CONFIGURED`.

Supported regions include `us-central1`. Cost is billed as evaluation-model tokens; each verdict log carries `token_usage`.

**Verdict: do not attempt before the deadline.** If you want the story, provision nothing and instead show the [Semantic governance policies overview](https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/policies/semantic-governance-overview) layered-governance table next to CaseRelay's own architecture and say which row you occupy today and which row you'd occupy next.

---

## Decision log and corrections

### Correction 1: Basic Agent Gateway does not require private networking — still true

The VPC / proxy-only subnet / network attachment / PSC / private DNS stack is required only for **SGP** connectivity and for egressing to private destinations. A basic egress gateway for IAP + Model Armor is Google-managed and needs none of it. Source: [Set up Agent Gateway](https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/gateways/set-up-agent-gateway) — the egress YAML contains only `name`, `protocols`, `googleManaged.governedAccessPath`, `registries`.

### Correction 2: `agentGatewayConfig` is PATCHable for routing — with a caveat

The [Route Runtime traffic doc](https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/runtime/agent-gateway-runtime-deploy) documents a REST PATCH for existing agents. Limitation: engines created before **April 29, 2026** cannot be bound at all. Unresolved: whether a PATCHed engine satisfies SGP's eligibility check — see Phase 3.

### Correction 3: Gateway Model Armor probably does not see CaseRelay's LLM traffic

Earlier versions of this plan asserted that Phase 1 gives "real Model Armor screening on LLM/A2A traffic." That is very likely wrong.

> "Egress integration compatibility: Model Armor's inline protection on egress traffic is limited to integrations with MCP servers, services following the OpenAI format, and A2A through Agent Gateway."
> — [Integrate Model Armor with Agent Gateway](https://docs.cloud.google.com/model-armor/model-armor-agent-gateway-integration)

CaseRelay's engine egress is Gemini `:generateContent` — not MCP, not OpenAI-format, and not A2A. Confusingly, the SGP setup doc's authz policy `when:` clause matches `:generateContent` and `:streamGenerateContent`, which shows the *gateway* sees that traffic. But Model Armor's own compatibility statement excludes it. **I could not reconcile these two documents.** Treat Model Armor coverage of Gemini egress as **unverified and probably absent**, and design as if Phase 2 is a prerequisite for any gateway content screening.

The A2A clause does not rescue this either: CaseRelay's A2A calls originate from the Cloud Run control plane, not from a bound engine.

### Correction 4: Registration uses `services`, not `endpoints` / `mcp-servers`

`gcloud agent-registry endpoints create` and `mcp-servers create` were used in earlier versions of this plan. `Endpoint` and `McpServer` are **read-only** discovery resources generated by the registry; you create a `Service`. Corrected commands are in [1.2](#12-register-every-destination-hostname--do-this-before-binding) and [2.3](#23-register-each-server). Sources: [Register endpoints](https://docs.cloud.google.com/agent-registry/register-endpoints), [Register MCP servers](https://docs.cloud.google.com/agent-registry/register-mcp-servers), [data model](https://docs.cloud.google.com/agent-registry/data-model).

### Correction 5: IAP bindings take registry-generated IDs, not your service names

`gcloud iap web {add-iam-policy-binding,set-iam-policy} --endpoint=` / `--mcp-server=` take `ENDPOINT_ID` / `MCP_SERVER_ID`. Derive them:

```bash
gcloud agent-registry endpoints list --project=caserelay --location=us-central1 \
  --filter="interfaces.url:HOSTNAME" --format="value(name.basename())"
```

### Correction 6: Per-resource IAM bindings replace, not merge

> "Per-resource: Narrow access. **A per-resource binding replaces the registry-wide binding for that specific resource** instead of merging with it."
> — [Troubleshoot Agent Gateway connectivity](https://docs.cloud.google.com/gemini-enterprise-agent-platform/troubleshooting/troubleshoot-agent-gateway)

This cuts both ways: it is what makes Policy 1 enforceable, and it is what will silently break a partner call in Phase 2 if you add a narrow binding that omits an agent that previously worked via the registry-wide grant.

### Correction 7: The CA-injection story in the Dockerfile is a BYOC path

The [Route Runtime traffic doc](https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/runtime/agent-gateway-runtime-deploy) states:

> "non-BYOC (source-based) agent deployments **automatically inject the CA's certificate during image creation**."

The `AGENT_GATEWAY_ROOT_CERTIFICATES` build-arg block in the repo's root `Dockerfile` (commit `ff47cad`) is the documented **BYOC** remedy. The earlier canary nonetheless failed with `CERTIFICATE_VERIFY_FAILED` on a source-based `agents-cli deploy`, which means either the automatic injection did not fire, or that path is effectively BYOC. **Either way the documented guarantee did not hold in practice — treat CA/TLS as a live risk, not a solved one.** See [Risk R2](#risk-register).

Two differences between the repo's Dockerfile and Google's snippet, neither verified as significant:
- Google's snippet sets a fourth env var, `AGENT_GATEWAY_ROOT_CERT_302034098528`, which looks like a Google-internal project-number-suffixed variable. **Unverified whether it is required.** The repo's Dockerfile omits it.
- Google's snippet does not `mkdir -p /usr/local/share/ca-certificates` before the `awk` redirect; the repo's does, which is more robust on slim images.

### Correction 8: Blue/green rollout is the wrong shape for this platform

See [1.0](#10-decide-patch-in-place-or-bluegreen). New engines mean new identities mean invalidated grants; and split-gateway binding within a project+region is documented as unsupported for *different* gateways, with the bound/unbound case unstated. `infra/rollout_gateway.sh` is well built — its identity-pinning guard, empty-stub detection, and `MAX_PARALLEL=1` default all address real documented failure modes — but it is solving for a rollout shape that the platform does not reward. Prefer the in-place PATCH.

---

## Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| **R1** | Any engine redeploy regenerates `reasoningEngines/{id}` → new identity principal → every `roles/iap.egressor` grant silently stops applying. Google's own codelab names this the #1 cause of 403s. | High | Demo-fatal once IAP is enforcing | PATCH in place, never redeploy. If you must redeploy, re-run every grant and re-derive `pinned_identities.env` immediately after. Keep IAP in `DRY_RUN` until the demo is over. |
| **R2** | TLS interception breaks egress with `CERTIFICATE_VERIFY_FAILED`. Already happened once on the canary despite the docs promising automatic CA injection on source builds. | Medium | Demo-fatal | Capture the CA in [0.3](#03-capture-the-root-ca-now) before anything else. Canary a single engine and drive a real turn, not just an agent-card probe. Keep the unbind PATCH one paste away. |
| **R3** | Default-deny blocks an unregistered hostname variant. `GOOGLE_API_USE_CLIENT_CERTIFICATE=true` and `GOOGLE_CLOUD_LOCATION=global` mean the SDK may resolve through `*.mtls.googleapis.com`, `aiplatform.googleapis.com`, or `aiplatform.us-central1.rep.googleapis.com`. Gateway matches hostnames **exactly**. | High | Startup failures | Register all variants ([1.2](#12-register-every-destination-hostname--do-this-before-binding)). Stay in `DRY_RUN` and read the IAP log for `audited_resource_name: unregisteredResource`. |
| **R4** | Moving screening to the gateway silently converts fail-closed to fail-open. `armor.py` raises `ScreeningUnavailable` → quarantine; the documented gateway extension sets `failOpen: true` with a 1s timeout. | Medium | Safety regression, and an uncomfortable question if a judge asks | Set `failOpen: false` **and** keep `armor.py` in the verifier as defence in depth. |
| **R5** | Four-policy ceiling on an egress gateway. **Two are already spent** (IAP + Model Armor, both live). One DENY makes 3 of 4. | Certain | Blocks a fourth idea late | Budget slots up front — see [The four-policy budget](#the-four-policy-budget). Prefer IAM CEL conditions (unlimited, bound to resources, identity-aware) over AuthzPolicy objects (capped at 4, gateway-wide). |
| **R9** | `caserelay-ma-authz-ext` is live with `failOpen: true`, so a Model Armor timeout currently passes traffic through unscreened — laxer than `armor.py`. | Certain (deployed now) | Safety regression, and it is real rather than hypothetical | Apply `infra/policies/authzext-model-armor-failclosed.yaml`. Costs no policy slot. |
| **R10** | Adding an `ALLOW` AuthzPolicy alongside the existing `CUSTOM` policy on `REQUEST_AUTHZ` has undefined composition; the docs only say ordering between same-profile policies is not guaranteed. | Unknown | Could deny all MCP traffic, or silently allow | Keep slot 4 in reserve. Prefer the `DENY` policy, whose match set is disjoint from slot 1's. |
| **R11** | `followup` is invoked from the Cloud Run control plane, not an engine, so it never traverses the gateway. | Certain | Overclaiming risk on camera | State that the follow-up path is in-app-governed only. |
| **R6** | SGP eligibility may require create-time config, invalidating a PATCH-bound fleet. | Unknown — unresolved doc conflict | Days of rework | Do not attempt SGP before the deadline. |
| **R7** | Binding a gateway disables SCC Agent Engine Threat Detection. | Certain | Low — not in use | Note it; don't claim both. |
| **R8** | Observability dashboard silently shows nothing unless `_Default` is upgraded to Observability Analytics. | Medium | Embarrassing on camera | Verify the dashboard renders a day before, not on the day. |

---

## Theatre vs substance — revised

| Action | Verdict |
|---|---|
| Phase 0: gateway + IAP dry-run policy, no engines bound | **Presentational.** The resource exists and governs nothing. Do not call this "using Agent Gateway." |
| Phase 1: fleet PATCH-bound, destinations registered, IAP dry-run | **Substantive.** Every engine's egress is identity-authenticated over mTLS, matched against a registry, and logged with a SPIFFE identity and a verdict. The log is a real artifact, not a slide. |
| Phase 1 claimed as "Model Armor screening LLM traffic" | **False, per Correction 3.** Don't say it. |
| Phase 1 IAP grants while in `DRY_RUN` | **Substantive infrastructure, not enforcement.** Say "audit mode" out loud. Enforcing before the demo is how you lose the demo. |
| Custom Policy 3 (deny MCP `prompts/` + `resources/`) | **Deeply substantive.** A named attack class blocked declaratively in four lines of YAML, no application code. Best value-per-effort item in this document — but needs Phase 2. |
| "We moved our field-scoping policy to the platform's governance layer" | **False.** The gateway has no redact-and-continue action, cannot read the per-case grant, and the decision never crosses the network. See [Field scoping](#field-scoping-the-honest-answer-is-no). Say instead that the platform governs *reachability* and the application governs *disclosure*, and show both artifacts. |
| Gateway Model Armor presented as replacing `armor.py` | **False and a safety regression as currently deployed** (`failOpen: true`). Run both; fix `failOpen`; say which ring produces the verdict. |
| Per-agent tool isolation via IAM CEL on `mcp.toolName` | **Substantive, and free of the policy ceiling.** Deterministic, identity-scoped, audited, and it costs none of the four slots. The strongest available answer to "did you use the platform's governance layer?" |
| Custom Policies 1 & 2 (per-partner isolation, verifier read-only) | **Deeply substantive.** Deterministic, auditable, identity-level cross-scope enforcement in cloud config. Needs Phase 2. |
| Phase 2: partner simulator as MCP servers | **The real prize, and the real risk.** Everything interesting depends on it; it requires a redeploy, which triggers R1. |
| Phase 3: SGP in dry-run | **Substantive as a capability demo, unenforceable in practice.** Preview + VPC/PSC + create-time immutability. Honest as a talking point, dishonest as "enforced." |
| Blue/green rollout via `rollout_gateway.sh` | **Well-engineered solution to the wrong problem.** See Correction 8. |

---

## Deadline-aware recommendation

Today is **2026-08-28**. Assume days, not weeks.

### Do now (about half a day, low risk)

1. **Phase 0** — gateway + IAP dry-run extension and policy. **Capture the root CA first ([0.3](#03-capture-the-root-ca-now)).**
2. **[1.2](#12-register-every-destination-hostname--do-this-before-binding)** — register all destination hostname variants as `Service` resources. This is the step that actually prevents the fleet from breaking.
3. **[1.3](#13-grant-rolesiapegressor--registry-wide-first)** — registry-wide `roles/iap.egressor` for all eight identities, plus the baseline roles from the troubleshooting guide (`roles/browser` and `roles/agentregistry.viewer` are the likely gaps).
4. **[1.4](#14-canary-bind-the-shelter-engine)** — canary **one** engine by PATCH. Drive a real turn. Read the logs. This is the moment R2 either bites or doesn't.
5. If the canary holds: **[1.5](#15-bind-the-remaining-seven)** — bind the other seven, 6s apart.
6. **[1.6](#16-verification-and-the-demo-artifact)** — verify the Observability tab renders. Screenshot the gateway and IAP logs. **This is your demo artifact.**

Stop here if anything wobbles. Phase 1 alone is a defensible, honest story: *"every outbound call any agent makes is identity-authenticated, matched against an approved registry, and logged — in audit mode, because we're not enforcing on a system that touches children's records until we've watched a week of traffic."* That last clause is not a hedge; it is the correct engineering answer and it will read as one.

### Do only if Phase 1 lands clean with real time to spare

7. **Phase 2** for **one partner** — school only, not all five. That is the only partner the demo actually exercises (`inspect_school_callback`). One MCP server, one `toolspec.json`, two IAM bindings (Policies 1 and 2), and Policy 3's DENY rule.
8. Attach Model Armor with `failOpen: false`, and **keep `armor.py`** — do not delete the fail-closed path to make a point about moving policy to config.

That gets you the entire custom-policy story with roughly one-fifth of Phase 2's blast radius.

### Defer outright

- Phase 3 / SGP. Preview, VPC + PSC + private DNS, unresolved create-time immutability. Not reachable safely.
- Ingress (Client-to-Agent) gateway. Governs only `query`/`streamQuery`; CaseRelay's A2A path is neither. Zero coverage for real work.
- Custom `ext_proc` authorization extensions. Needs a VPC-resolvable FQDN and a streaming gRPC service. Nothing here needs it.
- The remaining four partner MCP servers.
- Blue/green rollout (Correction 8).

### Talking points — true, unbuilt, and worth saying

- **"Semantic Governance Policies would sit here."** Show the layered-governance table from the SGP overview, point at the row CaseRelay's verifier currently occupies in application code, and say the platform now offers it as an LLM-judged intent gate in Preview. That is an architecture-literate answer, not a claim.
- **"Agent Identity is mTLS + DPoP, not a bearer token."** Already true of CaseRelay's fleet via `--agent-identity`. Most demos will not have this.
- **"Custom policies are CEL over MCP attributes, not a new DSL."** Being specific about `mcp.tool.isReadOnly` — and about the fact that it comes from a `toolspec.json` **you** author, so it is self-asserted — will read as someone who actually read the docs.

### The one thing not to do

Do not switch IAP out of `DRY_RUN` before the demo. Enforcement plus default-deny plus exact hostname matching plus R1's identity churn is four independent ways to produce a 403 mid-run, and only one of them announces itself clearly in the logs.

---

## Source index

| Topic | URL |
|---|---|
| Agent Gateway overview | https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/gateways/agent-gateway-overview |
| Set up Agent Gateway | https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/gateways/set-up-agent-gateway |
| Delegate authorization with Service Extensions | https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/gateways/delegate-authorization |
| Monitor Agent Gateway | https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/gateways/monitor-agent-gateway |
| Troubleshoot Agent Gateway connectivity | https://docs.cloud.google.com/gemini-enterprise-agent-platform/troubleshooting/troubleshoot-agent-gateway |
| Route Agent Runtime traffic through Agent Gateway | https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/runtime/agent-gateway-runtime-deploy |
| Policies overview (CEL attribute table) | https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/policies/overview |
| Configure IAM agent policies | https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/policies/configure-iam-policies |
| Semantic governance policies overview | https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/policies/semantic-governance-overview |
| Configure semantic governance policies | https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/policies/configure-semantic-governance |
| Integrate Model Armor with Agent Gateway | https://docs.cloud.google.com/model-armor/model-armor-agent-gateway-integration |
| Integrate Model Armor with Agent Platform | https://docs.cloud.google.com/model-armor/model-armor-vertex-integration |
| Model Armor overview / templates | https://docs.cloud.google.com/model-armor/overview · https://docs.cloud.google.com/model-armor/manage-templates |
| Register endpoints | https://docs.cloud.google.com/agent-registry/register-endpoints |
| Register MCP servers | https://docs.cloud.google.com/agent-registry/register-mcp-servers |
| Agent Registry data model | https://docs.cloud.google.com/agent-registry/data-model |
| Agent Platform release notes (GA/Preview stages) | https://docs.cloud.google.com/gemini-enterprise-agent-platform/release-notes |
| Agent Platform pricing | https://cloud.google.com/products/gemini-enterprise-agent-platform/pricing |
| Agent quotas and system limits | https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/agent-quotas |
| Codelab: Govern agentic workloads with Agent Platform | https://codelabs.developers.google.com/cloudnet-agent-gateway |

**Pages that 404'd during this research** (linked from the overview but not resolvable — do not cite them): `govern/gateways/plan-agent-gateway-deployment`, `govern/policies/authorization-policies-overview`, `govern/gateways/delegate-authorization-service-extensions`, `govern/gateways/troubleshoot-agent-gateway`. The live equivalents are in the table above.

**Explicitly unverified, flagged inline:** whether gateway Model Armor screens Gemini `:generateContent` on egress (Correction 3); whether a PATCH-bound engine is SGP-eligible (Phase 3); whether `agents-cli --agent-gateway-egress` maps to `spec.deploymentSpec.agentGatewayConfig` ([1.0](#10-decide-patch-in-place-or-bluegreen)); whether the bare-CEL-variable form `request.mcp.toolName` works alongside the `api.getAttribute(...)` form ([Surface A](#surface-a--verified-cel-attributes)); whether Google's `AGENT_GATEWAY_ROOT_CERT_302034098528` env var is required (Correction 7); whether a bound and an unbound engine may coexist in one project+region ([1.0](#10-decide-patch-in-place-or-bluegreen)).

**Additionally unverified, from the policy-migration analysis:**

- Whether bare `action: ALLOW` / `action: DENY` policies count against the four-**custom**-policy ceiling, or whether only `action: CUSTOM` policies do. Assumed to count.
- **Whether five Agent Registry Services sharing one interface URL authorize independently.** `infra/deploy_partners.sh` registers all five partners against the same `/mcp` endpoint and depends on per-resource IAM to isolate them. The gateway matches destinations by hostname, so this may collapse to a single authorization unit. Untested, and load-bearing for the Policy 1 scope-isolation story.
- How an `ALLOW` policy composes with a `CUSTOM` policy on the same `REQUEST_AUTHZ` profile. Only the "order is not guaranteed" statement is documented. This is why slot 4 is held in reserve ([R10](#risk-register)).
- Whether the `mcp.toolName == ''` escape clause is required to admit base-protocol MCP RPCs under an IAM condition. It comes from the codelab; the reference IAM doc's own example omits it and would, read literally, prevent MCP session establishment. Included in `iam-partner-mcp-server.json` on the codelab's authority.
- Whether the DENY method matcher `name: "prompts"` matches the whole `prompts/*` family or only a literal method named `prompts`. The docs' own DENY example uses the bare family name and describes it as disallowing "all `prompts/` method access", so the family reading is the documented intent — but it was not tested.
- Whether `gcloud model-armor templates` / DLP `inspectTemplates` can be recreated from the captured JSON in `infra/policies/` via a `?template_id=` create. The GET shapes were read live; the create path was not exercised.
- Whether `mcp.resourceName` and `mcp.promptName` are populated on a DENY evaluation. Not needed by any artifact here, so not pursued.
- The Model Armor template config could not be read via `gcloud model-armor templates describe` — the active account lacks the permission. It was read through the Model Armor REST endpoint instead, which succeeded; the captured config is live, not inferred.

---

## Phase 2 Implementation — Partner MCP Server (completed locally)

### Architecture decision: one server, five registry entries

One Cloud Run service (`caserelay-partners`) exposes all five partners as MCP tools via Streamable HTTP transport (MCP 2.x). Five Agent Registry Services are registered against it, one per partner (`caserelay-partner-school`, `-clinic`, `-legal`, `-shelter`, `-family`), each pointing at the same `/mcp` endpoint. This gives:

- Per-resource IAP authorization without CEL conditions (each registry entry is its own authorization unit)
- Full Agent Registry discovery story (five distinct external organisations visible)
- One deployable, one image, one Cloud Run scaling group (minimal blast radius)
- The four-policy ceiling is unaffected (IAM per-resource bindings are unlimited)

### Files created

| File | Purpose |
|---|---|
| `backend/partners/mcp_server.py` | MCPServer (MCP 2.x) wrapping all `sim.py` functions as tools with proper annotations (`readOnlyHint`, `idempotentHint`) |
| `backend/partners/mcp_client.py` | Sync client with automatic fallback: `CASERELAY_PARTNER_MCP=0` (default) → in-process `sim.py`; `=1` → network MCP call |
| `Dockerfile.partners` | Standalone image for the partner MCP server |
| `infra/deploy_partners.sh` | Build, deploy to Cloud Run, register five Services in Agent Registry |

### Callers rewired

All agent modules (`education`, `health`, `legal`, `shelter`, `family`, `verifier`) and `backend/workflows/escalation.py` now import `backend.partners.mcp_client` instead of `backend.partners.sim`. The client transparently routes to sim.py (in-process) or MCP (network) based on the env var.

### Fallback control

| Env var | Value | Effect |
|---|---|---|
| `CASERELAY_PARTNER_MCP` | unset, `""`, `"0"`, `"false"` | In-process sim.py (proven path, default) |
| `CASERELAY_PARTNER_MCP` | `"1"` | MCP network call to `CASERELAY_PARTNER_MCP_URL` |
| `CASERELAY_PARTNER_MCP_URL` | URL | Target MCP server (default: `http://localhost:8090`) |

### Deploy commands (run when ready)

```bash
# 1. Build and deploy the partner MCP server
bash infra/deploy_partners.sh

# 2. Enable MCP on the fleet (add to deploy_fleet.sh env or redeploy with):
#    CASERELAY_PARTNER_MCP=1
#    CASERELAY_PARTNER_MCP_URL=<output from step 1>

# 3. Verify: call the school_callback tool through the gateway and confirm
#    the poisoned payload triggers Model Armor + quarantine as before.
```

### What this enables for the gateway

With MCP traffic on the wire, all four custom policies from the [Custom policies](#four-concrete-caserelay-policies) section become enforceable:
- Policy 1 (scope isolation) — per-resource IAM binding on the five registry entries
- Policy 2 (verifier read-only) — CEL condition on `mcp.tool.isReadOnly`
- Policy 3 (deny prompts/resources) — DENY AuthzPolicy on MCP methods
- Model Armor — `CONTENT_AUTHZ` extension now has MCP traffic to screen
