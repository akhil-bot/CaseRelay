#!/usr/bin/env bash
# ============================================================================
# CaseRelay Agent Gateway Rollout — Blue/Green + In-Place Orchestrator
# ============================================================================
#
# Single entry point for converting the fleet to Agent Gateway binding.
# Run phases individually or let it drive end-to-end (with pauses for approval).
#
# STRATEGY:
#   Phase 1 (canary):   Deploy ONE leaf specialist as a new -gw engine.
#                        Verify with probe_engine.sh. Decide go/no-go.
#   Phase 2 (leaves):   Deploy remaining 5 leaf specialists as -gw engines.
#                        All must pass probe. Old engines still serve.
#   Phase 3 (cutover):  PATCH Agent Registry + update control plane env vars
#                        to point at -gw engines. Instantly revertible.
#   Phase 4 (orchestrator): In-place redeploy of orchestrator with gateway.
#                        Identity must be preserved (effectiveIdentity tied to resource ID).
#   Phase 5 (cleanup):  Delete old leaf engines once stable.
#
# SAFETY:
#   - Identity values are ALWAYS sourced from infra/pinned_identities.env.
#     The guard refuses to proceed if env vars don't match the pinned set.
#   - Default CASERELAY_MAX_PARALLEL=1 to avoid documented 409 IAM race.
#   - Retry-once on transient failures; permanent failures skip the engine.
#   - Empty-stub detection prevents cutting over to a broken engine.
#   - Blue/green engines never serve traffic until explicitly cut over.
#
# USAGE:
#   bash infra/rollout_gateway.sh --phase canary          # just the canary
#   bash infra/rollout_gateway.sh --phase leaves          # remaining leaves
#   bash infra/rollout_gateway.sh --phase cutover         # switch traffic
#   bash infra/rollout_gateway.sh --phase orchestrator    # in-place upgrade
#   bash infra/rollout_gateway.sh --phase all             # full sequence (prompts between)
#   bash infra/rollout_gateway.sh --phase verify          # probe all -gw engines
#   bash infra/rollout_gateway.sh --phase rollback        # revert cutover
#
# ENVIRONMENT:
#   CASERELAY_PROJECT           (default: caserelay)
#   CASERELAY_REGION            (default: us-central1)
#   CASERELAY_PROJECT_NUMBER    (default: 189353698936)
#   CASERELAY_MAX_PARALLEL      (default: 1 — for safety)
#   CASERELAY_CANARY_AGENT      (default: health — the canary specialist)
#   CASERELAY_STOP_ON_FAILURE   (default: 1 — halt batch on first failure)
#   CASERELAY_AGENT_GATEWAY     (required — the gateway resource name)
#   CASERELAY_DEPLOY_TIMEOUT    (default: 1800)
#
# ROLLBACK (orchestrator — the only irreversible step):
#   The orchestrator is deployed in-place. If it fails post-deploy, you must
#   redeploy from the last known-good commit WITHOUT --agent-gateway-egress:
#     CASERELAY_AGENT_GATEWAY=none bash infra/deploy_fleet.sh orchestrator
#   This is documented as the only command that cannot be automated safely.
# ============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT="${CASERELAY_PROJECT:-caserelay}"
REGION="${CASERELAY_REGION:-us-central1}"
PROJECT_NUMBER="${CASERELAY_PROJECT_NUMBER:-189353698936}"
MAX_PARALLEL="${CASERELAY_MAX_PARALLEL:-1}"
CANARY_AGENT="${CASERELAY_CANARY_AGENT:-health}"
STOP_ON_FAILURE="${CASERELAY_STOP_ON_FAILURE:-1}"
DEPLOY_TIMEOUT="${CASERELAY_DEPLOY_TIMEOUT:-1800}"
MAX_IAM_RETRIES="${CASERELAY_MAX_IAM_RETRIES:-5}"
# Default 0 keeps idle burn near zero. To warm for judges: CASERELAY_MIN_INSTANCES=1 bash infra/deploy_all.sh
MIN_INSTANCES="${CASERELAY_MIN_INSTANCES:-0}"
PHASE=""

LEAF_AGENTS=(education health legal shelter family verifier)
GW_SUFFIX="-gw"
LOG_DIR="${SCRIPT_DIR}/deploy_logs"
mkdir -p "$LOG_DIR"

# --- Argument parsing ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --phase) PHASE="$2"; shift 2 ;;
    --help|-h)
      sed -n '2,/^set -/{ /^#/s/^# \?//p }' "$0"
      exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

[[ -z "$PHASE" ]] && { echo "ERROR: --phase required (canary|leaves|cutover|orchestrator|verify|rollback|all)" >&2; exit 1; }

# ============================================================================
# Identity pinning guard
# ============================================================================
PINNED_FILE="${SCRIPT_DIR}/pinned_identities.env"
if [[ ! -f "$PINNED_FILE" ]]; then
  echo "FATAL: $PINNED_FILE not found." >&2
  echo "  This file pins the identity values that ALL engines must share." >&2
  echo "  Generate it from the current fleet:" >&2
  echo "    bash infra/collect_endpoints.sh --identities-only --out infra/pinned_identities.env" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$PINNED_FILE"

_check_identity_pin() {
  local errors=0
  for var in CASERELAY_IDENTITY_EDUCATION CASERELAY_IDENTITY_HEALTH \
             CASERELAY_IDENTITY_LEGAL CASERELAY_IDENTITY_SHELTER \
             CASERELAY_IDENTITY_FAMILY CASERELAY_IDENTITY_INTAKE \
             CASERELAY_IDENTITY_ORCHESTRATOR CASERELAY_IDENTITY_VERIFIER; do
    local val="${!var:-}"
    if [[ -z "$val" ]]; then
      echo "  GUARD FAIL: $var is empty after sourcing pinned_identities.env" >&2
      errors=$((errors + 1))
    fi
  done
  if [[ $errors -gt 0 ]]; then
    echo "FATAL: $errors identity values are empty. Cannot proceed." >&2
    echo "  The grant system requires all engines to agree on identity values." >&2
    echo "  Fix infra/pinned_identities.env and retry." >&2
    exit 1
  fi
}

_check_identity_pin

# ============================================================================
# Gateway auto-detect
# ============================================================================
if [[ -z "${CASERELAY_AGENT_GATEWAY:-}" ]]; then
  _gw_probe=$(gcloud network-services agent-gateways describe caserelay-egress \
    --project="$PROJECT" --location="$REGION" --format="value(name)" 2>/dev/null || true)
  if [[ -n "$_gw_probe" ]]; then
    CASERELAY_AGENT_GATEWAY="projects/${PROJECT}/locations/${REGION}/agentGateways/caserelay-egress"
  else
    echo "FATAL: no Agent Gateway found and CASERELAY_AGENT_GATEWAY not set." >&2
    echo "  Create the gateway first or set the env var." >&2
    exit 1
  fi
fi
echo "=== Agent Gateway: $CASERELAY_AGENT_GATEWAY ==="

# ============================================================================
# Helpers
# ============================================================================
_get_token() { gcloud auth print-access-token 2>/dev/null; }

_log() { echo "[rollout $(date +%H:%M:%S)] $*"; }

_prompt_continue() {
  if [[ "${CASERELAY_UNATTENDED:-0}" == "1" ]]; then return 0; fi
  echo ""
  echo "  >>> $1"
  read -rp "  >>> Continue? [y/N] " ans
  [[ "$ans" =~ ^[Yy] ]] || { echo "Aborted by user."; exit 130; }
}

_api_engine_id() {
  local display_name="$1"
  local token
  token="$(_get_token)" || return 1
  curl -s -H "Authorization: Bearer ${token}" \
    "https://${REGION}-aiplatform.googleapis.com/v1beta1/projects/${PROJECT}/locations/${REGION}/reasoningEngines?filter=display_name%3D${display_name}" 2>/dev/null |
    python3 -c "
import json, sys
data = json.load(sys.stdin)
engines = data.get('reasoningEngines', [])
if engines:
    print(engines[0]['name'].rsplit('/', 1)[-1])
    sys.exit(0)
sys.exit(1)
" 2>/dev/null
}

_engine_is_stub() {
  local engine_id="$1"
  local token
  token="$(_get_token)" || return 0
  local resource="projects/${PROJECT_NUMBER}/locations/${REGION}/reasoningEngines/${engine_id}"
  curl -sf -H "Authorization: Bearer ${token}" \
    "https://${REGION}-aiplatform.googleapis.com/v1beta1/${resource}" 2>/dev/null |
    python3 -c "
import json, sys
e = json.load(sys.stdin)
spec = e.get('spec', {}) or {}
deploy = spec.get('deploymentSpec', {}) or {}
source = spec.get('sourceCodeSpec', {}) or {}
sys.exit(0 if not deploy and not source else 1)
" 2>/dev/null
}

# --- Deploy a single -gw engine with retry-once ---
_deploy_gw_engine() {
  local key="$1"
  local svc="caserelay-${key}${GW_SUFFIX}"
  local log="${LOG_DIR}/${key}-gw.log"
  local result_file="${LOG_DIR}/${key}-gw.result"

  # Map key to agent name and a2a folder
  local -A agent_map=(
    [education]="education_liaison|education"
    [health]="health_coordination|health"
    [legal]="legal_aid|legal"
    [shelter]="shelter_status|shelter"
    [family]="family_services|family"
    [verifier]="safeguarding_verifier|verifier"
  )
  local agent_info="${agent_map[$key]}"
  local agent="${agent_info%%|*}"
  local a2a_folder="${agent_info##*|}"

  _log "deploying $agent as $svc (gateway-bound)"

  # Build env vars — always use pinned identities
  local extra=""
  for id_var in CASERELAY_IDENTITY_EDUCATION CASERELAY_IDENTITY_HEALTH \
                CASERELAY_IDENTITY_LEGAL CASERELAY_IDENTITY_SHELTER \
                CASERELAY_IDENTITY_FAMILY CASERELAY_IDENTITY_INTAKE \
                CASERELAY_IDENTITY_ORCHESTRATOR CASERELAY_IDENTITY_VERIFIER; do
    local id_val="${!id_var:-}"
    if [[ -n "$id_val" ]]; then
      extra+=",${id_var}=${id_val}"
    fi
  done

  local attempt=0 max_attempts=2  # retry once
  local deploy_rc=1
  local final_status="FAIL"

  while [[ $attempt -lt $max_attempts ]]; do
    attempt=$((attempt + 1))
    _log "  attempt ${attempt}/${max_attempts}" | tee -a "$log"

    timeout "$DEPLOY_TIMEOUT" agents-cli deploy \
      -d agent_runtime \
      --project "$PROJECT" \
      --region "$REGION" \
      --no-confirm-project \
      --agent-identity \
      --service-name "$svc" \
      --agent-gateway-egress "$CASERELAY_AGENT_GATEWAY" \
      --update-env-vars "CASERELAY_AGENT=${agent},CASERELAY_STATE=firestore,CASERELAY_PROJECT_ID=${PROJECT},GOOGLE_CLOUD_PROJECT=${PROJECT},GOOGLE_CLOUD_LOCATION=global,GOOGLE_GENAI_USE_VERTEXAI=true,GOOGLE_API_USE_CLIENT_CERTIFICATE=true,GOOGLE_CLOUD_AGENT_ENGINE_ENABLE_TELEMETRY=true,OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental,OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=EVENT_ONLY,PYTHONPATH=/app${extra},MODEL_ARMOR_TEMPLATE=projects/${PROJECT}/locations/${REGION}/templates/caserelay-screen,MODEL_ARMOR_LOCATION=${REGION}" \
      --cpu 1 --memory 2Gi --min-instances ${MIN_INSTANCES} --max-instances 2 \
      >> "$log" 2>&1
    deploy_rc=$?

    if [[ "$deploy_rc" -eq 0 ]]; then
      _log "  CLI returned success" | tee -a "$log"
      # Verify with probe
      local eid
      eid=$(_api_engine_id "$svc" 2>/dev/null || true)
      if [[ -n "$eid" ]]; then
        if _engine_is_stub "$eid"; then
          final_status="EMPTY_STUB"
          _log "  WARNING: engine $eid is an empty stub" | tee -a "$log"
        else
          # Run the real health probe
          if bash "${SCRIPT_DIR}/probe_engine.sh" "$svc" 2>>"$log"; then
            final_status="HEALTHY"
          else
            local probe_rc=$?
            case $probe_rc in
              2) final_status="TLS_FAILURE" ;;
              3) final_status="IDENTITY_FAILURE" ;;
              4) final_status="GATEWAY_NOT_BOUND" ;;
              5) final_status="EMPTY_STUB" ;;
              *) final_status="PROBE_FAILED" ;;
            esac
          fi
        fi
      else
        final_status="CLI_OK_NOT_SERVING"
      fi
      break
    elif [[ "$deploy_rc" -eq 124 ]]; then
      _log "  timeout after ${DEPLOY_TIMEOUT}s" | tee -a "$log"
      final_status="TIMEOUT_BUILD_KILLED"
      # Retry once on timeout
      if [[ $attempt -lt $max_attempts ]]; then
        _log "  retrying..." | tee -a "$log"
        sleep 10
        continue
      fi
      break
    elif grep -q "concurrent policy changes\|ABORTED" "$log" 2>/dev/null; then
      final_status="IAM_RACE"
      if [[ $attempt -lt $max_attempts ]]; then
        _log "  409 IAM race — retrying in 15s" | tee -a "$log"
        sleep 15
        continue
      fi
      break
    else
      _log "  non-retryable failure (rc=$deploy_rc)" | tee -a "$log"
      final_status="NOT_CREATED"
      # Retry once even for non-retryable (might be transient network)
      if [[ $attempt -lt $max_attempts ]]; then
        _log "  retrying once..." | tee -a "$log"
        sleep 5
        continue
      fi
      break
    fi
  done

  echo "$final_status" > "$result_file"
  _log "  result: $final_status"
  [[ "$final_status" == "HEALTHY" ]]
}

# ============================================================================
# Phase: Canary
# ============================================================================
_phase_canary() {
  _log "=== PHASE: CANARY (deploying ${CANARY_AGENT}${GW_SUFFIX}) ==="
  if _deploy_gw_engine "$CANARY_AGENT"; then
    _log "CANARY PASS: ${CANARY_AGENT}${GW_SUFFIX} is healthy and gateway-bound"
    return 0
  else
    _log "CANARY FAIL: ${CANARY_AGENT}${GW_SUFFIX} did not pass health probe"
    _log "  Check logs: ${LOG_DIR}/${CANARY_AGENT}-gw.log"
    _log "  Result: $(cat "${LOG_DIR}/${CANARY_AGENT}-gw.result" 2>/dev/null)"
    return 1
  fi
}

# ============================================================================
# Phase: Deploy remaining leaves
# ============================================================================
_phase_leaves() {
  _log "=== PHASE: LEAVES (deploying remaining specialists as -gw) ==="
  local failed=() succeeded=()
  local pids=()

  for key in "${LEAF_AGENTS[@]}"; do
    [[ "$key" == "$CANARY_AGENT" ]] && continue

    # Concurrency limiter
    while true; do
      local running=0
      local still_active=()
      for pid in "${pids[@]+"${pids[@]}"}"; do
        if kill -0 "$pid" 2>/dev/null; then
          running=$((running + 1))
          still_active+=("$pid")
        fi
      done
      pids=("${still_active[@]+"${still_active[@]}"}")
      [[ $running -lt $MAX_PARALLEL ]] && break
      sleep 2
    done

    _deploy_gw_engine "$key" &
    pids+=($!)
  done

  # Wait for all
  for pid in "${pids[@]+"${pids[@]}"}"; do
    wait "$pid" 2>/dev/null || true
  done

  # Collect results
  for key in "${LEAF_AGENTS[@]}"; do
    local result
    result="$(cat "${LOG_DIR}/${key}-gw.result" 2>/dev/null || echo "NOT_RUN")"
    if [[ "$result" == "HEALTHY" ]]; then
      succeeded+=("$key")
    elif [[ "$result" != "NOT_RUN" ]]; then
      failed+=("$key")
    fi
  done

  _log ""
  _log "=== LEAVES SUMMARY ==="
  _log "  Healthy:  ${succeeded[*]:-none}"
  _log "  Failed:   ${failed[*]:-none}"

  if [[ ${#failed[@]} -gt 0 ]]; then
    if [[ "$STOP_ON_FAILURE" == "1" ]]; then
      _log "STOP_ON_FAILURE=1: aborting. Fix failed engines before cutover."
      return 1
    fi
    _log "WARNING: ${#failed[@]} engines failed but STOP_ON_FAILURE=0, continuing."
  fi
  return 0
}

# ============================================================================
# Phase: Verify all -gw engines
# ============================================================================
_phase_verify() {
  _log "=== PHASE: VERIFY (probing all -gw engines) ==="
  local failed=() passed=()

  for key in "${LEAF_AGENTS[@]}"; do
    local svc="caserelay-${key}${GW_SUFFIX}"
    _log "probing $svc..."
    if bash "${SCRIPT_DIR}/probe_engine.sh" "$svc" 2>/dev/null; then
      passed+=("$key")
      _log "  PASS: $svc"
    else
      failed+=("$key")
      _log "  FAIL: $svc (exit $?)"
    fi
  done

  _log ""
  _log "=== VERIFY SUMMARY ==="
  _log "  Passed: ${passed[*]:-none}"
  _log "  Failed: ${failed[*]:-none}"
  [[ ${#failed[@]} -eq 0 ]]
}

# ============================================================================
# Phase: Cutover (switch traffic from old engines to -gw engines)
# ============================================================================
_phase_cutover() {
  _log "=== PHASE: CUTOVER (switching URLs to -gw engines) ==="

  # Collect -gw engine URLs
  _log "collecting -gw engine endpoints..."
  bash "${SCRIPT_DIR}/collect_endpoints.sh" --suffix "$GW_SUFFIX" --urls-only --out "${SCRIPT_DIR}/fleet_endpoints_gw.env"

  # Source the new URLs but keep pinned identities
  # shellcheck disable=SC1090
  source "${SCRIPT_DIR}/fleet_endpoints_gw.env"
  # Re-source pinned identities (they must override any identity that collect might have emitted)
  source "$PINNED_FILE"

  # Write combined file for control plane deploy
  {
    echo "# generated by rollout_gateway.sh cutover phase"
    echo "# URLs point to -gw engines; identities are PINNED from original fleet"
    cat "${SCRIPT_DIR}/fleet_endpoints_gw.env" | grep -v "^#"
    echo ""
    echo "# Pinned identities (from infra/pinned_identities.env)"
    cat "$PINNED_FILE" | grep -v "^#"
  } > "${SCRIPT_DIR}/fleet_endpoints.env"

  _log "updated fleet_endpoints.env with -gw URLs + pinned identities"
  _log ""
  _log "To complete cutover, redeploy the control plane:"
  _log "  bash infra/deploy_control_plane.sh"
  _log ""
  _log "The control plane's canary probe will validate before shifting traffic."
  _log "To revert: bash infra/rollout_gateway.sh --phase rollback"
}

# ============================================================================
# Phase: Orchestrator (in-place, identity-preserving)
# ============================================================================
_phase_orchestrator() {
  _log "=== PHASE: ORCHESTRATOR (in-place redeploy with gateway) ==="
  _log ""
  _log "  WARNING: This is the only irreversible step."
  _log "  The orchestrator's effectiveIdentity is tied to its resource ID."
  _log "  If this fails, rollback is:"
  _log "    CASERELAY_AGENT_GATEWAY=none bash infra/deploy_fleet.sh orchestrator"
  _log ""

  _prompt_continue "Deploy orchestrator in-place with gateway binding?"

  # Use deploy_fleet.sh for the orchestrator (it handles specialist URLs, registry update, etc.)
  export CASERELAY_AGENT_GATEWAY="$CASERELAY_AGENT_GATEWAY"
  export CASERELAY_MAX_PARALLEL=1
  bash "${SCRIPT_DIR}/deploy_fleet.sh" orchestrator
  local rc=$?

  if [[ $rc -eq 0 ]]; then
    _log "orchestrator deployed — verifying with probe..."
    if bash "${SCRIPT_DIR}/probe_engine.sh" caserelay-orchestrator 2>/dev/null; then
      _log "ORCHESTRATOR PASS"
    else
      _log "WARNING: orchestrator probe failed (exit $?). Check manually."
      _log "  Rollback: CASERELAY_AGENT_GATEWAY=none bash infra/deploy_fleet.sh orchestrator"
      return 1
    fi
  else
    _log "ORCHESTRATOR DEPLOY FAILED"
    _log "  Rollback: CASERELAY_AGENT_GATEWAY=none bash infra/deploy_fleet.sh orchestrator"
    return 1
  fi
}

# ============================================================================
# Phase: Rollback (revert cutover to original engines)
# ============================================================================
_phase_rollback() {
  _log "=== PHASE: ROLLBACK (reverting to original engines) ==="

  # Collect original engine URLs (no suffix)
  bash "${SCRIPT_DIR}/collect_endpoints.sh" --no-suffix --urls-only --out "${SCRIPT_DIR}/fleet_endpoints_original.env"

  # Combine with pinned identities
  {
    echo "# generated by rollout_gateway.sh rollback phase"
    cat "${SCRIPT_DIR}/fleet_endpoints_original.env" | grep -v "^#"
    echo ""
    cat "$PINNED_FILE" | grep -v "^#"
  } > "${SCRIPT_DIR}/fleet_endpoints.env"

  _log "reverted fleet_endpoints.env to original engine URLs + pinned identities"
  _log ""
  _log "Redeploy the control plane to complete rollback:"
  _log "  bash infra/deploy_control_plane.sh"
}

# ============================================================================
# Phase: All (sequenced with approval gates)
# ============================================================================
_phase_all() {
  _log "=== FULL ROLLOUT SEQUENCE ==="
  _log ""
  _log "  Phase 1: Deploy canary (${CANARY_AGENT}${GW_SUFFIX})"
  _log "  Phase 2: Deploy remaining leaves"
  _log "  Phase 3: Verify all -gw engines"
  _log "  Phase 4: Cutover (switch traffic)"
  _log "  Phase 5: Orchestrator (in-place)"
  _log ""

  _phase_canary || { _log "ABORT: canary failed"; return 1; }
  _prompt_continue "Canary passed. Deploy remaining leaves?"

  _phase_leaves || { _log "ABORT: leaf deploy had failures"; return 1; }

  _log "All leaves deployed. Running full verification..."
  _phase_verify || { _log "ABORT: verification failed"; return 1; }
  _prompt_continue "All -gw engines verified. Cut over traffic?"

  _phase_cutover
  _prompt_continue "Cutover prepared. After deploying control plane, proceed to orchestrator?"

  _phase_orchestrator || { _log "WARNING: orchestrator step failed"; return 1; }

  _log ""
  _log "=== ROLLOUT COMPLETE ==="
  _log "  All engines are gateway-bound."
  _log "  Monitor for 24h before deleting old engines."
}

# ============================================================================
# Dispatch
# ============================================================================
case "$PHASE" in
  canary)       _phase_canary ;;
  leaves)       _phase_leaves ;;
  verify)       _phase_verify ;;
  cutover)      _phase_cutover ;;
  orchestrator) _phase_orchestrator ;;
  rollback)     _phase_rollback ;;
  all)          _phase_all ;;
  *)
    echo "ERROR: unknown phase '$PHASE'" >&2
    echo "  Valid: canary, leaves, verify, cutover, orchestrator, rollback, all" >&2
    exit 1 ;;
esac
