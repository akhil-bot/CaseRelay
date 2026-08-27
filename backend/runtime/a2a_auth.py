"""Authenticated HTTP client for agent-to-agent calls.

Deployed specialists are reached through the Agent Runtime /api passthrough, which sits behind
Google's API frontend and rejects unauthenticated requests. RemoteA2aAgent's default client sends
no credentials, so it needs one that mints and refreshes an access token from the caller's own
service account.
"""

import asyncio
import logging

import httpx

logger = logging.getLogger(__name__)

SCOPE = "https://www.googleapis.com/auth/cloud-platform"

# ADK's engine-side middleware extracts distributed trace context only from this
# custom header, not from the standard W3C traceparent that HTTPXClientInstrumentor
# injects. We mirror the traceparent value into this header so the engine's root
# span becomes a child of the control-plane span, producing one linked trace.
_AE_TRACEPARENT_HEADER = "Google-Agent-Engine-Traceparent"


class GoogleAuth(httpx.Auth):
    """Attaches a bearer token from Application Default Credentials, refreshing when stale."""

    def __init__(self) -> None:
        import google.auth

        self._credentials, _ = google.auth.default(scopes=[SCOPE])

    def auth_flow(self, request: httpx.Request):
        import google.auth.transport.requests

        if not self._credentials.valid:
            self._credentials.refresh(google.auth.transport.requests.Request())
        request.headers["Authorization"] = f"Bearer {self._credentials.token}"
        yield request


async def _inject_ae_traceparent(request: httpx.Request) -> None:
    """Mirror the active OTel span into Google-Agent-Engine-Traceparent.

    ADK's get_propagated_context reads Google-Agent-Engine-Traceparent to create
    a child span on the engine side. W3C traceparent (injected by HTTPXClientInstrumentor)
    is stored only in baggage there, not used as a parent. Sending both headers produces
    a single linked trace across the A2A boundary.

    The hook reads from contextvars, which are task-scoped in asyncio, so concurrent
    fan-out calls each read their own span without cross-task contamination.
    """
    try:
        from opentelemetry import trace
        from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

        span = trace.get_current_span()
        sc = span.get_span_context() if span else None
        if sc is not None and sc.is_valid:
            carrier: dict[str, str] = {}
            TraceContextTextMapPropagator().inject(carrier)
            tp = carrier.get("traceparent")
            if tp:
                request.headers[_AE_TRACEPARENT_HEADER] = tp
    except Exception as exc:
        logger.warning("Failed to inject %s: %s", _AE_TRACEPARENT_HEADER, exc)


# Hooks registered on every authenticated client. Declared here so the guard below
# runs at import time rather than on first use — a sync hook kills every outbound
# call with a confusing TypeError, so we must refuse to start rather than fail later.
_REQUEST_HOOKS: list = [_inject_ae_traceparent]

for _hook in _REQUEST_HOOKS:
    if not asyncio.iscoroutinefunction(_hook):
        raise TypeError(
            f"a2a_auth: event hook {_hook.__name__!r} must be declared 'async def'; "
            f"httpx.AsyncClient awaits every request hook and raises TypeError when it "
            f"returns None instead of a coroutine. Fix: 'async def {_hook.__name__}(...)'."
        )


def authenticated_client(timeout: float = 600.0) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        auth=GoogleAuth(),
        timeout=timeout,
        event_hooks={"request": list(_REQUEST_HOOKS)},
    )
