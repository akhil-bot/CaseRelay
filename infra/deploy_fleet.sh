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
MAX_PARALLEL="${CASERELAY_MAX_PARALLEL:-4}"
MAX_IAM_RETRIES="${CASERELAY_MAX_IAM_RETRIES:-5}"
# Default 0 keeps idle burn near zero. To warm for judges: CASERELAY_MIN_INSTANCES=1 bash infra/deploy_all.sh
MIN_INSTANCES="${CASERELAY_MIN_INSTANCES:-0}"
LOG_DIR="$(dirname "$0")/deploy_logs"
mkdir -p "$LOG_DIR"

# Gateway binding is EXPLICIT OPT-IN only. Set CASERELAY_AGENT_GATEWAY to the full gateway
# resource name to bind engines during this deploy. Leave unset or set to "none" to deploy
# without touching each engine's existing binding.
# IMPORTANT: when not binding the flag is OMITTED entirely (not passed as empty), because
# --agent-gateway-egress="" would silently unbind engines — the cause of the shelter {} state.
# To intentionally remove an existing binding, set CASERELAY_AGENT_GATEWAY=unbind (distinct,
# unmistakable value — cannot be triggered by "none" or an unset var).
if [ "${CASERELAY_AGENT_GATEWAY:-}" = "none" ] || [ -z "${CASERELAY_AGENT_GATEWAY:-}" ]; then
  AGENT_GATEWAY=""
  echo "  Agent Gateway binding: OFF — --agent-gateway-egress omitted; per-engine bindings unchanged."
elif [ "${CASERELAY_AGENT_GATEWAY:-}" = "unbind" ]; then
  AGENT_GATEWAY="unbind"
  echo "  Agent Gateway binding: UNBIND — removing existing bindings (passes --agent-gateway-egress \"\")."
else
  AGENT_GATEWAY="$CASERELAY_AGENT_GATEWAY"
  echo "  Agent Gateway binding: ON  — ${AGENT_GATEWAY}"
  echo "  NOTE: ensure the gateway root CA is baked into the image or engines will fail with CERTIFICATE_VERIFY_FAILED."
fi

# Partner MCP routing is EXPLICIT OPT-IN only. Set CASERELAY_PARTNER_MCP=1 and
# CASERELAY_PARTNER_MCP_URL to route partner calls through the deployed MCP server.
# Unset or "0" keeps the in-process sim.py path (default, always safe).
# Fail fast when MCP is enabled but the URL is missing — a fleet deploy with a missing URL
# would break every partner call at runtime with a connection refused error.
if [ "${CASERELAY_PARTNER_MCP:-0}" = "1" ]; then
  if [ -z "${CASERELAY_PARTNER_MCP_URL:-}" ]; then
    echo "FATAL: CASERELAY_PARTNER_MCP=1 but CASERELAY_PARTNER_MCP_URL is empty." >&2
    echo "  Deploy the partner MCP server first (bash infra/deploy_partners.sh) and set the URL." >&2
    exit 1
  fi
  PARTNER_MCP_EXTRA=",CASERELAY_PARTNER_MCP=1,CASERELAY_PARTNER_MCP_URL=${CASERELAY_PARTNER_MCP_URL}"
  echo "  Partner MCP path:    ON  — ${CASERELAY_PARTNER_MCP_URL}"
else
  PARTNER_MCP_EXTRA=",CASERELAY_PARTNER_MCP=0"
  echo "  Partner MCP path:    OFF — in-process sim.py (default)"
fi

# Identity pinning: ALWAYS source pinned identities first, then fleet endpoints for URLs.
# The pinned file is the single source of truth for identity values during the gateway rollout.
# If a deploy would ship identity values that differ from the pinned set, it will produce
# engines whose grants silently fail (IdentityDenied even though card returns 200).
PINNED_ENV="$(dirname "$0")/pinned_identities.env"
if [ -f "$PINNED_ENV" ]; then
  # shellcheck disable=SC1090
  source "$PINNED_ENV"
  # Guard: refuse to deploy if any pinned identity is empty
  _identity_guard_ok=1
  for _id_var in CASERELAY_IDENTITY_EDUCATION CASERELAY_IDENTITY_HEALTH \
                 CASERELAY_IDENTITY_LEGAL CASERELAY_IDENTITY_SHELTER \
                 CASERELAY_IDENTITY_FAMILY CASERELAY_IDENTITY_INTAKE \
                 CASERELAY_IDENTITY_ORCHESTRATOR CASERELAY_IDENTITY_VERIFIER; do
    if [ -z "${!_id_var:-}" ]; then
      echo "FATAL: $_id_var is empty after sourcing $PINNED_ENV" >&2
      _identity_guard_ok=0
    fi
  done
  if [ "$_identity_guard_ok" -eq 0 ]; then
    echo "  Identity pinning guard failed. Cannot deploy — grants would silently break." >&2
    echo "  Fix $PINNED_ENV or regenerate from live fleet." >&2
    exit 1
  fi
fi

# Source fleet endpoints if available (needed for orchestrator's specialist URLs).
# This file is generated by collect_endpoints.sh; on a cold-start where no engines
# exist yet, it won't be present — that's fine for specialist-only deploys.
FLEET_ENV="$(dirname "$0")/fleet_endpoints.env"
if [ -f "$FLEET_ENV" ]; then
  # shellcheck disable=SC1090
  source "$FLEET_ENV"
fi

# Re-apply pinned identities AFTER fleet_endpoints.env to ensure they override
# any potentially stale identity values that collect_endpoints.sh may have written.
if [ -f "$PINNED_ENV" ]; then
  # shellcheck disable=SC1090
  source "$PINNED_ENV"
fi

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
  local attempt=0 max_attempts=3 backoff=2
  while [ $attempt -lt $max_attempts ]; do
    attempt=$((attempt + 1))
    local token
    token="$(_get_token)" || { sleep "$backoff"; backoff=$((backoff * 2)); continue; }
    local result
    result=$(curl -s -H "Authorization: Bearer ${token}" \
      "https://${REGION}-aiplatform.googleapis.com/v1beta1/projects/${PROJECT}/locations/${REGION}/reasoningEngines?filter=display_name%3D${display_name}" 2>/dev/null |
      python3 -c "
import json, sys
data = json.load(sys.stdin)
engines = data.get('reasoningEngines', [])
if engines:
    print(engines[0]['name'].rsplit('/', 1)[-1])
    sys.exit(0)
sys.exit(1)
" 2>/dev/null) && { echo "$result"; return 0; }
    sleep "$backoff"
    backoff=$((backoff * 2))
  done
  return 1
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
    extra+=",CASERELAY_PUBLIC_URL=${self_url}"
  fi
  if [ "$key" = "orchestrator" ]; then
    local missing_urls=""
    for url_var in CASERELAY_URL_EDUCATION CASERELAY_URL_HEALTH CASERELAY_URL_LEGAL \
                   CASERELAY_URL_SHELTER CASERELAY_URL_FAMILY CASERELAY_URL_VERIFIER; do
      if [ -z "${!url_var:-}" ]; then
        missing_urls="${missing_urls} ${url_var}"
      fi
    done
    if [ -n "$missing_urls" ]; then
      echo "FATAL: orchestrator deploy requires specialist URLs but these are empty:${missing_urls}" >> "$log"
      echo "  Generate them with: bash infra/collect_endpoints.sh" >> "$log"
      echo "  Then re-run this script (it will source infra/fleet_endpoints.env automatically)." >> "$log"
      echo "ORCHESTRATOR_MISSING_URLS" > "$result_file"
      return 1
    fi
    extra+=",CASERELAY_URL_EDUCATION=${CASERELAY_URL_EDUCATION}"
    extra+=",CASERELAY_URL_HEALTH=${CASERELAY_URL_HEALTH}"
    extra+=",CASERELAY_URL_LEGAL=${CASERELAY_URL_LEGAL}"
    extra+=",CASERELAY_URL_SHELTER=${CASERELAY_URL_SHELTER}"
    extra+=",CASERELAY_URL_FAMILY=${CASERELAY_URL_FAMILY}"
    extra+=",CASERELAY_URL_VERIFIER=${CASERELAY_URL_VERIFIER}"
  fi
  # Every engine needs the identity registry (cross-agent verification)
  for id_var in CASERELAY_IDENTITY_EDUCATION CASERELAY_IDENTITY_HEALTH \
                CASERELAY_IDENTITY_LEGAL CASERELAY_IDENTITY_SHELTER \
                CASERELAY_IDENTITY_FAMILY CASERELAY_IDENTITY_INTAKE \
                CASERELAY_IDENTITY_ORCHESTRATOR CASERELAY_IDENTITY_VERIFIER; do
    local id_val="${!id_var:-}"
    if [ -n "$id_val" ]; then
      extra+=",${id_var}=${id_val}"
    fi
  done
  # Partner MCP routing: OFF by default (CASERELAY_PARTNER_MCP=0 → in-process sim.py)
  extra+="$PARTNER_MCP_EXTRA"

  local attempt=0 backoff=5 max_backoff=60
  local deploy_rc=1
  local final_status="FAIL"
  local retried_transient=0

  while [ $attempt -lt "$MAX_IAM_RETRIES" ]; do
    attempt=$((attempt + 1))
    echo "[$(date +%H:%M:%S)] attempt ${attempt}/${MAX_IAM_RETRIES}" >> "$log"

    local -a gw_flags=()
    if [ -n "$AGENT_GATEWAY" ]; then
      if [ "$AGENT_GATEWAY" = "unbind" ]; then
        gw_flags=("--agent-gateway-egress" "")
      else
        gw_flags=("--agent-gateway-egress" "${AGENT_GATEWAY}")
      fi
    fi

    timeout "$DEPLOY_TIMEOUT" agents-cli deploy \
      -d agent_runtime \
      --project "$PROJECT" \
      --region "$REGION" \
      --no-confirm-project \
      --agent-identity \
      --service-name "$svc" \
      "${gw_flags[@]+"${gw_flags[@]}"}" \
      --update-env-vars "CASERELAY_AGENT=${agent},CASERELAY_STATE=firestore,CASERELAY_PROJECT_ID=${PROJECT},GOOGLE_CLOUD_PROJECT=${PROJECT},GOOGLE_CLOUD_LOCATION=global,GOOGLE_GENAI_USE_VERTEXAI=true,GOOGLE_API_USE_CLIENT_CERTIFICATE=true,GOOGLE_CLOUD_AGENT_ENGINE_ENABLE_TELEMETRY=true,OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental,PYTHONPATH=/app${extra},MODEL_ARMOR_TEMPLATE=projects/${PROJECT}/locations/${REGION}/templates/caserelay-screen,MODEL_ARMOR_LOCATION=${REGION}" \
      --cpu 1 --memory 2Gi --min-instances ${MIN_INSTANCES} --max-instances 2 \
      >> "$log" 2>&1
    deploy_rc=$?

    if [ "$deploy_rc" -eq 0 ]; then
      echo "[$(date +%H:%M:%S)] CLI returned success" >> "$log"
      # CLI success is necessary but not sufficient — verify real readiness.
      local eid
      eid=$(_api_engine_id "$svc" 2>/dev/null || true)
      if [ -n "$eid" ] && _poll_a2a_ready "$eid" "$a2a_folder" 20 15 2>>"$log"; then
        echo "[$(date +%H:%M:%S)] A2A agent card returns 200 — engine is serving" >> "$log"
        # Check for empty stub (engine exists but has no working spec)
        local stub_check
        stub_check=$(curl -sf -H "Authorization: Bearer $(_get_token)" \
          "https://${REGION}-aiplatform.googleapis.com/v1beta1/projects/${PROJECT_NUMBER}/locations/${REGION}/reasoningEngines/${eid}" 2>/dev/null | \
          python3 -c "
import json, sys
e = json.load(sys.stdin)
spec = e.get('spec', {}) or {}
deploy = spec.get('deploymentSpec', {}) or {}
source_code = spec.get('sourceCodeSpec', {}) or {}
if not deploy and not source_code:
    print('STUB')
else:
    print('OK')
" 2>/dev/null || echo "OK")
        if [ "$stub_check" = "STUB" ]; then
          echo "[$(date +%H:%M:%S)] WARNING: engine is an empty stub despite card 200" >> "$log"
          final_status="EMPTY_STUB"
        else
          final_status="CREATED_AND_CONFIGURED"
        fi
      else
        echo "[$(date +%H:%M:%S)] CLI succeeded but engine not serving after polling" >> "$log"
        final_status="CLI_OK_NOT_SERVING"
      fi
      # Retry once for CLI_OK_NOT_SERVING (transient: build may still be propagating)
      if [ "$final_status" = "CLI_OK_NOT_SERVING" ] && [ "$retried_transient" -eq 0 ]; then
        retried_transient=1
        echo "[$(date +%H:%M:%S)] retrying once (transient: engine not serving yet)" >> "$log"
        echo "--- transient retry boundary ---" >> "$log"
        sleep 30
        continue
      fi
      break
    elif [ "$deploy_rc" -eq 124 ]; then
      echo "[$(date +%H:%M:%S)] CLI killed by timeout (${DEPLOY_TIMEOUT}s) — build was likely still running" >> "$log"
      final_status="TIMEOUT_BUILD_KILLED"
      # Retry once on timeout (the build may complete on its own)
      if [ "$retried_transient" -eq 0 ]; then
        retried_transient=1
        echo "[$(date +%H:%M:%S)] retrying once after timeout" >> "$log"
        echo "--- timeout retry boundary ---" >> "$log"
        sleep 15
        continue
      fi
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
      # Retry once for NOT_CREATED (transient network/auth failure)
      if [ "$retried_transient" -eq 0 ]; then
        retried_transient=1
        echo "[$(date +%H:%M:%S)] retrying once (may be transient)" >> "$log"
        echo "--- transient retry boundary ---" >> "$log"
        sleep 10
        continue
      fi
      break
    fi
  done

  echo "$final_status" > "$result_file"
}

# --- Portable concurrency limiter (bash 3.2+) ---
# Polls running PIDs instead of relying on bash 4.3+ `wait -n`.
_wait_for_slot() {
  while true; do
    local running=0
    local still_active=()
    local i
    for i in "${!pids[@]}"; do
      if kill -0 "${pids[$i]}" 2>/dev/null; then
        running=$((running + 1))
        still_active+=("${pids[$i]}")
      fi
    done
    pids=("${still_active[@]+"${still_active[@]}"}")
    if [ "$running" -lt "$MAX_PARALLEL" ]; then
      return
    fi
    sleep 1
  done
}

# --- Main ---
targets=("$@")
declare -a pids=()

echo "=== CaseRelay Fleet Deploy (parallel=${MAX_PARALLEL}, iam_retries=${MAX_IAM_RETRIES}) ==="
echo "    project=${PROJECT} region=${REGION} timeout=${DEPLOY_TIMEOUT}s"
echo "    gateway=${AGENT_GATEWAY:-none}"
echo "    logs: ${LOG_DIR}/"
echo ""

for entry in "${AGENTS[@]}"; do
  IFS='|' read -r key agent a2a_folder <<<"$entry"
  if [ ${#targets[@]} -gt 0 ] && [[ ! " ${targets[*]} " =~ " ${key} " ]]; then
    continue
  fi

  _wait_for_slot

  echo "  launching: ${key}"
  _deploy_one "$key" "$agent" "$a2a_folder" &
  pids+=($!)
done

# Wait for all remaining
for pid in ${pids[@]+"${pids[@]}"}; do
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
      echo "  FAIL: ${key} — CLI returned 0 but engine not serving after retry (see ${LOG_DIR}/${key}.log)"
      ;;
    TIMEOUT_BUILD_KILLED)
      failed+=("$key")
      echo "  FAIL: ${key} — timeout killed the build at ${DEPLOY_TIMEOUT}s after retry (see ${LOG_DIR}/${key}.log)"
      ;;
    EMPTY_STUB)
      failed+=("$key")
      echo "  FAIL: ${key} — engine is an empty stub (no sourceCodeSpec/deploymentSpec; a killed build left this)"
      ;;
    NOT_CREATED)
      failed+=("$key")
      echo "  FAIL: ${key} — engine not created after retry (see ${LOG_DIR}/${key}.log)"
      ;;
    ORCHESTRATOR_MISSING_URLS)
      failed+=("$key")
      echo "  FAIL: ${key} — specialist URLs not set (run: bash infra/collect_endpoints.sh)"
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

# --- Grant IAM roles that --agent-identity does not provision ---
echo ""
echo "=== granting fleet IAM roles (Firestore, Service Usage) ==="
if [ ${#created_configured[@]} -gt 0 ] || [ ${#created_iam_aborted[@]} -gt 0 ]; then
  bash "$(dirname "$0")/grant_fleet_iam.sh" ${created_configured[*]:-} ${created_iam_aborted[*]:-}
  grant_rc=$?
  if [ $grant_rc -ne 0 ]; then
    echo "  WARNING: some IAM grants failed — agents may not be able to access Firestore"
  fi
else
  echo "  SKIP: no engines were deployed this run"
fi

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
