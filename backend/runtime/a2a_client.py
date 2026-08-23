"""Client for calling a deployed CaseRelay agent over A2A.

Agent Runtime exposes each agent's ADK app behind an /api passthrough, and ADK mounts the A2A
JSON-RPC route at /a2a/<folder>. This is the caller side of that contract, shared by the
operator CLI and the end-to-end driver so both speak to the fleet the same way the orchestrator
does.
"""

import json
import os
from typing import Any
from uuid import uuid4

import httpx

from backend.runtime.a2a_auth import GoogleAuth

# CLI key -> the agent folder ADK mounts the A2A route under.
AGENTS = {
    "intake": "intake",
    "orchestrator": "orchestrator",
    "education": "education",
    "health": "health",
    "legal": "legal",
    "shelter": "shelter",
    "family": "family",
    "verifier": "verifier",
}


def endpoint(key: str) -> str:
    if key not in AGENTS:
        raise SystemExit(f"unknown agent {key!r}; expected one of {sorted(AGENTS)}")
    base = os.environ.get(f"CASERELAY_URL_{key.upper()}", "").rstrip("/")
    if not base:
        raise SystemExit(
            f"CASERELAY_URL_{key.upper()} is not set — run: source infra/fleet_endpoints.env"
        )
    return f"{base}/a2a/{AGENTS[key]}"


def client(timeout: float = 600.0) -> httpx.Client:
    return httpx.Client(auth=GoogleAuth(), timeout=timeout)


def _texts(node: Any, out: list[str]) -> None:
    """Collect every text part in the response, whatever shape the task result came back in."""
    if isinstance(node, dict):
        if node.get("kind") == "text" and isinstance(node.get("text"), str) and node["text"].strip():
            out.append(node["text"].strip())
        for value in node.values():
            _texts(value, out)
    elif isinstance(node, list):
        for item in node:
            _texts(item, out)


def send(http: httpx.Client, url: str, text: str) -> str:
    """One A2A turn. The reply may be empty; stored case state is the source of truth."""
    body = {
        "jsonrpc": "2.0",
        "id": uuid4().hex,
        "method": "message/send",
        "params": {
            "message": {
                "role": "user",
                "parts": [{"kind": "text", "text": text}],
                "messageId": uuid4().hex,
            }
        },
    }
    response = http.post(url, json=body)
    response.raise_for_status()
    data = response.json()
    if "error" in data:
        raise RuntimeError(f"A2A error from {url}: {json.dumps(data['error'])[:400]}")
    found: list[str] = []
    _texts(data.get("result") or {}, found)
    # The task history replays the prompt, and the same reply appears in both the artifact and the
    # final status, so drop the echo and keep the first occurrence of everything else.
    seen, unique = {text.strip()}, []
    for chunk in found:
        if chunk not in seen:
            seen.add(chunk)
            unique.append(chunk)
    return " ".join(unique)


def ask(key: str, text: str) -> str:
    with client() as http:
        return send(http, endpoint(key), text)
