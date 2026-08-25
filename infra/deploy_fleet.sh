#!/usr/bin/env bash
# Deploy the CaseRelay fleet to GEAP Agent Runtime with agent identity enabled.
#
# Each `agents-cli deploy` packages source, uploads it, and builds a container image.
# A full build takes 10-20 minutes per engine. The timeout (default 1800s / 30 min)
# is a safety net, not a speed gate — a killed CLI leaves an empty resource stub with
# no running instances.
#
# Readiness signal: the A2A agent card at the engine's /api passthrough returning HTTP 200.
# Resource existence alone means nothing — an engine without sourceCodeSpec/deploymentSpec
# is an empty shell that will 400 on every request.
#
# The --agent-identity flag triggers a read-modify-write on the project IAM policy.
# Concurrent deploys race on that one resource and all but one lose with 409 ABORTED.
# This script retries the entire agents-cli invocation on 409 with truncated exponential
# backoff plus jitter (per Google's IAM retry-strategy docs).
#
#   ./infra/deploy_fleet.sh                 # deploy all agents
#   ./infra/deploy_fleet.sh health legal    # deploy a subset
set -uo pipefail

PROJECT="${CASERELAY_PROJECT:-caserelay}"
REGION="${CASERELAY_REGION:-us-central1}"
PROJECT_NUMBER="${CASERELAY_PROJECT_NUMBER:-189353698936}"
DEPLOY_TIMEOUT="${CASERELAY_DEPLOY_TIMEOUT:-1800}"
MAX_PARALLEL="${CASERELAY_MAX_PARALLEL:-2}"
MAX_IAM_RETRIES="${CASERELAY_MAX_IAM_RETRIES:-5}"
LOG_DIR="$(dirname "$0")/deploy_logs"
mkdir -p "$LOG_DIR"

# key | agent name | a2a folder
AGENTS=(
  "education|education_liaison|education"
  "health|health_coordination|health"
  "legal|legal_aid|legal"
  "shelter|shelter_status|shelter"
  "family|family_services|family"
  "verifier|safeguarding_verifier|verifier"
  "intake|intake_authority|intake"
  "orchestrator|continuity_orchestrator|orchestrator"
)

_get_token() {
  gcloud auth print-access-token 2>/dev/null
}

_api_engine_id() {
  local display_name="$1"
  local token
  token="$(_get_token)" || return 1
  curl -sf -H "Authorization: Bearer ${token}" \
    "https://${REGION}-aiplatform.googleapis.com/v1beta1/projects/${PROJECT}/locations/${REGION}/reasoningEngines" |
    python3 -c "
import json, sys
for e in json.load(sys.stdin).get('reasoningEngines', []):
    if e.get('displayName') == '${display_name}':
        print(e['name'].rsplit('/', 1)[-1])
        sys.exit(0)
sys.exit(1)
" 2>/dev/null
}

_a2a_card_ready() {
  local engine_id="$1" a2a_folder="$2"
  local token
  token="$(_get_token)" || return 1
  local url="https://${REGION}-aiplatform.googleapis.com/reasoningEngines/v1/projects/${PROJECT_NUMBER}/locations/${REGION}/reasoningEngines/${engine_id}/api/a2a/${a2a_folder}/.well-known/agent-card.json"
  local http_code
  http_code=$(curl -sf -o /dev/null -w "%{http_code}" -H "Authorization: Bearer ${token}" "$url" 2>/dev/null) || true
  [ "$http_code" = "200" ]
}

_poll_a2a_ready() {
  local engine_id="$1" a2a_folder="$2"
  local attempts="${3:-40}"
  local interval="${4:-30}"
  for ((i=1; i<=attempts; i++)); do
    if _a2a_card_ready "$engine_id" "$a2a_folder"; then
      return 0
    fi
    echo "[$(date +%H:%M:%S)]   readiness poll ${i}/${attempts}: not yet serving" >&2
    sleep "$interval"
  done
  return 1
}

_update_registry() {
  local key="$1" engine_id="$2" a2a_folder="$3"
  local svc_name="caserelay-${key}-a2a"
  local token
  token="$(_get_token)" || return 1
  local url="https://us-central1-aiplatform.googleapis.com/reasoningEngines/v1/projects/${PROJECT_NUMBER}/locations/${REGION}/reasoningEngines/${engine_id}/api/a2a/${a2a_folder}"

  local current
  current=$(curl -sf -H "Authorization: Bearer ${token}" \
    "https://agentregistry.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/services/${svc_name}") || return 1

  local updated
  updated=$(echo "$current" | python3 -c "
import json, sys
svc = json.load(sys.stdin, strict=False)
content = svc.get('agentSpec', {}).get('content', {})
ifaces = content.get('supportedInterfaces', [])
if ifaces:
    ifaces[0]['url'] = '${url}'
print(json.dumps({'agentSpec': svc['agentSpec']}))
") || return 1

  curl -sf -X PATCH \
    -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    "https://agentregistry.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/services/${svc_name}?updateMask=agentSpec" \
    -d "$updated" >/dev/null
}

# --- Deploy a single engine with 409 retry ---
_deploy_one() {
  local key="$1" agent="$2" a2a_folder="$3"
  local svc="caserelay-${key}"
  local log="${LOG_DIR}/${key}.log"
  local result_file="${LOG_DIR}/${key}.result"

  echo "[$(date +%H:%M:%S)] deploying ${agent} as ${svc}" > "$log"

  # Build extra env vars
  local extra=""
  local self_url_var="CASERELAY_URL_$(echo "$key" | tr '[:lower:]' '[:upper:]')"
  local self_url="${!self_url_var:-}"
  if [ -n "$self_url" ]; then
    extra=",CASERELAY_PUBLIC_URL=${self_url}"
  fi
  if [ "$key" = "orchestrator" ]; then
    extra+=",CASERELAY_URL_EDUCATION=${CASERELAY_URL_EDUCATION:-}"
    extra+=",CASERELAY_URL_HEALTH=${CASERELAY_URL_HEALTH:-}"
    extra+=",CASERELAY_URL_LEGAL=${CASERELAY_URL_LEGAL:-}"
    extra+=",CASERELAY_URL_SHELTER=${CASERELAY_URL_SHELTER:-}"
    extra+=",CASERELAY_URL_FAMILY=${CASERELAY_URL_FAMILY:-}"
    extra+=",CASERELAY_URL_VERIFIER=${CASERELAY_URL_VERIFIER:-}"
  fi

  local attempt=0 backoff=5 max_backoff=60
  local deploy_rc=1
  local final_status="FAIL"

  while [ $attempt -lt "$MAX_IAM_RETRIES" ]; do
    attempt=$((attempt + 1))
    echo "[$(date +%H:%M:%S)] attempt ${attempt}/${MAX_IAM_RETRIES}" >> "$log"

    timeout "$DEPLOY_TIMEOUT" agents-cli deploy \
      -d agent_runtime \
      --project "$PROJECT" \
      --region "$REGION" \
      --no-confirm-project \
      --agent-identity \
      --service-name "$svc" \
      --update-env-vars "CASERELAY_AGENT=${agent},CASERELAY_STATE=firestore,CASERELAY_PROJECT_ID=${PROJECT},GOOGLE_CLOUD_PROJECT=${PROJECT},GOOGLE_CLOUD_LOCATION=global,GOOGLE_GENAI_USE_VERTEXAI=true,PYTHONPATH=/app${extra}" \
      --cpu 1 --memory 2Gi --min-instances 1 --max-instances 2 \
      >> "$log" 2>&1
    deploy_rc=$?

    if [ "$deploy_rc" -eq 0 ]; then
      echo "[$(date +%H:%M:%S)] CLI returned success" >> "$log"
      # CLI success is necessary but not sufficient — verify real readiness.
      local eid
      eid=$(_api_engine_id "$svc" 2>/dev/null || true)
      if [ -n "$eid" ] && _poll_a2a_ready "$eid" "$a2a_folder" 20 15 2>>"$log"; then
        echo "[$(date +%H:%M:%S)] A2A agent card returns 200 — engine is serving" >> "$log"
        final_status="CREATED_AND_CONFIGURED"
      else
        echo "[$(date +%H:%M:%S)] CLI succeeded but engine not serving after polling" >> "$log"
        final_status="CLI_OK_NOT_SERVING"
      fi
      break
    elif [ "$deploy_rc" -eq 124 ]; then
      echo "[$(date +%H:%M:%S)] CLI killed by timeout (${DEPLOY_TIMEOUT}s) — build was likely still running" >> "$log"
      final_status="TIMEOUT_BUILD_KILLED"
      break
    elif grep -q "concurrent policy changes\|ABORTED" "$log"; then
      echo "[$(date +%H:%M:%S)] 409 IAM race detected, will retry" >> "$log"
      if [ $attempt -ge "$MAX_IAM_RETRIES" ]; then
        final_status="CREATED_IAM_ABORTED"
        break
      fi
      # Truncated exponential backoff with jitter
      local jitter=$((RANDOM % backoff))
      local sleep_time=$((backoff + jitter))
      echo "[$(date +%H:%M:%S)] sleeping ${sleep_time}s before retry" >> "$log"
      sleep "$sleep_time"
      backoff=$((backoff * 2))
      [ $backoff -gt $max_backoff ] && backoff=$max_backoff
      # Truncate log for next attempt to only detect NEW 409s
      echo "--- retry boundary ---" >> "$log"
    else
      echo "[$(date +%H:%M:%S)] non-retryable failure (rc=${deploy_rc})" >> "$log"
      final_status="NOT_CREATED"
      break
    fi
  done

  echo "$final_status" > "$result_file"
}

# --- Main ---
targets=("$@")
declare -a pids=()
active=0

echo "=== CaseRelay Fleet Deploy (parallel=${MAX_PARALLEL}, iam_retries=${MAX_IAM_RETRIES}) ==="
echo "    project=${PROJECT} region=${REGION} timeout=${DEPLOY_TIMEOUT}s"
echo "    logs: ${LOG_DIR}/"
echo ""

for entry in "${AGENTS[@]}"; do
  IFS='|' read -r key agent a2a_folder <<<"$entry"
  if [ ${#targets[@]} -gt 0 ] && [[ ! " ${targets[*]} " =~ " ${key} " ]]; then
    continue
  fi

  # Bounded concurrency
  while [ "$active" -ge "$MAX_PARALLEL" ]; do
    wait -n 2>/dev/null || true
    active=$((active - 1))
  done

  echo "  launching: ${key}"
  _deploy_one "$key" "$agent" "$a2a_folder" &
  pids+=($!)
  active=$((active + 1))
done

# Wait for all
for pid in "${pids[@]}"; do
  wait "$pid" 2>/dev/null || true
done

# --- Collect results ---
echo ""
echo "=== fleet deploy results ==="
created_configured=()
created_iam_aborted=()
failed=()

for entry in "${AGENTS[@]}"; do
  IFS='|' read -r key agent a2a_folder <<<"$entry"
  if [ ${#targets[@]} -gt 0 ] && [[ ! " ${targets[*]} " =~ " ${key} " ]]; then
    continue
  fi

  result="$(cat "${LOG_DIR}/${key}.result" 2>/dev/null || echo "UNKNOWN")"
  case "$result" in
    CREATED_AND_CONFIGURED)
      created_configured+=("$key")
      echo "  PASS: ${key} — deployed and A2A agent card returns 200"
      ;;
    CREATED_IAM_ABORTED)
      created_iam_aborted+=("$key")
      echo "  WARN: ${key} — IAM grant aborted after retries (needs manual repair)"
      ;;
    CLI_OK_NOT_SERVING)
      failed+=("$key")
      echo "  FAIL: ${key} — CLI returned 0 but engine not serving (see ${LOG_DIR}/${key}.log)"
      ;;
    TIMEOUT_BUILD_KILLED)
      failed+=("$key")
      echo "  FAIL: ${key} — timeout killed the build at ${DEPLOY_TIMEOUT}s (see ${LOG_DIR}/${key}.log)"
      ;;
    NOT_CREATED)
      failed+=("$key")
      echo "  FAIL: ${key} — engine not created (see ${LOG_DIR}/${key}.log)"
      ;;
    *)
      failed+=("$key")
      echo "  FAIL: ${key} — unknown status '${result}' (see ${LOG_DIR}/${key}.log)"
      ;;
  esac
done

# --- Update Agent Registry for all live engines ---
echo ""
echo "=== updating Agent Registry ==="
registry_ok=0
registry_fail=0

for entry in "${AGENTS[@]}"; do
  IFS='|' read -r key agent a2a_folder <<<"$entry"
  if [ ${#targets[@]} -gt 0 ] && [[ ! " ${targets[*]} " =~ " ${key} " ]]; then
    continue
  fi

  svc="caserelay-${key}"
  engine_id=$(_api_engine_id "$svc" 2>/dev/null || true)
  if [ -z "$engine_id" ]; then
    echo "  SKIP registry for ${key}: no live engine"
    continue
  fi

  if _update_registry "$key" "$engine_id" "$a2a_folder"; then
    echo "  OK: caserelay-${key}-a2a -> engine ${engine_id}"
    registry_ok=$((registry_ok + 1))
  else
    echo "  FAIL: caserelay-${key}-a2a registry update failed"
    registry_fail=$((registry_fail + 1))
  fi
done

# --- Final summary ---
echo ""
echo "=== final summary ==="
echo "  Deployed and serving: ${created_configured[*]:-none}"
echo "  IAM grant aborted:   ${created_iam_aborted[*]:-none}"
echo "  Failed:              ${failed[*]:-none}"
echo "  Registry updates:    ${registry_ok} OK, ${registry_fail} failed"

if [ ${#created_iam_aborted[@]} -gt 0 ]; then
  echo ""
  echo "  ACTION REQUIRED: Engines with aborted IAM need role repair:"
  echo "    bash infra/repair_iam.sh ${created_iam_aborted[*]}"
fi

if [ ${#failed[@]} -gt 0 ] || [ ${#created_iam_aborted[@]} -gt 0 ] || [ "$registry_fail" -gt 0 ]; then
  exit 1
fi
echo "  all engines deployed, configured, and registered successfully"
