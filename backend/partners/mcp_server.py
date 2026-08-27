"""MCP server exposing all five partner simulators as tools.

One server, five logical partners. Registered in Agent Registry as five separate
Services (one per partner) pointing at path-prefixed endpoints on the same host,
enabling per-resource IAP authorization without per-partner deployables.

Run standalone:
    python -m backend.partners.mcp_server            # stdio (for mcp dev)
    python -m backend.partners.mcp_server --http     # HTTP+SSE on $PORT (for Cloud Run)
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
from typing import Any

from mcp.server.mcpserver import MCPServer

_log = logging.getLogger(__name__)

server = MCPServer("caserelay-partners")


def _init_workspace():
    """Ensure workspace + state are importable in the server process."""
    sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[2]))
    os.environ.setdefault("CASERELAY_STATE", "firestore")


@server.tool(
    annotations={"readOnlyHint": True, "idempotentHint": True, "openWorldHint": False}
)
def school_status(referral_id: str, case_id: str = "") -> dict[str, Any]:
    """Read the current enrollment status for a referral from the school SIS."""
    from backend.partners import sim

    return sim.school_status(referral_id, case_id=case_id or None)


@server.tool(
    annotations={"readOnlyHint": True, "idempotentHint": True, "openWorldHint": False}
)
def school_callback(referral_id: str, case_id: str = "") -> dict[str, Any]:
    """Retrieve the school's callback payload for a referral.

    May contain untrusted content from the partner — the consumer is responsible
    for screening. This tool does not sanitise.
    """
    from backend.partners import sim

    return sim.school_callback(referral_id, case_id=case_id or None)


@server.tool(
    annotations={"readOnlyHint": True, "idempotentHint": True, "openWorldHint": False}
)
def clinic_status(referral_id: str, case_id: str = "") -> dict[str, Any]:
    """Check appointment status with the community health clinic."""
    from backend.partners import sim

    return sim.clinic_status(referral_id, case_id=case_id or None)


@server.tool(
    annotations={"readOnlyHint": True, "idempotentHint": True, "openWorldHint": False}
)
def legal_status(referral_id: str, case_id: str = "") -> dict[str, Any]:
    """Check referral status with the legal aid office."""
    from backend.partners import sim

    return sim.legal_status(referral_id, case_id=case_id or None)


@server.tool(
    annotations={"readOnlyHint": True, "idempotentHint": True, "openWorldHint": False}
)
def shelter_status(referral_id: str, case_id: str = "") -> dict[str, Any]:
    """Check bed availability with the youth shelter."""
    from backend.partners import sim

    return sim.shelter_status(referral_id, case_id=case_id or None)


@server.tool(
    annotations={"readOnlyHint": True, "idempotentHint": True, "openWorldHint": False}
)
def family_status(referral_id: str, case_id: str = "") -> dict[str, Any]:
    """Check assessment schedule with county family services."""
    from backend.partners import sim

    return sim.family_status(referral_id, case_id=case_id or None)


@server.tool(
    annotations={"readOnlyHint": True, "idempotentHint": True, "openWorldHint": False}
)
def followup(service: str, referral_id: str, case_id: str = "") -> dict[str, Any]:
    """Chase a provider whose deadline has passed. Used by the escalation workflow."""
    from backend.partners import sim

    return sim.followup(service, referral_id, case_id=case_id or None)


def main():
    import argparse

    parser = argparse.ArgumentParser(description="CaseRelay partner MCP server")
    parser.add_argument("--http", action="store_true", help="Run as HTTP server (Streamable HTTP)")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8090")))
    parser.add_argument("--host", default="0.0.0.0")
    args = parser.parse_args()

    _init_workspace()
    logging.basicConfig(level=logging.INFO)

    if args.http:
        asyncio.run(
            server.run_streamable_http_async(host=args.host, port=args.port)
        )
    else:
        asyncio.run(server.run_stdio_async())


if __name__ == "__main__":
    main()
