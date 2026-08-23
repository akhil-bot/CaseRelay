from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class AgentEvent(BaseModel):
    event_id: str
    trace_id: str
    workflow_id: str
    case_id: str
    event_type: str
    source_agent: str
    target_agent: str
    authorized_purpose: str
    allowed_fields: list[str] = Field(default_factory=list)
    payload: dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime
    idempotency_key: str


class AgentRequest(BaseModel):
    case_id: str
    workflow_id: str
    event_id: str
    trace_id: str
    requester_identity: str
    authorized_purpose: str
    allowed_fields: list[str] = Field(default_factory=list)
    idempotency_key: str
    payload: dict[str, Any] = Field(default_factory=dict)


class AgentResponse(BaseModel):
    event_id: str
    status: Literal[
        "received",
        "scheduled",
        "completed",
        "blocked",
        "unresolved",
        "pending",
        "draft",
    ]
    facts: list[dict[str, Any]] = Field(default_factory=list)
    proposed_next_action: str | None = None
    approval_required: bool = False
    disclosed_fields: list[str] = Field(default_factory=list)
    withheld_fields: list[str] = Field(default_factory=list)
    audit_ref: str = ""
    evidence_refs: list[str] = Field(default_factory=list)
