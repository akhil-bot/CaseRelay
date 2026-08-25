# Agent Identity IAM — Research Findings

**Project:** `caserelay` (project number `189353698936`, org number `126484209344`)  
**Region:** `us-central1`  
**Researched:** August 2026  
**Sources:** Official Google Cloud documentation only. Where docs are silent, that is explicitly stated.

---

## Q1 — IAM roles required for inference (calling Vertex AI / Gemini models)

### Documented default roles (auto-granted at deploy time)

When you create an Agent Runtime instance with `identity_type=AGENT_IDENTITY`, Google automatically grants:

- `roles/aiplatform.agentContextEditor`
- `roles/aiplatform.agentDefaultAccess`

> "Agent identities come with a default `roles/aiplatform.agentContextEditor` and `roles/aiplatform.agentDefaultAccess` roles so that agents have basic permissions to operate."  
> — [Use Agent Identity with Agent Runtime](https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/runtime/agent-identity)

### Roles you must grant explicitly for inference

The GEAP-specific page lists this as the inference role:

| Role | Purpose |
|------|---------|
| `roles/aiplatform.expressUser` | "Grant access to running inference, sessions, and memory" |
| `roles/serviceusage.serviceUsageConsumer` | "Grant the agent permission to use the project's quota and the Agent Platform SDK" |
| `roles/browser` | "Grant access to basic Google Cloud functionalities" (also required for `resourcemanager.projects.get` during SDK init) |

> Source: [Use Agent Identity with Agent Runtime — Grant access to an agent](https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/runtime/agent-identity)

The IAM-layer auth page additionally lists `roles/aiplatform.user` and `roles/storage.objectViewer` as recommended:

> "Recommended roles for the agent identity: Agent Context Editor, Agent Default Access, **Vertex AI User (`roles/aiplatform.user`)**, Service Usage Consumer, Browser, Storage Object Viewer"  
> — [Authenticate using an agent's own authority](https://docs.cloud.google.com/iam/docs/auth-agent-own-identity)

The Agent Gateway startup troubleshooting page specifically calls out `roles/aiplatform.user` as **required** for the agent to run:

> "`roles/aiplatform.user`: Required to run the agent."  
> — [Troubleshoot Agent Gateway connectivity](https://docs.cloud.google.com/gemini-enterprise-agent-platform/troubleshooting/troubleshoot-agent-gateway)

**Bottom line:** Grant **all four** of these on the project. The auto-granted pair alone is insufficient for inference:

```
roles/aiplatform.expressUser        # inference / model calls
roles/aiplatform.user               # required to run the agent
roles/serviceusage.serviceUsageConsumer  # quota / SDK
roles/browser                       # project get during init
```

`roles/aiplatform.user` alone is documented in multiple places. `roles/aiplatform.expressUser` is the GEAP-specific inference role. Grant both.

> **Verification status:** The role list is sourced from official Google documentation (URLs cited above). We applied these roles via `principalSet://` and inference works. We have NOT independently verified that omitting any specific role causes a failure — the list is taken at face value from the docs.

---

## Q2 — Exact IAM binding syntax for an Agent Identity principal

### Single-agent principal (`principal://`)

```
principal://agents.global.org-ORGANIZATION_ID.system.id.goog/resources/aiplatform/projects/PROJECT_NUMBER/locations/LOCATION/reasoningEngines/ENGINE_ID
```

For caserelay, filling in constants:

```
principal://agents.global.org-126484209344.system.id.goog/resources/aiplatform/projects/189353698936/locations/us-central1/reasoningEngines/<ENGINE_ID>
```

> Source: [Agent Identity overview — Principal identifiers](https://docs.cloud.google.com/iam/docs/agent-identity-overview) and [Principal identifiers reference](https://cloud.google.com/iam/docs/principal-identifiers)

### All agents in the project (`principalSet://`)

```
principalSet://agents.global.org-ORGANIZATION_ID.system.id.goog/attribute.platformContainer/aiplatform/projects/PROJECT_NUMBER
```

For caserelay:

```
principalSet://agents.global.org-126484209344.system.id.goog/attribute.platformContainer/aiplatform/projects/189353698936
```

### All agents across the entire organization

```
principalSet://agents.global.org-ORGANIZATION_ID.system.id.goog/*
```

> Source: [Authenticate using an agent's own authority](https://docs.cloud.google.com/iam/docs/auth-agent-own-identity)

### Is `principal://` or `principalSet://` correct for this scenario?

Agent Identity uses the **`principal://`** form (not `principal://iam.googleapis.com/...` which is Workload Identity Federation), and `principalSet://` for multi-agent grants. This is **different** from WIF's `principal://iam.googleapis.com/...` form.

> "When an agent identity is used in an IAM allow policy, the principal identifier follows this format: `principal://TRUST_DOMAIN/resources/SERVICE/RESOURCE_PATH`"  
> — [Agent Identity overview](https://docs.cloud.google.com/iam/docs/agent-identity-overview)

### ⚠ Silent no-op warning — `principalSet://` bindings

The official troubleshooting guide documents that `principalSet://` bindings can silently fail to apply:

> "If permissions work inconsistently or fail unexpectedly, the issue might relate to how your agent's group identity (the principal set) is configured. Principal set-based permissions might fail for the following reasons:
> - **Sync delays**: When you add an identity to a set, it can take a few minutes for IAM to update and recognize the new member.
> - **Missing attributes**: If membership in a principal set requires certain attributes, the agent's identity must carry those exact attributes. If the identity is missing these attributes, the agent might be **silently excluded** from the group."
>
> "To test if group membership is the issue, grant permissions directly to the specific agent by adding a direct `principal://` binding on the affected resource. If the agent successfully connects with the direct binding, then the root cause is likely an attribute mismatch or sync delay with the principal set."  
> — [Troubleshoot Agent Gateway connectivity](https://docs.cloud.google.com/gemini-enterprise-agent-platform/troubleshooting/troubleshoot-agent-gateway)

**Practical implication:** If you ran `gcloud projects add-iam-policy-binding` with `principalSet://` and it returned successfully, it may still not have taken effect for all 8 engines due to attribute sync delays. Use per-engine `principal://` bindings to validate, then fall back to `principalSet://` for ongoing management.

> **Verification status:** The silent-exclusion hazard is sourced from the official Agent Gateway troubleshooting guide (quoted above). We have not reproduced the failure ourselves — our `principalSet://` bindings appear to be working. Marked as a documented risk, not a confirmed bug in our deployment.

---

## Q3 — Exact gcloud command for granting roles

### Grant to a single agent (per-engine)

```bash
gcloud projects add-iam-policy-binding caserelay \
  --member="principal://agents.global.org-126484209344.system.id.goog/resources/aiplatform/projects/189353698936/locations/us-central1/reasoningEngines/<ENGINE_ID>" \
  --role="roles/aiplatform.expressUser"
```

### Grant to all agents in the project at once (recommended for caserelay)

```bash
PROJECT_ID="caserelay"
MEMBER="principalSet://agents.global.org-126484209344.system.id.goog/attribute.platformContainer/aiplatform/projects/189353698936"

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="${MEMBER}" --role=roles/aiplatform.expressUser

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="${MEMBER}" --role=roles/aiplatform.user

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="${MEMBER}" --role=roles/serviceusage.serviceUsageConsumer

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="${MEMBER}" --role=roles/browser

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="${MEMBER}" --role=roles/logging.logWriter

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="${MEMBER}" --role=roles/monitoring.metricWriter
```

The example in the official GEAP doc uses this exact set:

> "For example, the following commands grant basic roles to all agents in a project"  
> — [Use Agent Identity with Agent Runtime](https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/runtime/agent-identity)

The generic form is `gcloud SERVICE add-iam-policy-binding RESOURCE_NAME --member="PRINCIPAL_IDENTIFIER" --role="ROLE"`, where `SERVICE` is `projects` when granting at project level.

> Source: [Authenticate using an agent's own authority](https://docs.cloud.google.com/iam/docs/auth-agent-own-identity)

---

## Q4 — Required one-time bootstrap / enablement steps

**Yes — documented required prerequisite steps exist**, and missing them is a plausible root cause.

### APIs that must be enabled

The official "Create and deploy an agent with Agent CLI and Agent Identity" guide lists:

> "Enable the **Agent Identity API**, **Agent Platform API**, **Agent Registry API**, and **App Hub API** APIs."  
> — [Create and deploy an agent with Agent CLI and Agent Identity](https://docs.cloud.google.com/iam/docs/create-and-deploy-agent)

### Trust domain provisioning

The trust domain (`agents.global.org-126484209344.system.id.goog`) is auto-provisioned, but **only when the Agent Platform API is enabled**:

> "TRUST_DOMAIN: A trust domain is provisioned for you **when you enable the Agent Platform API**:
> - If you have an organization, the trust domain is created at the organization level with the format `agents.global.org-ORGANIZATION_ID.system.id.goog`."  
> — [Use Agent Identity with Agent Runtime](https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/runtime/agent-identity)

**Implication:** If any of these APIs were enabled only recently (after some of the 8 engines were already deployed), those earlier engines may have been deployed without a valid trust domain or without the full principal being recognized by IAM. Re-deploying or updating those engines after API enablement would be necessary.

> **Verification status:** The four-API requirement is sourced from the official "Create and deploy an agent" guide (quoted above). All four APIs are enabled on the `caserelay` project. We have not tested what happens if one is disabled — the list is taken at face value from the docs.

---

## Q5 — Documented 401 failure mode: exact match to your error message

**Yes — Google explicitly documents this exact error message and attributes it to the Context-Aware Access (CAA) policy.**

### From the IAM troubleshooting guide

> "If your agent can't authenticate, the following error might occur. This error is typically caused by a **Google-managed Context-Aware Access policy that enforces mTLS binding and DPoP cryptographic proofs**:
>
> ```json
> {
>   "error": {
>     "code": 401,
>     "message": "Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential.",
>     "status": "UNAUTHENTICATED"
>   }
> }
> ```"  
> — [Troubleshoot Agent Identity authentication issues](https://docs.cloud.google.com/iam/docs/troubleshoot-auth-manager)

### From the GEAP runtime troubleshooting guide

> "By default, when you use Agent Identity with Agent Runtime, **certificate bound access tokens** are used for authentication to prevent token theft. A 401 error can occur at runtime in one of the **following two scenarios**:
> 1. User or Agent attempting to use an access token **outside of the context in which it was issued**, such as passing the token between agents.
> 2. Agent calling a **non-mTLS compatible API endpoint**, such as `telemetry.googleapis.com` instead of `telemetry.mtls.googleapis.com`."  
> — [Troubleshoot environment setup for Agent Runtime](https://docs.cloud.google.com/gemini-enterprise-agent-platform/troubleshooting/runtime-setup)

### Documented fix

> "Opt out of the default CAA policy by setting the following environment variable when you create your Agent Runtime instance:
> ```python
> config={
>   "env_vars": {
>     "GOOGLE_API_PREVENT_AGENT_TOKEN_SHARING_FOR_GCP_SERVICES": False,
>   }
> }
> ```"  
> — Both [Troubleshoot Agent Identity authentication issues](https://docs.cloud.google.com/iam/docs/troubleshoot-auth-manager) and [Use Agent Identity with Agent Runtime](https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/runtime/agent-identity)

### Interpretation for caserelay

The docs describe two triggers. Scenario 2 (non-mTLS endpoint) is most likely for agents calling Gemini models, because the ADK or Vertex AI SDK may be routing calls through non-mTLS endpoints (e.g., `us-central1-aiplatform.googleapis.com` instead of `us-central1-aiplatform.mtls.googleapis.com`). The CAA policy then rejects the DPoP-bound token used outside its mTLS context.

### What we actually did (verified Aug 25)

We chose to **keep CAA enforcement ON** and route traffic to the mTLS endpoint instead:

```
GOOGLE_API_USE_CLIENT_CERTIFICATE=true
```

This is set on all eight engines in `infra/deploy_fleet.sh`. It tells the SDK to use `*.mtls.googleapis.com` endpoints, which satisfies the DPoP + mTLS binding requirement without weakening the security model.

We deliberately did **NOT** set `GOOGLE_API_PREVENT_AGENT_TOKEN_SHARING_FOR_GCP_SERVICES=False` (Google's documented opt-out) because it disables token binding entirely — meaning agent tokens could be replayed or shared across contexts without cryptographic proof of possession. Keeping mTLS binding active is a genuine security strength.

See also: [Troubleshoot Agent Identity authentication issues](https://docs.google.com/iam/docs/troubleshoot-auth-manager) and [Authenticate using an agent's own identity](https://docs.google.com/iam/docs/auth-agent-own-identity).

---

## Q6 — IAM propagation delay

**Explicitly documented.**

### Direct policy changes (your scenario when running `gcloud ... add-iam-policy-binding`)

> "In general, policy changes take effect within **2 minutes**. However, in some cases, it can take **7 minutes or more** for changes to propagate across the system."  
> — [Manage access to projects, folders, and organizations](https://docs.cloud.google.com/iam/docs/granting-changing-revoking-access)

### The IAM propagation table (from the authoritative propagation doc)

| Change type | Propagation time |
|-------------|-----------------|
| Edit an allow or deny policy | Typically 2 minutes, potentially 7 minutes or longer |
| Change a group's membership | Typically several minutes, potentially hours or longer |
| Change a nested group's membership | Typically several minutes, potentially hours or longer |

> Source: [Access change propagation](https://docs.cloud.google.com/iam/docs/access-change-propagation)

### For `principalSet://` specifically

The Agent Gateway troubleshooting guide adds a specific note for principal-set membership syncing:

> "**Sync delays**: When you add an identity to a set, it can take **a few minutes** for IAM to update and recognize the new member."  
> — [Troubleshoot Agent Gateway connectivity](https://docs.cloud.google.com/gemini-enterprise-agent-platform/troubleshooting/troubleshoot-agent-gateway)

**Relevance to intermittent 401s:** If grants were applied recently or if different engines were granted at different times, some engines may not yet have the grant in effect from IAM's perspective in all serving regions. But note: **7 minutes is the max documented delay for direct policy bindings**. If the 401s are happening days after grants were applied, IAM propagation is not the cause — the CAA mTLS binding issue (Q5) is more likely.

> **Verification status:** The 2–7 minute propagation window is sourced from the official IAM docs (quoted above). We observed our grants taking effect within minutes, consistent with the documented window. The exact SLA timing has not been independently benchmarked.

---

## Q7 — `GOOGLE_CLOUD_LOCATION=global` vs regional auth differences

### What the docs say

The trust domain is **always** `agents.global.*` regardless of where the agent is deployed. The `global` in the trust domain string is part of the format, not a reference to the `global` deployment region.

> "If you have an organization, the trust domain is created at the organization level with the format `agents.global.org-ORGANIZATION_ID.system.id.goog`."  
> — [Use Agent Identity with Agent Runtime](https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/runtime/agent-identity)

The LOCATION embedded in the `principal://` identifier reflects the **agent's deployment region**, not the model's region:

```
principal://agents.global.org-123456789012.system.id.goog/resources/aiplatform/projects/9876543210/locations/us-central1/reasoningEngines/my-test-agent
```

### `global` as a model location

Setting `GOOGLE_CLOUD_LOCATION=global` is documented only as a workaround for accessing models that are **exclusively available in the global region** (i.e., not available in regional endpoints). The official doc shows a special `GlobalGemini` client subclass that explicitly sets `location="global"`:

> "To use a model that's only available in the `global` region, you must modify `agent.py` so that your agent can access it."  
> — [Create and deploy an agent with Agent CLI and Agent Identity](https://docs.cloud.google.com/iam/docs/create-and-deploy-agent)

### ⚠ Docs are silent on

The docs do **not** document any authentication-layer difference between deploying with `location=global` vs a named region. There is no documented claim that `GOOGLE_CLOUD_LOCATION=global` causes a different principal format, different token audience, or different CAA behavior. The potential issue is at the mTLS endpoint hostname level: a `global` region model call may route through `aiplatform.googleapis.com` (non-mTLS) instead of `us-central1-aiplatform.mtls.googleapis.com` — but this is inference from documented behavior, not a direct quote from the docs.

---

## Gaps — What the docs do NOT cover

The following questions have no documented answer in the official Google Cloud docs as of August 2026:

1. **Exact token audience for Agent Identity tokens when calling Gemini models.** The docs describe DPoP binding and mTLS but do not specify the `aud` claim required.

2. **Whether `GOOGLE_CLOUD_LOCATION=global` changes the token audience or the mTLS endpoint hostname** used by the Vertex AI SDK internally when Agent Identity is active.

3. **Which specific ADK version or `google-cloud-aiplatform` version** introduced the mTLS-compatible endpoint routing for `reasoningEngines`. The troubleshooting guide says "underlying issue could be a known issue with ADK" for scenario 2 but links to no bug tracker entry.

4. **The exact propagation timing for principal set membership sync when using `principalSet://agents.global.org-...`**. The docs say "a few minutes" — no SLA is stated.

5. **Whether all 8 engines need individual IAM grants if the `principalSet://` grant was applied correctly.** The docs imply `principalSet://` covers all existing and future engines in the project, but do not explicitly confirm whether the attribute `platformContainer` is set automatically for all `identity_type=AGENT_IDENTITY` engines vs only those created after some enablement step.

6. **Per-engine vs. per-project trust domain scope.** The docs only mention org-level or project-level trust domains. There is no documented option for engine-level trust domains.

---

## Copy-pasteable fix commands for caserelay

### Option A — Grant to all 8 engines at once via `principalSet://` (preferred, but see sync delay caveat)

```bash
PROJECT_ID="caserelay"
MEMBER="principalSet://agents.global.org-126484209344.system.id.goog/attribute.platformContainer/aiplatform/projects/189353698936"

for ROLE in \
  roles/aiplatform.expressUser \
  roles/aiplatform.user \
  roles/serviceusage.serviceUsageConsumer \
  roles/browser \
  roles/logging.logWriter \
  roles/monitoring.metricWriter; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="${MEMBER}" \
    --role="${ROLE}"
done
```

### Option B — Grant directly to a specific engine (use to validate, or as the definitive fix for intermittent failures)

```bash
ENGINE_ID="<your-reasoning-engine-id>"
PRINCIPAL="principal://agents.global.org-126484209344.system.id.goog/resources/aiplatform/projects/189353698936/locations/us-central1/reasoningEngines/${ENGINE_ID}"

for ROLE in \
  roles/aiplatform.expressUser \
  roles/aiplatform.user \
  roles/serviceusage.serviceUsageConsumer \
  roles/browser; do
  gcloud projects add-iam-policy-binding caserelay \
    --member="${PRINCIPAL}" \
    --role="${ROLE}"
done
```

### Option C — Disable CAA enforcement (**NOT USED — rejected**)

Google documents this as the official fix for the mTLS 401 scenario:

```python
config={
  "env_vars": {
    "GOOGLE_API_PREVENT_AGENT_TOKEN_SHARING_FOR_GCP_SERVICES": False,
  }
}
```

**We deliberately rejected this option** because it disables DPoP token binding, which means agent tokens can be replayed or shared across contexts without cryptographic proof of possession. Instead, we set `GOOGLE_API_USE_CLIENT_CERTIFICATE=true` to route all calls to the mTLS endpoint, satisfying the binding requirement while keeping CAA enforcement active. This is a stronger security posture.

---

## Source index

| Doc | URL |
|-----|-----|
| Use Agent Identity with Agent Runtime (GEAP) | https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/runtime/agent-identity |
| Authenticate using an agent's own authority (IAM) | https://docs.cloud.google.com/iam/docs/auth-agent-own-identity |
| Agent Identity overview (IAM) | https://docs.cloud.google.com/iam/docs/agent-identity-overview |
| Principal identifiers reference | https://cloud.google.com/iam/docs/principal-identifiers |
| Create and deploy an agent with Agent CLI and Agent Identity | https://docs.cloud.google.com/iam/docs/create-and-deploy-agent |
| Troubleshoot Agent Identity authentication issues | https://docs.cloud.google.com/iam/docs/troubleshoot-auth-manager |
| Troubleshoot environment setup for Agent Runtime | https://docs.cloud.google.com/gemini-enterprise-agent-platform/troubleshooting/runtime-setup |
| Troubleshoot Agent Gateway connectivity | https://docs.cloud.google.com/gemini-enterprise-agent-platform/troubleshooting/troubleshoot-agent-gateway |
| Access change propagation | https://docs.cloud.google.com/iam/docs/access-change-propagation |
| Manage access to projects, folders, and organizations | https://docs.cloud.google.com/iam/docs/granting-changing-revoking-access |
