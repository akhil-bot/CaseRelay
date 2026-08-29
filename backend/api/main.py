"""CaseRelay Control Plane — v1 API.

All routes are under /v1. Legacy routes from earlier prototypes have been removed.
"""

from __future__ import annotations

import asyncio
import contextvars
import json
import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

# Root logging configuration — ensures INFO-level application logs reach Cloud Logging.
# Without this, logging.lastResort applies at WARNING and everything below is dropped.
# Scoped to caserelay.* and backend.* loggers; third-party libraries stay at WARNING
# to avoid excessive noise from google-adk, httpx, etc.
_log_level = logging.DEBUG if os.environ.get("CASERELAY_DEBUG") else logging.INFO
logging.basicConfig(
    level=logging.WARNING,
    format="%(levelname)s %(name)s: %(message)s",
)
for _ns in ("caserelay", "backend"):
    logging.getLogger(_ns).setLevel(_log_level)

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from backend.api.wire import to_agui
from backend.identity.registry import IdentityDenied
from backend.runtime import event_log
from backend.runtime.workspace import CaseNotFound, workspace
from backend.state import dataset, scenarios as _scenarios_mod
from backend.workflows import durable
from backend.workflows.escalation import SUPERVISOR_NOTICE

if os.environ.get("CASERELAY_CONTROL_PLANE", "").strip() == "1":
    from backend.agents.orchestrator.agent import resolve_specialists
    resolve_specialists()

app = FastAPI(
    title="CaseRelay Control Plane",
    version="1.0.0",
    description="Versioned HTTP control plane for the CaseRelay multi-agent fleet.",
)

_agui_logger = logging.getLogger("caserelay.agui")

try:
    from backend.api.agui import agui_app
    app.mount("/agui", agui_app)
    _agui_logger.info("AG-UI chat endpoint mounted at /agui")
except Exception as _agui_exc:
    _agui_logger.error("Failed to load AG-UI chat endpoint: %s", _agui_exc, exc_info=True)
    if os.environ.get("CASERELAY_CONTROL_PLANE", "").strip() == "1":
        raise RuntimeError(
            f"AG-UI chat endpoint failed to load on the control plane: {_agui_exc}"
        ) from _agui_exc

try:
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    FastAPIInstrumentor.instrument_app(app)
except Exception as _e:
    logging.getLogger("caserelay.otel").warning("FastAPI OTel instrumentation failed: %s", _e)

try:
    from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
    HTTPXClientInstrumentor().instrument()
except Exception as _e:
    logging.getLogger("caserelay.otel").warning("HTTPX OTel instrumentation failed: %s", _e)

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


@app.get("/v1/probe", include_in_schema=False)
async def probe_a2a() -> dict:
    """Deployment readiness probe: fetch one specialist's A2A agent card via authenticated_client().

    Called by the deploy script on the canary revision before traffic is shifted.
    Unlike /health, this exercises the outbound authenticated HTTP path that broke
    when a sync event hook was registered — every health check stayed green while
    every A2A call failed. This probe fails in the same conditions that break production.
    """
    import os

    from backend.runtime.a2a_auth import authenticated_client

    _PROBE_CANDIDATES = [
        ("intake", "CASERELAY_URL_INTAKE", "intake"),
        ("education", "CASERELAY_URL_EDUCATION", "education"),
        ("health", "CASERELAY_URL_HEALTH", "health"),
        ("legal", "CASERELAY_URL_LEGAL", "legal"),
    ]

    target_url = None
    target_name = None
    for name, env_var, folder in _PROBE_CANDIDATES:
        base = os.environ.get(env_var, "").rstrip("/")
        if base:
            target_url = f"{base}/a2a/{folder}/.well-known/agent-card.json"
            target_name = name
            break

    if not target_url:
        raise HTTPException(
            status_code=503,
            detail="No specialist endpoints configured (CASERELAY_URL_*); cannot perform A2A probe.",
        )

    async with authenticated_client(timeout=30.0) as client:
        try:
            resp = await client.get(target_url)
            resp.raise_for_status()
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail=f"A2A probe to {target_name!r} agent card failed: {exc}",
            )

    return {"ok": True, "probed_agent": target_name, "http_status": resp.status_code}


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


def _resolve_due_in(due_in: str | None, scenario_name: str | None) -> str | None:
    """Resolve the effective due_in string. Stored on the case for checkpoint anchoring."""
    if due_in:
        return due_in
    spec = _scenarios_mod.get_scenario(scenario_name) if scenario_name else None
    if spec and getattr(spec, "default_due_in", None):
        return spec.default_due_in
    return None


def _resolve_deadline(due_in: str | None, scenario_name: str | None) -> datetime:
    """Compute due_at once at creation time. Never called on an existing case."""
    if due_in:
        return datetime.now(timezone.utc) + _parse_duration(due_in)
    spec = _scenarios_mod.get_scenario(scenario_name) if scenario_name else None
    if spec and getattr(spec, "default_due_in", None):
        return datetime.now(timezone.utc) + _parse_duration(spec.default_due_in)
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
        packet = {k: v for k, v in body.items() if k not in ("case_id", "due_in")}
        packet["case_id"] = case_id
        workspace.create_case(case_id, packet)

    effective_due_in = _resolve_due_in(due_in_str, scenario_name)
    case = workspace.get_case(case_id)
    if effective_due_in:
        case["due_in"] = effective_due_in

    deadline = _resolve_deadline(due_in_str, scenario_name)
    cp = durable.write_checkpoint(case_id, deadline)

    from backend.state import store
    store.save_case(case_id, case)

    return {
        "case_id": case_id,
        "scenario": scenario_name,
        "due_at": cp["due_at"].isoformat() if isinstance(cp["due_at"], datetime) else str(cp["due_at"]),
        "summary": f"Case {case_id} created" + (f" from scenario '{scenario_name}'" if scenario_name else ""),
    }


def _resume_after_approval(case_id: str, trigger: str) -> None:
    """Resume a run that is suspended at a supervisor gate after the gate is satisfied.

    ``trigger`` names which gate was cleared. It is narration only: the successor run
    opens by saying what restarted it, and a cleared gate must not be announced as a
    scheduled reminder.
    """
    blocked = [
        r for r in workspace.list_runs_for_case(case_id)
        if r.get("state") == "awaiting_supervisor"
    ]
    if not blocked:
        return
    old_run = blocked[0]
    old_run_id = old_run["run_id"]
    workspace.update_run(old_run_id, state="completed", current_phase="approved")
    run_id = uuid4().hex[:12]
    workspace.create_run(run_id, case_id)
    from backend.runtime.context import current as _ctx
    workspace.update_run(run_id, trace_id=_ctx().trace_id)
    t = threading.Thread(
        target=_run_background, args=(run_id, case_id),
        kwargs={"resume": True, "resume_trigger": trigger}, daemon=True,
    )
    t.start()


@app.post(
    "/v1/cases/{case_id}/activate",
    responses={404: {"description": "Case not found"}},
)
def activate_case(case_id: str, body: dict[str, Any] | None = None) -> dict:
    supervisor_id = (body or {}).get("supervisor_id")
    if not supervisor_id:
        raise HTTPException(status_code=400, detail="supervisor_id is required")
    case = workspace.activate(case_id, supervisor_id)
    _resume_after_approval(case_id, "activation")
    return {"case_id": case_id, "status": case["status"]}


@app.post(
    "/v1/approvals/{approval_id}/decide",
    responses={404: {"description": "Approval not found"}, 400: {"description": "Bad request"}},
)
def decide_approval(approval_id: str, body: dict[str, Any]) -> dict:
    decision = body.get("decision")
    decided_by = body.get("decided_by")
    note = body.get("note", "")
    if not decided_by:
        raise HTTPException(status_code=400, detail="decided_by is required")
    if decision not in ("approve", "reject", "approved", "rejected"):
        raise HTTPException(status_code=400, detail="decision must be 'approve' or 'reject'")
    for case_id in workspace.cases:
        for a in workspace.list_approvals(case_id):
            if str(a.get("approval_id")) == approval_id:
                result = workspace.decide_approval(case_id, decision, decided_by, approval_id)
                if note:
                    result["note"] = note
                _resume_after_approval(case_id, str(a.get("action_type") or "escalation"))
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


import base64

_push_logger = logging.getLogger("caserelay.pubsub_push")


def _verify_oidc_token(request: Request) -> dict | None:
    """Verify the OIDC token on an authenticated Pub/Sub push.

    Returns the decoded claims on success, None on failure. In non-deployed
    environments (no CASERELAY_CONTROL_PLANE), skips verification so local
    testing with curl works without a real token.
    """
    if os.environ.get("CASERELAY_CONTROL_PLANE", "").strip() != "1":
        return {"email": "local-test@caserelay.local"}

    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        _push_logger.warning("push rejected: no Bearer token")
        return None
    token = auth[7:]

    try:
        from google.auth.transport import requests as google_requests
        from google.oauth2 import id_token
        url_file = os.path.join(os.path.dirname(__file__), "../../infra/control_plane_url.txt")
        audience = os.environ.get("CASERELAY_PUSH_AUDIENCE", "")
        if not audience:
            try:
                with open(url_file) as f:
                    audience = f.read().strip()
            except FileNotFoundError:
                audience = ""
        claims = id_token.verify_oauth2_token(token, google_requests.Request(), audience=audience or None)
        return claims
    except Exception as exc:
        _push_logger.warning("OIDC verification failed: %s", exc)
        return None


@app.post("/v1/pubsub/push")
async def pubsub_push(request: Request) -> JSONResponse:
    """Authenticated Pub/Sub push handler. Processes sweep triggers and wake messages.

    Idempotency: a wake for a case that already has an active run is acknowledged
    without starting a duplicate. Duplicate Pub/Sub deliveries produce exactly one run.
    """
    claims = _verify_oidc_token(request)
    if claims is None:
        return JSONResponse(status_code=403, content={"detail": "invalid OIDC token"})

    try:
        envelope = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"detail": "invalid JSON"})

    raw = envelope.get("message", {}).get("data", "")
    if raw:
        try:
            payload = json.loads(base64.b64decode(raw))
        except Exception:
            payload = {}
    else:
        payload = {}

    action = payload.get("action", "")
    event_type = payload.get("event_type", "")

    if action == "sweep":
        fired = durable.sweep()
        _push_logger.info("sweep fired %d workflows", len(fired))
        return JSONResponse({"fired": fired, "count": len(fired)})

    if event_type == "workflow_wake":
        case_id = payload.get("case_id", "")
        workflow_id = payload.get("workflow_id", "")
        if not case_id:
            return JSONResponse(status_code=400, content={"detail": "missing case_id"})

        # If the specific checkpoint is already completed, this is a genuine duplicate
        # delivery (at-least-once semantics). Safe to ack — the work is done.
        if workflow_id:
            cp = workspace.get_checkpoint(workflow_id)
            if cp and cp.get("state") == "completed":
                _push_logger.info("wake for %s/%s acked — checkpoint already completed", case_id, workflow_id)
                return JSONResponse({"status": "deduplicated", "reason": "checkpoint_completed"})

        # A wake whose case has been deleted can never be actioned, so retrying it is
        # pointless: ack it and clear the state that produced it. Without this the sweep
        # republishes the same unprocessable wake every minute and the retries crowd out
        # wakes for live cases.
        if not durable.case_is_live(case_id):
            retired = durable.retire_case_wakes(case_id)
            _push_logger.info(
                "wake for %s discarded — case no longer exists; retired %d checkpoint(s)",
                case_id, len(retired),
            )
            return JSONResponse({"status": "discarded", "reason": "case_deleted", "retired": retired})

        # If a run is already active for this case — or parked at a supervisor gate —
        # return 409 so Pub/Sub retries with backoff. A gated run must not be bypassed by
        # a wake: the case cannot proceed until a human unblocks it via the API.
        active = [
            r for r in workspace.list_runs_for_case(case_id)
            if r.get("state") in ("queued", "running", "awaiting_supervisor")
        ]
        if active:
            _push_logger.info(
                "wake for %s nacked — run %s active, Pub/Sub will retry",
                case_id, active[0].get("run_id"),
            )
            return JSONResponse(
                status_code=409,
                content={"status": "busy", "existing_run": active[0].get("run_id")},
            )

        from backend.state import store as _store
        run_id = uuid4().hex[:12]
        if not _store.try_acquire_case_lock(case_id, run_id):
            _push_logger.info("wake for %s nacked — case lock held, Pub/Sub will retry", case_id)
            return JSONResponse(status_code=409, content={"status": "busy", "reason": "lock_held"})

        workspace.create_run(run_id, case_id)
        from backend.runtime.context import current as _ctx
        workspace.update_run(run_id, trace_id=_ctx().trace_id)
        _push_logger.info("starting resumed run %s for case %s (wake %s)", run_id, case_id, workflow_id)
        t = threading.Thread(target=_run_background, args=(run_id, case_id), kwargs={"resume": True}, daemon=True)
        t.start()
        return JSONResponse({"status": "resumed", "run_id": run_id, "case_id": case_id})

    _push_logger.info("push message with unknown type: action=%r event_type=%r", action, event_type)
    return JSONResponse({"status": "ignored"})


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


_SERVICE_WORDS: dict[str, str] = {
    "education": "school",
    "health": "clinic",
    "legal": "legal aid",
    "shelter": "shelter",
    "family_services": "family services",
}

_SERVICE_NOUNS: dict[str, str] = {
    "education": "enrollment",
    "health": "visit",
    "legal": "referral",
    "shelter": "placement",
    "family_services": "assessment",
}

_SPECIALIST_TO_SERVICE: dict[str, str] = {
    "education_liaison": "education",
    "health_coordination": "health",
    "legal_aid": "legal",
    "shelter_status": "shelter",
    "family_services": "family_services",
}

# The post-approval follow-up belongs to one service, so its lines resolve the
# organisation and contact the same way a fanout phase's lines do.
_PHASE_SERVICES: dict[str, str] = {"8-followup": "education"}

_run_event_lock = threading.Lock()


class _Narrator:
    """Plain-language wording for one run's events.

    Organisation and contact names are read from this case's referral packet, never
    written into a template: a name baked into a string would follow that string onto
    every other child's case. An organisation is named in full the first time a run
    mentions it and by its short name after that, so repeated lines stay readable.
    """

    def __init__(self, case_id: str, child_name: str) -> None:
        packet = workspace.packet(case_id)
        self.case_id = case_id
        self.child = child_name or "the child"
        self._referrals = {r.get("type", ""): r for r in packet.get("referrals", [])}
        self._supervisor = packet.get("supervisor_name", "") or "your supervisor"
        self._household = packet.get("foster_family", {}).get("household_name", "")
        self._introduced: set[str] = set()
        self._lock = threading.Lock()

    # -- packet lookups ----------------------------------------------------

    def _subject(self, service: str) -> str:
        """What the line is about, e.g. "school enrollment" — always names the service."""
        word = _SERVICE_WORDS.get(service, service.replace("_", " "))
        return f"{word} {_SERVICE_NOUNS.get(service, 'request')}"

    def _org(self, service: str) -> str:
        referral = self._referrals.get(service) or {}
        full = referral.get("target_org", "")
        with self._lock:
            introduced = service in self._introduced
            self._introduced.add(service)
        return referral.get("target_org_short", full) if introduced else full

    def _who(self, service: str) -> str:
        """The named contact if the partner has given one, otherwise the organisation.

        Re-read from the case rather than from the packet captured at construction: a
        provider that answers a follow-up names an owner part-way through the run, and the
        lines after that point should credit the person who took the work on.
        """
        contact = next(
            (
                r.get("contact")
                for r in workspace.packet(self.case_id).get("referrals", [])
                if r.get("type") == service
            ),
            None,
        )
        return contact["name"] if contact else self._org(service)

    # -- event lines -------------------------------------------------------

    def overdue(self, service: str) -> str:
        return f"{self._who(service)} is overdue on {self.child}'s {self._subject(service)}."

    def blocked(self, service: str) -> str:
        return f"{self._org(service)}'s {self._subject(service)} for {self.child} is still blocked."

    def chasing(self, service: str) -> str:
        return f"Chasing {self._org(service)} on {self.child}'s {self._subject(service)}."

    def owned(self, service: str) -> str:
        return f"{self._who(service)} has taken on {self.child}'s {self._subject(service)}."

    def silent(self, service: str) -> str:
        return f"{self._org(service)} still has not answered on {self.child}'s {self._subject(service)}."

    def raised(self, service: str) -> str:
        return f"A supervisor has been told {self.child}'s {self._subject(service)} is unanswered."

    def deferred(self, service: str) -> str:
        return f"{self._org(service)} asked for more time on {self.child}'s {self._subject(service)} — the fleet will check back."

    def checking_back(self, service: str) -> str:
        """Used when a commitment that was deferred is revisited on the follow-up wake."""
        return f"Checking back with {self._org(service)} on {self.child}'s {self._subject(service)} — they asked for more time."

    def resumed(self, trigger: str) -> str:
        """The opening line of a resumed run, named for whatever actually restarted it.

        A run resumed by a cleared gate and a run resumed by a fired checkpoint are both
        ``resume=True``, but announcing a reminder immediately after someone clicked
        approve narrates something that did not happen.
        """
        if trigger == "activation":
            return f"Approved — contacting every service on {self.child}'s case."
        if trigger == "escalation":
            return f"Escalation decided — picking {self.child}'s case back up."
        return f"Reminder fired — checking back on {self.child}'s open commitments."

    def line(self, event: str, phase: str, *, commitment_states: dict | None = None) -> str:
        child = self.child
        states = commitment_states or {}
        service = _PHASE_SERVICES.get(phase)
        if phase.startswith("3-fanout-"):
            service = _SPECIALIST_TO_SERVICE.get(phase.removeprefix("3-fanout-"))

        if event == "run_started":
            return f"Opening {child}'s case and reviewing every open commitment."

        if event == "run_completed":
            closed = sum(1 for v in states.values() if v == "completed")
            total = len(states)
            if total == 0:
                return f"Finished reviewing {child}'s case."
            if closed == total:
                return f"All {total} commitments for {child} are fulfilled."
            return f"{closed} of {total} commitments fulfilled for {child}."

        if event == "run_failed":
            return f"Something went wrong and {child}'s case could not be processed."

        if event == "run_partial_failure":
            return f"Some commitments for {child} could not be resolved."

        if event == "phase_started":
            if phase == "intake":
                return f"Reading the {self._household} family's referral for {child}."
            if "activate" in phase:
                return f"Waiting for supervisor approval before activating {self.child}'s case."
            if "checkpoint" in phase:
                return "Setting a reminder to follow up on anything still open."
            if "wake" in phase:
                return f"Reminder fired — checking back on {child}'s open commitments."
            if "quarantine" in phase:
                return (
                    "A reply came back from the school — the safeguarding verifier is "
                    "screening it before anyone acts."
                )
            if "approve" in phase:
                return "The flagged reply is waiting for a supervisor decision."
            if "nudge" in phase:
                return f"Following up on {child}'s missed deadlines."
            if "unanswered" in phase:
                return f"Nobody replied — escalating to a supervisor."
            if service:
                return f"Contacting {self._org(service)} about {child}'s {self._subject(service)}."
            if "memory" in phase:
                return f"Recording everything that happened for {child}'s file."
            return f"Working on {child}'s case."

        if event == "phase_complete":
            if phase == "intake":
                return f"Found {len(states)} commitments — waiting for supervisor approval to proceed."
            if "activate" in phase:
                return f"Supervisor approved — contacting every service on {child}'s case."
            if "checkpoint" in phase:
                return f"Reminder set — {child}'s open commitments will be chased automatically."
            if "wake" in phase:
                return f"Followed up on {child}'s open commitments."
            if "quarantine" in phase:
                return (
                    "The safeguarding verifier stopped that reply — it reached outside "
                    "its scope. Escalated — held for human review."
                )
            if "approve" in phase:
                return "Supervisor approved the escalation — the follow-up can now be sent."
            if "nudge" in phase:
                open_now = [s for s, v in states.items() if v != "completed"]
                if states and not open_now:
                    return f"The follow-ups landed — every commitment on {child}'s case is fulfilled."
                return f"Follow-ups are out; {len(open_now)} of {len(states)} still open on {child}'s case."
            if "unanswered" in phase:
                return "The unanswered commitments have been escalated to a supervisor."
            if service:
                subject = self._subject(service)
                status = states.get(service, "")
                if status == "completed":
                    return f"{self._who(service)} has confirmed {child}'s {subject}."
                if status == "blocked":
                    return (
                        f"{self._org(service)}'s reply asked for information outside the "
                        f"{_SERVICE_WORDS.get(service, service)} scope — "
                        f"{child}'s {subject} is blocked."
                    )
                if status == "deferred":
                    return (
                        f"{self._org(service)} asked for more time on {child}'s {subject}"
                        f" — the fleet will check back."
                    )
                if status == "unresolved":
                    return f"{self._who(service)} could not resolve {child}'s {subject}."
                if status == "pending":
                    return f"Still waiting on {self._who(service)} about {child}'s {subject}."
                if status:
                    return f"{self._who(service)} reports {child}'s {subject} is {status}."
                return f"{self._who(service)} finished checking {child}'s {subject}."
            if "memory" in phase:
                return f"Case notes updated — every status on {child}'s file is recorded."
            return f"Finished a step on {child}'s case."

        if event == "phase_error":
            if service:
                return f"Could not reach {self._org(service)} about {child}'s {self._subject(service)}."
            return f"A step on {child}'s case did not complete."

        return ""

    # -- closing summary ---------------------------------------------------

    def summary(self, run_id: str, commitment_states: dict[str, str], outcome: str,
                *, recall_count: int = 0, wrote_memory: bool = False) -> dict:
        """Build a structured closing summary with per-commitment status and next actions.

        Next actions are derived exclusively from real case state: pending approvals,
        unresolved commitments, and scheduled follow-ups. Nothing is fabricated.
        """
        child = self.child
        commitments = [
            {
                "domain": service,
                "label": self._subject(service),
                "partner": (self._referrals.get(service) or {}).get("target_org", ""),
                "status": status,
            }
            for service, status in commitment_states.items()
        ]

        next_actions: list[dict[str, str]] = []

        for a in workspace.list_approvals(self.case_id):
            if a.get("decision") != "pending":
                continue
            if a.get("action_type") == SUPERVISOR_NOTICE:
                service = a.get("commitment_type", "")
                next_actions.append({
                    "action": f"A supervisor was told nobody answered on the {self._subject(service)}.",
                    "context": a.get("reason", "The deadline passed and the follow-up went unanswered."),
                })
            else:
                next_actions.append({
                    "action": "An escalation is waiting for a supervisor decision.",
                    "context": a.get("reason", "A reply was flagged and needs a decision."),
                })

        for service, status in commitment_states.items():
            if status not in ("blocked", "pending", "unresolved", "deferred"):
                continue
            who = self._who(service)
            subject = self._subject(service)
            if status == "blocked":
                next_actions.append({
                    "action": f"Follow up with {who} about {child}'s {subject}.",
                    "context": "It is blocked and needs a nudge to move.",
                })
            elif status == "deferred":
                next_actions.append({
                    "action": f"Check back with {self._org(service)} about {child}'s {subject}.",
                    "context": "They asked for more time; a scheduled reminder will follow up.",
                })
            elif status == "pending":
                next_actions.append({
                    "action": f"Check in with {who} about {child}'s {subject}.",
                    "context": "No answer has come back yet.",
                })
            else:
                next_actions.append({
                    "action": f"Reach out to {who} about {child}'s {subject}.",
                    "context": "They could not fulfil this commitment.",
                })

        wf_ids = workspace._case_workflows.get(self.case_id, [])
        next_due = None
        for wf_id in wf_ids:
            cp = workspace.get_checkpoint(wf_id)
            if cp and cp.get("state") == "waiting":
                due = cp.get("due_at")
                if due and (next_due is None or due < next_due):
                    next_due = due
        if next_due is not None:
            scheduled_at = next_due.isoformat() if hasattr(next_due, "isoformat") else str(next_due)
            next_actions.append({
                "action": "A follow-up is already scheduled.",
                "context": "Anything still open will be chased again at that time.",
                "scheduled_at": scheduled_at,
            })

        if not next_actions:
            next_actions.append({
                "action": f"No action needed — all of {child}'s commitments are fulfilled.",
                "context": "",
            })

        closed = sum(1 for v in commitment_states.values() if v == "completed")
        total = len(commitment_states)
        if total == 0:
            message = f"Finished processing {child}'s case."
        elif closed == total:
            message = f"All {total} commitments for {child} are fulfilled."
        else:
            message = f"{closed} of {total} commitments fulfilled for {child}."

        result: dict = {
            "event": "run_summary",
            "run_id": run_id,
            "case_id": self.case_id,
            "child_name": child,
            "message": message,
            "outcome": outcome,
            "commitments": commitments,
            "next_actions": next_actions,
        }
        if recall_count > 0 or wrote_memory:
            result["memory"] = {"recalled": recall_count, "wrote": wrote_memory}
        return result


def _run_background(
    run_id: str, case_id: str, *, resume: bool = False, resume_trigger: str = "wake",
) -> None:
    """Drive the real agent fleet end-to-end: intake, then precondition-driven engine.

    When resume=False (first run): runs intake through the checkpoint phase, then suspends.
    Durable state is in Firestore; a Pub/Sub push will start a new run to continue.

    When resume=True (push-initiated): skips intake, evaluates preconditions from scratch.
    The wake phase fires because the checkpoint is in running state (sweep set it) with
    current_step still at sleeping, and reconciliation runs before continuing.
    """
    import warnings

    from backend.agents.orchestrator.agent import build_for_run as _build_orchestrator
    from backend.memory.platform import enabled as _mb_enabled, search_sync as _mb_search
    from backend.runtime.context import bind as _bind
    from backend.runtime.fleet import PHASE_REGISTRY, awaiting_supervisor as _awaiting_supervisor
    from backend.runtime.invoke import finalize_run_memory, run_agent
    from backend.workflows import escalation
    from backend.workflows.durable import reconcile_commitments

    _adk_logger = logging.getLogger("google.adk")

    def _quiet_run_agent(*args, **kwargs):
        prev = _adk_logger.level
        _adk_logger.setLevel(logging.CRITICAL)
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", module=r"google\.adk")
            try:
                return run_agent(*args, **kwargs)
            finally:
                _adk_logger.setLevel(prev)

    def _push_event(event: dict) -> None:
        """Record one event, stamping its time and its position together.

        The stamp is taken inside the lock because the fan-out phases narrate themselves
        from concurrent threads: a stamp taken before the lock can be assigned a later
        sequence number than an event stamped after it, leaving the recorded time and the
        recorded order disagreeing about which line came first.
        """
        with _run_event_lock:
            event["timestamp"] = datetime.now(timezone.utc).isoformat()
            workspace.push_run_event(run_id, event)

    def _run_single_phase(label: str, template: str, tools: tuple[str, ...],
                          ctx: contextvars.Context) -> tuple[str, str | None, str]:
        def _inner():
            phase_orchestrator = _build_orchestrator(tools)
            prompt = template.format(case_id=case_id)
            _push_event({
                "event": "phase_started", "run_id": run_id, "phase": label,
                "message": narrator.line("phase_started", label),
            })
            try:
                text = _quiet_run_agent(phase_orchestrator, prompt, app_name="continuity_orchestrator")
            except Exception as exc:  # noqa: BLE001
                err_msg = str(exc) or repr(exc)
                _push_event({
                    "event": "phase_error", "run_id": run_id,
                    "phase": label, "error": err_msg,
                    "message": narrator.line("phase_error", label),
                })
                return (label, err_msg, "")
            states = workspace.commitment_states(case_id)
            # Control-plane deferral override: the deployed specialist engine may predate
            # the `deferred` status and report a defer response as pending or completed.
            # Detect this from partner_behaviour on the referral and correct the commitment
            # state before narrating phase_complete so the feed tells one consistent story
            # (never a superseded "confirmed" line followed by a correction).
            if label.startswith("3-fanout-"):
                _cp_svc = _SPECIALIST_TO_SERVICE.get(label.removeprefix("3-fanout-"), "")
                if _cp_svc and states.get(_cp_svc) in ("pending", "completed", "unresolved", "blocked"):
                    _cp_ref = next(
                        (r for r in workspace.packet(case_id).get("referrals", [])
                         if r.get("type") == _cp_svc),
                        None,
                    )
                    if _cp_ref and _cp_ref.get("partner_behaviour", "").startswith("defer"):
                        workspace.set_commitment(case_id, _cp_svc, "deferred")
                        states = dict(states)
                        states[_cp_svc] = "deferred"
            _push_event({
                "event": "phase_complete", "run_id": run_id,
                "phase": label, "summary": (text or "")[:300],
                "commitment_states": states,
                "message": narrator.line("phase_complete", label, commitment_states=states),
            })
            return (label, None, text or "")
        return ctx.run(_inner)

    with _bind(case_id=case_id, run_id=run_id):
        # Loading the case is inside the try: it fails for a case deleted between the wake
        # being published and this run starting, and a failure above the try would leave the
        # run queued and the case lock held for as long as the reclaim threshold.
        narrator: _Narrator | None = None
        try:
            child_name = workspace.get_case(case_id).get("child_name", "")
            narrator = _Narrator(case_id, child_name)
            workspace.update_run(run_id, state="running", current_phase="intake" if not resume else "wake",
                                 heartbeat_at=datetime.now(timezone.utc).isoformat())
            _push_event({
                "event": "run_started", "run_id": run_id, "case_id": case_id,
                "resumed": resume,
                "resume_trigger": resume_trigger if resume else "",
                "message": (
                    narrator.resumed(resume_trigger)
                    if resume else
                    narrator.line("run_started", "intake")
                ),
            })

            recall_count = 0
            recalled: list[str] = []
            child = narrator.child

            if _mb_enabled() and resume:
                query = (
                    f"partner contacts, strategies, and prior outcomes for case {case_id}'s open commitments"
                )
                try:
                    recalled = _mb_search(case_id, query)
                    recall_count = len(recalled)
                    if recall_count > 0:
                        _push_event({
                            "event": "memory_recall", "run_id": run_id, "case_id": case_id,
                            "memory_count": recall_count,
                            "previews": [
                                m[:150] if len(m) <= 150 else m[:147].rsplit(" ", 1)[0] + "…"
                                for m in recalled[:3]
                            ],
                            "message": (
                                f"Recalled {recall_count} note{'s' if recall_count != 1 else ''} "
                                f"from earlier work on {child}'s case."
                            ),
                        })
                except Exception as _mb_exc:  # noqa: BLE001
                    logging.getLogger("caserelay.memory").warning(
                        "Memory Bank search failed for case %s (run %s): %s",
                        case_id, run_id, repr(_mb_exc),
                    )

            if not resume:
                from backend.agents.intake.agent import root_agent as intake_agent

                _push_event({
                    "event": "phase_started", "run_id": run_id, "phase": "intake",
                    "message": narrator.line("phase_started", "intake"),
                })

                intake_text = _quiet_run_agent(
                    intake_agent,
                    f"Process the referral packet for case {case_id}. Extract commitments and propose grants.",
                    app_name="intake_authority",
                )
                if not intake_text:
                    cmt_count = len(workspace.commitments.get(case_id) or [])
                    grant_count = len(workspace.grants.get(case_id) or [])
                    intake_text = (
                        f"Intake processed for case {case_id}: "
                        f"{cmt_count} commitments extracted, {grant_count} grants proposed."
                    )
                states = workspace.commitment_states(case_id)
                _push_event({
                    "event": "phase_complete", "run_id": run_id,
                    "phase": "intake", "summary": intake_text[:300],
                    "commitment_states": states,
                    "message": narrator.line("phase_complete", "intake", commitment_states=states),
                })

                if not workspace.commitments.get(case_id) or not workspace.grants.get(case_id):
                    raise RuntimeError(f"intake did not persist commitments/grants: {intake_text[:400]}")

            # ---- Precondition-driven engine ----
            completed_phases: set[str] = set()
            phase_failures = 0
            failed_phases: list[str] = []
            suspended = False

            for _engine_iter in range(len(PHASE_REGISTRY) + 1):
                ready = [
                    spec for spec in PHASE_REGISTRY
                    if spec.label not in completed_phases
                    and spec.precondition(case_id)
                ]

                if not ready:
                    gate_type = _awaiting_supervisor(case_id)
                    if gate_type:
                        _push_event({
                            "event": "awaiting_supervisor", "run_id": run_id, "case_id": case_id,
                            "gate_type": gate_type,
                            "message": (
                                f"Waiting for supervisor approval ({gate_type}) before continuing "
                                f"with {child}'s case."
                            ),
                        })
                        workspace.update_run(
                            run_id, state="awaiting_supervisor",
                            current_phase=f"gate:{gate_type}",
                            commitment_states=workspace.commitment_states(case_id),
                        )
                        suspended = True
                        break

                    # Re-evaluate: case state may have changed between the initial
                    # precondition sweep and _awaiting_supervisor returning None.
                    # This closes the race window where supervisor activation concurrent
                    # with the engine loop causes the run to exit as partial_failure
                    # instead of proceeding with the now-ready fanout phases.
                    re_ready = [
                        spec for spec in PHASE_REGISTRY
                        if spec.label not in completed_phases
                        and spec.precondition(case_id)
                    ]
                    if re_ready:
                        continue
                    break

                first = min(ready, key=lambda s: s.priority)

                if first.group:
                    group_phases = [s for s in ready if s.group == first.group]
                    workspace.update_run(
                        run_id, current_phase="3-fanout",
                        commitment_states=workspace.commitment_states(case_id),
                        heartbeat_at=datetime.now(timezone.utc).isoformat(),
                    )
                    with ThreadPoolExecutor(max_workers=len(group_phases), thread_name_prefix="fanout") as pool:
                        futures = {
                            pool.submit(
                                _run_single_phase, spec.label, spec.prompt_template, spec.tools,
                                contextvars.copy_context(),
                            ): spec.label
                            for spec in group_phases
                        }
                        for future in as_completed(futures):
                            label_result, error, _ = future.result()
                            if error is not None:
                                phase_failures += 1
                                failed_phases.append(label_result)
                    for spec in group_phases:
                        completed_phases.add(spec.label)

                    for _svc, _st in workspace.commitment_states(case_id).items():
                        if _st == "deferred":
                            _defer_detected = True
                        else:
                            _ref = next(
                                (r for r in workspace.packet(case_id).get("referrals", [])
                                 if r.get("type") == _svc),
                                None,
                            )
                            _defer_detected = bool(
                                _ref and _ref.get("partner_behaviour", "").startswith("defer")
                                and _st in ("pending", "completed", "unresolved", "blocked")
                            )
                        if _defer_detected:
                            if _st != "deferred":
                                workspace.set_commitment(case_id, _svc, "deferred")
                                # Only emit the feed event when phase_complete didn't
                                # already narrate the deferral (i.e., when the override
                                # in _run_single_phase left _st as pending/completed
                                # because the engine itself reported deferred natively).
                                _push_event({
                                    "event": "commitment_deferred", "run_id": run_id,
                                    "case_id": case_id, "commitment_type": _svc,
                                    "message": narrator.deferred(_svc),
                                })
                            # Always write the audit so the record is complete and honest,
                            # regardless of whether a feed event was emitted.
                            workspace.append_audit(case_id, {
                                "event_id": f"evt-defer-{uuid4().hex[:8]}",
                                "event_type": "commitment_deferred",
                                "commitment_type": _svc,
                                "verdict": "deferred",
                                "explanation": (
                                    f"{narrator._org(_svc)} asked for more time on the "
                                    f"{_svc} commitment; the fleet will check back when "
                                    f"the scheduled reminder fires."
                                ),
                            })

                else:
                    label = first.label

                    if label == "5-wake" and resume:
                        recon = reconcile_commitments(case_id)
                        overdue = [r for r in recon if r.get("overdue")]
                        blocked_overdue = [r for r in overdue if r.get("status") == "blocked"]
                        plain_overdue = [r for r in overdue if r.get("status") != "blocked"]
                        parts: list[str] = []
                        if blocked_overdue:
                            parts.append(f"{len(blocked_overdue)} blocked")
                        if plain_overdue:
                            parts.append(f"{len(plain_overdue)} overdue")
                        on_track = len(recon) - len(overdue)
                        if on_track:
                            parts.append(f"{on_track} on track")
                        recon_summary = ", ".join(parts) if parts else "all on track"
                        _push_event({
                            "event": "reconciliation", "run_id": run_id, "case_id": case_id,
                            "results": recon,
                            "overdue_count": len(overdue),
                            "message": (
                                f"Reconciled {child}'s commitments: {recon_summary}."
                            ),
                        })
                        for r in overdue:
                            ctype = r.get("type", "")
                            cstatus = r.get("status", "")
                            _push_event({
                                "event": "commitment_overdue", "run_id": run_id, "case_id": case_id,
                                "commitment_type": ctype,
                                "deadline": r.get("deadline", ""),
                                "status": cstatus,
                                "message": (
                                    narrator.blocked(ctype) if cstatus == "blocked"
                                    else narrator.checking_back(ctype) if cstatus == "deferred"
                                    else narrator.overdue(ctype)
                                ),
                            })

                    # Which providers this phase is about has to be read before it runs:
                    # the phase itself is what changes the answer.
                    chased = escalation.pending_nudges(case_id) if label == "9-nudge" else []
                    silent = escalation.unanswered(case_id) if label == "10-unanswered" else []

                    prompt = first.prompt_template.format(case_id=case_id)

                    # Inject recalled memories into decision-phase prompts so they
                    # genuinely inform orchestrator behaviour on resume.
                    _MEMORY_DECISION_PHASES = {"5-wake", "8-followup", "9-nudge"}
                    injected_memories: list[str] = []
                    if resume and recalled and label in _MEMORY_DECISION_PHASES:
                        injected_memories = recalled[:5]
                        memory_block = "\n".join(
                            f"- {m}" for m in injected_memories
                        )
                        prompt = (
                            f"[RECALLED CONTEXT from prior sessions]\n{memory_block}\n\n"
                            f"Use the above recalled notes to inform your approach — for example "
                            f"which strategies worked, which contacts responded, and what was tried "
                            f"before. Prefer approaches that succeeded previously.\n\n"
                            f"{prompt}"
                        )
                        _push_event({
                            "event": "memory_injected", "run_id": run_id, "case_id": case_id,
                            "phase": label,
                            "memory_count": len(injected_memories),
                            "previews": [m[:200] for m in injected_memories],
                            "message": (
                                f"Injected {len(injected_memories)} recalled "
                                f"note{'s' if len(injected_memories) != 1 else ''} "
                                f"into {label} phase prompt."
                            ),
                        })
                    workspace.update_run(
                        run_id, current_phase=label,
                        commitment_states=workspace.commitment_states(case_id),
                        heartbeat_at=datetime.now(timezone.utc).isoformat(),
                    )
                    _push_event({
                        "event": "phase_started", "run_id": run_id, "phase": label,
                        "message": narrator.line("phase_started", label),
                    })
                    for service in chased:
                        _push_event({
                            "event": "followup_sent", "run_id": run_id, "case_id": case_id,
                            "commitment_type": service,
                            "message": narrator.chasing(service),
                        })
                    try:
                        phase_orch = _build_orchestrator(first.tools)
                        orch_text = _quiet_run_agent(phase_orch, prompt, app_name="continuity_orchestrator")
                    except Exception as phase_exc:  # noqa: BLE001
                        phase_failures += 1
                        failed_phases.append(label)
                        err_msg = str(phase_exc) or repr(phase_exc)
                        _push_event({
                            "event": "phase_error", "run_id": run_id,
                            "phase": label, "error": err_msg,
                            "message": narrator.line("phase_error", label),
                        })
                        completed_phases.add(label)
                        continue
                    for service in chased:
                        record = escalation.followup_record(case_id, service)
                        if record.get("answered"):
                            _push_event({
                                "event": "followup_answered", "run_id": run_id, "case_id": case_id,
                                "commitment_type": service,
                                "disclosed_fields": record.get("disclosed_fields", []),
                                "message": narrator.owned(service),
                            })
                        elif record:
                            _push_event({
                                "event": "followup_ignored", "run_id": run_id, "case_id": case_id,
                                "commitment_type": service,
                                "message": narrator.silent(service),
                            })
                    still_silent = escalation.unanswered(case_id) if silent else []
                    for service in silent:
                        if service not in still_silent:
                            _push_event({
                                "event": "supervisor_notified", "run_id": run_id, "case_id": case_id,
                                "commitment_type": service,
                                "message": narrator.raised(service),
                            })

                    states = workspace.commitment_states(case_id)
                    _push_event({
                        "event": "phase_complete", "run_id": run_id,
                        "phase": label, "summary": (orch_text or "")[:300],
                        "commitment_states": states,
                        "message": narrator.line("phase_complete", label, commitment_states=states),
                    })
                    completed_phases.add(label)

                    if "checkpoint" in label and not resume:
                        all_cps = workspace.list_case_checkpoints(case_id)
                        waiting = [c for c in all_cps if c.get("state") == "waiting"]
                        if waiting:
                            next_cp = min(waiting, key=lambda c: c.get("due_at", ""))
                            cp_due = next_cp.get("due_at", "")
                        else:
                            cp_due = ""
                        if hasattr(cp_due, "isoformat"):
                            cp_due = cp_due.isoformat()
                        _push_event({
                            "event": "run_suspended", "run_id": run_id, "case_id": case_id,
                            "checkpoint_count": len(waiting),
                            "checkpoint_due": str(cp_due),
                            "message": (
                                f"Checkpoint saved — this run is ending. {len(waiting)} scheduled pushes will "
                                f"resume {child}'s case as each commitment comes due."
                            ),
                        })
                        suspended = True
                        break

            else:
                raise RuntimeError(
                    f"precondition engine exceeded {len(PHASE_REGISTRY) + 1} iterations — "
                    f"a precondition likely stayed true after its phase ran; "
                    f"completed={sorted(completed_phases)}, "
                    f"remaining={sorted(s.label for s in PHASE_REGISTRY if s.label not in completed_phases)}"
                )

            # A wake this run did not act on is still a wake this run consumed. Leaving it
            # unacknowledged sends it back round the reclaim-and-refire loop for ever, and
            # a case whose commitments have all closed has no phase left that would ack it.
            if resume and not suspended:
                durable.resume_wake(case_id)

            total_phases_run = len(completed_phases)
            commitments = workspace.commitment_states(case_id)
            wrote_events = finalize_run_memory(run_id, case_id)
            if wrote_events > 0:
                _push_event({
                    "event": "memory_write", "run_id": run_id, "case_id": case_id,
                    "events_committed": wrote_events,
                    "message": (
                        f"Saved notes from this session to {child}'s file — "
                        f"partner contacts, shortcuts, and strategies will be available next time."
                    ),
                })

            if suspended:
                run = workspace.get_run(run_id)
                if run and run.get("state") == "awaiting_supervisor":
                    gate_type = (run.get("current_phase") or "").removeprefix("gate:")
                    if gate_type == "escalation":
                        gate_msg = (
                            f"Run paused — a quarantined reply needs a supervisor decision "
                            f"before {child}'s case can proceed."
                        )
                    else:
                        gate_msg = (
                            f"Run paused — supervisor must activate {child}'s case "
                            f"before services are contacted."
                        )
                    _push_event({
                        "event": "run_completed", "run_id": run_id, "case_id": case_id,
                        "commitment_states": commitments,
                        "outcome": "awaiting_supervisor",
                        "message": gate_msg,
                    })
                else:
                    workspace.update_run(
                        run_id, state="suspended", current_phase="checkpoint",
                        commitment_states=commitments,
                    )
                    _push_event({
                        "event": "run_completed", "run_id": run_id, "case_id": case_id,
                        "commitment_states": commitments,
                        "outcome": "suspended",
                        "message": narrator.line("phase_complete", "checkpoint", commitment_states=commitments),
                    })
                return

            pending_commitments = [k for k, v in commitments.items() if v in ("pending", "deferred")]
            has_unresolved = bool(pending_commitments)

            if total_phases_run > 0 and phase_failures == total_phases_run:
                outcome = "failed"
            elif phase_failures > 0 or has_unresolved:
                outcome = "partial_failure"
            else:
                outcome = "completed"

            summary_event = narrator.summary(
                run_id, commitments, outcome,
                recall_count=recall_count, wrote_memory=wrote_events > 0,
            )
            _push_event(summary_event)

            if outcome == "failed":
                workspace.update_run(
                    run_id, state="failed", current_phase="done",
                    error=f"all {total_phases_run} phases failed",
                    commitment_states=commitments,
                    failed_phases=failed_phases,
                )
                _push_event({
                    "event": "run_failed", "run_id": run_id, "case_id": case_id,
                    "error": f"all {total_phases_run} phases failed",
                    "failed_phases": failed_phases,
                    "commitment_states": commitments,
                    "message": narrator.line("run_failed", "done"),
                })
            elif outcome == "partial_failure":
                error_parts = []
                if phase_failures > 0:
                    error_parts.append(f"{phase_failures}/{total_phases_run} phases failed")
                if has_unresolved:
                    _readable_pending = ", ".join(
                        f"{_SERVICE_WORDS.get(c, c.replace('_', ' '))} "
                        f"{_SERVICE_NOUNS.get(c, 'request')}"
                        for c in pending_commitments
                    )
                    error_parts.append(f"commitments still pending: {_readable_pending}")
                error_msg = "; ".join(error_parts)
                workspace.update_run(
                    run_id, state="partial_failure", current_phase="done",
                    error=error_msg,
                    commitment_states=commitments,
                    failed_phases=failed_phases,
                )
                _push_event({
                    "event": "run_partial_failure", "run_id": run_id, "case_id": case_id,
                    "error": error_msg,
                    "failed_phases": failed_phases,
                    "commitment_states": commitments,
                    "message": narrator.line("run_partial_failure", "done"),
                })
            else:
                workspace.update_run(
                    run_id, state="completed", current_phase="done",
                    commitment_states=commitments,
                )
                _push_event({
                    "event": "run_completed", "run_id": run_id, "case_id": case_id,
                    "commitment_states": commitments,
                    "message": narrator.line("run_completed", "done", commitment_states=commitments),
                })
        except Exception as exc:  # noqa: BLE001
            workspace.update_run(run_id, state="failed", error=str(exc))
            _push_event({
                "event": "run_failed", "run_id": run_id, "error": str(exc),
                "message": (
                    narrator.line("run_failed", "") if narrator
                    else f"Case {case_id} could not be opened, so this run did no work."
                ),
            })
        finally:
            if resume:
                if durable.case_is_live(case_id):
                    for _cp in workspace.list_case_checkpoints(case_id):
                        if _cp.get("current_step") == "awake":
                            _cp["state"] = "completed"
                            _cp["completed"] = True
                            workspace.put_checkpoint(_cp["workflow_id"], _cp)
                    from backend.state import store as _fin_store
                    _fin_store.release_case_lock(case_id)
                else:
                    # Writing the checkpoints back would recreate documents for a case that
                    # was deleted while this run held it.
                    durable.retire_case_wakes(case_id)
            # Nothing is narrating any more, so waiting for the queued events costs the run
            # nothing and means a restart straight after a run still leaves its history readable.
            event_log.flush()


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
    "/v1/cases/{case_id}/runs",
    responses={404: {"description": "Case not found"}},
)
def list_case_runs(case_id: str) -> list[dict]:
    """Return all runs associated with a case, newest first."""
    workspace.get_case(case_id)  # raises CaseNotFound if absent
    return [
        {
            "run_id": r["run_id"],
            "state": r.get("state", "queued"),
            "current_phase": r.get("current_phase"),
            "created_at": r.get("created_at", ""),
        }
        for r in workspace.list_runs_for_case(case_id)
    ]


@app.get(
    "/v1/cases/{case_id}/events",
    responses={404: {"description": "Case not found"}},
)
def list_case_events(case_id: str) -> list[dict]:
    """All run events across every run for a case, in the order they were narrated.

    Served as AG-UI events, the same vocabulary the live stream uses, so the portal
    reads a replayed history and a live one through one decoder.

    The portal uses this to stitch a continuous timeline across the pre-checkpoint
    and post-wake runs, reading a single case's full history regardless of how
    many runs it spans, and regardless of whether this instance is the one that
    produced them.

    Runs are emitted oldest first and each run's events are kept in the order they were
    recorded, which is the order their sequence numbers were assigned. Merging every run's
    events into one list and sorting that on the timestamp string would be a weaker
    guarantee twice over: it would depend on wall-clock stamps never colliding or drifting,
    and it could interleave two runs, which breaks the run-gap divider the portal draws
    wherever run_id changes.
    """
    workspace.get_case(case_id)
    runs = sorted(
        workspace.list_runs_for_case(case_id),
        key=lambda r: (r.get("created_at", ""), r.get("run_id", "")),
    )
    all_events: list[dict] = []
    for run in runs:
        rid = run.get("run_id", "")
        for ev in workspace.run_events(rid):
            ev_copy = dict(ev)
            ev_copy.setdefault("run_id", rid)
            all_events.append(to_agui(ev_copy))
    return all_events


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


_TERMINAL_STATES = {"completed", "failed", "partial_failure", "suspended", "awaiting_supervisor"}

_SSE_HEARTBEAT_INTERVAL = 15
_SSE_MAX_DURATION = 1800


@app.get(
    "/v1/runs/{run_id}/events",
    responses={404: {"description": "Run not found"}},
)
def stream_run_events(run_id: str, request: Request) -> StreamingResponse:
    """SSE stream of run events, as AG-UI events. Lasts as long as the run does.

    The stream terminates when the run reaches a terminal state (completed,
    failed, partial_failure). Heartbeat comments are sent every 15 s to keep
    the connection alive through proxies. A 30-minute safety valve prevents
    leaked connections; if it fires, an explicit stream_timeout event is sent.

    The stream's own control frames go out in the same envelope as the narrated
    events, so every frame a client parses is an AG-UI event.

    Client disconnect is handled at the ASGI layer: uvicorn cancels the response
    task (raising CancelledError in asyncio.sleep), cleanly stopping the generator.
    Starlette's Request.is_disconnected() is not used because it deadlocks under
    anyio-shielded cancel scopes in TestClient and older Starlette builds.
    """
    run = workspace.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail=f"run {run_id!r} not found")

    def _frame(event: dict) -> str:
        return f"data: {json.dumps(to_agui(event))}\n\n"

    async def _generate():
        yield "retry: 1000\n\n"
        yield _frame({'event': 'connected', 'run_id': run_id, 'state': run.get('state', 'queued')})
        sent = 0
        elapsed = 0.0
        since_heartbeat = 0.0
        poll_interval = 0.5
        transient_miss = 0
        while elapsed < _SSE_MAX_DURATION:
            try:
                current = await asyncio.to_thread(workspace.get_run, run_id)
            except Exception:
                # Transient backend read failure — keep the stream open so the
                # intermediary sees continued activity.
                transient_miss += 1
                if transient_miss > 10:
                    return
                yield f": heartbeat {int(elapsed)}s (retry)\n\n"
                since_heartbeat = 0.0
                await asyncio.sleep(poll_interval)
                elapsed += poll_interval
                since_heartbeat += poll_interval
                continue
            transient_miss = 0
            if current is None:
                return
            events = current.get("events", [])
            for ev in events[sent:]:
                yield _frame(ev)
                sent += 1
                since_heartbeat = 0.0
            state = current.get("state", "queued")
            if state in _TERMINAL_STATES:
                yield _frame({'event': 'stream_end', 'run_id': run_id, 'state': state})
                return
            if since_heartbeat >= _SSE_HEARTBEAT_INTERVAL:
                yield f": heartbeat {int(elapsed)}s\n\n"
                since_heartbeat = 0.0
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval
            since_heartbeat += poll_interval
        yield _frame({'event': 'stream_timeout', 'run_id': run_id, 'reason': 'safety valve after 30 minutes'})

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
