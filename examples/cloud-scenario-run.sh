#!/usr/bin/env bash
# Run a named scenario end to end against the DEPLOYED control plane.
#
#   bash examples/cloud-scenario-run.sh priya        # the escalation ladder, run to its end
#   bash examples/cloud-scenario-run.sh rosa         # a partner asking outside its scope
#   bash examples/cloud-scenario-run.sh theo         # a reply that cannot be parsed
#   bash examples/cloud-scenario-run.sh noah         # the clean path (the control)
#
# What each scenario exercises, and which ones do not demonstrate their own claim, is in
# examples/scenarios.md. Read that before drawing a conclusion from a run.
#
# Requirements: gcloud authenticated as a principal holding roles/run.invoker on
# caserelay-control-plane. The service is auth-required; anonymous requests return 403.
# The URL comes from infra/control_plane_url.txt, which deploy_control_plane.sh writes on
# its last successful deploy, so this cannot drift from what was actually shipped.
#
# This does NOT stand in for Cloud Scheduler. In the cloud the hourly Pub/Sub sweep
# (`0 * * * *`) is the real wake mechanism. Under a compressed deadline the wake phase runs inside the same
# run that set the checkpoint, so what you see below is proof that the ladder works, not
# that the timer does.
set -euo pipefail

SCENARIO="${1:-}"
DUE_IN="${DUE_IN:-10s}"
SUPERVISOR="${SUPERVISOR:-$(gcloud config get-value account 2>/dev/null || echo demo-supervisor)}"

if [ -z "$SCENARIO" ]; then
  echo "usage: bash examples/cloud-scenario-run.sh <scenario>" >&2
  echo "  scenarios: noah priya rosa theo maya kai diego ellis amara" >&2
  echo "  see examples/scenarios.md for what each one shows" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

CP="${CASERELAY_CONTROL_PLANE_URL:-}"
if [ -z "$CP" ]; then
  if [ ! -f "$ROOT/infra/control_plane_url.txt" ]; then
    echo "no control plane URL: set CASERELAY_CONTROL_PLANE_URL or deploy first" >&2
    exit 1
  fi
  CP="$(tr -d '[:space:]' < "$ROOT/infra/control_plane_url.txt")"
fi

TOK="$(gcloud auth print-identity-token)"
AUTH=(-H "Authorization: Bearer $TOK")

_json() { python3 -c "import sys,json; d=json.load(sys.stdin); print(d$1)"; }
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

step "control plane"
echo "    $CP"
if ! curl -sf --max-time 20 "${AUTH[@]}" "$CP/health" >/dev/null; then
  echo "    cannot reach it as this identity — check roles/run.invoker" >&2
  exit 1
fi

step "create the case from scenario '$SCENARIO'"
CASE=$(curl -sf -X POST "$CP/v1/cases" "${AUTH[@]}" \
  -H 'content-type: application/json' \
  -d "{\"scenario\":\"$SCENARIO\",\"due_in\":\"$DUE_IN\"}" | _json '["case_id"]')
echo "    case_id: $CASE"

step "first run — intake, then the activation gate"
# Every scenario stops here. The run emits awaiting_supervisor, parks with
# current_phase="gate:activation" and closes its stream. It resumes as a NEW run with a
# NEW run id only when a real activate call arrives carrying the identity of whoever
# decided. That is the same gate on all nine scenarios, and it is the reason a CaseRelay
# run is never one run.
curl -sf -X POST "$CP/v1/cases/$CASE/runs" "${AUTH[@]}" | sed 's/^/    /'
echo ""

step "the human decision"
echo "    deciding as: $SUPERVISOR"
curl -sf -X POST "$CP/v1/cases/$CASE/activate" "${AUTH[@]}" \
  -H 'content-type: application/json' \
  -d "{\"supervisor_id\":\"$SUPERVISOR\"}" | sed 's/^/    /'
echo ""

step "waiting for the fleet"
# Fan-out reaches five reasoning engines over authenticated A2A. Wall clock is 1.5-3
# minutes depending on the scenario; the escalation ladder is the slow part.
# NOTE: if the scenario includes a checkpoint wake (e.g. maya), the run will end
# `suspended` and resume only after Cloud Scheduler fires — up to an hour later.
# To skip the wait, fire the sweep on demand:
#   curl -s -X POST "$CP/v1/workflows/sweep" -H "Authorization: Bearer $TOK"
for i in $(seq 1 30); do
  sleep 6
  STATE=$(curl -sf "$CP/v1/cases/$CASE/runs" "${AUTH[@]}" | _json '[0]["state"]' 2>/dev/null || echo "?")
  printf '\r    %3ds  latest run state: %-18s' "$((i * 6))" "$STATE"
  case "$STATE" in
    completed|partial_failure|failed) break ;;
  esac
done
echo ""

step "the narrated history"
# The same feed the portal renders, and the same one scenarios.md quotes. These arrive as
# AG-UI envelopes: the internal event sits on `value` for CUSTOM frames and on `rawEvent`
# for the five that have a true AG-UI counterpart.
curl -sf "$CP/v1/cases/$CASE/events" "${AUTH[@]}" | python3 -c "
import sys, json
for frame in json.load(sys.stdin):
    raw = frame.get('value') or frame.get('rawEvent') or {}
    print('    {:22} {:30} {}'.format(
        raw.get('event', frame.get('type', '')),
        raw.get('phase') or '',
        raw.get('message') or '',
    ))
"

step "done"
echo "    case:     $CASE"
echo "    audit:    curl -s \"\$CP/v1/cases/$CASE/audit\" -H \"Authorization: Bearer \\\$(gcloud auth print-identity-token)\""
echo "    approvals: curl -s \"\$CP/v1/approvals\" -H \"Authorization: Bearer \\\$(gcloud auth print-identity-token)\""
echo ""
echo "    Synthetic case — delete it when you are finished:"
echo "      curl -s -X DELETE \"$CP/v1/cases/$CASE\" -H \"Authorization: Bearer \\\$(gcloud auth print-identity-token)\""
