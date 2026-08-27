#!/usr/bin/env bash
# Write the deployed fleet's A2A base URLs and agent identity principals to
# infra/fleet_endpoints.env.
#
# Agent Runtime exposes each container's HTTP routes under an /api passthrough, so a specialist's
# A2A base is:
#   https://{region}-aiplatform.googleapis.com/reasoningEngines/v1/{resource}/api
#
# When --agent-identity is enabled, each engine also has an effective_identity: the platform-managed
# principal that google.auth.default() returns inside the engine. These are exported as
# CASERELAY_IDENTITY_* so the gateway and grant system can match callers to grants.
#
# Source the generated file before deploying the orchestrator so it can resolve its specialists.
#
# Blue/green support:
#   --suffix <sfx>       Only collect engines whose display name ends with <sfx>.
#                        Example: --suffix "-gw" collects caserelay-health-gw but not caserelay-health.
#   --no-suffix          Only collect engines with NO suffix (the original engines).
#   --urls-only          Emit only CASERELAY_URL_* lines (no identity lines).
#   --identities-only    Emit only CASERELAY_IDENTITY_* lines.
#   --out <path>         Write to a custom path instead of infra/fleet_endpoints.env.
#
# Without any selector, the script preserves legacy behaviour: it collects all engines,
# using CASERELAY_AGENT env var (then display name) as the disambiguation key.
# If two engines claim the same agent (blue/green overlap), it prefers the NEWER one
# (higher numeric resource ID) — but you should use --suffix instead.
set -uo pipefail

PROJECT="${CASERELAY_PROJECT:-caserelay}"
REGION="${CASERELAY_REGION:-us-central1}"
SUFFIX=""
NO_SUFFIX=0
URLS_ONLY=0
IDENTITIES_ONLY=0
OUT="$(dirname "$0")/fleet_endpoints.env"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --suffix)
      SUFFIX="$2"; shift 2 ;;
    --no-suffix)
      NO_SUFFIX=1; shift ;;
    --urls-only)
      URLS_ONLY=1; shift ;;
    --identities-only)
      IDENTITIES_ONLY=1; shift ;;
    --out)
      OUT="$2"; shift 2 ;;
    --help|-h)
      sed -n '2,/^set -/{ /^#/s/^# \?//p }' "$0"
      exit 0 ;;
    *)
      echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

TOKEN="$(gcloud auth print-access-token)"

curl -s -H "Authorization: Bearer ${TOKEN}" \
  "https://${REGION}-aiplatform.googleapis.com/v1beta1/projects/${PROJECT}/locations/${REGION}/reasoningEngines" |
  REGION="$REGION" SUFFIX="$SUFFIX" NO_SUFFIX="$NO_SUFFIX" URLS_ONLY="$URLS_ONLY" IDENTITIES_ONLY="$IDENTITIES_ONLY" python3 -c '
import json, os, sys

region = os.environ["REGION"]
suffix = os.environ.get("SUFFIX", "")
no_suffix = os.environ.get("NO_SUFFIX", "0") == "1"
urls_only = os.environ.get("URLS_ONLY", "0") == "1"
identities_only = os.environ.get("IDENTITIES_ONLY", "0") == "1"

var_by_agent = {
    "education_liaison": "CASERELAY_URL_EDUCATION",
    "health_coordination": "CASERELAY_URL_HEALTH",
    "legal_aid": "CASERELAY_URL_LEGAL",
    "shelter_status": "CASERELAY_URL_SHELTER",
    "family_services": "CASERELAY_URL_FAMILY",
    "safeguarding_verifier": "CASERELAY_URL_VERIFIER",
    "intake_authority": "CASERELAY_URL_INTAKE",
    "continuity_orchestrator": "CASERELAY_URL_ORCHESTRATOR",
}
identity_by_agent = {
    "education_liaison": "CASERELAY_IDENTITY_EDUCATION",
    "health_coordination": "CASERELAY_IDENTITY_HEALTH",
    "legal_aid": "CASERELAY_IDENTITY_LEGAL",
    "shelter_status": "CASERELAY_IDENTITY_SHELTER",
    "family_services": "CASERELAY_IDENTITY_FAMILY",
    "safeguarding_verifier": "CASERELAY_IDENTITY_VERIFIER",
    "intake_authority": "CASERELAY_IDENTITY_INTAKE",
    "continuity_orchestrator": "CASERELAY_IDENTITY_ORCHESTRATOR",
}

display_to_agent = {
    "caserelay-education": "education_liaison",
    "caserelay-health": "health_coordination",
    "caserelay-legal": "legal_aid",
    "caserelay-shelter": "shelter_status",
    "caserelay-family": "family_services",
    "caserelay-verifier": "safeguarding_verifier",
    "caserelay-intake": "intake_authority",
    "caserelay-orchestrator": "continuity_orchestrator",
}

# Extended display map for -gw suffixed engines
for base, agent in list(display_to_agent.items()):
    display_to_agent[base + "-gw"] = agent

data = json.load(sys.stdin)
engines = data.get("reasoningEngines", [])

# Apply suffix filter
filtered = []
for e in engines:
    dn = e.get("displayName", "")
    if suffix:
        if not dn.endswith(suffix):
            continue
    elif no_suffix:
        # Exclude engines whose display name has a suffix after the base pattern
        base_names = set(display_to_agent.keys()) - {k for k in display_to_agent if "-gw" in k}
        if dn not in base_names:
            continue
    filtered.append(e)

# Sort by resource ID descending (higher = newer) so last-write-wins favours the newest
filtered.sort(key=lambda e: int(e["name"].rsplit("/", 1)[-1]), reverse=True)

seen_agents = set()
url_lines = []
identity_lines = []

for e in filtered:
    spec = e.get("spec", {}) or {}
    deploy = spec.get("deploymentSpec", {}) or {}
    env = {v.get("name"): v.get("value") for v in deploy.get("env", []) or []}
    agent = env.get("CASERELAY_AGENT")
    if agent not in var_by_agent:
        agent = display_to_agent.get(e.get("displayName", ""))
    if agent not in var_by_agent:
        continue
    if agent in seen_agents:
        continue
    seen_agents.add(agent)

    resource = e["name"]
    base = "https://%s-aiplatform.googleapis.com/reasoningEngines/v1/%s/api" % (region, resource)
    url_lines.append("export %s=%s" % (var_by_agent[agent], base))
    url_lines.append("export %s_RESOURCE=%s" % (var_by_agent[agent], resource))

    eff_id = spec.get("effectiveIdentity") or spec.get("effective_identity", "")
    if eff_id and agent in identity_by_agent:
        identity_lines.append("export %s=%s" % (identity_by_agent[agent], eff_id))

lines = ["# generated by infra/collect_endpoints.sh"]
if suffix:
    lines[0] += f" (suffix={suffix})"
elif no_suffix:
    lines[0] += " (no-suffix / original engines only)"

if not identities_only:
    lines.extend(url_lines)
if not urls_only:
    lines.extend(identity_lines)

print("\n".join(lines))
' >"$OUT"

echo "wrote $OUT"
cat "$OUT"
