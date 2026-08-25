"""Serving entrypoint for one CaseRelay agent.

The same image is deployed once per agent. CASERELAY_AGENT selects which one this instance
exposes, so an endpoint running under education-agent@ cannot answer as the health agent even
though the code for both ships in the image.

ADK mounts A2A routes only for agent folders that contain an agent.json card, and it keys the
route on the folder name. We therefore write the card for the selected agent at startup (its
rpc_url is only knowable once the service has a URL) and delete every other card so this
process can serve nothing else.
"""

import asyncio
import json
import os
from pathlib import Path
from typing import Any, Union

from google.adk.a2a.utils.agent_card_builder import AgentCardBuilder
from google.adk.agents import BaseAgent
from google.adk.apps import App
from google.adk.cli.fast_api import get_fast_api_app
from google.adk.cli.utils.agent_loader import AgentLoader

AGENTS_DIR = "backend/agents"

AGENT_FOLDERS = {
    "intake_authority": "intake",
    "continuity_orchestrator": "orchestrator",
    "education_liaison": "education",
    "health_coordination": "health",
    "legal_aid": "legal",
    "shelter_status": "shelter",
    "family_services": "family",
    "safeguarding_verifier": "verifier",
}

AGENT_NAME = os.environ.get("CASERELAY_AGENT", "continuity_orchestrator")
if AGENT_NAME not in AGENT_FOLDERS:
    raise ValueError(f"CASERELAY_AGENT must be one of {sorted(AGENT_FOLDERS)}, got {AGENT_NAME!r}")
FOLDER = AGENT_FOLDERS[AGENT_NAME]
PUBLIC_URL = os.environ.get("CASERELAY_PUBLIC_URL", "http://127.0.0.1:8080").rstrip("/")


class SingleAgentLoader(AgentLoader):
    """Serves exactly one agent folder and refuses every other name."""

    def __init__(self, agents_dir: str, folder: str) -> None:
        super().__init__(agents_dir)
        self._folder = folder

    def list_agents(self) -> list[str]:
        return [self._folder]

    def list_agents_detailed(self) -> list[dict[str, Any]]:
        return [{"name": self._folder, "type": "agent"}]

    def load_agent(self, agent_name: str) -> Union[BaseAgent, App]:
        if agent_name != self._folder:
            raise ValueError(f"this endpoint only serves {self._folder}")
        return super().load_agent(self._folder)


def _write_agent_cards(loader: SingleAgentLoader) -> None:
    """Write this agent's A2A card and remove the others so only one A2A route mounts."""
    base = Path(AGENTS_DIR)
    for folder in base.iterdir():
        if folder.is_dir() and folder.name != FOLDER:
            (folder / "agent.json").unlink(missing_ok=True)

    agent = loader.load_agent(FOLDER)
    card = asyncio.run(
        AgentCardBuilder(
            agent=agent,
            rpc_url=f"{PUBLIC_URL}/a2a/{FOLDER}",
            agent_version="1.0.0",
        ).build()
    )
    # a2a-sdk ships AgentCard as protobuf or pydantic depending on version; ADK's own
    # serializer is the symmetric counterpart to the parse_agent_card it uses to read this file.
    from google.adk.a2a import _compat

    payload = _compat.a2a_to_dict(card)
    (base / FOLDER / "agent.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")


loader = SingleAgentLoader(AGENTS_DIR, FOLDER)
_write_agent_cards(loader)

app = get_fast_api_app(
    agents_dir=AGENTS_DIR,
    agent_loader=loader,
    web=False,
    a2a=True,
    # Passing FOLDER here unlocks the /api/reasoning_engine and
    # /api/stream_reasoning_engine routes that Gemini Enterprise (AgentSpace)
    # calls via Vertex AI streamQuery. Without this argument the entire route
    # block in ADK's get_fast_api_app is skipped (gated on `if
    # gemini_enterprise_app_name:`), causing a 404 on every streamQuery
    # invocation and a silent fallback to the base Gemini model.
    gemini_enterprise_app_name=FOLDER,
    otel_to_cloud=True,
    host="0.0.0.0",
    port=int(os.environ.get("PORT", "8080")),
)
