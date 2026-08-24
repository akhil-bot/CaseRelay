#!/usr/bin/env bash
# Deploy the CaseRelay fleet to GEAP Agent Runtime with agent identity enabled.
# Each engine gets its own platform-managed identity (--agent-identity), replacing the
# hand-made service accounts that were previously bound via --service-account.
#
#   ./infra/deploy_fleet.sh                 # deploy all agents
#   ./infra/deploy_fleet.sh health legal    # deploy a subset
set -uo pipefail

PROJECT="${CASERELAY_PROJECT:-caserelay}"
REGION="${CASERELAY_REGION:-us-central1}"

# key | agent name
AGENTS=(
  "education|education_liaison"
  "health|health_coordination"
  "legal|legal_aid"
  "shelter|shelter_status"
  "family|family_services"
  "verifier|safeguarding_verifier"
  "intake|intake_authority"
  "orchestrator|continuity_orchestrator"
)

targets=("$@")
for entry in "${AGENTS[@]}"; do
  IFS='|' read -r key agent <<<"$entry"
  if [ ${#targets[@]} -gt 0 ] && [[ ! " ${targets[*]} " =~ " ${key} " ]]; then
    continue
  fi

  extra=""
  self_url_var="CASERELAY_URL_$(echo "$key" | tr '[:lower:]' '[:upper:]')"
  self_url="${!self_url_var:-}"
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

  echo "=== deploying ${agent} as caserelay-${key} (agent identity) ==="
  agents-cli deploy \
    -d agent_runtime \
    --project "$PROJECT" \
    --region "$REGION" \
    --no-confirm-project \
    --agent-identity \
    --service-name "caserelay-${key}" \
    --update-env-vars "CASERELAY_AGENT=${agent},CASERELAY_STATE=firestore,CASERELAY_PROJECT_ID=${PROJECT},GOOGLE_CLOUD_PROJECT=${PROJECT},GOOGLE_CLOUD_LOCATION=global,GOOGLE_GENAI_USE_VERTEXAI=true,PYTHONPATH=/app${extra}" \
    --cpu 1 --memory 2Gi --min-instances 1 --max-instances 2 \
    --no-wait
done
