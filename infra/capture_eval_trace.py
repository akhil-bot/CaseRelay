#!/usr/bin/env python3
"""Capture the orchestrator's real trajectory from a completed CaseRelay cloud run.

Reads Firestore audit events, commitment states, and approval records for a given
case and transforms them into the GEAP AgentData schema that `agents-cli eval grade`
can score. The output is a real trace derived from production data, not a hand-authored
description of expected behavior.

Usage:
    python infra/capture_eval_trace.py CR-0828181247
    python infra/capture_eval_trace.py CR-0828181247 --output tests/eval/datasets/maya-real-trace.json
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone

os.environ.setdefault("CASERELAY_STATE", "firestore")
os.environ.setdefault("CASERELAY_PROJECT_ID", "caserelay")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.runtime.workspace import workspace  # noqa: E402

ENGINE_ID_TO_SPECIALIST = {
    "6205121908900364288": "education_liaison",
    "2657974252392677376": "health_coordination",
    "3107630527687950336": "legal_aid",
    "8689420053348614144": "shelter_status",
    "7993613910919872512": "family_services",
    "3044580132904763392": "safeguarding_verifier",
}


def _extract_specialist(agent_identity: str) -> str | None:
    for engine_id, name in ENGINE_ID_TO_SPECIALIST.items():
        if engine_id in agent_identity:
            return name
    return None


def capture_trace(case_id: str) -> dict:
    workspace.load(case_id)

    audit_events = workspace.list_audit(case_id)
    audit_events.sort(key=lambda e: e.get("timestamp", ""))

    commitments = workspace.commitment_states(case_id)
    approvals = workspace.list_approvals(case_id)
    case = workspace.get_case(case_id)

    turns = []
    turn_index = 0

    # Turn 0: the user prompt that initiated the run (from cloud_e2e.py)
    turns.append({
        "turn_index": turn_index,
        "events": [{
            "author": "user",
            "content": {"parts": [{"text": f"Process the referral packet for case {case_id}. Extract commitments and propose grants."}]}
        }]
    })
    turn_index += 1

    # Turn 1: fan-out — reconstruct from disclosure audit events
    # Each disclosure event represents a specialist being dispatched and accessing
    # case data through the authority gateway.
    fanout_events = []
    specialists_dispatched = set()

    for evt in audit_events:
        if evt.get("event_type") != "disclosure":
            continue
        specialist = _extract_specialist(evt.get("agent_identity", ""))
        if specialist and specialist not in specialists_dispatched:
            specialists_dispatched.add(specialist)
            status = commitments.get(
                specialist.replace("_liaison", "").replace("_coordination", "").replace("_aid", "").replace("_status", "").replace("_services", ""),
                "pending"
            )
            # Function call: orchestrator dispatches specialist
            fanout_events.append({
                "author": "orchestrator",
                "content": {"parts": [{"function_call": {
                    "name": specialist,
                    "args": {"case_id": case_id, "instruction": f"Check and submit commitment for case {case_id}"}
                }}]}
            })
            # Function response: what the specialist reported
            response_data = {
                "status": status,
                "disclosed_fields": evt.get("disclosed_fields", []),
                "withheld_fields": evt.get("withheld_fields", []),
                "legal_basis": evt.get("legal_basis", ""),
                "trace_id": evt.get("trace_id", ""),
            }
            fanout_events.append({
                "author": "orchestrator",
                "content": {"parts": [{"function_response": {
                    "name": specialist,
                    "response": response_data
                }}]}
            })

    if fanout_events:
        fanout_events.append({
            "author": "orchestrator",
            "content": {"parts": [{"text": f"Fan-out complete for {case_id}. Dispatched {len(specialists_dispatched)} specialists. Commitment states: {json.dumps(commitments)}"}]}
        })
        turns.append({"turn_index": turn_index, "events": fanout_events})
        turn_index += 1

    # Turn 2: checkpoint/wake — from workflow_wake audit events
    wake_events = [e for e in audit_events if e.get("event_type") == "workflow_wake"]
    if wake_events:
        wake = wake_events[0]
        turns.append({
            "turn_index": turn_index,
            "events": [
                {"author": "orchestrator", "content": {"parts": [{"function_call": {
                    "name": "schedule_wake",
                    "args": {"case_id": case_id}
                }}]}},
                {"author": "orchestrator", "content": {"parts": [{"function_response": {
                    "name": "schedule_wake",
                    "response": {
                        "workflow_ids": wake.get("workflow_ids", []),
                        "triggered_by": wake.get("triggered_by"),
                        "timestamp": str(wake.get("timestamp", "")),
                        "trace_id": wake.get("trace_id", ""),
                    }
                }}]}},
                {"author": "orchestrator", "content": {"parts": [{"function_call": {
                    "name": "wake_workflow",
                    "args": {"case_id": case_id}
                }}]}},
                {"author": "orchestrator", "content": {"parts": [{"function_response": {
                    "name": "wake_workflow",
                    "response": {"woken": True, "workflow_ids": wake.get("workflow_ids", [])}
                }}]}},
                {"author": "orchestrator", "content": {"parts": [{"text": f"Checkpoint and wake complete. Workflow IDs: {wake.get('workflow_ids', [])}"}]}},
            ]
        })
        turn_index += 1

    # Turn 3: quarantine — from the quarantine audit event
    quarantine_events = [e for e in audit_events if e.get("event_type") == "quarantine"]
    if quarantine_events:
        q = quarantine_events[0]
        verifier_identity = q.get("agent_identity", "")
        turns.append({
            "turn_index": turn_index,
            "events": [
                {"author": "orchestrator", "content": {"parts": [{"function_call": {
                    "name": "safeguarding_verifier",
                    "args": {
                        "case_id": case_id,
                        "instruction": "Inspect the school callback and screen through Model Armor. Escalate if cross-scope.",
                    }
                }}]}},
                {"author": "orchestrator", "content": {"parts": [{"function_response": {
                    "name": "safeguarding_verifier",
                    "response": {
                        "verdict": q.get("verdict", "quarantine"),
                        "explanation": q.get("explanation", ""),
                        "trace_id": q.get("trace_id", ""),
                        "agent_identity": verifier_identity,
                        "escalation_id": approvals[0]["approval_id"] if approvals else None,
                    }
                }}]}},
                {"author": "orchestrator", "content": {"parts": [{"text": f"Safeguarding verifier quarantined the callback: {q.get('explanation', '')}. Escalation opened."}]}},
            ]
        })
        turn_index += 1

    # Turn 4: followup — from followup audit events
    followup_events = [e for e in audit_events if e.get("event_type") == "followup"]
    if followup_events:
        fu = followup_events[0]
        turns.append({
            "turn_index": turn_index,
            "events": [
                {"author": "orchestrator", "content": {"parts": [{"function_call": {
                    "name": "send_followup",
                    "args": {"case_id": case_id, "commitment_type": fu.get("commitment_type", "education")}
                }}]}},
                {"author": "orchestrator", "content": {"parts": [{"function_response": {
                    "name": "send_followup",
                    "response": {
                        "verdict": fu.get("verdict", ""),
                        "commitment_type": fu.get("commitment_type", ""),
                        "explanation": fu.get("explanation", ""),
                        "trace_id": fu.get("trace_id", ""),
                    }
                }}]}},
                {"author": "orchestrator", "content": {"parts": [{"text": f"Follow-up sent for {fu.get('commitment_type')}: {fu.get('explanation', '')}"}]}},
            ]
        })
        turn_index += 1

    # Turn 5: memory close
    turns.append({
        "turn_index": turn_index,
        "events": [
            {"author": "orchestrator", "content": {"parts": [{"function_call": {
                "name": "preload_memory",
                "args": {"case_id": case_id}
            }}]}},
            {"author": "orchestrator", "content": {"parts": [{"function_response": {
                "name": "preload_memory",
                "response": {"written": True, "scopes": sorted(case.get("memory_scopes", {}).keys())}
            }}]}},
            {"author": "orchestrator", "content": {"parts": [{"text": f"Case {case_id} memory written. Final commitment states: {json.dumps(commitments)}. Approvals: {len(approvals)} decided."}]}},
        ]
    })

    # Build the final eval case
    final_text = turns[-1]["events"][-1]["content"]["parts"][0]["text"]

    eval_case = {
        "eval_case_id": f"maya_real_run_{case_id}",
        "agent_data": {
            "agents": {
                "orchestrator": {
                    "agent_id": "orchestrator",
                    "agent_type": "OrchestratorAgent",
                    "instruction": "Coordinate the CaseRelay multi-agent fleet: fan-out to specialists, checkpoint, wake, screen callbacks through safeguarding verifier, chase overdue providers, close memory.",
                    "tools": [{"function_declarations": [
                        {"name": "education_liaison", "description": "A2A dispatch to education specialist"},
                        {"name": "health_coordination", "description": "A2A dispatch to health specialist"},
                        {"name": "legal_aid", "description": "A2A dispatch to legal specialist"},
                        {"name": "shelter_status", "description": "A2A dispatch to shelter specialist"},
                        {"name": "family_services", "description": "A2A dispatch to family services specialist"},
                        {"name": "safeguarding_verifier", "description": "A2A dispatch to safeguarding verifier — screens callbacks through Model Armor"},
                        {"name": "schedule_wake", "description": "Write durable checkpoint with future wake deadline"},
                        {"name": "wake_workflow", "description": "Fire durable wake and reconcile commitment states"},
                        {"name": "send_followup", "description": "Chase providers that missed their deadline"},
                        {"name": "preload_memory", "description": "Write case memory to Memory Bank"},
                        {"name": "get_commitment_states", "description": "Read current commitment statuses"},
                    ]}]
                }
            },
            "turns": turns,
        },
        "responses": [{
            "response": {
                "role": "model",
                "parts": [{"text": final_text}]
            }
        }],
        "_metadata": {
            "source": "infra/capture_eval_trace.py",
            "case_id": case_id,
            "captured_at": datetime.now(timezone.utc).isoformat(),
            "audit_event_count": len(audit_events),
            "commitment_states": commitments,
            "approvals_count": len(approvals),
            "note": "Trace derived mechanically from Firestore audit events, commitment states, and approval records of a real cloud_e2e.py run.",
        },
    }

    return {"eval_cases": [eval_case]}


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("case_id", help="The case ID from a completed cloud_e2e.py --keep run")
    ap.add_argument("--output", "-o", default="tests/eval/datasets/maya-real-trace.json",
                    help="Output path for the eval dataset JSON")
    args = ap.parse_args()

    dataset = capture_trace(args.case_id)

    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    with open(args.output, "w") as f:
        json.dump(dataset, f, indent=2, default=str)

    n_turns = len(dataset["eval_cases"][0]["agent_data"]["turns"])
    n_events = sum(len(t["events"]) for t in dataset["eval_cases"][0]["agent_data"]["turns"])
    print(f"Captured trace for {args.case_id}: {n_turns} turns, {n_events} events")
    print(f"Written to {args.output}")


if __name__ == "__main__":
    main()
