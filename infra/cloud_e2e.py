"""Run the CaseRelay journey against the deployed fleet.

Same phases as the local driver, but every turn is a JSON-RPC A2A call to an Agent Runtime
endpoint, and the shared state is Firestore. The case is created here, exercised by the agents,
verified by reading Firestore back, and deleted — the deployed agents are never told it is a test
case, they just read whatever is in the store.

  python infra/cloud_e2e.py              # throwaway synthetic case, deleted at the end
  python infra/cloud_e2e.py --keep       # leave the case in Firestore to inspect
  python infra/cloud_e2e.py --case CR-1042 --source fixture
"""

import argparse
import os
import sys

os.environ.setdefault("CASERELAY_STATE", "firestore")
os.environ.setdefault("CASERELAY_PROJECT_ID", "caserelay")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.runtime import a2a_client  # noqa: E402
from backend.runtime.fleet import PHASES  # noqa: E402
from backend.runtime.workspace import workspace  # noqa: E402
from backend.state import dataset  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--case", default=None)
    ap.add_argument("--source", default="synthetic", choices=["synthetic", "fixture"])
    ap.add_argument("--keep", action="store_true")
    args = ap.parse_args()

    case_id = args.case or (None if args.source == "synthetic" else "CR-1042")
    case_id = dataset.create_case(case_id, source=args.source)
    packet = workspace.packet(case_id)
    print(f"created case {case_id} in Firestore — child {packet['child']['name']}, "
          f"referrals {[r['referral_id'] for r in packet['referrals']]}\n")

    ok = True
    try:
        with a2a_client.client() as client:
            print("phase 1-intake -> caserelay-intake")
            said = a2a_client.send(client, a2a_client.endpoint("intake"), f"Process the referral packet for case {case_id}. "
                                                   "Extract commitments and propose grants.")
            print(f"   said: {said[:160] or '(empty)'}")
            workspace.load(case_id)
            n_c = len(workspace.commitments.get(case_id, []))
            n_g = len(workspace.grants.get(case_id, []))
            print(f"   firestore: {n_c} commitments, {n_g} proposed grants")
            if not n_c or not n_g:
                raise RuntimeError("intake did not persist commitments/grants")

            orch = a2a_client.endpoint("orchestrator")
            for label, template in PHASES:
                print(f"phase {label} -> caserelay-orchestrator")
                said = a2a_client.send(client, orch, template.format(case_id=case_id))
                print(f"   said: {said[:160] or '(empty)'}")

        workspace.load(case_id)
        case = workspace.get_case(case_id)
        states = workspace.commitment_states(case_id)
        approvals = [(a.get("approval_id"), a.get("decision")) for a in workspace.list_approvals(case_id)]
        print("\n--- read back from Firestore ---")
        print("case status  :", case["status"])
        print("commitments  :", states)
        print("grants       :", len(workspace.grants.get(case_id, [])))
        print("approvals    :", approvals)
        print("audit events :", len(workspace.list_audit(case_id)))
        print("memory       :", list(workspace.memory.get(case_id, {}).keys()))

        if case["status"] != "monitoring":
            print("CHECK FAILED: case never reached monitoring"); ok = False
        if any(v == "pending" for v in states.values()) and all(v == "pending" for v in states.values()):
            print("CHECK FAILED: no specialist resolved anything"); ok = False
        if not any(d == "approved" for _, d in approvals):
            print("CHECK FAILED: quarantine escalation was not approved"); ok = False
    finally:
        if args.keep:
            print(f"\nkept case {case_id} in Firestore")
        else:
            dataset.delete_case(case_id)
            print(f"\ndeleted case {case_id}")

    print("CLOUD-E2E-" + ("OK" if ok else "FAILED"))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
