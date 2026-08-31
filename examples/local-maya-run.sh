#!/usr/bin/env bash
# Drive the flagship Maya case end to end against a LOCAL control plane.
#
# Start the control plane first, in another shell:
#   PYTHONPATH=. uvicorn backend.api.main:app --port 8000
#
#   bash examples/local-maya-run.sh                 # default: localhost:8000
#   CP=http://localhost:8001 bash examples/local-maya-run.sh
#
# Two things here are not obvious and are the reason this is a script rather than a
# paste-able sequence.
#
# 1. due_in MUST stay at 10s. schedule_wake spreads the five per-commitment checkpoints
#    proportionally across the window it is given, at now + due_in x (i+1)/5. At 10s all
#    five have lapsed by the time the run checkpoints, so the resumed run finds education
#    overdue and checks back with the school. A longer deadline leaves the later
#    checkpoints in the future, the resumed run arrives before education's check-back is
#    due, and the quarantine, follow-up and memory phases never become reachable.
#
# 2. There is no Pub/Sub locally. In the cloud, Cloud Scheduler's hourly sweep
#    (`0 * * * *`) publishes the wake and an authenticated push handler starts the continuation run.
#    Here we stand in for it by calling /v1/workflows/sweep and then posting the push
#    envelope ourselves. OIDC verification on /v1/pubsub/push is skipped when
#    CASERELAY_CONTROL_PLANE is unset — which is exactly what makes this possible, and
#    exactly why the deployed service sets it.
set -euo pipefail

CP="${CP:-http://localhost:8000}"
SUPERVISOR="${SUPERVISOR:-supervisor-001}"
DUE_IN="${DUE_IN:-10s}"

_json() { python3 -c "import sys,json; d=json.load(sys.stdin); print(d$1)"; }

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

# ---------------------------------------------------------------------------
step "0/6  control plane"

if ! curl -sf --max-time 5 "$CP/health" >/dev/null; then
  echo "no control plane at $CP" >&2
  echo "  start one with: PYTHONPATH=. uvicorn backend.api.main:app --port 8000" >&2
  exit 1
fi
echo "    $CP is up"

# ---------------------------------------------------------------------------
step "1/6  create the case"

CASE=$(curl -sf -X POST "$CP/v1/cases" \
  -H 'content-type: application/json' \
  -d "{\"scenario\":\"maya\",\"due_in\":\"$DUE_IN\"}" | _json '["case_id"]')
echo "    case_id: $CASE   (scenario=maya, due_in=$DUE_IN)"

# ---------------------------------------------------------------------------
step "2/6  first run — parks at the activation gate"

# Intake extracts the five commitments and proposes the authority grants, then stops.
# No phase can approve this: the orchestrator has no activate_case tool, which is the
# only reason the model cannot approve its own work.
RUN1=$(curl -sf -X POST "$CP/v1/cases/$CASE/runs" | _json '["run_id"]')
echo "    run_id: $RUN1"
curl -sN --max-time 180 "$CP/v1/runs/$RUN1/events" | sed 's/^/    /' || true

# ---------------------------------------------------------------------------
step "3/6  the human decision — activation"

# A real supervisor id, recorded on the grant as granted_by. There is no default approver.
curl -sf -X POST "$CP/v1/cases/$CASE/activate" \
  -H 'content-type: application/json' \
  -d "{\"supervisor_id\":\"$SUPERVISOR\"}" | sed 's/^/    /'
echo ""

# activate returns {case_id, status} and starts the continuation run on a background
# thread, so the run id has to be read back. /v1/cases/{id}/runs is newest first.
RUN2=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  RUN2=$(curl -sf "$CP/v1/cases/$CASE/runs" | _json '[0]["run_id"]' 2>/dev/null || echo "")
  [ -n "$RUN2" ] && [ "$RUN2" != "$RUN1" ] && break
  sleep 1
done
if [ -z "$RUN2" ] || [ "$RUN2" = "$RUN1" ]; then
  echo "    no second run appeared — activation did not take" >&2
  exit 1
fi

step "4/6  second run — fan-out, then run_suspended on its checkpoints"

echo "    run_id: $RUN2"
curl -sN --max-time 240 "$CP/v1/runs/$RUN2/events" | sed 's/^/    /' || true

# ---------------------------------------------------------------------------
step "5/6  stand in for Cloud Scheduler + Pub/Sub"

# Wait for the checkpoints to come due before sweeping. Sweeping early finds nothing
# and the resumed run has no overdue commitment to act on.
echo "    waiting for the checkpoint window to lapse..."
sleep 12

curl -sf -X POST "$CP/v1/workflows/sweep" | sed 's/^/    sweep: /'
echo ""

PUSH_DATA=$(printf '{"event_type":"workflow_wake","case_id":"%s"}' "$CASE" | base64)
RUN3=$(curl -sf -X POST "$CP/v1/pubsub/push" \
  -H 'content-type: application/json' \
  -d "{\"message\":{\"data\":\"$PUSH_DATA\"}}" | _json '.get("run_id","")')

if [ -z "$RUN3" ]; then
  echo "    the push did not start a run — no checkpoint was due" >&2
  echo "    keep DUE_IN at 10s; see the note at the top of this script" >&2
  exit 1
fi

echo "    resumed as run: $RUN3"
curl -sN --max-time 300 "$CP/v1/runs/$RUN3/events" | sed 's/^/    /' || true

# ---------------------------------------------------------------------------
step "6/6  the second human decision — the quarantine escalation"

# The district's reply to the check-back tried to retrieve medical notes. Model Armor
# quarantined it and the Safeguarding Verifier opened an escalation. The run parks here
# with school enrollment still open. Nothing goes out until a person rules on it.
APPROVAL=$(curl -sf "$CP/v1/approvals" | python3 -c "
import sys, json
for a in json.load(sys.stdin):
    if a.get('case_id') == '$CASE' and a.get('decision') in (None, '', 'pending'):
        print(a['approval_id']); break
")

if [ -z "$APPROVAL" ]; then
  echo "    no pending approval for $CASE."
  echo "    If the run finished without reaching the quarantine, check that the"
  echo "    education check-back happened — 'quarantine' should appear above."
else
  echo "    approval_id: $APPROVAL"
  curl -sf -X POST "$CP/v1/approvals/$APPROVAL/decide" \
    -H 'content-type: application/json' \
    -d "{\"decision\":\"approve\",\"decided_by\":\"$SUPERVISOR\"}" | sed 's/^/    /'
  echo ""
  echo "    the follow-up may now go out; the resumed run streams from the same endpoint"
fi

# ---------------------------------------------------------------------------
printf '\n\033[1m== done\033[0m\n'
echo "    case:        $CASE"
echo "    full history: curl -s $CP/v1/cases/$CASE/events"
echo "    audit trail:  curl -s $CP/v1/cases/$CASE/audit"
echo "    delete it:    curl -s -X DELETE $CP/v1/cases/$CASE"
