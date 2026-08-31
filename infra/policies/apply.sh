#!/usr/bin/env bash
#
# Applies the CaseRelay gateway policy artifacts in this directory.
#
# NOTHING RUNS WITHOUT AN EXPLICIT OPT-IN. Default is a dry run that prints the exact
# commands. Pass --apply to execute. Each step is independently selectable so you can
# apply the safe ones and hold the risky ones.
#
#   bash infra/policies/apply.sh                       # print everything, change nothing
#   bash infra/policies/apply.sh --apply iam           # registry-wide + partner MCP IAM
#   bash infra/policies/apply.sh --apply deny          # slot 3: DENY prompts/ + resources/
#   bash infra/policies/apply.sh --apply armor         # flip Model Armor ext to fail-closed
#   bash infra/policies/apply.sh --apply allow         # slot 4: tool allowlist (SEE WARNING)
#
# POLICY SLOT BUDGET — hard ceiling is 4 authzPolicies per egress gateway.
#   slot 1  caserelay-iap-authz-policy   REQUEST_AUTHZ  CUSTOM -> IAP        [LIVE]
#   slot 2  caserelay-ma-authz-policy    CONTENT_AUTHZ  CUSTOM -> ModelArmor [LIVE]
#   slot 3  caserelay-deny-mcp-prompts-resources        DENY                 [this script]
#   slot 4  caserelay-allow-partner-tool-surface        ALLOW                [RESERVE]
# Per-agent isolation is expressed in IAM conditions, which consume no slots. That is the
# whole reason the budget fits.

set -euo pipefail

PROJECT=caserelay
REGION=us-central1
GATEWAY=caserelay-egress
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

MODE=print
STEP=all
while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) MODE=apply; shift ;;
    iam|deny|allow|armor|sa-grants) STEP="$1"; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

# --apply with no step named would also apply the reserve slot-4 policy, whose interaction
# with the live IAP policy is undefined. Force the caller to name what they mean.
if [[ "$MODE" == apply && "$STEP" == all ]]; then
  echo "refusing: --apply requires an explicit step (iam | deny | armor | sa-grants | allow)" >&2
  exit 2
fi

run() {
  if [[ "$MODE" == apply ]]; then
    echo "+ $*"
    "$@"
  else
    echo "  $*"
  fi
}

want() { [[ "$STEP" == all || "$STEP" == "$1" ]]; }

# --------------------------------------------------------------------------------------
# Preconditions worth reading before you run anything
# --------------------------------------------------------------------------------------
# 1. All eight engines are bound to caserelay-egress. These policies govern live traffic.
# 2. The partner MCP server is not registered in Agent Registry yet (mcp-servers list was
#    empty as of 2026-08-28), so the partner IAM step will no-op until
#    infra/deploy_partners.sh has run.
# 3. caserelay-iap-authz-ext is in DRY_RUN. IAM grants are audited, not enforced. Leave it
#    that way through the demo.
# 4. `followup` is called from backend/workflows/escalation.py, which runs on the Cloud Run
#    control plane, NOT from a Reasoning Engine. Those MCP calls never traverse the gateway
#    and no IAM grant here affects them. Do not claim gateway coverage of the follow-up path.

echo "=== resolving partner MCP server registry IDs ==="
# infra/deploy_partners.sh registers five Services (school, clinic, legal, shelter, family)
# all pointing at the SAME /mcp URL. The registry generates a read-only McpServer per Service,
# so expect up to five IDs for one physical server, and the gateway may or may not be able to
# tell them apart when authorizing (see the adoption plan's unverified list).
#
# The same policy file is applied to every resolved ID. That is deliberate: the per-agent CEL
# conditions are semantically identical whichever resource the gateway resolves a call to, so
# applying to all of them makes the outcome independent of duplicate-URL behaviour.
# Built with a read loop rather than mapfile so this runs on macOS's bash 3.2.
MCP_SERVER_IDS=()
# Captured rather than piped straight into the loop so a failed list is distinguishable
# from an empty one. Both used to render as "none registered", which would silently skip
# the per-agent IAM step and leave you believing isolation had been applied.
if ! MCP_LIST=$(gcloud agent-registry mcp-servers list \
  --project="$PROJECT" --location="$REGION" \
  --format="value(name.basename())" 2>&1); then
  echo "refusing: could not list MCP servers" >&2
  echo "  $MCP_LIST" >&2
  exit 1
fi
while IFS= read -r _id; do
  [[ -n "$_id" ]] && MCP_SERVER_IDS+=("$_id")
done <<<"$MCP_LIST"
if [[ ${#MCP_SERVER_IDS[@]} -eq 0 ]]; then
  echo "  (none registered — the partner IAM step will be skipped)"
else
  printf '  %s\n' "${MCP_SERVER_IDS[@]}"
fi

# --------------------------------------------------------------------------------------
if want iam; then
  echo
  echo "=== IAM: registry-wide egress for all eight engines ==="
  # No condition: these are the Google-first-party endpoints every engine needs to boot.
  # The live registry-wide policy is currently empty, so this is purely additive.
  run gcloud iap web set-iam-policy "$DIR/iam-registry-wide-egress.json" \
    --resource-type=agent-registry --region="$REGION" --project="$PROJECT"

  if [[ ${#MCP_SERVER_IDS[@]} -gt 0 ]]; then
    echo
    echo "=== IAM: per-agent tool scoping on the partner MCP server(s) ==="
    # set-iam-policy REPLACES the whole policy for this resource, and a per-resource binding
    # replaces the registry-wide binding rather than merging with it. So this one file must
    # enumerate every principal allowed to reach the partner server. The orchestrator and
    # intake engines are deliberately absent: they hold no partner tools and should be
    # structurally unable to reach one.
    for ID in "${MCP_SERVER_IDS[@]}"; do
      run gcloud iap web set-iam-policy "$DIR/iam-partner-mcp-server.json" \
        --resource-type=agent-registry --mcp-server="$ID" \
        --region="$REGION" --project="$PROJECT"
    done
  fi
fi

# --------------------------------------------------------------------------------------
if want deny; then
  echo
  echo "=== slot 3: DENY MCP prompts/ and resources/ ==="
  run gcloud network-security authz-policies import caserelay-deny-mcp-prompts-resources \
    --source="$DIR/authzpolicy-mcp-deny-prompts-resources.yaml" \
    --location="$REGION" --project="$PROJECT"
  # ROLLBACK:
  #   gcloud network-security authz-policies delete caserelay-deny-mcp-prompts-resources \
  #     --location=us-central1 --project=caserelay
fi

# --------------------------------------------------------------------------------------
if want armor; then
  echo
  echo "=== Model Armor extension: failOpen true -> false ==="
  # The live caserelay-ma-authz-ext carries failOpen: true, so a Model Armor timeout
  # currently lets traffic through unscreened — laxer than backend/gateway/armor.py, which
  # quarantines. This import replaces the extension in place; the CONTENT_AUTHZ policy
  # pointing at it does not change and no policy slot is consumed.
  run gcloud beta service-extensions authz-extensions import caserelay-ma-authz-ext \
    --source="$DIR/authzext-model-armor-failclosed.yaml" \
    --location="$REGION" --project="$PROJECT"
  # ROLLBACK: re-import the same file with failOpen: true.
fi

# --------------------------------------------------------------------------------------
if want sa-grants; then
  echo
  echo "=== Model Armor roles for the gateway's Service Extensions service account ==="
  # The gateway itself declares which SA it calls Model Armor as. Read it rather than
  # deriving it: the documented formula service-<GATEWAY_PROJECT_NUMBER>@gcp-sa-dep... would
  # give service-189353698936@..., but caserelay-egress reports a different account. Trust
  # the resource.
  SA="$(gcloud network-services agent-gateways describe "$GATEWAY" \
    --location="$REGION" --project="$PROJECT" \
    --format="value(agentGatewayCard.serviceExtensionsServiceAccount)")"
  echo "  gateway-declared SA: $SA"
  for ROLE in roles/modelarmor.calloutUser roles/serviceusage.serviceUsageConsumer roles/modelarmor.user; do
    run gcloud projects add-iam-policy-binding "$PROJECT" \
      --member="serviceAccount:$SA" --role="$ROLE" --condition=None --quiet
  done
fi

# --------------------------------------------------------------------------------------
if want allow; then
  echo
  echo "=== slot 4: ALLOW partner tool surface — UNVERIFIED INTERACTION ==="
  echo "  WARNING: caserelay-iap-authz-policy already holds REQUEST_AUTHZ with action CUSTOM."
  echo "  Google documents that execution order between policies sharing a profile is not"
  echo "  guaranteed, and does not define how ALLOW composes with CUSTOM. Apply this only with"
  echo "  time to run a full case end to end, and keep the delete command ready."
  run gcloud network-security authz-policies import caserelay-allow-partner-tool-surface \
    --source="$DIR/authzpolicy-mcp-allow-tool-surface.yaml" \
    --location="$REGION" --project="$PROJECT"
  # ROLLBACK:
  #   gcloud network-security authz-policies delete caserelay-allow-partner-tool-surface \
  #     --location=us-central1 --project=caserelay
fi

echo
echo "=== verify ==="
echo "  gcloud network-security authz-policies list --location=$REGION --project=$PROJECT"
echo "  gcloud iap web get-iam-policy --resource-type=agent-registry --region=$REGION --project=$PROJECT"
echo "  gcloud logging read 'resource.type=\"networkservices.googleapis.com/Gateway\" resource.labels.gateway_name=\"$GATEWAY\"' --project=$PROJECT --limit=40 --freshness=15m"
