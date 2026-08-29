#!/usr/bin/env python3
"""Drive a full Maya case through the deployed control plane and capture the feed.

Handles the multi-run architecture:
  Run 1: intake → activation gate (parks)
  Run 2 (after activation): fanout (education deferred, 4 confirmed) → checkpoint → ends
  -- sweep fires when checkpoints come due → Pub/Sub → --
  Run 3 (resumed wake): wake (checking-back on education) → quarantine → escalation gate (parks)
  Run 4 (after escalation): followup → nudge (Sarah Miller named) → memory → ends
"""

import json
import subprocess
import sys
import time

import httpx

CP_URL = open("infra/control_plane_url.txt").read().strip()


def token():
    return subprocess.check_output(
        ["gcloud", "auth", "print-identity-token"],
        stderr=subprocess.DEVNULL,
    ).decode().strip()


def hdrs():
    return {"Authorization": f"Bearer {token()}"}


def get(path, timeout=60):
    return httpx.get(f"{CP_URL}{path}", headers=hdrs(), timeout=timeout)


def post(path, body=None, timeout=60):
    if body:
        return httpx.post(f"{CP_URL}{path}", json=body, headers=hdrs(), timeout=timeout)
    return httpx.post(f"{CP_URL}{path}", headers=hdrs(), timeout=timeout)


def msg(ev):
    """Extract message from AG-UI envelope."""
    if ev.get("type") == "CUSTOM":
        return (ev.get("value") or {}).get("message", "")
    raw = ev.get("rawEvent") or {}
    return raw.get("message", ev.get("message", ""))


# ── Step 1: Create case ──────────────────────────────────────────────────────

print("=== Creating Maya case ===")
r = post("/v1/cases", {"scenario": "maya", "due_in": "45s"})
r.raise_for_status()
case_data = r.json()
case_id = case_data["case_id"]
print(f"   case_id: {case_id}")
print(f"   due_at: {case_data.get('due_at')}")

# ── Step 2: Start run → wait for activation gate ─────────────────────────────

print("\n=== Starting run ===")
r = post(f"/v1/cases/{case_id}/runs")
r.raise_for_status()
run_id = r.json()["run_id"]
print(f"   run_id: {run_id}")

print("\n=== Waiting for activation gate ===")
for i in range(60):
    time.sleep(5)
    r = get(f"/v1/runs/{run_id}")
    run = r.json()
    state = run.get("state", "")
    phase = run.get("current_phase", "")
    print(f"   [{i*5}s] state={state} phase={phase}")
    if state == "awaiting_supervisor" and "activation" in str(phase):
        break
    if state in ("completed", "failed", "partial_failure"):
        print(f"   Run ended unexpectedly: {state}")
        break

# ── Step 3: Activate case ────────────────────────────────────────────────────

print("\n=== Activating case ===")
r = post(f"/v1/cases/{case_id}/activate", {"supervisor_id": "demo-supervisor"})
r.raise_for_status()
print(f"   activated -> {r.json()}")

# ── Step 4: Wait for post-activation run to complete ─────────────────────────

print("\n=== Waiting for post-activation run to complete ===")
post_activation_done = False
for i in range(120):
    time.sleep(5)
    try:
        r = get(f"/v1/cases/{case_id}/runs")
        runs = r.json()
    except Exception as exc:
        print(f"   [{i*5}s] error: {exc}")
        continue
    if not runs:
        continue
    latest = runs[0]
    state = latest.get("state", "")
    phase = latest.get("current_phase", "")
    rid = latest.get("run_id", "")[:8]
    if i % 6 == 0 or state != "running":
        print(f"   [{i*5}s] run={rid} state={state} phase={phase}")

    if state == "awaiting_supervisor" and "escalation" in str(phase):
        print("   Escalation gate found in same run!")
        post_activation_done = True
        break

    if state in ("completed", "partial_failure", "failed", "suspended"):
        print(f"   Post-activation run ended: {state}")
        post_activation_done = True
        break

if not post_activation_done:
    print("   WARNING: timed out waiting for post-activation run")

# ── Step 5: Trigger sweeps to fire checkpoint wakes ──────────────────────────

commitments = get(f"/v1/cases/{case_id}").json().get("commitments", {})
print(f"\n=== Current commitments: {json.dumps(commitments)} ===")

escalation_done = False
escalation_gate_seen = False

if "deferred" in commitments.values() or any(v not in ("completed",) for v in commitments.values()):
    print("\n=== Triggering sweeps to fire checkpoint wakes ===")
    sweep_attempts = 0
    for sweep_round in range(30):
        time.sleep(10)
        sweep_attempts += 1

        try:
            r = post("/v1/workflows/sweep")
            sweep = r.json()
            fired = sweep.get("count", 0)
            if fired > 0:
                print(f"   sweep {sweep_round}: fired {fired} wakes")
            elif sweep_round % 3 == 0:
                print(f"   sweep {sweep_round}: nothing due yet")
        except Exception as exc:
            print(f"   sweep {sweep_round}: error {exc}")

        try:
            r = get(f"/v1/cases/{case_id}/runs")
            runs = r.json()
        except Exception:
            continue

        if not runs:
            continue
        latest = runs[0]
        state = latest.get("state", "")
        phase = latest.get("current_phase", "")
        rid = latest.get("run_id", "")[:8]

        if state == "awaiting_supervisor" and "escalation" in str(phase) and not escalation_done:
            escalation_gate_seen = True
            print(f"\n=== Escalation gate found (run={rid}) ===")
            time.sleep(2)

            r2 = get("/v1/approvals")
            approvals = r2.json()
            esc = next(
                (a for a in approvals
                 if a.get("action_type") == "escalation" and a.get("case_id") == case_id),
                None,
            )
            if esc:
                aid = esc["approval_id"]
                print(f"   approving escalation {aid}")
                r3 = post(
                    f"/v1/approvals/{aid}/decide",
                    {"decision": "approved", "decided_by": "demo-supervisor"},
                )
                r3.raise_for_status()
                print(f"   decided -> {r3.json()}")
                escalation_done = True
            continue

        if state in ("completed", "partial_failure", "failed") and escalation_done:
            print(f"\n=== Final run completed: {state} (run={rid}) ===")
            break

        if state == "running":
            if sweep_round % 6 == 0:
                print(f"   [{sweep_round*10}s] run={rid} state={state} phase={phase}")
    else:
        print("   WARNING: sweep loop exhausted (300s)")

# ── Step 6: Dump the complete feed ───────────────────────────────────────────

print("\n\n" + "=" * 60)
print("    COMPLETE MAYA FEED SEQUENCE")
print("=" * 60 + "\n")

r = get(f"/v1/cases/{case_id}/events")
events = r.json()
for ev in events:
    ts = ev.get("timestamp", 0)
    if isinstance(ts, (int, float)):
        from datetime import datetime, timezone
        ts_str = datetime.fromtimestamp(ts / 1000, tz=timezone.utc).strftime("%H:%M:%S")
    else:
        ts_str = str(ts)[-8:]
    m = msg(ev)
    if m:
        print(f"  [{ts_str}] {m}")

# ── Step 7: Final state ─────────────────────────────────────────────────────

print("\n\n" + "=" * 60)
print("    FINAL CASE STATE")
print("=" * 60 + "\n")

r = get(f"/v1/cases/{case_id}")
case_final = r.json()
print(f"  case status: {case_final.get('case', {}).get('status')}")
print(f"  commitments: {json.dumps(case_final.get('commitments', {}), indent=2)}")
print(f"  grants: {len(case_final.get('grants', []))}")
print(f"  audit events: {len(case_final.get('timeline', []))}")

# Deferral audit check
try:
    r = get(f"/v1/cases/{case_id}/audit")
    audit = r.json()
    deferrals = [e for e in audit if e.get("event_type") == "commitment_deferred"]
    print(f"  deferral audit events: {len(deferrals)}")
    for d in deferrals:
        print(f"    - {d.get('commitment_type')}: {d.get('explanation', '')[:100]}")
except Exception as exc:
    print(f"  audit check failed: {exc}")

# ── Step 8: Verification summary ─────────────────────────────────────────────

print("\n\n" + "=" * 60)
print("    VERIFICATION CHECKLIST")
print("=" * 60 + "\n")

all_events_text = [msg(ev) for ev in events if msg(ev)]
feed_text = "\n".join(all_events_text)
commitments = case_final.get("commitments", {})

checks = [
    ("Activation gate parks", any("supervisor" in m.lower() and "activat" in m.lower() for m in all_events_text)),
    ("Quarantine fires", any("safeguarding" in m.lower() or "quarantine" in m.lower() for m in all_events_text)),
    ("Escalation gate parks", escalation_gate_seen),
    ("Education deferral in feed", any("more time" in m.lower() or "check back" in m.lower() for m in all_events_text)),
    ("Shelter ends completed", commitments.get("shelter") == "completed"),
    ("Education ends completed", commitments.get("education") == "completed"),
    ("All 5 commitments present", len(commitments) == 5),
]

all_ok = True
for label, ok in checks:
    status = "PASS" if ok else "FAIL"
    if not ok:
        all_ok = False
    print(f"  [{status}] {label}")

# ── Step 9: Cleanup ─────────────────────────────────────────────────────────

print(f"\n=== Cleaning up case {case_id} ===")
try:
    r = httpx.delete(f"{CP_URL}/v1/cases/{case_id}", headers=hdrs(), timeout=30)
    print(f"   deleted: {r.status_code}")
except Exception as exc:
    print(f"   cleanup failed: {exc}")

print(f"\n{'MAYA E2E: ALL CHECKS PASSED' if all_ok else 'MAYA E2E: SOME CHECKS FAILED'}")
sys.exit(0 if all_ok else 1)
