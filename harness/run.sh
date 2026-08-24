#!/usr/bin/env bash
# Run the coding agent unattended until every gate passes.
#
#   ./harness/run.sh              # fast gates only, no cloud, no spend
#   ./harness/run.sh --slow       # include the cloud gates (real deploys, costs money)
#   ./harness/run.sh --stage 1    # one stage at a time
#
# Stops when the gates pass, when it stops making progress, or after --max-loops.
# Safe to Ctrl-C and re-run: progress is in git.

set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

MAX_LOOPS=40
SCOPE=(--all)
SLOW=()
MODEL=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --slow)      SLOW=(--slow); shift ;;
    --stage)     SCOPE=(--stage "$2"); shift 2 ;;
    --max-loops) MAX_LOOPS="$2"; shift 2 ;;
    --model)     MODEL=(--model "$2"); shift 2 ;;
    -h|--help)   sed -n '2,11p' "$0"; exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

git switch -c harness/portal-ready 2>/dev/null || git switch harness/portal-ready || exit 1
mkdir -p harness/logs

stuck=0
for (( i=1; i<=MAX_LOOPS; i++ )); do
  if python3 harness/gate.py "${SCOPE[@]}" "${SLOW[@]}"; then
    echo
    echo "All gates pass. Handover artifacts:"
    echo "  contracts/openapi.json  docs/admin-page-spec.md  infra/control_plane_url.txt"
    exit 0
  fi

  before=$(git rev-parse HEAD)
  echo
  echo "=== iteration $i/$MAX_LOOPS ==="

  cursor-agent -p --force "${MODEL[@]}" "Read harness/GUARDRAILS.md first — it overrides everything else.

Run: python3 harness/gate.py ${SCOPE[*]} ${SLOW[*]}

Take the FIRST failing check and fix it properly. Gates are listed in dependency order, so
earlier failures are usually the cause of later ones — do not skip ahead.

Read docs/caserelay-hardening-plan.md for the reasoning behind whatever you are fixing.

You may not edit harness/gate.py. Make the existing check pass honestly.

When the check passes, commit just that change with a one-line message, then stop. One
failing check per turn." 2>&1 | tee -a "harness/logs/iter-$i.log"

  # gate.py is read-only to the agent; revert any edit to it.
  if ! git diff --quiet HEAD -- harness/gate.py; then
    echo "!! agent edited gate.py — reverting"
    git checkout HEAD -- harness/gate.py
  fi

  # Sweep up anything it left uncommitted so each iteration is reviewable.
  if [[ -n "$(git status --porcelain)" ]]; then
    git add -A && git commit -q -m "harness iteration $i"
  fi

  if [[ "$(git rev-parse HEAD)" == "$before" ]]; then
    stuck=$(( stuck + 1 ))
    echo "!! no changes this iteration ($stuck in a row)"
    if (( stuck >= 3 )); then
      echo "Stopping: three iterations with no progress. Read harness/logs/ and the gate output."
      exit 1
    fi
  else
    stuck=0
  fi
done

echo "Hit --max-loops=$MAX_LOOPS without going green."
python3 harness/gate.py "${SCOPE[@]}" "${SLOW[@]}"
exit 1
