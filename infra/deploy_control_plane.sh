#!/usr/bin/env bash
# Build and deploy the CaseRelay control plane to Cloud Run.
# Idempotent and repeatable — run after any code change to ship it.
#
#   bash infra/deploy_control_plane.sh
set -euo pipefail

PROJECT="${CASERELAY_PROJECT:-caserelay}"
REGION="${CASERELAY_REGION:-us-central1}"
IMAGE="us-central1-docker.pkg.dev/${PROJECT}/caserelay/control-plane:latest"
SERVICE="caserelay-control-plane"

# Service account used by the Next.js portal to call the control plane.
# If this SA doesn't exist yet, create it first:
#   gcloud iam service-accounts create caserelay-portal \
#     --project="$PROJECT" --display-name="CaseRelay Portal BFF"
PORTAL_SA="${CASERELAY_PORTAL_SA:-caserelay-portal@${PROJECT}.iam.gserviceaccount.com}"

# Load fleet endpoints so the control plane can reach all deployed engines.
FLEET_ENV="$(dirname "$0")/fleet_endpoints.env"
if [ ! -f "$FLEET_ENV" ]; then
  echo "ERROR: $FLEET_ENV not found — run infra/collect_endpoints.sh first" >&2
  exit 1
fi
source "$FLEET_ENV"

# Memory Bank config — not in fleet_endpoints.env (that file is regenerated).
MEMORY_ENV="$(dirname "$0")/memory_bank.env"
if [ -f "$MEMORY_ENV" ]; then
  source "$MEMORY_ENV"
fi

# Agent Engine hosting the chat agent's Sessions. The control plane refuses to start
# without it, so stop here rather than shipping an image that cannot boot.
SESSIONS_ENV="$(dirname "$0")/chat_sessions.env"
if [ ! -f "$SESSIONS_ENV" ]; then
  echo "ERROR: $SESSIONS_ENV not found — run infra/bootstrap.sh first" >&2
  exit 1
fi
source "$SESSIONS_ENV"
if [ -z "${CASERELAY_CHAT_SESSION_ENGINE_ID:-}" ]; then
  echo "ERROR: CASERELAY_CHAT_SESSION_ENGINE_ID is empty in $SESSIONS_ENV" >&2
  exit 1
fi

echo "=== building linux/amd64 image ==="
docker buildx build --platform linux/amd64 \
  -f backend/Dockerfile \
  -t "$IMAGE" \
  --push .

echo "=== deploying to Cloud Run (authenticated) ==="
gcloud run deploy "$SERVICE" \
  --project="$PROJECT" \
  --region="$REGION" \
  --image="$IMAGE" \
  --platform=managed \
  --no-allow-unauthenticated \
  --set-env-vars="\
CASERELAY_STATE=firestore,\
CASERELAY_PROJECT_ID=${PROJECT},\
GOOGLE_CLOUD_PROJECT=${PROJECT},\
GOOGLE_GENAI_USE_VERTEXAI=true,\
GOOGLE_CLOUD_LOCATION=global,\
CASERELAY_CONTROL_PLANE=1,\
MODEL_ARMOR_TEMPLATE=projects/${PROJECT}/locations/${REGION}/templates/caserelay-screen,\
MODEL_ARMOR_LOCATION=${REGION},\
OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental,\
CASERELAY_URL_EDUCATION=${CASERELAY_URL_EDUCATION},\
CASERELAY_URL_HEALTH=${CASERELAY_URL_HEALTH},\
CASERELAY_URL_LEGAL=${CASERELAY_URL_LEGAL},\
CASERELAY_URL_SHELTER=${CASERELAY_URL_SHELTER},\
CASERELAY_URL_FAMILY=${CASERELAY_URL_FAMILY},\
CASERELAY_URL_VERIFIER=${CASERELAY_URL_VERIFIER},\
CASERELAY_URL_ORCHESTRATOR=${CASERELAY_URL_ORCHESTRATOR},\
CASERELAY_URL_INTAKE=${CASERELAY_URL_INTAKE},\
CASERELAY_IDENTITY_EDUCATION=${CASERELAY_IDENTITY_EDUCATION},\
CASERELAY_IDENTITY_HEALTH=${CASERELAY_IDENTITY_HEALTH},\
CASERELAY_IDENTITY_LEGAL=${CASERELAY_IDENTITY_LEGAL},\
CASERELAY_IDENTITY_SHELTER=${CASERELAY_IDENTITY_SHELTER},\
CASERELAY_IDENTITY_FAMILY=${CASERELAY_IDENTITY_FAMILY},\
CASERELAY_IDENTITY_INTAKE=${CASERELAY_IDENTITY_INTAKE},\
CASERELAY_IDENTITY_ORCHESTRATOR=${CASERELAY_IDENTITY_ORCHESTRATOR},\
CASERELAY_IDENTITY_VERIFIER=${CASERELAY_IDENTITY_VERIFIER},\
CASERELAY_MEMORY_BANK_ID=${CASERELAY_MEMORY_BANK_ID:-},\
CASERELAY_MEMORY_BANK_LOCATION=${REGION},\
CASERELAY_CHAT_SESSION_ENGINE_ID=${CASERELAY_CHAT_SESSION_ENGINE_ID},\
CASERELAY_CHAT_SESSION_LOCATION=${REGION}" \
  --port=8080 \
  --memory=1Gi \
  --cpu=1 \
  --min-instances=1 \
  --max-instances=1 \
  --timeout=900 \
  --no-cpu-throttling \
  --execution-environment=gen2

echo "=== granting run.invoker to portal SA ==="
gcloud run services add-iam-policy-binding "$SERVICE" \
  --project="$PROJECT" \
  --region="$REGION" \
  --member="serviceAccount:${PORTAL_SA}" \
  --role="roles/run.invoker" \
  --quiet

# aiplatform.user is also what lets the chat agent write Agent Platform Sessions: it
# carries aiplatform.sessions.create and aiplatform.sessionEvents.append.
echo "=== granting aiplatform.user to control plane SA ==="
CP_SA="${PROJECT_NUMBER:-189353698936}-compute@developer.gserviceaccount.com"
_grant_with_retry() {
  local member="$1" role="$2"
  local attempt=0 backoff=3 max_retries=5
  while [ $attempt -lt $max_retries ]; do
    attempt=$((attempt + 1))
    output=$(gcloud projects add-iam-policy-binding "$PROJECT" \
      --member="$member" \
      --role="$role" \
      --condition=None \
      --format=json 2>&1) && { echo "  OK: $member <- $role"; return 0; }
    if echo "$output" | grep -q "ABORTED\|concurrent policy"; then
      echo "  409 race, retry in ${backoff}s (${attempt}/${max_retries})"
      sleep $backoff
      backoff=$((backoff * 2))
    else
      echo "  FAIL: $output" | head -3
      return 1
    fi
  done
  echo "  FAIL after $max_retries retries"
  return 1
}
_grant_with_retry "serviceAccount:${CP_SA}" "roles/aiplatform.user"

URL=$(gcloud run services describe "$SERVICE" \
  --project="$PROJECT" --region="$REGION" \
  --format='value(status.url)')

echo "$URL" > infra/control_plane_url.txt
echo "=== deployed: $URL ==="

echo "=== verifying (authenticated health check) ==="
TOKEN=$(gcloud auth print-identity-token --audiences="$URL" 2>/dev/null || true)
if [ -n "$TOKEN" ]; then
  curl -fsS -H "Authorization: Bearer $TOKEN" "$URL/health"
  echo ""
else
  echo "SKIP: could not mint identity token for health check"
fi

echo "=== verifying unauthenticated access is blocked ==="
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$URL/health" || true)
if [ "$HTTP_CODE" = "403" ]; then
  echo "PASS: unauthenticated request returned 403"
else
  echo "WARN: expected 403, got $HTTP_CODE"
fi
