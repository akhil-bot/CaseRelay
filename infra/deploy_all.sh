#!/usr/bin/env bash
# Run the CaseRelay deploy scripts in the one order that works.
#
# This is a wrapper and nothing else: it adds no logic, creates no resources, and
# reads no configuration the underlying scripts do not already read. Every stage
# stays individually runnable, which is what you want when one of them fails.
#
# Two orderings here are not obvious and are the reason this file exists:
#
#   fleet -> collect -> fleet    deploy_fleet.sh refuses the orchestrator until the six
#                                specialist CASERELAY_URL_* are set, and those contain
#                                engine ids that do not exist until the specialists do.
#                                The second pass also bakes each engine's own public URL
#                                into its A2A agent card.
#
#   bootstrap ... bootstrap      bootstrap.sh creates the authenticated Pub/Sub push
#                                subscription from infra/control_plane_url.txt, which
#                                deploy_control_plane.sh only writes on success. The
#                                first pass prints "SKIP: control_plane_url.txt not
#                                found"; the second pass completes the wake path.
#
# Optional stages (partner MCP, Agent Gateway binding, gateway policies) are deliberately
# NOT here. They are opt-in, they change the security posture, and they belong in a command
# someone typed on purpose. See docs/deploy.md.
#
#   bash infra/deploy_all.sh                      # every stage, in order
#   bash infra/deploy_all.sh --from control-plane  # resume from a stage
#   bash infra/deploy_all.sh --list                # print the stages and exit
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/.." && pwd)"

# stage name | what it runs | one-line purpose
STAGES=(
  "bootstrap|bash infra/bootstrap.sh|APIs, Pub/Sub, Scheduler, Firestore index, Memory Bank, Sessions engines"
  "fleet|bash infra/deploy_fleet.sh|create the eight reasoning engines (orchestrator may fail on a fresh project)"
  "collect|bash infra/collect_endpoints.sh|write infra/fleet_endpoints.env from the live engines"
  "fleet-rewire|bash infra/deploy_fleet.sh|redeploy with specialist URLs and identities resolved"
  "control-plane|bash infra/deploy_control_plane.sh|Cloud Run control plane, canary-probed before traffic shifts"
  "push-subscription|bash infra/bootstrap.sh|re-run: the Pub/Sub push subscription needs the control plane URL"
  "portal|CASERELAY_BUILD=cloud bash infra/deploy_portal.sh|Cloud Run portal behind its password gate"
)

FROM=""
LIST=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --from) FROM="${2:-}"; shift 2 ;;
    --list) LIST=1; shift ;;
    -h|--help)
      awk 'NR>1 { if (/^set -/) exit; if (/^#/) { sub(/^# ?/, ""); print } }' "${BASH_SOURCE[0]}"
      exit 0 ;;
    *) echo "unknown argument: $1 (try --help)" >&2; exit 2 ;;
  esac
done

if [ "$LIST" -eq 1 ]; then
  printf '%-19s %s\n' "STAGE" "PURPOSE"
  for entry in "${STAGES[@]}"; do
    IFS='|' read -r name _cmd purpose <<<"$entry"
    printf '%-19s %s\n' "$name" "$purpose"
  done
  exit 0
fi

# Validate --from before running anything, so a typo does not silently run everything.
if [ -n "$FROM" ]; then
  _known=0
  for entry in "${STAGES[@]}"; do
    IFS='|' read -r name _cmd _purpose <<<"$entry"
    [ "$name" = "$FROM" ] && _known=1
  done
  if [ "$_known" -eq 0 ]; then
    echo "unknown stage: $FROM — run with --list" >&2
    exit 2
  fi
fi

cd "$ROOT"

echo "=== CaseRelay deploy ==="
echo "    project=${CASERELAY_PROJECT:-caserelay} region=${CASERELAY_REGION:-us-central1}"
[ -n "$FROM" ] && echo "    starting from: $FROM"
echo ""

started=0
[ -z "$FROM" ] && started=1

for entry in "${STAGES[@]}"; do
  IFS='|' read -r name cmd purpose <<<"$entry"

  if [ "$started" -eq 0 ]; then
    if [ "$name" = "$FROM" ]; then
      started=1
    else
      echo "--- skip: $name"
      continue
    fi
  fi

  echo ""
  echo "=========================================================================="
  echo "  $name — $purpose"
  echo "  \$ $cmd"
  echo "=========================================================================="
  if ! eval "$cmd"; then
    rc=$?
    echo "" >&2
    echo "FAILED at stage '$name' (exit $rc)." >&2
    echo "  Fix it, then resume with: bash infra/deploy_all.sh --from $name" >&2
    exit "$rc"
  fi
done

echo ""
echo "=== all stages complete ==="
[ -f infra/control_plane_url.txt ] && echo "    control plane: $(cat infra/control_plane_url.txt)"
[ -f infra/portal_url.txt ] && echo "    portal:        $(cat infra/portal_url.txt)"
echo ""
echo "    Verify:  bash infra/fleet_status.sh"
echo "             source infra/fleet_endpoints.env && python infra/cloud_e2e.py"
