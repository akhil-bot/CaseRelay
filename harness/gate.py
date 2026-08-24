#!/usr/bin/env python3
"""Executable acceptance gates for Steps 1-14 of docs/caserelay-hardening-plan.md.

A gate returns PASS only when it has positively observed the behaviour it is
checking -- never because a check was skipped or an import failed. Absence of
evidence is a failure. This is the whole point: it is the only thing standing
between an unattended loop and another round of work that looks finished.

    python harness/gate.py t5.1          # one task
    python harness/gate.py --stage 1     # every gate in a stage
    python harness/gate.py --all
    python harness/gate.py t5.1 --json   # machine-readable, for the driver

Gates marked slow=True talk to Vertex, Firestore or Cloud Run and cost money.
They are skipped unless --slow is passed, and reported as SKIP (not PASS).
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import textwrap
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Gates import project code, so they must run in the project venv rather than
# whatever python launched this file.
_VENV_PY = ROOT / ".venv" / "bin" / "python"
PY = str(_VENV_PY) if _VENV_PY.exists() else sys.executable

# Most behavioural gates need an ingested case to act on.
PRELUDE = """
from backend.state import synthetic, dataset
from backend.runtime.workspace import workspace

def make_case(case_id, scenario=None):
    # scenario= only exists once t7.2 lands; fall back until then.
    if scenario:
        try:
            dataset.create_case(case_id, scenario=scenario)
            return case_id
        except TypeError:
            pass
    dataset.create_case(case_id)
    return case_id
"""

PASS, FAIL, SKIP = "pass", "fail", "skip"

# Gates are declared below in dependency order, which is also the order the loop
# should fix them in. Stages match the plan: 0 unblock, 1 real data, 2 control
# plane, 3 handover.
STAGE_BOUNDS = ((2, 0), (8, 1), (12, 2), (99, 3))


def stage_of(task_id: str) -> int:
    step = int(task_id.lstrip("t").split(".")[0])
    return next(stage for bound, stage in STAGE_BOUNDS if step <= bound)


# --------------------------------------------------------------------------
# result plumbing
# --------------------------------------------------------------------------


@dataclass
class Check:
    ok: bool
    label: str
    detail: str = ""


@dataclass
class GateResult:
    task_id: str
    status: str
    checks: list[Check] = field(default_factory=list)
    next_actions: list[str] = field(default_factory=list)

    @property
    def summary(self) -> str:
        if self.status == SKIP:
            return f"{self.task_id}: skipped (slow gate, pass --slow to run)"
        failed = [c for c in self.checks if not c.ok]
        if not failed:
            return f"{self.task_id}: {len(self.checks)}/{len(self.checks)} checks passed"
        return f"{self.task_id}: {len(failed)}/{len(self.checks)} checks FAILED"

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "status": self.status,
            "summary": self.summary,
            "checks": [{"ok": c.ok, "label": c.label, "detail": c.detail} for c in self.checks],
            "next_actions": self.next_actions,
        }


class Ctx:
    """Helpers shared by gates. Every helper returns evidence, never a bare bool."""

    def __init__(self) -> None:
        self.checks: list[Check] = []

    def add(self, ok: bool, label: str, detail: str = "") -> bool:
        self.checks.append(Check(bool(ok), label, detail.strip()[:1200]))
        return bool(ok)

    # -- shell -------------------------------------------------------------

    @staticmethod
    def sh(cmd: str, timeout: int = 120, cwd: Path | None = None) -> tuple[int, str]:
        try:
            p = subprocess.run(
                cmd,
                shell=True,
                cwd=str(cwd or ROOT),
                capture_output=True,
                text=True,
                timeout=timeout,
            )
            return p.returncode, (p.stdout + p.stderr)
        except subprocess.TimeoutExpired:
            return 124, f"timed out after {timeout}s"

    def rg_absent(self, pattern: str, paths: str, label: str, *, flags: str = "") -> bool:
        rc, out = self.sh(f"rg --no-heading -n {flags} {json.dumps(pattern)} {paths}")
        # rg exits 1 when there are no matches, which is what we want.
        return self.add(rc != 0, label, f"matches found:\n{out}" if rc == 0 else "")

    def rg_present(self, pattern: str, paths: str, label: str, *, flags: str = "") -> bool:
        rc, out = self.sh(f"rg --no-heading -n {flags} {json.dumps(pattern)} {paths}")
        return self.add(rc == 0, label, "no match found" if rc != 0 else out[:400])

    def exists(self, rel: str, label: str = "") -> bool:
        p = ROOT / rel
        return self.add(p.exists(), label or f"{rel} exists")

    def absent(self, rel: str, label: str = "") -> bool:
        p = ROOT / rel
        return self.add(not p.exists(), label or f"{rel} is gone")

    # -- python ------------------------------------------------------------

    def py(self, code: str, label: str, *, env: dict | None = None, timeout: int = 180,
           prelude: bool = False) -> bool:
        """Run a snippet in a subprocess. It must print OK as its last line.

        Import errors, exceptions and silence all count as failure, which is
        correct: a gate for code that does not exist yet must fail.
        """
        full_env = {**os.environ, "PYTHONPATH": str(ROOT), **(env or {})}
        script = (PRELUDE if prelude else "") + textwrap.dedent(code)
        try:
            p = subprocess.run(
                [PY, "-c", script],
                cwd=str(ROOT),
                capture_output=True,
                text=True,
                timeout=timeout,
                env=full_env,
            )
        except subprocess.TimeoutExpired:
            return self.add(False, label, f"timed out after {timeout}s")
        out = (p.stdout + p.stderr).strip()
        ok = bool(out) and p.returncode == 0 and out.splitlines()[-1] == "OK"
        return self.add(ok, label, out)

    def routes(self) -> tuple[bool, list[dict]]:
        """Import the FastAPI app and return its route table."""
        code = """
        import json, sys
        try:
            from backend.api.main import app
        except Exception as e:
            print(json.dumps({"error": f"{type(e).__name__}: {e}"})); sys.exit(0)
        out = []
        for r in app.routes:
            out.append({"path": getattr(r, "path", None),
                        "methods": sorted(getattr(r, "methods", []) or [])})
        print(json.dumps({"routes": out}))
        """
        env = {**os.environ, "PYTHONPATH": str(ROOT), "CASERELAY_STATE": "memory"}
        try:
            p = subprocess.run(
                [PY, "-c", textwrap.dedent(code)],
                cwd=str(ROOT), capture_output=True, text=True, timeout=180, env=env,
            )
            data = json.loads(p.stdout.strip().splitlines()[-1])
        except Exception as e:  # noqa: BLE001 - any failure here is a gate failure
            self.add(False, "backend.api.main imports", f"{type(e).__name__}: {e}")
            return False, []
        if "error" in data:
            self.add(False, "backend.api.main imports", data["error"])
            return False, []
        return True, data["routes"]

    def has_route(self, routes: list[dict], method: str, path: str) -> bool:
        hit = any(r["path"] == path and method.upper() in r["methods"] for r in routes)
        return self.add(hit, f"{method.upper()} {path} exists")


# --------------------------------------------------------------------------
# gates
# --------------------------------------------------------------------------

GATES: dict[str, callable] = {}
SLOW: set[str] = set()


def gate(task_id: str, slow: bool = False):
    def deco(fn):
        GATES[task_id] = fn
        if slow:
            SLOW.add(task_id)
        return fn
    return deco


# ---- Stage 0 -------------------------------------------------------------


@gate("t2.1")
def _(c: Ctx) -> None:
    # The hardening plan quotes the wrong claim in order to fix it, so it is excluded.
    c.rg_absent(r"[Gg]emini[- ]2\.5", "README.md docs/ portal/", "no Gemini 2.5 claim survives",
                flags="-g '!caserelay-hardening-plan.md'")
    c.rg_present(r"gemini-3\.5-flash", "README.md", "README names the exact model id")


@gate("t2.2")
def _(c: Ctx) -> None:
    c.absent("fixtures/cr-1042/partner_configs.json", "the answer key is deleted")
    c.absent("frontend", "empty frontend/ directory is deleted")
    c.rg_absent("partner_configs", "backend/ app/ infra/ portal/src/", "nothing references it")


@gate("t2.3")
def _(c: Ctx) -> None:
    c.rg_absent(r"p50Ms|lastHeartbeat", "portal/src/", "fabricated live metrics are gone")
    c.rg_absent(r"evt-2051|26 correlated spans", "portal/src/", "invented proof strings are gone")
    tsc = ROOT / "portal" / "node_modules" / ".bin" / "tsc"
    if not tsc.exists():
        c.add(False, "portal typechecks", "portal/node_modules missing - run npm install in portal/")
        return
    rc, out = c.sh("./node_modules/.bin/tsc --noEmit", timeout=300, cwd=ROOT / "portal")
    c.add(rc == 0, "portal typechecks after the deletions", out[-1500:])


# ---- Stage 1 -------------------------------------------------------------


@gate("t3.1")
def _(c: Ctx) -> None:
    c.rg_absent("CASERELAY_PERSIST", ".env.example backend/ infra/", "phantom var is gone")
    # With nothing set, the store must choose the persistent backend.
    c.py(
        """
        import os
        for k in ("CASERELAY_STATE",):
            os.environ.pop(k, None)
        from backend.state import store
        mode = getattr(store, "BACKEND", None) or getattr(store, "MODE", None) \\
               or getattr(store, "backend", None)
        assert mode is not None, "store must expose its chosen backend (BACKEND/MODE)"
        assert "memory" not in str(mode).lower(), f"default backend is {mode!r}, expected firestore"
        print("OK")
        """,
        "Firestore is the default with no env set",
    )
    c.py(
        """
        import os
        os.environ["CASERELAY_STATE"] = "memory"
        import importlib
        from backend.state import store
        importlib.reload(store)
        mode = getattr(store, "BACKEND", None) or getattr(store, "MODE", None) \\
               or getattr(store, "backend", None)
        assert "memory" in str(mode).lower(), f"opt-out ignored, got {mode!r}"
        print("OK")
        """,
        "CASERELAY_STATE=memory still opts out",
    )


@gate("t4.1")
def _(c: Ctx) -> None:
    c.exists("backend/runtime/context.py")
    c.py(
        """
        import asyncio
        from backend.runtime.context import RunContext
        for f in ("run_id", "case_id", "workflow_id", "trace_id"):
            assert hasattr(RunContext, f) or f in getattr(RunContext, "__annotations__", {}), f
        print("OK")
        """,
        "RunContext carries the four ids",
    )
    c.py(
        """
        import asyncio
        from backend.runtime import context as ctxmod

        async def nested():
            return ctxmod.current().case_id

        async def one(case_id):
            with ctxmod.bind(case_id=case_id):
                await asyncio.sleep(0.01)
                return await nested()

        async def main():
            a, b = await asyncio.gather(one("CASE-A"), one("CASE-B"))
            assert a == "CASE-A", a
            assert b == "CASE-B", b

        asyncio.run(main())
        print("OK")
        """,
        "context propagates into awaited calls and does not bleed between tasks",
    )


@gate("t4.2")
def _(c: Ctx) -> None:
    # The harness and the hardening plan both have to name the string to talk about it,
    # so they are excluded; everything else must be free of it.
    c.rg_absent(
        "trace-7821",
        ".",
        "the hardcoded trace id is gone from code, docs and diagrams",
        flags="-g '!harness/**' -g '!docs/caserelay-hardening-plan.md'",
    )
    c.py(
        """
        from backend.runtime import context as ctxmod
        t = ctxmod.current().trace_id
        assert t, "a run with no explicit context must still get a trace id"
        assert t != "trace-7821"
        print("OK")
        """,
        "an unbound run still gets a real trace id",
    )


@gate("t4.3")
def _(c: Ctx) -> None:
    c.py(
        """
        import re
        from opentelemetry import trace
        from backend.runtime import context as ctxmod

        tracer = trace.get_tracer("gate")
        with tracer.start_as_current_span("probe") as span:
            tid = ctxmod.current().trace_id
            want = trace.format_trace_id(span.get_span_context().trace_id)
        assert re.fullmatch(r"[0-9a-f]{32}", tid), f"not a 32-hex otel trace id: {tid!r}"
        assert tid == want, f"context id {tid} != span id {want}"
        print("OK")
        """,
        "trace_id inside a span equals the OTel span's trace id",
    )
    c.py(
        """
        import re
        from backend.runtime import context as ctxmod
        tid = ctxmod.current().trace_id
        assert re.fullmatch(r"[0-9a-f]{32}", tid), f"not 32-hex outside a span: {tid!r}"
        assert set(tid) != {"0"}, "all-zero trace id"
        print("OK")
        """,
        "outside a span a valid non-zero id is still produced",
    )


@gate("t4.4")
def _(c: Ctx) -> None:
    c.py(
        """
        from opentelemetry import trace
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import SimpleSpanProcessor
        from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

        exporter = InMemorySpanExporter()
        provider = TracerProvider()
        provider.add_span_processor(SimpleSpanProcessor(exporter))
        trace.set_tracer_provider(provider)

        from backend.gateway import gateway

        case_id = make_case("GATE-T44")
        dataset.grant_authority(case_id)
        try:
            gateway.authorized_context(case_id, "verify_school_enrollment")
        except Exception as e:
            print("disclosure call failed:", type(e).__name__, e)

        spans = exporter.get_finished_spans()
        assert spans, "no spans were emitted by a gateway disclosure"
        attrs = {}
        for s in spans:
            attrs.update(dict(s.attributes or {}))
        for key in ("caserelay.case_id", "caserelay.commitment_type", "caserelay.workflow_id"):
            assert key in attrs, f"missing span attribute {key}; saw {sorted(attrs)}"
        print("OK")
        """,
        "a gateway disclosure emits a span with the three caserelay.* attributes",
        env={"CASERELAY_STATE": "memory"}, prelude=True,
    )


@gate("t5.1")
def _(c: Ctx) -> None:
    c.rg_absent(
        r'workflow_id[^\n]*=[^\n]*["\']wf-school-enrollment["\']',
        "backend/",
        "no constant workflow_id default survives",
    )
    c.py(
        """
        from backend.workflows import durable
        from backend.runtime.workspace import workspace

        make_case("CASE-AAA"); make_case("CASE-BBB")
        a = durable.write_checkpoint("CASE-AAA")
        b = durable.write_checkpoint("CASE-BBB")
        assert a["workflow_id"] != b["workflow_id"], "both cases share a workflow id"
        assert "CASE-AAA" in a["workflow_id"], a["workflow_id"]
        assert "CASE-BBB" in b["workflow_id"], b["workflow_id"]

        ca = workspace.get_checkpoint(a["workflow_id"])
        cb = workspace.get_checkpoint(b["workflow_id"])
        assert ca["case_id"] == "CASE-AAA", ca
        assert cb["case_id"] == "CASE-BBB", cb
        print("OK")
        """,
        "two cases get distinct checkpoints and neither clobbers the other",
        env={"CASERELAY_STATE": "memory"}, prelude=True,
    )


@gate("t5.2")
def _(c: Ctx) -> None:
    c.py(
        """
        from datetime import datetime, timezone
        from backend.workflows import durable

        make_case("CASE-DUE")
        cp = durable.write_checkpoint("CASE-DUE")
        assert "due_at" in cp, f"no due_at on checkpoint: {sorted(cp)}"
        due = cp["due_at"]
        assert not isinstance(due, str), f"due_at must be a timestamp, got str {due!r}"
        assert isinstance(due, datetime), f"due_at is {type(due).__name__}"
        assert due.tzinfo is not None, "due_at must be timezone-aware"
        assert cp.get("state") in {"waiting", "running", "done"}, f"bad state {cp.get('state')!r}"
        print("OK")
        """,
        "checkpoints carry a tz-aware due_at timestamp and a queryable state",
        env={"CASERELAY_STATE": "memory"}, prelude=True,
    )
    c.rg_absent("next_wake", "backend/", "the unread next_wake string is gone")


@gate("t5.3")
def _(c: Ctx) -> None:
    p = ROOT / "infra" / "firestore.indexes.json"
    if not c.add(p.exists(), "infra/firestore.indexes.json exists"):
        return
    try:
        idx = json.loads(p.read_text())
    except Exception as e:  # noqa: BLE001
        c.add(False, "index file is valid JSON", str(e))
        return
    c.add(True, "index file is valid JSON")
    blob = json.dumps(idx)
    c.add("due_at" in blob and '"state"' in blob,
          "a composite index covers state + due_at",
          f"file contents:\n{blob[:800]}")
    c.add("partner_updates" not in blob,
          "no index remains for the collection nothing writes")


@gate("t6.1")
def _(c: Ctx) -> None:
    c.rg_present(r"from backend\.audit|audit\.writer|write_audit",
                 "backend/runtime/workspace.py", "workspace imports the immutable writer")
    c.py(
        """
        from backend.runtime.workspace import workspace
        make_case("CASE-AUDIT")
        ev = {"event_id": "evt-gate-dup", "event_type": "probe", "case_id": "CASE-AUDIT"}
        workspace.append_audit("CASE-AUDIT", dict(ev))
        try:
            workspace.append_audit("CASE-AUDIT", dict(ev))
        except Exception as e:
            assert "Mutation" in type(e).__name__ or "mutation" in str(e).lower(), \\
                f"raised {type(e).__name__}, expected an audit mutation rejection"
            print("OK")
        else:
            raise AssertionError("duplicate event_id was accepted; audit is still mutable")
        """,
        "a duplicate event_id is rejected rather than overwriting",
        env={"CASERELAY_STATE": "memory"}, prelude=True,
    )


@gate("t7.1")
def _(c: Ctx) -> None:
    expected_simple = {"noah", "priya", "diego", "rosa", "ellis", "theo"}
    expected_complex = {"maya", "kai", "amara"}
    c.py(
        f"""
        from backend.state import scenarios
        all_ = scenarios.all_scenarios() if hasattr(scenarios, "all_scenarios") else scenarios.SCENARIOS
        ids = set(all_.keys()) if isinstance(all_, dict) else {{s.id for s in all_}}
        want = {sorted(expected_simple | expected_complex)!r}
        missing = set(want) - ids
        assert not missing, f"missing scenarios: {{sorted(missing)}}"

        def get(name):
            return all_[name] if isinstance(all_, dict) else next(s for s in all_ if s.id == name)

        for name in {sorted(expected_simple)!r}:
            s = get(name)
            cx = s["complexity"] if isinstance(s, dict) else s.complexity
            assert cx == "simple", f"{{name}} should be simple, got {{cx}}"
        for name in {sorted(expected_complex)!r}:
            s = get(name)
            cx = s["complexity"] if isinstance(s, dict) else s.complexity
            assert cx == "complex", f"{{name}} should be complex, got {{cx}}"

        for name in want:
            s = get(name)
            d = s if isinstance(s, dict) else s.__dict__
            for f in ("child_name", "title", "description", "expected_outcome"):
                assert d.get(f), f"{{name}} missing {{f}}"
        print("OK")
        """,
        "nine scenarios exist, correctly split into six simple and three complex",
        env={"CASERELAY_STATE": "memory"},
    )


@gate("t7.2")
def _(c: Ctx) -> None:
    c.py(
        """
        import json
        from backend.state import synthetic

        def blob(s):
            return json.dumps(synthetic.build_packet("CASE-VARY", scenario=s), default=str, sort_keys=True)

        names = ["noah", "priya", "diego", "rosa", "ellis", "theo", "maya", "kai", "amara"]
        packets = {n: blob(n) for n in names}
        assert len(set(packets.values())) == len(names), \\
            "scenarios do not produce materially different packets"

        # determinism for a fixed (case_id, scenario)
        assert blob("maya") == packets["maya"], "build_packet is not deterministic"

        assert "inject_callback" in packets["maya"], "maya must set inject_callback"
        noah = json.loads(packets["noah"])
        assert "inject_callback" not in packets["noah"] or "true" not in packets["noah"].lower().split("inject_callback")[1][:20], \\
            "noah is the clean baseline and must set no failure conditions"
        assert "test_case" in packets["maya"], "generated cases must carry test_case"
        print("OK")
        """,
        "scenarios produce distinct, deterministic packets; maya injects, noah is clean",
        env={"CASERELAY_STATE": "memory"},
    )


@gate("t7.3")
def _(c: Ctx) -> None:
    c.rg_absent(r"def \w+\([^)]*variant[^)]*\)", "backend/partners/ backend/agents/",
                "no partner or tool function takes a caller-supplied variant")
    c.py(
        """
        import inspect
        from backend.partners import sim
        src = inspect.getsource(sim)
        assert "case" in src or "state" in src, "sim.py does not appear to read case state"
        for behaviour in ("timeout", "malformed", "hallucinat"):
            assert behaviour in src.lower(), f"sim.py cannot produce {behaviour} behaviour"
        print("OK")
        """,
        "the simulator resolves behaviour from case state and covers the failure modes",
        env={"CASERELAY_STATE": "memory"},
    )


@gate("t8.1", slow=True)
def _(c: Ctx) -> None:
    rc, out = c.sh("python infra/cloud_e2e.py", timeout=900)
    c.add(rc == 0 and "CLOUD-E2E-OK" in out,
          "cloud_e2e.py passes on its default invocation", out[-2000:])
    rc2, out2 = c.sh(
        "CASERELAY_URL_EDUCATION=https://invalid.example/api python infra/cloud_e2e.py",
        timeout=900,
    )
    c.add(rc2 != 0, "it fails when a specialist is deliberately broken", out2[-1500:])


# ---- Stage 2 -------------------------------------------------------------


@gate("t9.1")
def _(c: Ctx) -> None:
    ok, routes = c.routes()
    if not ok:
        return
    demo = [r for r in routes if "/demo" in (r["path"] or "")]
    c.add(not demo, "no /demo route is registered", json.dumps(demo))
    bare_wake = [r for r in routes if r["path"] == "/wake"]
    c.add(not bare_wake, "no bare POST /wake route")
    # Docs count: leaving the walkthrough describing /demo/maya moves the credibility
    # problem from the code to the file a judge is more likely to read. The hardening
    # plan is excluded because it quotes the old routes in order to remove them.
    c.rg_absent("/demo/", "backend/ infra/ docs/ portal/src/ README.md",
                "no /demo reference remains in code, docs or the portal",
                flags="-g '!caserelay-hardening-plan.md'")


@gate("t9.2")
def _(c: Ctx) -> None:
    ok, routes = c.routes()
    if not ok:
        return
    for path in ("/v1/cases", "/v1/cases/{case_id}", "/v1/cases/{case_id}/audit",
                 "/v1/cases/{case_id}/memory", "/v1/approvals", "/v1/registry",
                 "/v1/traces/{trace_id}"):
        c.has_route(routes, "GET", path)


@gate("t9.3")
def _(c: Ctx) -> None:
    ok, routes = c.routes()
    if not ok:
        return
    c.has_route(routes, "POST", "/v1/cases")
    c.has_route(routes, "POST", "/v1/cases/{case_id}/activate")
    c.has_route(routes, "POST", "/v1/approvals/{approval_id}/decide")
    c.has_route(routes, "POST", "/v1/workflows/sweep")
    c.has_route(routes, "POST", "/v1/workflows/{workflow_id}/wake")


@gate("t9.4")
def _(c: Ctx) -> None:
    ok, routes = c.routes()
    if ok:
        c.has_route(routes, "GET", "/v1/scenarios")
        c.has_route(routes, "DELETE", "/v1/cases/{case_id}")
    c.py(
        """
        from fastapi.testclient import TestClient
        from backend.api.main import app
        cl = TestClient(app)

        r = cl.get("/v1/scenarios")
        assert r.status_code == 200, (r.status_code, r.text[:300])
        data = r.json()
        items = data if isinstance(data, list) else data.get("scenarios", [])
        assert len(items) >= 9, f"expected nine scenarios, got {len(items)}"
        for it in items:
            for f in ("id", "child_name", "complexity", "title", "description", "expected_outcome"):
                assert f in it, f"scenario {it.get('id')} missing {f}"

        r = cl.post("/v1/cases", json={"scenario": "noah", "due_in": "45s"})
        assert r.status_code in (200, 201), (r.status_code, r.text[:300])
        body = r.json()
        for f in ("case_id", "scenario", "due_at"):
            assert f in body, f"create response missing {f}: {sorted(body)}"
        print("OK")
        """,
        "scenarios list and scenario-backed create both work over the API",
        env={"CASERELAY_STATE": "memory"},
    )
    c.py(
        """
        from fastapi.testclient import TestClient
        from backend.api.main import app
        cl = TestClient(app)

        # A case that did not come from the test factory must not be deletable, so this
        # one is written straight to the workspace without the test_case flag.
        workspace.create_case("REAL-CASE-1", {"case_id": "REAL-CASE-1"})
        r = cl.delete("/v1/cases/REAL-CASE-1")
        assert 400 <= r.status_code < 500, \\
            f"deleting a non-test case returned {r.status_code}, expected a 4xx refusal"
        print("OK")
        """,
        "DELETE refuses a case that is not test_case",
        env={"CASERELAY_STATE": "memory"}, prelude=True,
    )


@gate("t9.5")
def _(c: Ctx) -> None:
    c.py(
        """
        from fastapi.testclient import TestClient
        from backend.api.main import app
        cl = TestClient(app)
        r = cl.get("/v1/cases/NO-SUCH-CASE-XYZ")
        assert r.status_code == 404, f"unknown case returned {r.status_code}, expected 404"
        body = r.text.lower()
        for leak in ("traceback", "document name", "google.api_core", "firestore"):
            assert leak not in body, f"error body leaks internals: {leak}"
        print("OK")
        """,
        "an unknown case is a clean 404 with no internals leaked",
        env={"CASERELAY_STATE": "memory"},
    )
    c.py(
        """
        import json
        from backend.api.main import app
        spec = json.dumps(app.openapi())
        assert '"403"' in spec, "403 is not documented in the OpenAPI schema"
        assert '"404"' in spec, "404 is not documented in the OpenAPI schema"
        print("OK")
        """,
        "403 and 404 are in the published schema so the client can code against them",
        env={"CASERELAY_STATE": "memory"},
    )


@gate("t10.1")
def _(c: Ctx) -> None:
    c.py(
        """
        import time
        from fastapi.testclient import TestClient
        from backend.api.main import app
        cl = TestClient(app)

        case_id = make_case("CASE-RUN-1", "noah")

        t0 = time.monotonic()
        r = cl.post(f"/v1/cases/{case_id}/runs")
        elapsed = time.monotonic() - t0
        assert r.status_code == 202, f"expected 202, got {r.status_code}: {r.text[:300]}"
        assert elapsed < 1.0, f"submission blocked for {elapsed:.2f}s; must return immediately"
        run_id = r.json()["run_id"]

        s = cl.get(f"/v1/runs/{run_id}")
        assert s.status_code == 200, s.text[:300]
        body = s.json()
        for f in ("state", "current_phase", "commitment_states", "trace_id"):
            assert f in body, f"run state missing {f}: {sorted(body)}"
        print("OK")
        """,
        "run submission returns 202 in under a second and run state is readable",
        env={"CASERELAY_STATE": "memory"}, prelude=True,
    )


@gate("t10.2")
def _(c: Ctx) -> None:
    c.py(
        """
        import threading, time
        from fastapi.testclient import TestClient
        from backend.api.main import app
        from backend.runtime.workspace import workspace

        cl = TestClient(app)
        case_id = make_case("CASE-SSE-1", "noah")

        # Drive run state directly rather than through POST /runs: the property under
        # test is event delivery, not fleet behaviour, and a real run takes minutes.
        run_id = "ssegate01"
        workspace.create_run(run_id, case_id)
        workspace.update_run(run_id, state="running")
        workspace.push_run_event(run_id, {"event": "seed", "run_id": run_id})

        def drive():
            time.sleep(1.0)
            workspace.push_run_event(run_id, {"event": "late_event", "run_id": run_id})
            time.sleep(1.0)
            workspace.update_run(run_id, state="completed")

        threading.Thread(target=drive, daemon=True).start()

        seen = []
        deadline = time.time() + 30
        with cl.stream("GET", f"/v1/runs/{run_id}/events") as r:
            assert r.status_code == 200, r.status_code
            ctype = r.headers.get("content-type", "")
            assert "text/event-stream" in ctype, f"content-type is {ctype!r}"
            for line in r.iter_lines():
                if line.startswith("data: "):
                    seen.append(line[6:])
                    if "stream_end" in line:
                        break
                if time.time() > deadline:
                    raise AssertionError("no stream_end within 30s; saw: " + " | ".join(seen))

        blob = " ".join(seen)
        assert "seed" in blob, "stream did not replay events queued before the client connected"
        # A one-shot dump-and-close implementation cannot satisfy this.
        assert "late_event" in blob, "stream did not deliver an event pushed after the client connected"
        assert "stream_end" in blob, "stream never signalled termination"
        print("OK")
        """,
        "the SSE endpoint delivers events pushed after connect and terminates on a terminal state",
        env={"CASERELAY_STATE": "memory"}, prelude=True, timeout=60,
    )


@gate("t10.3")
def _(c: Ctx) -> None:
    c.py(
        """
        import os, importlib
        os.environ["CASERELAY_CONTROL_PLANE"] = "1"
        for k in list(os.environ):
            if k.startswith("CASERELAY_URL_"):
                os.environ.pop(k)
        from backend.agents.orchestrator import agent as orch
        importlib.reload(orch)

        resolver = getattr(orch, "resolve_specialists", None) or getattr(orch, "build_agent", None)
        if resolver is None:
            raise SystemExit("no specialist resolver exists yet to probe")

        try:
            resolver()
        except Exception as e:
            msg = str(e).lower()
            named = any(w in msg for w in ("unreachable", "registry", "endpoint", "specialist"))
            if not named:
                raise SystemExit(f"raised, but the error does not name what failed to resolve: {e}")
            print("OK")
        else:
            raise SystemExit("control plane silently fell back to in-process sub_agents")
        """,
        "with no endpoints set the control plane raises instead of running agents in-process",
        env={"CASERELAY_STATE": "memory"},
    )


@gate("t11.1")
def _(c: Ctx) -> None:
    c.py(
        """
        from datetime import datetime, timedelta, timezone
        from backend.workflows import durable

        now = datetime.now(timezone.utc)
        make_case("CASE-OVERDUE"); make_case("CASE-FUTURE")
        overdue = durable.write_checkpoint("CASE-OVERDUE", due_at=now - timedelta(days=1))
        future = durable.write_checkpoint("CASE-FUTURE", due_at=now + timedelta(days=17))

        due = durable.find_due(now=now)
        ids = {d["workflow_id"] for d in due}
        assert overdue["workflow_id"] in ids, "an overdue checkpoint was not returned"
        assert future["workflow_id"] not in ids, \\
            "a checkpoint due in 17 days was fired early; the sweeper is not comparing due_at"
        print("OK")
        """,
        "the sweeper returns the overdue checkpoint and leaves the 17-day one alone",
        env={"CASERELAY_STATE": "memory"}, prelude=True,
    )
    c.py(
        """
        from datetime import datetime, timedelta, timezone
        from backend.workflows import durable
        now = datetime.now(timezone.utc)
        make_case("CASE-IDEM")
        durable.write_checkpoint("CASE-IDEM", due_at=now - timedelta(minutes=5))
        first = {d["workflow_id"] for d in durable.find_due(now=now)}
        durable.sweep(now=now)
        second = {d["workflow_id"] for d in durable.find_due(now=now)}
        assert not (first & second), "sweeping twice re-fires the same workflow"
        print("OK")
        """,
        "sweeping twice does not double-fire a workflow",
        env={"CASERELAY_STATE": "memory"}, prelude=True,
    )


@gate("t11.2")
def _(c: Ctx) -> None:
    src = (ROOT / "backend" / "workflows" / "durable.py")
    if not c.add(src.exists(), "durable.py exists"):
        return
    text = src.read_text()
    bad = "except Exception:\n        return" in text or "except Exception:  # noqa\n        return" in text
    c.add(not bad, "the bare except-return around the publish is gone",
          "found a swallowed exception in durable.py")
    c.rg_absent(r"except Exception:\s*\n\s*return\s*$", "backend/workflows/durable.py",
                "no swallowed publish failure", flags="-U --multiline")


@gate("t11.3")
def _(c: Ctx) -> None:
    c.rg_absent("elena-volunteer-001", "backend/ app/", "no hardcoded volunteer identity")
    c.py(
        """
        from datetime import datetime, timedelta, timezone
        from backend.workflows import durable
        from backend.runtime.workspace import workspace

        now = datetime.now(timezone.utc)
        make_case("CASE-WAKE-AUDIT")
        cp = durable.write_checkpoint("CASE-WAKE-AUDIT", due_at=now - timedelta(minutes=1))
        durable.resume_wake("CASE-WAKE-AUDIT", cp["workflow_id"])

        events = workspace.audit("CASE-WAKE-AUDIT") if hasattr(workspace, "audit") \\
                 else workspace.audit_events("CASE-WAKE-AUDIT")
        blob = str(events)
        assert "scheduler" in blob, f"no triggered_by: scheduler event was written: {blob[:400]}"
        assert "elena" not in blob.lower(), "an unattended wake was attributed to a person"
        print("OK")
        """,
        "a wake writes an audit event naming the scheduler, not a volunteer",
        env={"CASERELAY_STATE": "memory"}, prelude=True,
    )


@gate("t11.4")
def _(c: Ctx) -> None:
    c.py(
        """
        from datetime import datetime, timezone
        from fastapi.testclient import TestClient
        from backend.api.main import app
        cl = TestClient(app)

        def due_of(payload):
            r = cl.post("/v1/cases", json=payload)
            assert r.status_code in (200, 201), (r.status_code, r.text[:300])
            return r.json()["due_at"]

        short = due_of({"scenario": "maya", "due_in": "45s", "case_id": "CASE-SHORT"})
        long_ = due_of({"scenario": "maya", "due_in": "17d", "case_id": "CASE-LONG"})
        assert short != long_, "due_in had no effect on the stored deadline"

        def parse(x):
            return datetime.fromisoformat(str(x).replace("Z", "+00:00"))

        delta = (parse(long_) - parse(short)).total_seconds()
        assert delta > 16 * 86400, f"17d and 45s differ by only {delta}s"
        print("OK")
        """,
        "due_in resolves to a real deadline and 45s vs 17d differ as expected",
        env={"CASERELAY_STATE": "memory"},
    )
    # The whole design rests on never rewriting a deadline after creation.
    c.rg_absent(r'due_at\s*=\s*', "backend/api/", "no route mutates due_at after creation")


@gate("t11.5", slow=True)
def _(c: Ctx) -> None:
    c.exists("infra/bootstrap.sh")
    rc, out = c.sh("bash -n infra/bootstrap.sh")
    c.add(rc == 0, "bootstrap.sh parses", out)
    c.rg_present("cloudscheduler", "infra/bootstrap.sh", "it enables the Scheduler API")
    c.rg_present("dead-letter|dead_letter", "infra/bootstrap.sh", "it sets a dead-letter policy")
    rc, out = c.sh("gcloud scheduler jobs list --project=caserelay --location=us-central1 "
                   "--format='value(name)'", timeout=120)
    c.add(rc == 0 and out.strip() != "", "a Cloud Scheduler job exists", out[-600:])
    rc, out = c.sh("gcloud pubsub subscriptions list --project=caserelay --format='value(name)'",
                   timeout=120)
    c.add(rc == 0 and "caserelay-events" in out,
          "caserelay-events has a subscription", out[-600:])


@gate("t12.1")
def _(c: Ctx) -> None:
    rc, out = c.sh("docker build -f backend/Dockerfile -t caserelay-control-plane:gate .", timeout=1200)
    c.add(rc == 0, "docker build succeeds", out[-2500:])
    if rc != 0:
        return
    rc, out = c.sh(
        "docker run --rm -d -p 18080:8080 -e CASERELAY_STATE=memory "
        "--name caserelay-gate caserelay-control-plane:gate",
        timeout=180,
    )
    if not c.add(rc == 0, "the container starts", out[-800:]):
        return
    try:
        rc, out = c.sh(
            "for i in $(seq 1 30); do "
            "  curl -fsS http://localhost:18080/health && exit 0; sleep 2; done; exit 1",
            timeout=120,
        )
        c.add(rc == 0, "GET /health responds from inside the image", out[-600:])
    finally:
        c.sh("docker rm -f caserelay-gate", timeout=60)
    c.rg_absent(r"google-adk[><=]", "backend/Dockerfile", "no inline pin contradicts pyproject.toml")


@gate("t12.2", slow=True)
def _(c: Ctx) -> None:
    url_file = ROOT / "infra" / "control_plane_url.txt"
    if not c.add(url_file.exists(), "the deployed URL is recorded for the portal"):
        return
    url = url_file.read_text().strip()
    c.add(url.startswith("https://") and ".run.app" in url, f"recorded URL looks right: {url}")
    rc, out = c.sh(f"curl -fsS -m 30 {url}/health", timeout=60)
    c.add(rc == 0, "GET /health returns 200 over HTTPS", out[-600:])
    rc, out = c.sh(f"curl -fsS -m 60 -H \"Authorization: Bearer $(gcloud auth print-identity-token)\" "
                   f"{url}/v1/cases", timeout=120)
    c.add(rc == 0, "GET /v1/cases returns data over HTTPS", out[-800:])
    rc, out = c.sh("gcloud run services list --project=caserelay --format='value(metadata.name)'",
                   timeout=120)
    c.add(rc == 0 and out.strip() != "", "a Cloud Run service exists", out[-400:])


@gate("t12.3")
def _(c: Ctx) -> None:
    c.py(
        """
        from backend.api.main import app
        mws = [str(m) for m in app.user_middleware]
        assert any("CORS" in m for m in mws), f"no CORS middleware installed: {mws}"
        opts = {}
        for m in app.user_middleware:
            if "CORS" in str(m):
                opts = getattr(m, "kwargs", {}) or getattr(m, "options", {}) or {}
        origins = opts.get("allow_origins", [])
        creds = opts.get("allow_credentials", False)
        assert not (origins == ["*"] and creds), "wildcard origin with credentials is unsafe"
        print("OK")
        """,
        "CORS is configured and is not a wildcard with credentials",
        env={"CASERELAY_STATE": "memory"},
    )
    c.rg_present("localhost:3000", "backend/api/main.py infra/", "the portal dev origin is allowed")


# ---- Stage 3 -------------------------------------------------------------


@gate("t13.1")
def _(c: Ctx) -> None:
    if not c.exists("contracts/openapi.json"):
        return
    try:
        spec = json.loads((ROOT / "contracts" / "openapi.json").read_text())
    except Exception as e:  # noqa: BLE001
        c.add(False, "contracts/openapi.json is valid JSON", str(e))
        return
    c.add(True, "contracts/openapi.json is valid JSON")
    paths = spec.get("paths", {})
    c.add(not any("/demo" in p for p in paths), "the frozen contract has no /demo path")
    for required in ("/v1/cases", "/v1/scenarios", "/v1/approvals",
                     "/v1/workflows/sweep"):
        c.add(required in paths, f"contract documents {required}", f"have: {sorted(paths)[:25]}")
    blob = json.dumps(spec)
    c.add('"403"' in blob and '"404"' in blob, "contract documents the 403 and 404 shapes")
    # It must match what is actually running, or it is fiction.
    c.py(
        """
        import json, pathlib
        from backend.api.main import app
        live = app.openapi()
        frozen = json.loads(pathlib.Path("contracts/openapi.json").read_text())
        lp, fp = set(live.get("paths", {})), set(frozen.get("paths", {}))
        assert lp == fp, f"contract drifted from the app.\\nonly in app: {sorted(lp - fp)}\\nonly in file: {sorted(fp - lp)}"
        print("OK")
        """,
        "the checked-in contract matches the app's live schema",
        env={"CASERELAY_STATE": "memory"},
    )


@gate("t14.1")
def _(c: Ctx) -> None:
    if not c.exists("docs/admin-page-spec.md"):
        return
    text = (ROOT / "docs" / "admin-page-spec.md").read_text()
    for needle, label in (
        ("/v1/scenarios", "spec names the scenarios endpoint"),
        ("/v1/cases", "spec names the create endpoint"),
        ("/v1/runs", "spec names the run/SSE endpoints"),
        ("/v1/approvals", "spec names the approvals endpoint"),
        ("test_case", "spec states the test_case-only rule"),
        ("due_in", "spec covers the compressed-deadline control"),
    ):
        c.add(needle in text, label)
    c.add(".run.app" in text, "spec includes the deployed base URL")
    # Every endpoint the spec names must exist in the frozen contract.
    cpath = ROOT / "contracts" / "openapi.json"
    if cpath.exists():
        spec_paths = set(json.loads(cpath.read_text()).get("paths", {}))
        import re as _re
        named = set(_re.findall(r"/v1/[A-Za-z0-9_{}/-]+", text))
        def known(p: str) -> bool:
            return any(p.rstrip("/").startswith(sp.split("{")[0].rstrip("/")) for sp in spec_paths)
        unknown = sorted(p for p in named if not known(p))
        c.add(not unknown, "every endpoint the spec names exists in the contract",
              f"not in contract: {unknown}")


# --------------------------------------------------------------------------
# runner
# --------------------------------------------------------------------------


def run_gate(task_id: str, allow_slow: bool) -> GateResult:
    fn = GATES.get(task_id)
    if fn is None:
        return GateResult(task_id, FAIL, [Check(False, "gate is defined", f"no gate for {task_id}")],
                          [f"Add a gate for {task_id} in harness/gate.py"])
    if task_id in SLOW and not allow_slow:
        return GateResult(task_id, SKIP)
    c = Ctx()
    try:
        fn(c)
    except Exception as e:  # noqa: BLE001 - a crashing gate is a failing gate
        import traceback
        c.add(False, "gate ran without crashing", traceback.format_exc()[-1500:])
    status = PASS if c.checks and all(ck.ok for ck in c.checks) else FAIL
    res = GateResult(task_id, status, c.checks)
    if status == FAIL:
        res.next_actions = [f"Fix: {ck.label}" for ck in c.checks if not ck.ok]
    return res


def task_ids_for(stage: int | None) -> list[str]:
    return [t for t in GATES if stage is None or stage_of(t) == stage]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("task_id", nargs="?", help="task id, e.g. t5.1")
    ap.add_argument("--stage", type=int, help="run every gate in a stage")
    ap.add_argument("--all", action="store_true", help="run every gate")
    ap.add_argument("--slow", action="store_true", help="include cloud/LLM gates (costs money)")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    args = ap.parse_args()

    if args.task_id:
        ids = [args.task_id]
    elif args.stage is not None:
        ids = task_ids_for(args.stage)
    elif args.all:
        ids = task_ids_for(None)
    else:
        ap.error("give a task id, --stage N, or --all")

    results = [run_gate(i, args.slow) for i in ids]

    if args.json:
        print(json.dumps([r.to_dict() for r in results], indent=2))
    else:
        for r in results:
            mark = {PASS: "PASS", FAIL: "FAIL", SKIP: "SKIP"}[r.status]
            print(f"[{mark}] {r.summary}")
            for ck in r.checks:
                if not ck.ok:
                    print(f"       - {ck.label}")
                    if ck.detail:
                        for line in ck.detail.splitlines()[-12:]:
                            print(f"         {line}")
        n_fail = sum(1 for r in results if r.status == FAIL)
        n_skip = sum(1 for r in results if r.status == SKIP)
        print(f"\n{len(results) - n_fail - n_skip} passed, {n_fail} failed, {n_skip} skipped")

    return 1 if any(r.status == FAIL for r in results) else 0


if __name__ == "__main__":
    sys.exit(main())
