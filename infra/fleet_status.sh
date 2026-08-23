#!/usr/bin/env bash
# Report the deployed CaseRelay fleet: engine id, display name, service account, and endpoint.
set -uo pipefail

PROJECT="${CASERELAY_PROJECT:-caserelay}"
REGION="${CASERELAY_REGION:-us-central1}"
TOKEN="$(gcloud auth print-access-token)"

curl -s -H "Authorization: Bearer ${TOKEN}" \
  "https://${REGION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/reasoningEngines" |
  python3 -c '
import json, sys
data = json.load(sys.stdin)
engines = data.get("reasoningEngines", [])
if not engines:
    print("no engines found"); sys.exit(0)
for e in sorted(engines, key=lambda x: x.get("displayName", "")):
    spec = e.get("spec", {}) or {}
    deploy = spec.get("deploymentSpec", {}) or {}
    env = {v.get("name"): v.get("value") for v in deploy.get("env", []) or []}
    print("{:24} {:22} agent={:24} sa={}".format(
        e.get("displayName", "?"),
        e["name"].rsplit("/", 1)[-1],
        env.get("CASERELAY_AGENT", "?"),
        (deploy.get("serviceAccount") or spec.get("serviceAccount") or "?").split("@")[0],
    ))
'
