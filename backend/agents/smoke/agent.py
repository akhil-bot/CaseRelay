"""
Smoke / health agent — verifies ADK + Gemini connectivity end-to-end.
Run with: adk run backend/agents/smoke "ping"
"""

from google.adk.agents import Agent


def ping(_ = None) -> dict:
    """Returns a structured health payload; no LLM call required."""
    return {"ok": True, "service": "caserelay-smoke"}


root_agent = Agent(
    name="caserelay_smoke",
    model="gemini-3.5-flash",
    description="CaseRelay smoke / health agent. Replies to any message with a ping response.",
    instruction=(
        "You are the CaseRelay smoke agent. "
        "When the user sends any message, call the ping tool and return its result verbatim. "
        "Do not add any extra text."
    ),
    tools=[ping],
)
