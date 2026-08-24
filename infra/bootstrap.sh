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
gcloud firestore indexes composite list --project="$PROJECT" --format=json 2>/dev/null | grep -q "due_at" \
  || gcloud firestore indexes composite create \
       --project="$PROJECT" \
       --collection-group=checkpoints \
       --field-config field-path=state,order=ASCENDING \
       --field-config field-path=due_at,order=ASCENDING \
  || echo "index may already exist or be building"

echo "=== bootstrap complete ==="
