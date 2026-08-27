#!/usr/bin/env bash
# Deploy the CaseRelay partner MCP server to Cloud Run and register in Agent Registry.
#
# This deploys ONE Cloud Run service (`caserelay-partners`) that exposes all five
# partner simulators as MCP tools. It then registers five Agent Registry Services
# (one per partner) pointing at path-prefixed URLs on the same host, enabling
# per-resource IAP authorization without per-partner deployables.
#
# Usage:
#   bash infra/deploy_partners.sh              # build + deploy + register
#   bash infra/deploy_partners.sh --skip-build # deploy pre-built image
#   bash infra/deploy_partners.sh --register-only  # just update registry
set -euo pipefail

PROJECT="${CASERELAY_PROJECT:-caserelay}"
REGION="${CASERELAY_REGION:-us-central1}"
SERVICE_NAME="caserelay-partners"
IMAGE="us-central1-docker.pkg.dev/${PROJECT}/caserelay/${SERVICE_NAME}:latest"

SKIP_BUILD=0
REGISTER_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --register-only) REGISTER_ONLY=1 ;;
  esac
done

echo "=== CaseRelay Partner MCP Server Deploy ==="
echo "    project=${PROJECT} region=${REGION}"
echo "    service=${SERVICE_NAME}"
echo "    image=${IMAGE}"
echo ""

# --- Build ---
if [ "$REGISTER_ONLY" -eq 0 ] && [ "$SKIP_BUILD" -eq 0 ]; then
  echo "  Building image..."
  docker build -f Dockerfile.partners -t "${IMAGE}" .
  echo "  Pushing to Artifact Registry..."
  docker push "${IMAGE}"
fi

# --- Deploy to Cloud Run ---
if [ "$REGISTER_ONLY" -eq 0 ]; then
  echo "  Deploying to Cloud Run..."
  gcloud run deploy "${SERVICE_NAME}" \
    --project="${PROJECT}" \
    --region="${REGION}" \
    --image="${IMAGE}" \
    --platform=managed \
    --allow-unauthenticated=false \
    --set-env-vars="CASERELAY_STATE=firestore,CASERELAY_PROJECT_ID=${PROJECT},GOOGLE_CLOUD_PROJECT=${PROJECT}" \
    --cpu=1 --memory=512Mi \
    --min-instances=1 --max-instances=4 \
    --port=8090 \
    --quiet

  PARTNER_URL=$(gcloud run services describe "${SERVICE_NAME}" \
    --project="${PROJECT}" --region="${REGION}" \
    --format="value(status.url)")
  echo "  Deployed: ${PARTNER_URL}"
else
  PARTNER_URL=$(gcloud run services describe "${SERVICE_NAME}" \
    --project="${PROJECT}" --region="${REGION}" \
    --format="value(status.url)" 2>/dev/null || echo "")
  if [ -z "$PARTNER_URL" ]; then
    echo "FATAL: service not deployed yet, cannot register" >&2
    exit 1
  fi
fi

echo ""
echo "=== Registering Partner Services in Agent Registry ==="

# Five logical partners, one backing Cloud Run service.
# Each gets its own registry entry for independent IAP authorization.
PARTNERS=(
  "school|CaseRelay School Partner (Lincoln Unified SIS)"
  "clinic|CaseRelay Clinic Partner (Riverbend Community Health)"
  "legal|CaseRelay Legal Partner (Statewide Legal Aid)"
  "shelter|CaseRelay Shelter Partner (Harborlight Youth Shelter)"
  "family|CaseRelay Family Services Partner (Mesa County)"
)

for entry in "${PARTNERS[@]}"; do
  IFS='|' read -r key display <<<"$entry"
  svc_name="caserelay-partner-${key}"
  mcp_url="${PARTNER_URL}/mcp"

  echo "  Registering: ${svc_name} -> ${mcp_url}"
  gcloud agent-registry services create "${svc_name}" \
    --project="${PROJECT}" --location="${REGION}" \
    --display-name="${display}" \
    --mcp-server-spec-type=tool-spec \
    --interfaces=url="${mcp_url}",protocolBinding=jsonrpc \
    --format="value(name)" 2>/dev/null || \
  gcloud agent-registry services update "${svc_name}" \
    --project="${PROJECT}" --location="${REGION}" \
    --interfaces=url="${mcp_url}",protocolBinding=jsonrpc \
    --format="value(name)" 2>/dev/null || \
  echo "    WARNING: registry update failed for ${svc_name} (may need manual fix)"
done

echo ""
echo "=== IAP Grants (per-resource, per-agent) ==="
echo "  Run these after deploy to enable per-agent partner isolation."
echo "  (Requires IAP dry-run to be active on the gateway first.)"
echo ""
echo "  # Education -> school only"
echo "  # Health    -> clinic only"
echo "  # Legal     -> legal only"
echo "  # Shelter   -> shelter only"
echo "  # Family    -> family only"
echo "  # Verifier  -> school only (read-only CEL condition)"
echo ""
echo "  See docs/agent-gateway-adoption-plan.md Phase 2 for grant commands."

echo ""
echo "=== Done ==="
echo "  CASERELAY_PARTNER_MCP_URL=${PARTNER_URL}"
echo ""
echo "  To enable MCP on the fleet, add to deploy_fleet.sh env vars:"
echo "    CASERELAY_PARTNER_MCP=1"
echo "    CASERELAY_PARTNER_MCP_URL=${PARTNER_URL}"
