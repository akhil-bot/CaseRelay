"""Operator CLI for the deployed CaseRelay fleet.

Test data lives in Firestore like any other case — the agents cannot tell the difference, which is
the point. A case generated here carries synthetic=true on its referral packet, and that flag is
the only thing `purge` uses to decide what is safe to delete, so a real case can never be caught
by it.

  source infra/fleet_endpoints.env

  python infra/case_cli.py new                      create a throwaway case, print its id
  python infra/case_cli.py new --source fixture     load the scripted CR-1042 packet instead
  python infra/case_cli.py ls                       every case in Firestore
  python infra/case_cli.py show CR-0823...          status, commitments, grants, audit, memory
  python infra/case_cli.py run CR-0823...           drive the whole journey against the cloud
  python infra/case_cli.py run CR-0823... --from 6-quarantine
  python infra/case_cli.py phases                   list the phase labels
  python infra/case_cli.py ask orchestrator "..."   send your own prompt to any agent
  python infra/case_cli.py rm CR-0823...            delete one case
  python infra/case_cli.py purge                    delete every synthetic case
"""

import argparse
import os
import sys

os.environ.setdefault("CASERELAY_STATE", "firestore")
os.environ.setdefault("CASERELAY_PROJECT_ID", "caserelay")
os.environ.setdefault("GOOGLE_CLOUD_PROJECT", "caserelay")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.runtime import a2a_client  # noqa: E402
from backend.runtime.fleet import PHASES  # noqa: E402
from backend.runtime.workspace import CaseNotFound, workspace  # noqa: E402
from backend.state import dataset, store  # noqa: E402


def _is_test(row: dict) -> bool:
    packet = row.get("referral_packet") or {}
    return bool(packet.get("test_case") or packet.get("synthetic"))


def cmd_new(args) -> int:
    case_id = dataset.create_case(args.case, source=args.source)
    packet = workspace.packet(case_id)
    print(f"case_id   : {case_id}")
    print(f"child     : {packet['child']['name']} (dob {packet['child']['dob']})")
    print(f"status    : draft")
    print(f"referrals : {[r['referral_id'] for r in packet['referrals']]}")
    print(f"synthetic : {packet.get('synthetic', False)}")
    print(f"\nnext: python infra/case_cli.py run {case_id}")
    return 0


def cmd_ls(args) -> int:
    rows = store.list_cases()
    if not rows:
        print("no cases in Firestore")
        return 0
    print(f"{'case_id':<18} {'status':<12} {'child':<10} test_case")
    for row in sorted(rows, key=lambda r: r.get("case_id", "")):
        print(f"{row.get('case_id', '?'):<18} {row.get('status', '?'):<12} "
              f"{row.get('child_name', '?'):<10} {_is_test(row)}")
    return 0


def cmd_show(args) -> int:
    case_id = args.case_id
    workspace.load(case_id)
    try:
        case = workspace.get_case(case_id)
    except CaseNotFound as exc:
        print(exc)
        return 1
    print(f"case      : {case_id}  status={case['status']}  child={case['child_name']}")
    print(f"commitments: {workspace.commitment_states(case_id)}")
    for grant in workspace.grants.get(case_id, []):
        print(f"  grant {grant['grant_id']:<22} {grant['granted_to']:<32} "
              f"{grant['status']:<9} fields={grant['allowed_fields']}")
    for approval in workspace.list_approvals(case_id):
        print(f"  approval {approval.get('approval_id')} {approval.get('decision')} "
              f"— {approval.get('reason', '')[:80]}")
    audit = workspace.list_audit(case_id)
    print(f"  audit ({len(audit)} events):")
    for event in audit:
        print(f"    {event.get('event_type', '?'):<11} {event.get('agent_identity', '?'):<32} "
              f"verdict={event.get('verdict')} basis={event.get('legal_basis')}")
        if event.get("disclosed_fields") is not None:
            print(f"       disclosed={event['disclosed_fields']} "
                  f"withheld={len(event.get('withheld_fields') or [])}")
    print(f"  memory scopes: {sorted(workspace.memory.get(case_id, {}).keys())}")
    return 0


def cmd_run(args) -> int:
    case_id = args.case_id
    workspace.load(case_id)
    try:
        workspace.get_case(case_id)
    except CaseNotFound as exc:
        print(f"{exc} — create one with: python infra/case_cli.py new")
        return 1

    labels = [label for label, _ in PHASES]
    start = 0
    if args.start_from:
        if args.start_from not in labels:
            print(f"unknown phase {args.start_from!r}; see: python infra/case_cli.py phases")
            return 1
        start = labels.index(args.start_from)

    with a2a_client.client() as http:
        if not args.start_from and not args.skip_intake:
            print("phase 1-intake -> caserelay-intake")
            said = a2a_client.send(
                http,
                a2a_client.endpoint("intake"),
                f"Process the referral packet for case {case_id}. "
                "Extract commitments and propose grants.",
            )
            print(f"   {said[:200] or '(empty reply)'}")
            workspace.load(case_id)
            if not workspace.commitments.get(case_id) or not workspace.grants.get(case_id):
                print("   intake did not persist commitments/grants — stopping")
                return 1

        orchestrator = a2a_client.endpoint("orchestrator")
        for label, template in PHASES[start:]:
            print(f"phase {label} -> caserelay-orchestrator")
            said = a2a_client.send(http, orchestrator, template.format(case_id=case_id))
            print(f"   {said[:200] or '(empty reply)'}")

    print()
    return cmd_show(args)


def cmd_phases(args) -> int:
    for label, template in PHASES:
        print(f"{label:<28} {template.format(case_id='<case>')[:90]}")
    return 0


def cmd_ask(args) -> int:
    print(a2a_client.ask(args.agent, " ".join(args.text)) or "(empty reply)")
    return 0


def cmd_rm(args) -> int:
    dataset.delete_case(args.case_id)
    print(f"deleted {args.case_id}")
    return 0


def cmd_purge(args) -> int:
    victims = [row["case_id"] for row in store.list_cases() if _is_test(row) and row.get("case_id")]
    if not victims:
        print("no test cases to purge")
        return 0
    for case_id in victims:
        dataset.delete_case(case_id)
        print(f"deleted {case_id}")
    print(f"purged {len(victims)} test case(s)")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("new", help="create a case in Firestore")
    p.add_argument("--case", default=None, help="case id (default: generated)")
    p.add_argument("--source", default="synthetic", choices=["synthetic", "fixture"])
    p.set_defaults(func=cmd_new)

    p = sub.add_parser("ls", help="list cases")
    p.set_defaults(func=cmd_ls)

    p = sub.add_parser("show", help="show one case in full")
    p.add_argument("case_id")
    p.set_defaults(func=cmd_show)

    p = sub.add_parser("run", help="drive the journey against the deployed fleet")
    p.add_argument("case_id")
    p.add_argument("--from", dest="start_from", default=None, help="resume at this phase label")
    p.add_argument("--skip-intake", action="store_true")
    p.set_defaults(func=cmd_run)

    p = sub.add_parser("phases", help="list phase labels")
    p.set_defaults(func=cmd_phases)

    p = sub.add_parser("ask", help="send your own prompt to one agent")
    p.add_argument("agent", choices=sorted(a2a_client.AGENTS))
    p.add_argument("text", nargs="+")
    p.set_defaults(func=cmd_ask)

    p = sub.add_parser("rm", help="delete one case")
    p.add_argument("case_id")
    p.set_defaults(func=cmd_rm)

    p = sub.add_parser("purge", help="delete every synthetic case")
    p.set_defaults(func=cmd_purge)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
