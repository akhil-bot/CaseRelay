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
import subprocess
import sys
import time

os.environ.setdefault("CASERELAY_STATE", "firestore")
os.environ.setdefault("CASERELAY_PROJECT_ID", "caserelay")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.runtime import a2a_client  # noqa: E402
from backend.runtime.fleet import PHASES  # noqa: E402
from backend.runtime.workspace import workspace  # noqa: E402
from backend.state import dataset  # noqa: E402

# Synthetic supervisor identity used for both gate actions.  Deliberately
# machine-readable so it is obvious in audit logs that no real person approved.
_SUPERVISOR_ID = "cloud-e2e-harness"

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _cp_base_url() -> str:
    url = os.environ.get("CASERELAY_CONTROL_PLANE_URL", "").rstrip("/")
    if url:
        return url
    artifact = os.path.join(_REPO_ROOT, "infra", "control_plane_url.txt")
    if os.path.exists(artifact):
        url = open(artifact).read().strip().rstrip("/")
    if url:
        return url
    raise SystemExit(
        "Control plane URL not found — set CASERELAY_CONTROL_PLANE_URL "
        "or run infra/deploy_control_plane.sh"
    )


def _id_token(audience: str) -> str:
    """Mint a Google identity token, mirroring the fallback in deploy_control_plane.sh.

    --audiences only works for service-account credentials; it fails outright on user
    accounts, so we fall back to a plain identity token (Cloud Run accepts both).
    """
    for cmd in (
        ["gcloud", "auth", "print-identity-token", f"--audiences={audience}"],
        ["gcloud", "auth", "print-identity-token"],
    ):
        try:
            token = subprocess.check_output(cmd, stderr=subprocess.DEVNULL).decode().strip()
            if token:
                return token
        except (subprocess.CalledProcessError, FileNotFoundError):
            pass
    raise SystemExit("Failed to mint identity token — is gcloud configured?")


def _cp_post(base: str, path: str, body: dict, token: str) -> dict:
    import httpx
    resp = httpx.post(
        f"{base}{path}",
        json=body,
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def _await_pending_escalation(case_id: str, retries: int = 10, delay: float = 3.0) -> str | None:
    """Poll Firestore until a pending escalation approval appears, then return its id."""
    for _ in range(retries):
        workspace.load(case_id)
        for appr in workspace.list_approvals(case_id):
            if appr.get("decision") == "pending" and appr.get("action_type") == "escalation":
                return str(appr["approval_id"])
        time.sleep(delay)
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--case", default=None)
    ap.add_argument("--source", default="synthetic", choices=["synthetic", "fixture"])
    ap.add_argument("--keep", action="store_true")
    args = ap.parse_args()

    import httpx as _httpx
    required_agents = ["intake", "orchestrator", "education", "health", "legal", "shelter", "family", "verifier"]
    for agent_key in required_agents:
        url = a2a_client.endpoint(agent_key)
        try:
            _httpx.head(url, timeout=10, follow_redirects=True)
        except (_httpx.ConnectError, _httpx.TimeoutException) as exc:
            print(f"PREFLIGHT FAILED: {agent_key} at {url} unreachable: {exc}")
            return 1
        except _httpx.HTTPStatusError:
            pass  # reachable, just rejected the request — that's fine

    cp_base = _cp_base_url()
    cp_token = _id_token(cp_base)

    case_id = args.case or (None if args.source == "synthetic" else "CR-1042")
    case_id = dataset.create_case(case_id, source=args.source, scenario="maya")
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

            # Supervisor gate 1: activate the case so grants become "granted" and
            # the run engine can advance past "draft".  This is the human action
            # that the old "2-activate" phase used to fake; we now call the real
            # endpoint as a legitimate supervisor client would.
            print(f"supervisor gate: activating case {case_id} as {_SUPERVISOR_ID!r}")
            result = _cp_post(cp_base, f"/v1/cases/{case_id}/activate",
                              {"supervisor_id": _SUPERVISOR_ID}, cp_token)
            print(f"   activated → status={result.get('status')}")

            orch = a2a_client.endpoint("orchestrator")
            for label, template in PHASES:
                print(f"phase {label} -> caserelay-orchestrator")
                said = a2a_client.send(client, orch, template.format(case_id=case_id))
                print(f"   said: {said[:160] or '(empty)'}")

                if label == "6-quarantine":
                    # Supervisor gate 2: the verifier has now quarantined the injected
                    # callback and written a pending escalation approval to Firestore.
                    # Approve it as the harness supervisor so phase 8-followup can run.
                    approval_id = _await_pending_escalation(case_id)
                    if not approval_id:
                        print("   supervisor gate: no pending escalation found after quarantine (check verifier logs)")
                    else:
                        print(f"supervisor gate: approving escalation {approval_id} as {_SUPERVISOR_ID!r}")
                        result = _cp_post(cp_base, f"/v1/approvals/{approval_id}/decide",
                                          {"decision": "approved", "decided_by": _SUPERVISOR_ID},
                                          cp_token)
                        print(f"   decided → {result.get('decision')}")

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
