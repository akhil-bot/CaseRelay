import json
from datetime import datetime, timezone
from typing import Any

TRACE_ID = "trace-7821"


def _clip(value: Any, limit: int = 220) -> str:
    text = value if isinstance(value, str) else json.dumps(value, default=str)
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


class TraceLog:
    """Ordered record of every agent hop, tool call, and handoff in one workflow."""

    def __init__(self) -> None:
        self.hops: list[dict[str, Any]] = []
        self.echo = False

    def reset(self, echo: bool = False) -> None:
        self.hops = []
        self.echo = echo

    def add(self, kind: str, agent: str, detail: str, payload: Any = None) -> None:
        hop = {
            "seq": len(self.hops) + 1,
            "trace_id": TRACE_ID,
            "at": datetime.now(timezone.utc).strftime("%H:%M:%S"),
            "kind": kind,
            "agent": agent,
            "detail": detail,
        }
        if payload is not None:
            hop["payload"] = _clip(payload, 400)
        self.hops.append(hop)
        if self.echo:
            label = {
                "phase": "PHASE  ",
                "invoke": "INVOKE ",
                "tool_in": "  tool→",
                "tool_out": "  tool←",
                "transfer": "HANDOFF",
                "gateway": "GATEWAY",
                "output": "OUTPUT ",
            }.get(kind, kind.upper())
            line = f"[{hop['seq']:>2}] {label} {agent}: {detail}"
            if "payload" in hop:
                line += f"\n         {hop['payload']}"
            print(line, flush=True)

    def as_table(self) -> list[dict[str, Any]]:
        return self.hops


tracer = TraceLog()
