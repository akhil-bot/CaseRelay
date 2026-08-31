#!/usr/bin/env bash
# Build and deploy the CaseRelay control plane to Cloud Run.
# Idempotent and repeatable — run after any code change to ship it.
#
# Flow: build → deploy new revision with no traffic → probe A2A readiness
# on the tagged canary URL → shift traffic only if the probe passes.
# A failure at any step leaves production traffic on the current revision
# and exits non-zero, printing the canary URL for investigation.
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

# Agent Engine hosting the fleet's per-invocation run Sessions. Same rule: the control
# plane refuses to start without it.
RUN_SESSIONS_ENV="$(dirname "$0")/run_sessions.env"
if [ ! -f "$RUN_SESSIONS_ENV" ]; then
  echo "ERROR: $RUN_SESSIONS_ENV not found — run infra/bootstrap.sh first" >&2
  exit 1
fi
source "$RUN_SESSIONS_ENV"
if [ -z "${CASERELAY_RUN_SESSION_ENGINE_ID:-}" ]; then
  echo "ERROR: CASERELAY_RUN_SESSION_ENGINE_ID is empty in $RUN_SESSIONS_ENV" >&2
  exit 1
fi

echo "=== building linux/amd64 image ==="
docker buildx build --platform linux/amd64 \
  -f backend/Dockerfile \
  -t "$IMAGE" \
  --push .

# Tag with a timestamp so the canary URL is unambiguous and the revision is
# identifiable if someone needs to inspect it after a failed probe.
DEPLOY_TAG="canary-$(date +%s)"

echo "=== deploying revision (no traffic, tag=${DEPLOY_TAG}) ==="
echo "    production traffic is unchanged until the A2A probe passes"
gcloud run deploy "$SERVICE" \
  --project="$PROJECT" \
  --region="$REGION" \
  --image="$IMAGE" \
  --platform=managed \
  --no-allow-unauthenticated \
  --no-traffic \
  --tag="$DEPLOY_TAG" \
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
CASERELAY_CHAT_SESSION_LOCATION=${REGION},\
CASERELAY_RUN_SESSION_ENGINE_ID=${CASERELAY_RUN_SESSION_ENGINE_ID},\
CASERELAY_RUN_SESSION_LOCATION=${REGION},\
CASERELAY_CHAT_MODEL=gemini-3.5-flash" \
  --port=8080 \
  --memory=1Gi \
  --cpu=1 \
  --min-instances=1 \
  --max-instances=1 \
  --timeout=900 \
  --no-cpu-throttling \
  --execution-environment=gen2

# Construct the tagged URL. Cloud Run tagged URLs follow the pattern:
#   https://TAG---SERVICE-HASH-REGION.a.run.app
# where SERVICE-HASH-REGION is everything after https:// in the main service URL.
echo "=== locating canary revision URL ==="
SERVICE_URL=$(gcloud run services describe "$SERVICE" \
  --project="$PROJECT" --region="$REGION" \
  --format='value(status.url)')
SERVICE_HOST="${SERVICE_URL#https://}"
CANARY_URL="https://${DEPLOY_TAG}---${SERVICE_HOST}"
echo "    canary URL: $CANARY_URL"
echo "    production URL (unchanged): $SERVICE_URL"

echo "=== granting run.invoker to portal SA ==="
gcloud run services add-iam-policy-binding "$SERVICE" \
  --project="$PROJECT" \
  --region="$REGION" \
  --member="serviceAccount:${PORTAL_SA}" \
  --role="roles/run.invoker" \
  --quiet

# aiplatform.user is also what lets the chat agent and the agent fleet write Agent Platform
# Sessions: it carries aiplatform.sessions.create and aiplatform.sessionEvents.append.
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

# Probe A2A readiness on the canary revision. The token audience is the main
# service URL — Cloud Run validates identity tokens at the service level, not
# per tagged-URL, so the same token reaches the canary revision.
echo "=== probing A2A readiness on canary revision ==="
echo "    this exercises the outbound authenticated HTTP path that broke"
echo "    when a sync hook was registered; /health cannot catch this"

# Mint with retry — a transient gcloud auth failure returns an empty string;
# an empty bearer token produces HTTP 401 indistinguishable from a bad audience.
#
# --audiences only works when the active credential is a service account; gcloud
# refuses it outright on a user account ("Invalid account type for --audiences").
# Cloud Run accepts a plain user identity token, so fall back to one rather than
# failing an otherwise healthy deploy on whose credentials happened to run it.
MINT_ERR=$(mktemp)
TOKEN=""
for _mint_i in 1 2 3; do
  TOKEN=$(gcloud auth print-identity-token --audiences="$SERVICE_URL" 2>"$MINT_ERR" \
    || gcloud auth print-identity-token 2>>"$MINT_ERR" || true)
  [ -n "$TOKEN" ] && break
  echo "  token mint attempt ${_mint_i}/3 failed" >&2
  cat "$MINT_ERR" >&2
  [ "$_mint_i" -lt 3 ] && sleep 5
done

if [ -z "$TOKEN" ]; then
  echo "FAIL: identity token minting failed after 3 attempts — production traffic is UNCHANGED" >&2
  echo "  this is a probe infrastructure failure, not a broken revision" >&2
  echo "  gcloud error: $(cat "$MINT_ERR")" >&2
  rm -f "$MINT_ERR"
  echo "  canary revision for investigation: $CANARY_URL" >&2
  exit 1
fi
rm -f "$MINT_ERR"

# Probe with retry — guards against transient cold-start or network blips.
# Each attempt is still a genuine functional check; all must fail to block the deploy.
PROBE_BODY=$(mktemp)
PROBE_HTTP="000"
for _probe_i in 1 2 3; do
  PROBE_HTTP=$(curl -s \
    -o "$PROBE_BODY" \
    -w "%{http_code}" \
    -H "Authorization: Bearer $TOKEN" \
    --max-time 60 \
    "$CANARY_URL/v1/probe" 2>/dev/null) || PROBE_HTTP="000"
  [ "$PROBE_HTTP" = "200" ] && break
  echo "  probe attempt ${_probe_i}/3: HTTP $PROBE_HTTP" >&2
  [ "$_probe_i" -lt 3 ] && sleep 10
done

if [ "$PROBE_HTTP" != "200" ]; then
  echo "FAIL: A2A probe returned HTTP $PROBE_HTTP — production traffic is UNCHANGED" >&2
  if [ "$PROBE_HTTP" = "401" ] || [ "$PROBE_HTTP" = "403" ]; then
    # Token was confirmed non-empty above, so this likely means audience mismatch.
    echo "  NOTE: token minted successfully but Cloud Run returned $PROBE_HTTP —" >&2
    echo "  likely audience mismatch; audience must be \$SERVICE_URL, not \$CANARY_URL." >&2
  fi
  echo "  canary revision for investigation: $CANARY_URL" >&2
  echo "  probe response body:" >&2
  cat "$PROBE_BODY" >&2
  rm -f "$PROBE_BODY"
  exit 1
fi

echo "    PASS: A2A probe succeeded (HTTP $PROBE_HTTP)"
cat "$PROBE_BODY"
echo ""
rm -f "$PROBE_BODY"

# Only reached when the probe passes. Shift all traffic to the verified revision.
echo "=== shifting traffic to verified revision ==="
gcloud run services update-traffic "$SERVICE" \
  --project="$PROJECT" \
  --region="$REGION" \
  --to-latest

# Remove stale canary tags so old revisions don't stay warm.
# Cloud Run honors min-instances=1 for any tagged revision even at 0% traffic,
# so each unremoved canary tag costs one always-on instance. We keep the two
# newest canary-* tags (current + one rollback option) and strip the rest.
echo "=== removing stale canary tags ==="
STALE_CANARY_TAGS=$(gcloud run services describe "$SERVICE" \
  --project="$PROJECT" \
  --region="$REGION" \
  --format='json' \
  | python3 -c "
import json, sys
data = json.load(sys.stdin)
traffic = data.get('spec', {}).get('traffic', [])
# Sort descending so index 0 is newest; canary tags are canary-<epoch> so lex sort is correct.
tags = sorted(
    [e['tag'] for e in traffic if e.get('tag', '').startswith('canary-')],
    reverse=True
)
to_remove = tags[2:]  # keep newest 2, remove the rest
if to_remove:
    print(','.join(to_remove))
" 2>/dev/null || true)

if [ -n "$STALE_CANARY_TAGS" ]; then
  echo "    removing: $STALE_CANARY_TAGS"
  gcloud run services update-traffic "$SERVICE" \
    --project="$PROJECT" \
    --region="$REGION" \
    --remove-tags="$STALE_CANARY_TAGS"
  echo "    done — stale revisions can now scale to 0"
else
  echo "    no stale canary tags to remove"
fi

echo "$SERVICE_URL" > infra/control_plane_url.txt
echo "=== deployed and verified: $SERVICE_URL ==="
