"""CaseRelay Control Plane — v1 API.

All routes are under /v1. Legacy routes from earlier prototypes have been removed.
"""

from __future__ import annotations

import asyncio
import json
import threading
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from backend.identity.registry import IdentityDenied
from backend.runtime.workspace import CaseNotFound, workspace
from backend.state import dataset, scenarios as _scenarios_mod
from backend.workflows import durable

app = FastAPI(
    title="CaseRelay Control Plane",
    version="1.0.0",
    description="Versioned HTTP control plane for the CaseRelay multi-agent fleet.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "https://caserelay-portal.web.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# exception handlers
# ---------------------------------------------------------------------------


@app.exception_handler(CaseNotFound)
async def _case_not_found(request: Request, exc: CaseNotFound) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.exception_handler(IdentityDenied)
async def _identity_denied(request: Request, exc: IdentityDenied) -> JSONResponse:
    return JSONResponse(status_code=403, content={"detail": str(exc)})


@app.exception_handler(KeyError)
async def _key_error(request: Request, exc: KeyError) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.exception_handler(ValueError)
async def _value_error(request: Request, exc: ValueError) -> JSONResponse:
    return JSONResponse(status_code=400, content={"detail": str(exc)})


# ---------------------------------------------------------------------------
# health
# ---------------------------------------------------------------------------


@app.get("/health")
def health() -> dict:
    return {"ok": True}


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _parse_duration(s: str) -> timedelta:
    """Parse a duration string like '45s', '5m', '2h', '17d' into a timedelta."""
    s = s.strip()
    if s.endswith("s"):
        return timedelta(seconds=int(s[:-1]))
    if s.endswith("m"):
        return timedelta(minutes=int(s[:-1]))
    if s.endswith("h"):
        return timedelta(hours=int(s[:-1]))
    if s.endswith("d"):
        return timedelta(days=int(s[:-1]))
    raise ValueError(f"cannot parse duration {s!r}; expected e.g. '45s', '17d'")


def _resolve_deadline(due_in: str | None, scenario_name: str | None) -> datetime:
    """Compute due_at once at creation time. Never called on an existing case."""
    if due_in:
        return datetime.now(timezone.utc) + _parse_duration(due_in)
    spec = _scenarios_mod.get_scenario(scenario_name) if scenario_name else None
    days = getattr(spec, "default_due_days", 17) if spec else 17
    return datetime.now(timezone.utc) + timedelta(days=days)


# ---------------------------------------------------------------------------
# Stage 1 read models
# ---------------------------------------------------------------------------


@app.get(
    "/v1/cases",
    responses={403: {"description": "Identity denied"}, 404: {"description": "Not found"}},
)
def list_cases() -> list[dict]:
    from backend.state import store

    if store.enabled():
        return store.list_cases()
    return [
        {
            "case_id": cid,
            "child_name": c.get("child_name", ""),
            "status": c.get("status", ""),
            "test_case": c.get("test_case", False),
        }
        for cid, c in workspace.cases.items()
    ]


@app.get(
    "/v1/cases/{case_id}",
    responses={403: {"description": "Identity denied"}, 404: {"description": "Case not found"}},
)
def get_case(case_id: str) -> dict:
    case = workspace.get_case(case_id)
    return {
        "case": case,
        "commitments": workspace.commitment_states(case_id),
        "grants": workspace.grants.get(case_id, []),
        "timeline": workspace.list_audit(case_id)[:20],
    }


@app.get(
    "/v1/cases/{case_id}/audit",
    responses={404: {"description": "Case not found"}},
)
def get_audit(case_id: str, trace_id: str | None = None, event_type: str | None = None) -> list[dict]:
    events = workspace.list_audit(case_id)
    if trace_id:
        events = [e for e in events if e.get("trace_id") == trace_id]
    if event_type:
        events = [e for e in events if e.get("event_type") == event_type]
    return events


@app.get(
    "/v1/cases/{case_id}/memory",
    responses={404: {"description": "Case not found"}},
)
def get_memory(case_id: str) -> dict:
    workspace.get_case(case_id)  # raises CaseNotFound if absent
    return workspace.memory.get(case_id, {})


@app.get(
    "/v1/approvals",
    responses={403: {"description": "Identity denied"}},
)
def list_approvals() -> list[dict]:
    pending = []
    for case_id in workspace.cases:
        for a in workspace.list_approvals(case_id):
            if a.get("decision") == "pending":
                pending.append({**a, "case_id": case_id})
    return pending


@app.get("/v1/registry")
def get_registry() -> list[dict]:
    from backend.state.fixtures import agent_cards
    try:
        return agent_cards()
    except Exception:  # noqa: BLE001
        return []


@app.get(
    "/v1/traces/{trace_id}",
    responses={404: {"description": "Trace not found"}},
)
def get_trace(trace_id: str) -> dict:
    from backend.runtime.trace import tracer

    hops = [h for h in tracer.as_table() if h.get("trace_id") == trace_id]
    project = __import__("os").environ.get("GOOGLE_CLOUD_PROJECT", "caserelay")
    cloud_trace_url = (
        f"https://console.cloud.google.com/traces/list?project={project}"
        f"&tid={trace_id}"
    )
    return {"trace_id": trace_id, "hops": hops, "cloud_trace_url": cloud_trace_url}


# ---------------------------------------------------------------------------
# Stage 1 write routes
# ---------------------------------------------------------------------------


@app.post(
    "/v1/cases",
    status_code=201,
    responses={
        400: {"description": "Bad request"},
        403: {"description": "Identity denied"},
        404: {"description": "Not found"},
    },
)
def create_case(body: dict[str, Any]) -> dict:
    scenario_name = body.get("scenario")
    due_in_str = body.get("due_in")
    case_id = body.get("case_id") or dataset.synthetic.new_case_id()

    if scenario_name:
        spec = _scenarios_mod.get_scenario(scenario_name)
        if spec is None:
            raise HTTPException(status_code=400, detail=f"unknown scenario {scenario_name!r}")
        dataset.create_case(case_id, scenario=scenario_name)
    else:
        # Raw referral-packet intake.
        packet = {k: v for k, v in body.items() if k not in ("case_id", "due_in")}
        packet["case_id"] = case_id
        workspace.create_case(case_id, packet)

    deadline = _resolve_deadline(due_in_str, scenario_name)
    cp = durable.write_checkpoint(case_id, deadline)

    return {
        "case_id": case_id,
        "scenario": scenario_name,
        "due_at": cp["due_at"].isoformat() if isinstance(cp["due_at"], datetime) else str(cp["due_at"]),
        "summary": f"Case {case_id} created" + (f" from scenario '{scenario_name}'" if scenario_name else ""),
    }


@app.post(
    "/v1/cases/{case_id}/activate",
    responses={404: {"description": "Case not found"}},
)
def activate_case(case_id: str, body: dict[str, Any] | None = None) -> dict:
    supervisor_id = (body or {}).get("supervisor_id", "supervisor-001")
    case = workspace.activate(case_id, supervisor_id)
    return {"case_id": case_id, "status": case["status"]}


@app.post(
    "/v1/approvals/{approval_id}/decide",
    responses={404: {"description": "Approval not found"}, 400: {"description": "Bad request"}},
)
def decide_approval(approval_id: str, body: dict[str, Any]) -> dict:
    decision = body.get("decision")
    decided_by = body.get("decided_by", "supervisor-001")
    note = body.get("note", "")
    if decision not in ("approve", "reject", "approved", "rejected"):
        raise HTTPException(status_code=400, detail="decision must be 'approve' or 'reject'")
    # Find the case that owns this approval.
    for case_id in workspace.cases:
        for a in workspace.list_approvals(case_id):
            if str(a.get("approval_id")) == approval_id:
                result = workspace.decide_approval(case_id, decision, decided_by)
                if note:
                    result["note"] = note
                return result
    raise HTTPException(status_code=404, detail=f"approval {approval_id!r} not found")


@app.post(
    "/v1/workflows/sweep",
    responses={403: {"description": "Unauthorized"}},
)
def sweep_workflows() -> dict:
    fired = durable.sweep()
    return {"fired": fired, "count": len(fired)}


@app.post(
    "/v1/workflows/{workflow_id}/wake",
    responses={404: {"description": "Workflow not found"}},
)
def wake_workflow(workflow_id: str) -> dict:
    cp = workspace.get_checkpoint(workflow_id)
    if not cp:
        raise HTTPException(status_code=404, detail=f"workflow {workflow_id!r} not found")
    case_id = cp.get("case_id", "")
    return durable.resume_wake(case_id, workflow_id)


# ---------------------------------------------------------------------------
# Test-data routes
# ---------------------------------------------------------------------------


@app.get("/v1/scenarios")
def list_scenarios() -> list[dict]:
    return [s.to_dict() for s in _scenarios_mod.all_scenarios().values()]


@app.delete(
    "/v1/cases/{case_id}",
    responses={
        403: {"description": "Case is not a test case and cannot be deleted via API"},
        404: {"description": "Case not found"},
    },
)
def delete_case(case_id: str) -> dict:
    case = workspace.get_case(case_id)
    packet = case.get("referral_packet", {})
    if not (case.get("test_case") or packet.get("test_case")):
        raise HTTPException(
            status_code=403,
            detail=f"case {case_id!r} is not a test case; deletion refused",
        )
    dataset.delete_case(case_id)
    return {"deleted": case_id}


# ---------------------------------------------------------------------------
# Async runs
# ---------------------------------------------------------------------------


def _run_background(run_id: str, case_id: str) -> None:
    """Drive the real agent fleet end-to-end: intake, then orchestrator through PHASES."""
    from backend.agents.intake.agent import root_agent as intake_agent
    from backend.agents.orchestrator.agent import root_agent as orchestrator_agent
    from backend.runtime.context import bind as _bind
    from backend.runtime.fleet import PHASES
    from backend.runtime.invoke import run_agent

    with _bind(case_id=case_id, run_id=run_id):
        try:
            workspace.update_run(run_id, state="running", current_phase="intake")
            workspace.push_run_event(run_id, {
                "event": "run_started", "run_id": run_id, "case_id": case_id,
            })

            intake_text = run_agent(
                intake_agent,
                f"Process the referral packet for case {case_id}. Extract commitments and propose grants.",
                app_name="intake_authority",
            )
            workspace.push_run_event(run_id, {
                "event": "phase_complete", "run_id": run_id,
                "phase": "intake", "summary": intake_text[:300],
                "commitment_states": workspace.commitment_states(case_id),
            })

            if not workspace.commitments.get(case_id) or not workspace.grants.get(case_id):
                raise RuntimeError(f"intake did not persist commitments/grants: {intake_text[:400]}")

            phase_failures = 0
            total_phases = len(PHASES)
            failed_phases: list[str] = []

            for label, template in PHASES:
                prompt = template.format(case_id=case_id)
                workspace.update_run(
                    run_id, current_phase=label,
                    commitment_states=workspace.commitment_states(case_id),
                )
                workspace.push_run_event(run_id, {
                    "event": "phase_started", "run_id": run_id, "phase": label,
                })
                try:
                    orch_text = run_agent(orchestrator_agent, prompt, app_name="continuity_orchestrator")
                except Exception as phase_exc:  # noqa: BLE001
                    phase_failures += 1
                    failed_phases.append(label)
                    workspace.push_run_event(run_id, {
                        "event": "phase_error", "run_id": run_id,
                        "phase": label, "error": str(phase_exc),
                    })
                    continue
                workspace.push_run_event(run_id, {
                    "event": "phase_complete", "run_id": run_id,
                    "phase": label, "summary": orch_text[:300],
                    "commitment_states": workspace.commitment_states(case_id),
                })

            commitments = workspace.commitment_states(case_id)

            if phase_failures == total_phases:
                workspace.update_run(
                    run_id, state="failed", current_phase="done",
                    error=f"all {total_phases} phases failed",
                    commitment_states=commitments,
                    failed_phases=failed_phases,
                )
                workspace.push_run_event(run_id, {
                    "event": "run_failed", "run_id": run_id, "case_id": case_id,
                    "error": f"all {total_phases} phases failed",
                    "failed_phases": failed_phases,
                    "commitment_states": commitments,
                })
            elif phase_failures > 0:
                workspace.update_run(
                    run_id, state="partial_failure", current_phase="done",
                    error=f"{phase_failures}/{total_phases} phases failed",
                    commitment_states=commitments,
                    failed_phases=failed_phases,
                )
                workspace.push_run_event(run_id, {
                    "event": "run_partial_failure", "run_id": run_id, "case_id": case_id,
                    "error": f"{phase_failures}/{total_phases} phases failed",
                    "failed_phases": failed_phases,
                    "commitment_states": commitments,
                })
            else:
                workspace.update_run(
                    run_id, state="completed", current_phase="done",
                    commitment_states=commitments,
                )
                workspace.push_run_event(run_id, {
                    "event": "run_completed", "run_id": run_id, "case_id": case_id,
                    "commitment_states": commitments,
                })
        except Exception as exc:  # noqa: BLE001
            workspace.update_run(run_id, state="failed", error=str(exc))
            workspace.push_run_event(run_id, {
                "event": "run_failed", "run_id": run_id, "error": str(exc),
            })


@app.post(
    "/v1/cases/{case_id}/runs",
    status_code=202,
    responses={404: {"description": "Case not found"}},
)
def submit_run(case_id: str) -> dict:
    workspace.get_case(case_id)  # raises CaseNotFound if absent
    run_id = uuid4().hex[:12]
    from backend.runtime.context import current as _ctx
    workspace.create_run(run_id, case_id)
    workspace.update_run(run_id, trace_id=_ctx().trace_id)
    t = threading.Thread(target=_run_background, args=(run_id, case_id), daemon=True)
    t.start()
    return {"run_id": run_id, "case_id": case_id, "state": "queued"}


@app.get(
    "/v1/runs/{run_id}",
    responses={404: {"description": "Run not found"}},
)
def get_run(run_id: str) -> dict:
    run = workspace.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail=f"run {run_id!r} not found")
    result = {
        "run_id": run["run_id"],
        "state": run.get("state", "queued"),
        "current_phase": run.get("current_phase"),
        "commitment_states": run.get("commitment_states", {}),
        "trace_id": run.get("trace_id", ""),
    }
    if run.get("error"):
        result["error"] = run["error"]
    if run.get("failed_phases"):
        result["failed_phases"] = run["failed_phases"]
    return result


_TERMINAL_STATES = {"completed", "failed", "partial_failure"}

_SSE_HEARTBEAT_INTERVAL = 15
_SSE_MAX_DURATION = 1800


@app.get(
    "/v1/runs/{run_id}/events",
    responses={404: {"description": "Run not found"}},
)
def stream_run_events(run_id: str, request: Request) -> StreamingResponse:
    """SSE stream of run events. Lasts as long as the run does.

    The stream terminates when the run reaches a terminal state (completed,
    failed, partial_failure). Heartbeat comments are sent every 15 s to keep
    the connection alive through proxies. A 30-minute safety valve prevents
    leaked connections; if it fires, an explicit stream_timeout event is sent.

    Client disconnect is handled at the ASGI layer: uvicorn cancels the response
    task (raising CancelledError in asyncio.sleep), cleanly stopping the generator.
    Starlette's Request.is_disconnected() is not used because it deadlocks under
    anyio-shielded cancel scopes in TestClient and older Starlette builds.
    """
    run = workspace.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail=f"run {run_id!r} not found")

    async def _generate():
        yield "retry: 1000\n\n"
        yield f"data: {json.dumps({'event': 'connected', 'run_id': run_id, 'state': run.get('state', 'queued')})}\n\n"
        sent = 0
        elapsed = 0.0
        since_heartbeat = 0.0
        poll_interval = 0.5
        while elapsed < _SSE_MAX_DURATION:
            current = workspace.get_run(run_id)
            if current is None:
                return
            events = current.get("events", [])
            for ev in events[sent:]:
                yield f"data: {json.dumps(ev)}\n\n"
                sent += 1
                since_heartbeat = 0.0
            state = current.get("state", "queued")
            if state in _TERMINAL_STATES:
                yield f"data: {json.dumps({'event': 'stream_end', 'run_id': run_id, 'state': state})}\n\n"
                return
            if since_heartbeat >= _SSE_HEARTBEAT_INTERVAL:
                yield f": heartbeat {int(elapsed)}s\n\n"
                since_heartbeat = 0.0
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval
            since_heartbeat += poll_interval
        yield f"data: {json.dumps({'event': 'stream_timeout', 'run_id': run_id, 'reason': 'safety valve after 30 minutes'})}\n\n"

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
