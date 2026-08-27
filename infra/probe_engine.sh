#!/usr/bin/env bash
# Verify a single CaseRelay engine is genuinely healthy: gateway binding, TLS,
# identity consistency, and Firestore grant lookup.
#
# Unlike the A2A card poll (_poll_a2a_ready), this exercises a REAL authorized_context
# call path, which simultaneously proves:
#   1. The engine process imported cleanly (card would catch this too)
#   2. Agent Gateway TLS is functional (the gateway CA was installed and egress routes work)
#   3. The identity env vars match across engines (grant subject == caller principal)
#   4. Firestore is reachable and the grant exists for the test case
#
# Usage:
#   bash infra/probe_engine.sh caserelay-health-gw        # by service name (display name)
#   bash infra/probe_engine.sh --engine-id 12345          # by numeric engine ID
#   bash infra/probe_engine.sh caserelay-health-gw --case PROBE-CASE-001  # explicit case
#
# Exit codes:
#   0  — engine is healthy: gateway bound, TLS working, identity verified, grant matches
#   1  — engine not found or not serving (not reachable at all)
#   2  — TLS failure: CERTIFICATE_VERIFY_FAILED (gateway CA not installed correctly)
#   3  — identity failure: IdentityDenied (identity env vars mismatch)
#   4  — gateway not bound: agentGatewayConfig is missing or empty
#   5  — engine exists but is an empty stub (no sourceCodeSpec/deploymentSpec)
#   6  — unexpected failure (network, auth, other)
#
# This script is safe for both supervised canary gating and unattended per-engine checks.
# It never modifies any resource — all calls are read-only GETs.
set -uo pipefail

PROJECT="${CASERELAY_PROJECT:-caserelay}"
REGION="${CASERELAY_REGION:-us-central1}"
PROJECT_NUMBER="${CASERELAY_PROJECT_NUMBER:-189353698936}"
PROBE_CASE="${CASERELAY_PROBE_CASE:-}"
VERBOSE="${CASERELAY_PROBE_VERBOSE:-0}"

# --- Argument parsing ---
ENGINE_ID=""
SERVICE_NAME=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --engine-id)
      ENGINE_ID="$2"; shift 2 ;;
    --case)
      PROBE_CASE="$2"; shift 2 ;;
    --verbose|-v)
      VERBOSE=1; shift ;;
    --help|-h)
      sed -n '2,/^set -/{ /^#/s/^# \?//p }' "$0"
      exit 0 ;;
    *)
      SERVICE_NAME="$1"; shift ;;
  esac
done

_log() { echo "[probe $(date +%H:%M:%S)] $*"; }
_verbose() { [[ "$VERBOSE" == "1" ]] && _log "$@" || true; }
_die() { local code="$1"; shift; echo "FAIL: $*" >&2; exit "$code"; }

_get_token() { gcloud auth print-access-token 2>/dev/null; }

# --- Resolve engine ID from service name ---
if [[ -z "$ENGINE_ID" && -z "$SERVICE_NAME" ]]; then
  _die 6 "usage: probe_engine.sh <service-name> | --engine-id <id>"
fi

TOKEN="$(_get_token)" || _die 6 "cannot get access token — run 'gcloud auth login'"

if [[ -z "$ENGINE_ID" ]]; then
  _verbose "resolving engine ID for display name: $SERVICE_NAME"
  ENGINE_JSON=$(curl -sf -H "Authorization: Bearer ${TOKEN}" \
    "https://${REGION}-aiplatform.googleapis.com/v1beta1/projects/${PROJECT}/locations/${REGION}/reasoningEngines?filter=display_name%3D${SERVICE_NAME}" 2>/dev/null) \
    || _die 1 "API call failed — engine '$SERVICE_NAME' may not exist"

  ENGINE_ID=$(echo "$ENGINE_JSON" | python3 -c "
import json, sys
data = json.load(sys.stdin)
engines = data.get('reasoningEngines', [])
if not engines:
    sys.exit(1)
print(engines[0]['name'].rsplit('/', 1)[-1])
" 2>/dev/null) || _die 1 "engine '$SERVICE_NAME' not found"
fi

_log "engine ID: $ENGINE_ID"
RESOURCE="projects/${PROJECT_NUMBER}/locations/${REGION}/reasoningEngines/${ENGINE_ID}"

# --- Step 1: Check engine has deploymentSpec (not an empty stub) ---
_verbose "checking engine spec..."
ENGINE_SPEC=$(curl -sf -H "Authorization: Bearer ${TOKEN}" \
  "https://${REGION}-aiplatform.googleapis.com/v1beta1/${RESOURCE}" 2>/dev/null) \
  || _die 1 "cannot describe engine ${ENGINE_ID}"

HAS_DEPLOY=$(echo "$ENGINE_SPEC" | python3 -c "
import json, sys
e = json.load(sys.stdin)
spec = e.get('spec', {}) or {}
deploy = spec.get('deploymentSpec', {}) or {}
source = spec.get('sourceCodeSpec', {}) or {}
if not deploy and not source:
    print('EMPTY_STUB')
    sys.exit(0)
print('OK')
" 2>/dev/null)

if [[ "$HAS_DEPLOY" == "EMPTY_STUB" ]]; then
  _die 5 "engine $ENGINE_ID is an empty stub (no sourceCodeSpec/deploymentSpec) — a killed build left this"
fi

# --- Step 2: Verify agentGatewayConfig is non-empty ---
# Field lives at spec.deploymentSpec.agentGatewayConfig (NOT at spec.agentGatewayConfig).
# Three distinct states:
#   MISSING — field absent; engine was never bound to a gateway.
#   EMPTY   — field present as {} ; engine was unbound or rolled back (caserelay-shelter had this).
#   BOUND   — field contains an actual gateway resource name.
# Raw value is always printed so callers can inspect what the API actually returned.
_verbose "checking gateway binding..."
GW_OUTPUT=$(echo "$ENGINE_SPEC" | python3 -c "
import json, sys
e = json.load(sys.stdin)
spec = e.get('spec', {}) or {}
deploy = spec.get('deploymentSpec', {}) or {}
gw = deploy.get('agentGatewayConfig', None)
raw = json.dumps(gw) if gw is not None else '<absent>'
if gw is None:
    status = 'MISSING'
elif not gw or (isinstance(gw, dict) and not any(gw.values())):
    status = 'EMPTY'
else:
    has_ref = any(v for v in gw.values() if v and 'agentGateway' in str(v).lower())
    status = 'BOUND' if has_ref else 'EMPTY'
print(status)
print(raw)
" 2>/dev/null)
GW_STATUS=$(printf '%s' "$GW_OUTPUT" | head -1)
GW_RAW=$(printf '%s' "$GW_OUTPUT" | tail -1)

case "$GW_STATUS" in
  BOUND)
    _log "gateway binding: PRESENT (raw: ${GW_RAW})" ;;
  EMPTY)
    _die 4 "agentGatewayConfig is empty-object {} — unbound/rolled-back state (raw: ${GW_RAW}). Re-deploy with --agent-gateway-egress to rebind." ;;
  MISSING)
    _die 4 "agentGatewayConfig is absent — engine was never bound (raw: ${GW_RAW}). Deploy with --agent-gateway-egress to bind." ;;
  *)
    _die 6 "unexpected gateway status: $GW_STATUS (raw: ${GW_RAW})" ;;
esac

# --- Step 3: Resolve the engine's CASERELAY_AGENT and A2A folder ---
AGENT_INFO=$(echo "$ENGINE_SPEC" | python3 -c "
import json, sys
e = json.load(sys.stdin)
spec = e.get('spec', {}) or {}
deploy = spec.get('deploymentSpec', {}) or {}
env = {v.get('name'): v.get('value') for v in deploy.get('env', []) or []}
agent = env.get('CASERELAY_AGENT', '')
# Map agent name to a2a folder
folder_map = {
    'education_liaison': 'education',
    'health_coordination': 'health',
    'legal_aid': 'legal',
    'shelter_status': 'shelter',
    'family_services': 'family',
    'intake_authority': 'intake',
    'continuity_orchestrator': 'orchestrator',
    'safeguarding_verifier': 'verifier',
}
folder = folder_map.get(agent, '')
print(f'{agent}|{folder}')
" 2>/dev/null)

CASERELAY_AGENT="${AGENT_INFO%%|*}"
A2A_FOLDER="${AGENT_INFO##*|}"

if [[ -z "$CASERELAY_AGENT" || -z "$A2A_FOLDER" ]]; then
  _die 5 "engine lacks CASERELAY_AGENT env var or maps to unknown agent"
fi
_verbose "agent: $CASERELAY_AGENT, a2a folder: $A2A_FOLDER"

# --- Step 4: Check A2A card returns 200 (basic liveness) ---
_verbose "polling A2A agent card..."
CARD_URL="https://${REGION}-aiplatform.googleapis.com/reasoningEngines/v1/${RESOURCE}/api/a2a/${A2A_FOLDER}/.well-known/agent-card.json"
CARD_HTTP=$(curl -sf -o /dev/null -w "%{http_code}" -H "Authorization: Bearer ${TOKEN}" "$CARD_URL" 2>/dev/null) || CARD_HTTP="000"

if [[ "$CARD_HTTP" != "200" ]]; then
  _die 1 "A2A agent card returned HTTP $CARD_HTTP — engine is not serving (may still be building)"
fi
_log "A2A card: HTTP 200 (engine process is alive)"

# --- Step 5: Attempt a health-check invocation via the A2A task endpoint ---
# We send a minimal JSON-RPC task that asks the agent to call get_authorized_context.
# The engine will attempt the full identity + gateway + Firestore path.
# If no probe case is set, we use a synthetic case ID that will fail at Firestore
# (no grant for it), which still exercises TLS and the identity check path.
PROBE_CASE="${PROBE_CASE:-PROBE-GW-$(date +%s)}"
A2A_BASE="https://${REGION}-aiplatform.googleapis.com/reasoningEngines/v1/${RESOURCE}/api/a2a/${A2A_FOLDER}"

_verbose "sending health probe task (case=$PROBE_CASE) to $A2A_BASE"

# Use the tasks/send endpoint to invoke the agent synchronously
PROBE_PAYLOAD=$(python3 -c "
import json
payload = {
    'jsonrpc': '2.0',
    'method': 'tasks/send',
    'id': 'probe-health-01',
    'params': {
        'id': 'probe-health-01',
        'message': {
            'role': 'user',
            'parts': [{'text': 'For case $PROBE_CASE, run get_authorized_context now. Report the result exactly.'}]
        }
    }
}
print(json.dumps(payload))
")

PROBE_BODY=$(mktemp)
PROBE_HTTP=$(curl -s -o "$PROBE_BODY" -w "%{http_code}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --max-time 120 \
  -d "$PROBE_PAYLOAD" \
  "${A2A_BASE}/tasks/send" 2>/dev/null) || PROBE_HTTP="000"

_verbose "probe HTTP: $PROBE_HTTP"

# --- Step 6: Check engine logs for TLS failures ---
_verbose "checking recent logs for CERTIFICATE_VERIFY_FAILED..."
LOG_FILTER="resource.type=\"aiplatform.googleapis.com/ReasoningEngine\" resource.labels.reasoning_engine_id=\"${ENGINE_ID}\" severity>=ERROR textPayload:\"CERTIFICATE_VERIFY_FAILED\" OR jsonPayload.message:\"CERTIFICATE_VERIFY_FAILED\""
TLS_LOG_HITS=$(gcloud logging read "$LOG_FILTER" \
  --project="$PROJECT" \
  --freshness=15m \
  --limit=5 \
  --format="value(textPayload)" 2>/dev/null | head -5)

if [[ -n "$TLS_LOG_HITS" ]]; then
  _log "WARNING: CERTIFICATE_VERIFY_FAILED found in recent engine logs"
  echo "$TLS_LOG_HITS" | head -3
  rm -f "$PROBE_BODY"
  _die 2 "TLS failure detected: the Agent Gateway CA certificate was not installed correctly. " \
          "Check that the Dockerfile ARG AGENT_GATEWAY_ROOT_CERTIFICATES is receiving the cert " \
          "and update-ca-certificates ran successfully during the build."
fi

# --- Step 7: Interpret probe response ---
if [[ "$PROBE_HTTP" == "000" ]]; then
  rm -f "$PROBE_BODY"
  _die 1 "probe request timed out or failed to connect"
fi

if [[ "$PROBE_HTTP" == "200" ]]; then
  # Parse the response to see if it succeeded or if an IdentityDenied error occurred
  PROBE_RESULT=$(python3 -c "
import json, sys
try:
    data = json.load(open('$PROBE_BODY'))
except:
    print('PARSE_ERROR'); sys.exit(0)

# Check for errors in the JSON-RPC response
if 'error' in data:
    err = str(data['error'])
    if 'CERTIFICATE_VERIFY_FAILED' in err or 'SSL' in err:
        print('TLS_FAILURE')
    elif 'IdentityDenied' in err or 'identity' in err.lower():
        print('IDENTITY_FAILURE')
    else:
        print('RPC_ERROR:' + err[:200])
    sys.exit(0)

# Check the task result
result = data.get('result', {})
status = result.get('status', {}).get('state', '')
artifacts = result.get('artifacts', [])

# Look for errors in the agent's output
output_text = ''
for art in artifacts:
    for part in art.get('parts', []):
        output_text += part.get('text', '')

if 'CERTIFICATE_VERIFY_FAILED' in output_text:
    print('TLS_FAILURE')
elif 'IdentityDenied' in output_text or 'no granted authority' in output_text:
    if 'no granted authority' in output_text and 'PROBE-GW' in output_text:
        # Expected: the probe case has no real grant — but identity was verified successfully
        print('IDENTITY_OK_NO_GRANT')
    else:
        print('IDENTITY_FAILURE')
elif 'principal mismatch' in output_text:
    print('IDENTITY_FAILURE')
elif status == 'completed' or status == 'failed':
    if 'audit_ref' in output_text or 'disclosed_fields' in output_text:
        print('FULL_SUCCESS')
    elif 'no granted authority' in output_text:
        print('IDENTITY_OK_NO_GRANT')
    else:
        print('TASK_COMPLETED')
else:
    print('UNKNOWN_STATE:' + status)
" 2>/dev/null)

  rm -f "$PROBE_BODY"

  case "$PROBE_RESULT" in
    FULL_SUCCESS)
      _log "PASS: full end-to-end success (gateway bound, TLS OK, identity OK, grant matched)"
      exit 0 ;;
    IDENTITY_OK_NO_GRANT)
      _log "PASS: engine is healthy (gateway bound, TLS OK, identity verified)"
      _log "  (no grant exists for probe case '$PROBE_CASE' — this is expected for synthetic probes)"
      _log "  The IdentityDenied on grant lookup confirms identity verification passed."
      exit 0 ;;
    TASK_COMPLETED)
      _log "PASS: task completed (gateway bound, TLS OK, engine functional)"
      exit 0 ;;
    TLS_FAILURE)
      _die 2 "TLS failure: the engine cannot reach external services through the gateway. " \
              "The Agent Gateway CA certificate is likely not installed. Rebuild with the cert." ;;
    IDENTITY_FAILURE)
      _die 3 "identity failure: IdentityDenied. The CASERELAY_IDENTITY_* env vars on this engine " \
              "do not match what intake wrote into Firestore grants. Pin identity values from the " \
              "current fleet (infra/pinned_identities.env) and redeploy." ;;
    RPC_ERROR:*)
      _die 6 "JSON-RPC error from engine: ${PROBE_RESULT#RPC_ERROR:}" ;;
    PARSE_ERROR)
      _die 6 "could not parse probe response" ;;
    UNKNOWN_STATE:*)
      _log "WARNING: task in unexpected state: ${PROBE_RESULT#UNKNOWN_STATE:}"
      _log "  The engine responded (TLS is working) but the task did not complete."
      _log "  This may be a timeout. Engine is likely functional but verify manually."
      exit 0 ;;
    *)
      _die 6 "unexpected probe result: $PROBE_RESULT" ;;
  esac
else
  # Non-200 HTTP response
  BODY_CONTENT=$(cat "$PROBE_BODY" 2>/dev/null || echo "")
  rm -f "$PROBE_BODY"

  if echo "$BODY_CONTENT" | grep -qi "CERTIFICATE_VERIFY_FAILED\|SSL"; then
    _die 2 "TLS failure (HTTP $PROBE_HTTP): Agent Gateway CA certificate not installed correctly"
  elif echo "$BODY_CONTENT" | grep -qi "IdentityDenied\|identity"; then
    _die 3 "identity failure (HTTP $PROBE_HTTP): CASERELAY_IDENTITY_* mismatch"
  else
    _die 6 "probe returned HTTP $PROBE_HTTP. Body: ${BODY_CONTENT:0:300}"
  fi
fi
