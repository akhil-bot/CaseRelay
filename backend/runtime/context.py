"""Run-scoped identity and trace propagation.

A RunContext is held in a contextvars.ContextVar so it propagates into awaited calls
without threading parameters through every signature. The trace_id is always derived
from the active OTel span when one is present, so the id stored in Firestore matches
the id Cloud Trace indexes. Outside a span, a stable UUID is used.
"""

from __future__ import annotations

import contextvars
from contextlib import contextmanager
from dataclasses import dataclass, field
from uuid import uuid4

# Ensure the SDK TracerProvider is active so spans have real, non-zero trace ids.
# Without this, `get_tracer()` returns a no-op tracer and every span carries an
# all-zeros trace id that does not appear in Cloud Trace.
try:
    from opentelemetry import trace as _otel_init
    from opentelemetry.sdk.trace import TracerProvider as _SDKProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    if not isinstance(_otel_init.get_tracer_provider(), _SDKProvider):
        import logging as _logging
        import os as _os

        _provider = _SDKProvider()
        if _os.environ.get("GOOGLE_CLOUD_PROJECT") or _os.environ.get("CASERELAY_PROJECT_ID"):
            from opentelemetry.exporter.cloud_trace import CloudTraceSpanExporter

            # Agent Runtime overrides GOOGLE_CLOUD_PROJECT with the numeric project
            # number, which Cloud Trace rejects in resource names. CASERELAY_PROJECT_ID
            # always holds the string project ID and takes precedence.
            _project_id = (
                _os.environ.get("CASERELAY_PROJECT_ID")
                or _os.environ.get("GOOGLE_CLOUD_PROJECT")
            )
            _provider.add_span_processor(
                BatchSpanProcessor(CloudTraceSpanExporter(project_id=_project_id))
            )
        _otel_init.set_tracer_provider(_provider)
except Exception as _otel_exc:  # noqa: BLE001 — OTel SDK not available
    import logging as _logging
    _logging.getLogger("caserelay.otel").warning(
        "OTel TracerProvider setup failed — traces will not be exported: %s", _otel_exc
    )


def _new_id() -> str:
    return uuid4().hex


@dataclass
class RunContext:
    run_id: str = field(default_factory=_new_id)
    case_id: str = ""
    workflow_id: str = ""
    trace_id: str = field(default_factory=_new_id)
    agent_identity: str = ""


_ctx: contextvars.ContextVar[RunContext] = contextvars.ContextVar("caserelay_run_context")


def current() -> RunContext:
    """Return the active RunContext.

    When called inside an OTel span, trace_id is replaced with the span's trace id so
    the value stored in Firestore matches the Cloud Trace index. A run with no bound
    context still gets a non-zero UUID, so audit events are never recorded with a null id.
    """
    base = _ctx.get(None) or RunContext()
    try:
        from opentelemetry import trace as _otel
        span = _otel.get_current_span()
        sc = span.get_span_context() if span else None
        if sc is not None and sc.is_valid:
            otel_tid = _otel.format_trace_id(sc.trace_id)
            if set(otel_tid) != {"0"}:
                return RunContext(
                    run_id=base.run_id,
                    case_id=base.case_id,
                    workflow_id=base.workflow_id,
                    trace_id=otel_tid,
                    agent_identity=base.agent_identity,
                )
    except Exception:  # noqa: BLE001 — OTel not installed or not configured
        pass
    return base


@contextmanager
def bind(**kwargs):
    """Set fields on the RunContext for the duration of the with-block.

    Compatible with asyncio.gather — each task gets its own copy of the contextvar.
    """
    base = _ctx.get(None) or RunContext()
    merged = RunContext(
        run_id=kwargs.get("run_id", base.run_id),
        case_id=kwargs.get("case_id", base.case_id),
        workflow_id=kwargs.get("workflow_id", base.workflow_id),
        trace_id=kwargs.get("trace_id", base.trace_id),
        agent_identity=kwargs.get("agent_identity", base.agent_identity),
    )
    token = _ctx.set(merged)
    try:
        yield merged
    finally:
        _ctx.reset(token)
