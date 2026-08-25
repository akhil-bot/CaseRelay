#!/usr/bin/env bash
# Bootstrap GCP resources for the CaseRelay control plane.
# Idempotent: safe to re-run. Requires gcloud authenticated with project owner.
#
#   bash infra/bootstrap.sh
set -euo pipefail

PROJECT="${CASERELAY_PROJECT:-caserelay}"
REGION="${CASERELAY_REGION:-us-central1}"

echo "=== enabling APIs ==="
gcloud services enable \
  cloudscheduler.googleapis.com \
  pubsub.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  firestore.googleapis.com \
  artifactregistry.googleapis.com \
  --project="$PROJECT"

echo "=== Pub/Sub topics ==="
gcloud pubsub topics describe caserelay-events --project="$PROJECT" 2>/dev/null \
  || gcloud pubsub topics create caserelay-events --project="$PROJECT"

gcloud pubsub topics describe caserelay-dead-letter --project="$PROJECT" 2>/dev/null \
  || gcloud pubsub topics create caserelay-dead-letter --project="$PROJECT"

echo "=== Pub/Sub subscription with dead-letter policy ==="
gcloud pubsub subscriptions describe caserelay-events-pull --project="$PROJECT" 2>/dev/null \
  || gcloud pubsub subscriptions create caserelay-events-pull \
       --project="$PROJECT" \
       --topic=caserelay-events \
       --dead-letter-topic="projects/${PROJECT}/topics/caserelay-dead-letter" \
       --max-delivery-attempts=5 \
       --ack-deadline=60

echo "=== Pub/Sub push subscription (authenticated → control plane sweep) ==="
PUSH_SA="caserelay-pubsub-push@${PROJECT}.iam.gserviceaccount.com"
gcloud iam service-accounts describe "$PUSH_SA" --project="$PROJECT" 2>/dev/null \
  || gcloud iam service-accounts create caserelay-pubsub-push \
       --project="$PROJECT" \
       --display-name="CaseRelay Pub/Sub Push Invoker"

CP_URL_FILE="$(dirname "$0")/control_plane_url.txt"
if [ -f "$CP_URL_FILE" ]; then
  CP_URL="$(cat "$CP_URL_FILE")"
  gcloud run services add-iam-policy-binding caserelay-control-plane \
    --project="$PROJECT" --region="$REGION" \
    --member="serviceAccount:${PUSH_SA}" \
    --role="roles/run.invoker" --quiet

  gcloud pubsub subscriptions describe caserelay-events-push --project="$PROJECT" 2>/dev/null \
    || gcloud pubsub subscriptions create caserelay-events-push \
         --project="$PROJECT" \
         --topic=caserelay-events \
         --push-endpoint="${CP_URL}/v1/workflows/sweep" \
         --push-auth-service-account="${PUSH_SA}" \
         --push-auth-token-audience="${CP_URL}" \
         --ack-deadline=60 \
         --dead-letter-topic="projects/${PROJECT}/topics/caserelay-dead-letter" \
         --max-delivery-attempts=5 \
         --min-retry-delay=10s \
         --max-retry-delay=300s
else
  echo "SKIP: control_plane_url.txt not found — deploy control plane first, then re-run bootstrap"
fi

echo "=== Cloud Scheduler job ==="
gcloud scheduler jobs describe caserelay-sweep \
  --project="$PROJECT" --location="$REGION" 2>/dev/null \
  || gcloud scheduler jobs create pubsub caserelay-sweep \
       --project="$PROJECT" \
       --location="$REGION" \
       --schedule="*/5 * * * *" \
       --topic=caserelay-events \
       --message-body='{"action":"sweep"}' \
       --description="Triggers the CaseRelay workflow sweep every 5 minutes"

echo "=== Firestore indexes ==="
gcloud firestore indexes composite list --project="$PROJECT" --database=caserelay --format=json 2>/dev/null | grep -q "due_at" \
  || gcloud firestore indexes composite create \
       --project="$PROJECT" \
       --database=caserelay \
       --collection-group=workflow_checkpoints \
       --field-config field-path=state,order=ASCENDING \
       --field-config field-path=due_at,order=ASCENDING \
  || echo "index may already exist or be building"

echo "=== Memory Bank instance ==="
MEMORY_ENV="$(dirname "$0")/memory_bank.env"
MB_API="https://${REGION}-aiplatform.googleapis.com/v1beta1"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
MB_BASE="${MB_API}/projects/${PROJECT_NUMBER}/locations/${REGION}/reasoningEngines"

if [ -f "$MEMORY_ENV" ]; then
  source "$MEMORY_ENV"
fi

if [ -n "${CASERELAY_MEMORY_BANK_ID:-}" ]; then
  # Verify instance exists
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $(gcloud auth print-access-token)" \
    "${MB_BASE}/${CASERELAY_MEMORY_BANK_ID}")
  if [ "$HTTP_CODE" != "200" ]; then
    echo "ERROR: Memory Bank instance ${CASERELAY_MEMORY_BANK_ID} not found (HTTP $HTTP_CODE)"
    echo "       Remove infra/memory_bank.env and re-run to create a new instance."
    exit 1
  fi
  echo "Memory Bank instance exists: ${CASERELAY_MEMORY_BANK_ID}"
else
  echo "Creating Memory Bank instance..."
  RESPONSE=$(curl -s -X POST \
    -H "Authorization: Bearer $(gcloud auth print-access-token)" \
    -H "Content-Type: application/json" \
    -d '{"display_name":"caserelay-memory-bank"}' \
    "${MB_BASE}")
  CASERELAY_MEMORY_BANK_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['name'].split('/')[-1])")
  echo "export CASERELAY_MEMORY_BANK_ID=${CASERELAY_MEMORY_BANK_ID}" > "$MEMORY_ENV"
  echo "Created Memory Bank instance: ${CASERELAY_MEMORY_BANK_ID}"
  echo "Written to infra/memory_bank.env"
fi

echo "=== Memory Bank custom topics ==="
# These descriptions steer the extraction LLM toward operational coordination knowledge
# rather than bland status summaries that duplicate Firestore state.
TOPICS_PAYLOAD=$(cat <<'TOPICS_JSON'
{
  "context_spec": {
    "memory_bank_config": {
      "customization_configs": [
        {
          "memory_topics": [
            {
              "custom_memory_topic": {
                "label": "partner_contacts",
                "description": "Named contacts at partner organizations (schools, clinics, courts, shelters), their communication preferences, and tips for reaching them efficiently (e.g. bypass switchboard, morning appointments)."
              }
            },
            {
              "custom_memory_topic": {
                "label": "institutional_shortcuts",
                "description": "Non-obvious workarounds or time-saving approaches: contacting someone directly rather than through official channels, specific information that speeds processing, ways to avoid known backlogs."
              }
            },
            {
              "custom_memory_topic": {
                "label": "unblocking_strategies",
                "description": "Specific actions that unblocked a stalled process, why they worked, and what to repeat in similar situations."
              }
            }
          ],
          "enable_third_person_memories": true
        }
      ]
    }
  }
}
TOPICS_JSON
)

HTTP_CODE=$(curl -s -o /tmp/mb_patch_response.json -w "%{http_code}" \
  -X PATCH \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d "$TOPICS_PAYLOAD" \
  "${MB_BASE}/${CASERELAY_MEMORY_BANK_ID}?updateMask=context_spec.memory_bank_config.customization_configs")

if [ "$HTTP_CODE" = "200" ]; then
  echo "Custom topics applied (partner_contacts, institutional_shortcuts, unblocking_strategies)"
  echo "Third-person memories enabled"
else
  echo "WARNING: topic configuration failed (HTTP $HTTP_CODE)"
  cat /tmp/mb_patch_response.json
fi

echo "=== Memory Bank IAM ==="
MB_SA="service-${PROJECT_NUMBER}@gcp-sa-aiplatform-re.iam.gserviceaccount.com"
# The control plane service account needs memoryUser to call Memory Bank.
# Grant is idempotent — re-applying the same binding is a no-op.
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${MB_SA}" \
  --role="roles/aiplatform.memoryUser" \
  --condition=None --quiet 2>/dev/null || true

echo "=== bootstrap complete ==="
