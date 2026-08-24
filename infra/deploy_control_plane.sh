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

echo "=== building linux/amd64 image ==="
docker buildx build --platform linux/amd64 \
  -f backend/Dockerfile \
  -t "$IMAGE" \
  --push .

echo "=== deploying to Cloud Run ==="
gcloud run deploy "$SERVICE" \
  --project="$PROJECT" \
  --region="$REGION" \
  --image="$IMAGE" \
  --platform=managed \
  --allow-unauthenticated \
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

URL=$(gcloud run services describe "$SERVICE" \
  --project="$PROJECT" --region="$REGION" \
  --format='value(status.url)')

echo "$URL" > infra/control_plane_url.txt
echo "=== deployed: $URL ==="
curl -fsS "$URL/health"
echo ""
