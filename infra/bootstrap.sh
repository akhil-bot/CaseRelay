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
         --push-endpoint="${CP_URL}/v1/pubsub/push" \
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
       --schedule="* * * * *" \
       --topic=caserelay-events \
       --message-body='{"action":"sweep"}' \
       --description="Triggers the CaseRelay workflow sweep every minute"

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
# Grant is idempotent — re-applying the same binding is a no-op. Idempotent means a repeat
# succeeds, though, not that a failure is harmless: without this role Memory Bank calls
# 403 at runtime, so report what went wrong rather than discarding it.
if ! MB_GRANT=$(gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${MB_SA}" \
  --role="roles/aiplatform.memoryUser" \
  --condition=None --quiet 2>&1); then
  echo "WARNING: could not grant memoryUser to ${MB_SA} — Memory Bank calls will 403" >&2
  echo "  $MB_GRANT" >&2
fi

echo "=== chat Sessions engine ==="
# Agent Platform Sessions are hosted by an Agent Engine. The chat agent gets its own
# rather than sharing the Memory Bank engine: the two hold different things, and a
# retention or deletion decision about one should not reach the other.
SESSIONS_ENV="$(dirname "$0")/chat_sessions.env"

if [ -f "$SESSIONS_ENV" ]; then
  source "$SESSIONS_ENV"
fi

if [ -n "${CASERELAY_CHAT_SESSION_ENGINE_ID:-}" ]; then
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $(gcloud auth print-access-token)" \
    "${MB_BASE}/${CASERELAY_CHAT_SESSION_ENGINE_ID}")
  if [ "$HTTP_CODE" != "200" ]; then
    echo "ERROR: chat Sessions engine ${CASERELAY_CHAT_SESSION_ENGINE_ID} not found (HTTP $HTTP_CODE)"
    echo "       Remove infra/chat_sessions.env and re-run to create a new engine."
    exit 1
  fi
  echo "Chat Sessions engine exists: ${CASERELAY_CHAT_SESSION_ENGINE_ID}"
else
  echo "Creating chat Sessions engine..."
  RESPONSE=$(curl -s -X POST \
    -H "Authorization: Bearer $(gcloud auth print-access-token)" \
    -H "Content-Type: application/json" \
    -d '{"display_name":"caserelay-chat-sessions","description":"Hosts Agent Platform Sessions for the CaseRelay operator chat agent (AG-UI)."}' \
    "${MB_BASE}")
  CASERELAY_CHAT_SESSION_ENGINE_ID=$(echo "$RESPONSE" | python3 -c "import sys,json,re; print(re.search(r'reasoningEngines/(\d+)', json.load(sys.stdin)['name']).group(1))")
  {
    echo "# Agent Engine that hosts Agent Platform Sessions for the operator chat agent."
    echo "# Provisioned once by bootstrap.sh, not regenerated by collect_endpoints.sh."
    echo "# Sourced by deploy_control_plane.sh alongside fleet_endpoints.env."
    echo "export CASERELAY_CHAT_SESSION_ENGINE_ID=${CASERELAY_CHAT_SESSION_ENGINE_ID}"
  } > "$SESSIONS_ENV"
  echo "Created chat Sessions engine: ${CASERELAY_CHAT_SESSION_ENGINE_ID}"
  echo "Written to infra/chat_sessions.env"
fi

echo "=== run Sessions engine ==="
# The agent fleet's per-invocation sessions get an engine of their own, separate from both
# the Memory Bank and the chat engine. They hold case material rather than operator chat,
# they are written at a different rate, and a retention or deletion decision about one kind
# of transcript should not be able to reach the other.
RUN_SESSIONS_ENV="$(dirname "$0")/run_sessions.env"

if [ -f "$RUN_SESSIONS_ENV" ]; then
  source "$RUN_SESSIONS_ENV"
fi

if [ -n "${CASERELAY_RUN_SESSION_ENGINE_ID:-}" ]; then
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $(gcloud auth print-access-token)" \
    "${MB_BASE}/${CASERELAY_RUN_SESSION_ENGINE_ID}")
  if [ "$HTTP_CODE" != "200" ]; then
    echo "ERROR: run Sessions engine ${CASERELAY_RUN_SESSION_ENGINE_ID} not found (HTTP $HTTP_CODE)"
    echo "       Remove infra/run_sessions.env and re-run to create a new engine."
    exit 1
  fi
  echo "Run Sessions engine exists: ${CASERELAY_RUN_SESSION_ENGINE_ID}"
else
  echo "Creating run Sessions engine..."
  RESPONSE=$(curl -s -X POST \
    -H "Authorization: Bearer $(gcloud auth print-access-token)" \
    -H "Content-Type: application/json" \
    -d '{"display_name":"caserelay-run-sessions","description":"Hosts Agent Platform Sessions for the CaseRelay agent fleet — one session per phase invocation of a case run."}' \
    "${MB_BASE}")
  # Creation may answer with the engine or with a long-running operation nested under it
  # (.../reasoningEngines/<id>/operations/<op>), so read the engine id by name rather than
  # taking the last path segment — which silently yields an operation id.
  CASERELAY_RUN_SESSION_ENGINE_ID=$(echo "$RESPONSE" | python3 -c "import sys,json,re; print(re.search(r'reasoningEngines/(\d+)', json.load(sys.stdin)['name']).group(1))")
  {
    echo "# Agent Engine that hosts Agent Platform Sessions for the agent fleet's case runs."
    echo "# Provisioned once by bootstrap.sh, not regenerated by collect_endpoints.sh."
    echo "# Sourced by deploy_control_plane.sh alongside fleet_endpoints.env."
    echo "export CASERELAY_RUN_SESSION_ENGINE_ID=${CASERELAY_RUN_SESSION_ENGINE_ID}"
  } > "$RUN_SESSIONS_ENV"
  echo "Created run Sessions engine: ${CASERELAY_RUN_SESSION_ENGINE_ID}"
  echo "Written to infra/run_sessions.env"
fi

# Creating a session and appending events to it needs aiplatform.sessions.create and
# aiplatform.sessionEvents.append. Both are in roles/aiplatform.user, which
# deploy_control_plane.sh already grants the control plane's runtime account, so no
# narrower session role is added here — roles/aiplatform.sessionEditor would be a subset.
# The fleet's sessions are written by that same account, so they need nothing further.

echo "=== bootstrap complete ==="
