#!/usr/bin/env python3
"""Repeated-trial harness for the verifier agent's escalation logic.

Runs the verifier agent N times against a given scenario and reports
whether each run produced an escalation (approval in workspace) or not.

    python harness/verifier_trial.py --scenario noah --runs 5
    python harness/verifier_trial.py --scenario maya --runs 5
    python harness/verifier_trial.py --scenario priya --runs 1
"""

import argparse
import os
import sys
import threading

os.environ.setdefault("CASERELAY_STATE", "memory")
os.environ.setdefault("GOOGLE_CLOUD_PROJECT", "caserelay")
os.environ.setdefault("GOOGLE_CLOUD_LOCATION", "global")
os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "1")
os.environ.setdefault("MODEL_ARMOR_TEMPLATE",
                       "projects/caserelay/locations/us-central1/templates/caserelay-screen")
os.environ.setdefault("MODEL_ARMOR_LOCATION", "us-central1")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.agents.verifier import agent as verifier_mod
from backend.runtime.invoke import run_agent
from backend.runtime.workspace import workspace
from backend.state import dataset


def trial(scenario: str, run_idx: int) -> dict:
    case_id = f"TRIAL-{scenario.upper()}-{run_idx}"

    # Reset module-level verdict state between trials.
    with verifier_mod._verdicts_lock:
        verifier_mod._verdicts.pop(case_id, None)

    dataset.create_case(case_id, source="synthetic", scenario=scenario)
    dataset.grant_authority(case_id)

    agent = verifier_mod.build_agent("task")
    prompt = (
        f"The school system sent a callback for case {case_id}. "
        f"Inspect it and escalate if it reaches outside the education scope."
    )

    try:
        reply = run_agent(agent, prompt, app_name="safeguarding_verifier")
    except Exception as exc:
        reply = f"ERROR: {exc}"

    approvals = workspace.list_approvals(case_id)
    audit = workspace.list_audit(case_id)
    quarantine_events = [e for e in audit if e.get("event_type") == "quarantine"]

    with verifier_mod._verdicts_lock:
        recorded_verdict = verifier_mod._verdicts.get(case_id, "not_recorded")

    result = {
        "case_id": case_id,
        "scenario": scenario,
        "run": run_idx,
        "screening_verdict": recorded_verdict,
        "escalated": len(approvals) > 0,
        "quarantine_audit_events": len(quarantine_events),
        "reply_snippet": reply[:200],
    }

    dataset.delete_case(case_id)
    return result


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenario", required=True)
    ap.add_argument("--runs", type=int, default=5)
    args = ap.parse_args()

    results = []
    for i in range(1, args.runs + 1):
        print(f"[{args.scenario} run {i}/{args.runs}] ", end="", flush=True)
        r = trial(args.scenario, i)
        verdict_tag = r["screening_verdict"]
        esc_tag = "ESCALATED" if r["escalated"] else "clean"
        print(f"screening={verdict_tag}  result={esc_tag}")
        results.append(r)

    n_escalated = sum(1 for r in results if r["escalated"])
    n_clean = sum(1 for r in results if not r["escalated"])
    print(f"\n{args.scenario}: {n_escalated} escalated, {n_clean} clean out of {len(results)} runs")

    if args.scenario in ("noah", "priya", "ellis", "diego", "rosa", "theo"):
        ok = n_escalated == 0
        print(f"EXPECTED: 0 escalations → {'PASS' if ok else 'FAIL'}")
    elif args.scenario == "maya":
        ok = n_escalated == len(results)
        print(f"EXPECTED: {len(results)} escalations → {'PASS' if ok else 'FAIL'}")
    else:
        ok = True
        print("(no expectation defined for this scenario)")

    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
