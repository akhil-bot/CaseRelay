from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from backend.state import store
from backend.state.case_machine import COMMITMENT_STATES, assert_transition

TRACE_ID = "trace-7821"


def _now() -> datetime:
    return datetime.now(timezone.utc)


class CaseNotFound(KeyError):
    """Raised when an agent is asked about a case that was never ingested."""


class Workspace:
    """Case state for the fleet.

    The dicts are this process's view. When Firestore is enabled they act as a read-through /
    write-through cache: `load` pulls the aggregate before a read and every mutator persists
    immediately, so an agent on another host sees the same grants and commitments.
    """

    def __init__(self) -> None:
        self.cases: dict[str, dict[str, Any]] = {}
        self.commitments: dict[str, list[dict[str, Any]]] = {}
        self.grants: dict[str, list[dict[str, Any]]] = {}
        self.updates: dict[str, dict[str, dict[str, Any]]] = {}
        self.approvals: dict[str, list[dict[str, Any]]] = {}
        self.audit: dict[str, list[dict[str, Any]]] = {}
        self.checkpoints: dict[str, dict[str, Any]] = {}
        self.memory: dict[str, dict[str, dict[str, Any]]] = {}

    def reset(self, case_id: str) -> None:
        store.delete_case(case_id)
        self.cases.pop(case_id, None)
        self.commitments.pop(case_id, None)
        self.grants.pop(case_id, None)
        self.updates.pop(case_id, None)
        self.approvals.pop(case_id, None)
        self.audit.pop(case_id, None)
        self.memory.pop(case_id, None)
        self.checkpoints.pop("wf-school-enrollment", None)

    def load(self, case_id: str) -> None:
        """Refresh this process's view from shared state. No-op when running in-memory.

        Deployed instances are long-lived and serve many requests, so a cached view goes stale
        as soon as another agent writes. Reads therefore always re-sync rather than only
        populating when empty.
        """
        if not store.enabled():
            return
        remote = store.load_case(case_id)
        if not remote:
            return
        self.cases[case_id] = remote["case"]
        self.commitments[case_id] = remote["commitments"]
        self.grants[case_id] = remote["grants"]
        self.approvals[case_id] = remote["approvals"]
        self.audit[case_id] = remote["audit"]
        self.memory[case_id] = remote["memory"]
        self.updates.setdefault(case_id, {})

    def get_case(self, case_id: str) -> dict[str, Any]:
        """The case as it exists in the store. Agents read cases; they never invent one."""
        if case_id not in self.cases:
            self.load(case_id)
        if case_id not in self.cases:
            raise CaseNotFound(f"case {case_id} has not been ingested")
        return self.cases[case_id]

    def create_case(self, case_id: str, packet: dict[str, Any]) -> dict[str, Any]:
        """Ingest a referral packet as a new draft case.

        This is the data-plane entry point used by whatever delivers referrals — the test
        harness today, a real intake pipeline later. Agents do not call it.
        """
        self.cases[case_id] = {
            "case_id": case_id,
            "child_name": packet["child"]["name"],
            "dob": packet["child"]["dob"],
            "status": "draft",
            "volunteer_id": packet["volunteer_id"],
            "supervisor_id": packet["supervisor_id"],
            "created_at": _now().isoformat(),
            "activated_at": None,
            "referral_packet": packet,
        }
        self.commitments.setdefault(case_id, [])
        self.grants.setdefault(case_id, [])
        self.updates.setdefault(case_id, {})
        self.approvals.setdefault(case_id, [])
        self.audit.setdefault(case_id, [])
        self.memory.setdefault(case_id, {})
        store.save_case(case_id, self.cases[case_id])
        return self.cases[case_id]

    def packet(self, case_id: str) -> dict[str, Any]:
        """The referral packet stored on the case — the only source of its referral ids."""
        packet = self.get_case(case_id).get("referral_packet")
        if not packet:
            raise CaseNotFound(f"case {case_id} has no referral packet")
        return packet

    def put_commitments(self, case_id: str, rows: list[dict[str, Any]]) -> None:
        self.commitments[case_id] = rows
        store.save_rows(case_id, "commitments", rows, "commitment_id")

    def put_grants(self, case_id: str, grants: list[dict[str, Any]]) -> None:
        self.grants[case_id] = grants
        store.save_rows(case_id, "authority_grants", grants, "grant_id")

    def activate(self, case_id: str, supervisor_id: str = "supervisor-001") -> dict[str, Any]:
        case = self.get_case(case_id)
        assert_transition(case["status"], "active")
        case["status"] = "active"
        case["activated_at"] = _now().isoformat()
        case["supervisor_id"] = supervisor_id
        for grant in self.grants[case_id]:
            grant["status"] = "granted"
            grant["granted_by"] = supervisor_id
            grant["revoked"] = False
        assert_transition("active", "monitoring")
        case["status"] = "monitoring"
        self.put_grants(case_id, self.grants[case_id])
        store.save_case(case_id, case)
        return case

    def grant_for(self, case_id: str, identity: str, purpose: str) -> dict[str, Any] | None:
        self.load(case_id)
        for grant in self.grants.get(case_id, []):
            target = grant.get("granted_to") or grant.get("identity") or grant.get("agent")
            grant_purpose = grant.get("purpose") or grant.get("authorized_purpose")
            if (
                target == identity
                and grant_purpose == purpose
                and grant.get("status") in {"granted", "proposed", None}
                and not grant.get("revoked")
            ):
                return grant
        return None

    def set_commitment(self, case_id: str, commitment_id: str, status: str) -> None:
        if status not in COMMITMENT_STATES:
            raise ValueError(f"status must be one of {sorted(COMMITMENT_STATES)}, got {status!r}")
        self.load(case_id)
        # Specialists identify their commitment by service type; ids vary per case.
        prefix_types = {"edu": "education", "hlth": "health", "leg": "legal", "shl": "shelter", "fam": "family_services"}
        want = next((t for p, t in prefix_types.items() if f"-{p}-" in commitment_id), None)
        for row in self.commitments.get(case_id, []):
            if (
                row.get("commitment_id") == commitment_id
                or row.get("type") == commitment_id
                or (want and row.get("type") == want)
            ):
                row["status"] = status
                row["last_update"] = _now().isoformat()
                store.append_row(case_id, "commitments", row, str(row["commitment_id"]))
                return

    def commitment_states(self, case_id: str) -> dict[str, str]:
        self.load(case_id)
        return {row["type"]: row["status"] for row in self.commitments.get(case_id, [])}

    def add_approval(self, case_id: str, approval: dict[str, Any]) -> dict[str, Any]:
        self.load(case_id)
        self.approvals.setdefault(case_id, []).append(approval)
        store.append_row(case_id, "human_approvals", approval, str(approval["approval_id"]))
        return approval

    def decide_approval(self, case_id: str, decision: str, decided_by: str) -> dict[str, Any]:
        self.load(case_id)
        pending = [a for a in self.approvals.get(case_id, []) if a.get("decision") == "pending"]
        if not pending:
            return {"decision": "none"}
        approval = pending[-1]
        approval["decision"] = decision
        approval["decided_by"] = decided_by
        store.append_row(case_id, "human_approvals", approval, str(approval["approval_id"]))
        return approval

    def list_approvals(self, case_id: str) -> list[dict[str, Any]]:
        self.load(case_id)
        return self.approvals.get(case_id, [])

    def put_checkpoint(self, workflow_id: str, body: dict[str, Any]) -> None:
        self.checkpoints[workflow_id] = body
        store.save_checkpoint(workflow_id, body)

    def get_checkpoint(self, workflow_id: str) -> dict[str, Any] | None:
        return self.checkpoints.get(workflow_id) or store.load_checkpoint(workflow_id)

    def set_memory(self, case_id: str, purpose: str, cleaned: dict[str, Any]) -> None:
        self.memory.setdefault(case_id, {})[purpose] = cleaned
        store.save_case(case_id, self.cases.get(case_id, {"case_id": case_id}), self.memory[case_id])

    def append_audit(self, case_id: str, event: dict[str, Any]) -> str:
        event_id = event.get("event_id") or f"evt-{uuid4().hex[:8]}"
        event["event_id"] = event_id
        event.setdefault("trace_id", TRACE_ID)
        event.setdefault("timestamp", _now().isoformat())
        self.audit.setdefault(case_id, []).append(event)
        store.append_row(case_id, "audit_events", event, event_id)
        return f"cases/{case_id}/audit_events/{event_id}"

    def list_audit(self, case_id: str) -> list[dict[str, Any]]:
        self.load(case_id)
        return self.audit.get(case_id, [])

    def claim_update(self, case_id: str, key: str, payload: dict[str, Any]) -> tuple[dict[str, Any], bool]:
        bucket = self.updates.setdefault(case_id, {})
        if key in bucket:
            return bucket[key], True
        bucket[key] = payload
        return payload, False


workspace = Workspace()
