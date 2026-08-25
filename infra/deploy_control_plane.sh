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
MODEL_ARMOR_TEMPLATE=projects/${PROJECT}/locations/${REGION}/templates/caserelay-screen,\
MODEL_ARMOR_LOCATION=${REGION}" \
  --port=8080 \
  --memory=1Gi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=2 \
  --timeout=300

echo "=== granting run.invoker to portal SA ==="
gcloud run services add-iam-policy-binding "$SERVICE" \
  --project="$PROJECT" \
  --region="$REGION" \
  --member="serviceAccount:${PORTAL_SA}" \
  --role="roles/run.invoker" \
  --quiet

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
