#!/usr/bin/env bash
# Grant the minimum IAM roles that Agent Identity principals need beyond what
# `agents-cli deploy --agent-identity` provisions automatically.
#
# --agent-identity gives each engine its own workload-identity principal and
# grants roles/aiplatform.user + roles/browser + the agentDefaultAccess principalSet.
# It does NOT grant access to Firestore, Cloud Trace, or Service Usage — those
# must be added explicitly.
#
# This script is idempotent and safe to re-run. It applies grants serially with
# retry-on-409 to avoid the IAM concurrent-policy-change hazard.
#
#   bash infra/grant_fleet_iam.sh                 # all engines
#   bash infra/grant_fleet_iam.sh health legal    # subset
set -uo pipefail

PROJECT="${CASERELAY_PROJECT:-caserelay}"
REGION="${CASERELAY_REGION:-us-central1}"
PROJECT_NUMBER="${CASERELAY_PROJECT_NUMBER:-189353698936}"
ORG_NUMBER="${CASERELAY_ORG_NUMBER:-126484209344}"
MAX_RETRIES="${CASERELAY_MAX_IAM_RETRIES:-5}"

FLEET_ENV="$(dirname "$0")/fleet_endpoints.env"
if [ ! -f "$FLEET_ENV" ]; then
  echo "ERROR: $FLEET_ENV not found — run infra/collect_endpoints.sh first" >&2
  exit 1
fi
source "$FLEET_ENV"

AGENTS=(
  "education|CASERELAY_IDENTITY_EDUCATION"
  "health|CASERELAY_IDENTITY_HEALTH"
  "legal|CASERELAY_IDENTITY_LEGAL"
  "shelter|CASERELAY_IDENTITY_SHELTER"
  "family|CASERELAY_IDENTITY_FAMILY"
  "verifier|CASERELAY_IDENTITY_VERIFIER"
  "intake|CASERELAY_IDENTITY_INTAKE"
  "orchestrator|CASERELAY_IDENTITY_ORCHESTRATOR"
)

ROLES=(
  "roles/datastore.user"
  "roles/serviceusage.serviceUsageConsumer"
  "roles/pubsub.publisher"
  "roles/cloudtrace.agent"
)

_grant_one() {
  local principal="$1" role="$2" name="$3"
  local attempt=0 backoff=3 max_backoff=60

  while [ $attempt -lt "$MAX_RETRIES" ]; do
    attempt=$((attempt + 1))
    output=$(gcloud projects add-iam-policy-binding "$PROJECT" \
      --member="principal://$principal" \
      --role="$role" \
      --condition=None \
      --format=json 2>&1)
    rc=$?

    if [ $rc -eq 0 ]; then
      echo "  OK: ${name} <- ${role}"
      return 0
    elif echo "$output" | grep -q "ABORTED\|concurrent policy"; then
      echo "  409 race on ${name}/${role}, retry in ${backoff}s (${attempt}/${MAX_RETRIES})"
      sleep $backoff
      local jitter=$((RANDOM % backoff))
      backoff=$(( (backoff * 2) + jitter ))
      [ $backoff -gt $max_backoff ] && backoff=$max_backoff
    else
      echo "  FAIL: ${name} <- ${role}: ${output}" | head -3
      return 1
    fi
  done
  echo "  FAIL: ${name} <- ${role} after ${MAX_RETRIES} retries"
  return 1
}

# --- main ---
targets=("$@")
ok=0; fail=0

echo "=== granting fleet IAM roles ==="

for entry in "${AGENTS[@]}"; do
  IFS='|' read -r key var_name <<<"$entry"

  if [ ${#targets[@]} -gt 0 ] && [[ ! " ${targets[*]} " =~ " ${key} " ]]; then
    continue
  fi

  identity="${!var_name:-}"
  if [ -z "$identity" ]; then
    echo "SKIP: ${key} — ${var_name} is empty (engine not deployed?)"
    continue
  fi

  echo "${key} (${identity##*/}):"
  for role in "${ROLES[@]}"; do
    if _grant_one "$identity" "$role" "$key"; then
      ok=$((ok + 1))
    else
      fail=$((fail + 1))
    fi
    sleep 1
  done
done

echo ""
echo "=== grant summary: ${ok} OK, ${fail} failed ==="
[ $fail -eq 0 ]
