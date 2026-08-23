#!/usr/bin/env bash
# Deploy the CaseRelay fleet to GEAP Agent Runtime: one endpoint per agent, each on its own
# service account. The same image ships every agent; CASERELAY_AGENT decides which one an
# instance exposes.
#
#   ./infra/deploy_fleet.sh                 # deploy all agents
#   ./infra/deploy_fleet.sh health legal    # deploy a subset
set -uo pipefail

PROJECT="${CASERELAY_PROJECT:-caserelay}"
REGION="${CASERELAY_REGION:-us-central1}"

# key | agent name | service account prefix
AGENTS=(
  "education|education_liaison|education-agent"
  "health|health_coordination|health-agent"
  "legal|legal_aid|legal-agent"
  "shelter|shelter_status|shelter-agent"
  "family|family_services|family-agent"
  "verifier|safeguarding_verifier|verifier-agent"
  "intake|intake_authority|intake-agent"
  "orchestrator|continuity_orchestrator|orchestrator-agent"
)

targets=("$@")
for entry in "${AGENTS[@]}"; do
  IFS='|' read -r key agent sa <<<"$entry"
  if [ ${#targets[@]} -gt 0 ] && [[ ! " ${targets[*]} " =~ " ${key} " ]]; then
    continue
  fi

  # A specialist's A2A card must advertise its own reachable URL, which only exists after the
  # first deploy — so re-run this script once infra/collect_endpoints.sh has been generated.
  extra=""
  self_url_var="CASERELAY_URL_$(echo "$key" | tr '[:lower:]' '[:upper:]')"
  self_url="${!self_url_var:-}"
  if [ -n "$self_url" ]; then
    extra=",CASERELAY_PUBLIC_URL=${self_url}"
  fi

  # The orchestrator needs its specialists' URLs; they are exported by collect_endpoints.sh.
  if [ "$key" = "orchestrator" ]; then
    extra+=",CASERELAY_URL_EDUCATION=${CASERELAY_URL_EDUCATION:-}"
    extra+=",CASERELAY_URL_HEALTH=${CASERELAY_URL_HEALTH:-}"
    extra+=",CASERELAY_URL_LEGAL=${CASERELAY_URL_LEGAL:-}"
    extra+=",CASERELAY_URL_SHELTER=${CASERELAY_URL_SHELTER:-}"
    extra+=",CASERELAY_URL_FAMILY=${CASERELAY_URL_FAMILY:-}"
    extra+=",CASERELAY_URL_VERIFIER=${CASERELAY_URL_VERIFIER:-}"
  fi

  echo "=== deploying ${agent} as caserelay-${key} ==="
  agents-cli deploy \
    -d agent_runtime \
    --project "$PROJECT" \
    --region "$REGION" \
    --no-confirm-project \
    --service-name "caserelay-${key}" \
    --service-account "${sa}@${PROJECT}.iam.gserviceaccount.com" \
    --update-env-vars "CASERELAY_AGENT=${agent},CASERELAY_STATE=firestore,CASERELAY_PROJECT_ID=${PROJECT},GOOGLE_CLOUD_PROJECT=${PROJECT},GOOGLE_CLOUD_LOCATION=global,GOOGLE_GENAI_USE_VERTEXAI=true,PYTHONPATH=/app${extra}" \
    --cpu 1 --memory 2Gi --min-instances 1 --max-instances 2 \
    --no-wait
done
