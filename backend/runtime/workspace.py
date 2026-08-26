import threading
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from backend.audit.writer import AuditMutationRejected, append_event as _write_audit_event
from backend.state import store
from backend.state.case_machine import COMMITMENT_STATES, assert_transition


def _now() -> datetime:
    return datetime.now(timezone.utc)


class CaseNotFound(KeyError):
    """Raised when an agent is asked about a case that was never ingested."""


class Workspace:
    """Case state for the fleet.

    The dicts are this process's view. When Firestore is enabled they act as a read-through /
    write-through cache: `load` pulls the aggregate before a read and every mutator persists
    immediately, so an agent on another host sees the same grants and commitments.

    Thread safety: concurrent access to a single case's containers (commitments, grants, etc.)
    is guarded by a per-case RLock. This is necessary because `load()` replaces the container
    lists wholesale — without the lock, a concurrent thread could be iterating or mutating a
    list that another thread's `load()` discards. The lock serialises load-then-mutate sequences
    while still allowing different cases to be processed in parallel. RLock is used because
    methods like `set_commitment` call `load()` internally (reentrant).
    """

    def __init__(self) -> None:
        self.cases: dict[str, dict[str, Any]] = {}
        self.commitments: dict[str, list[dict[str, Any]]] = {}
        self.grants: dict[str, list[dict[str, Any]]] = {}
        self.updates: dict[str, dict[str, dict[str, Any]]] = {}
        self.approvals: dict[str, list[dict[str, Any]]] = {}
        self._audit_log: dict[str, list[dict[str, Any]]] = {}
        self.checkpoints: dict[str, dict[str, Any]] = {}
        self._case_workflows: dict[str, list[str]] = {}
        self.memory: dict[str, dict[str, dict[str, Any]]] = {}
        self.runs: dict[str, dict[str, Any]] = {}
        self._case_locks: dict[str, threading.RLock] = {}
        self._locks_lock = threading.Lock()

    def _lock_for(self, case_id: str) -> threading.RLock:
        """Return (creating if needed) the per-case RLock for the given case."""
        lock = self._case_locks.get(case_id)
        if lock is not None:
            return lock
        with self._locks_lock:
            return self._case_locks.setdefault(case_id, threading.RLock())

    def reset(self, case_id: str) -> None:
        with self._lock_for(case_id):
            store.delete_case(case_id)
            store.delete_runs_for_case(case_id)
            self.cases.pop(case_id, None)
            self.commitments.pop(case_id, None)
            self.grants.pop(case_id, None)
            self.updates.pop(case_id, None)
            self.approvals.pop(case_id, None)
            self._audit_log.pop(case_id, None)
            self.memory.pop(case_id, None)
            run_ids_to_remove = [rid for rid, r in self.runs.items() if r.get("case_id") == case_id]
            for rid in run_ids_to_remove:
                self.runs.pop(rid, None)
            wf_ids = self._case_workflows.pop(case_id, [])
            for wf_id in wf_ids:
                self.checkpoints.pop(wf_id, None)

    def load(self, case_id: str) -> None:
        """Refresh this process's view from shared state. No-op when running in-memory.

        Deployed instances are long-lived and serve many requests, so a cached view goes stale
        as soon as another agent writes. Reads therefore always re-sync rather than only
        populating when empty.

        Must be called under the per-case lock (which all public accessors acquire) because it
        replaces container lists wholesale. Without the lock, a concurrent thread iterating or
        mutating a container could be operating on a reference that `load()` just discarded.
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
        self._audit_log[case_id] = remote["audit"]
        self.memory[case_id] = remote["memory"]
        self.updates.setdefault(case_id, {})

    def get_case(self, case_id: str) -> dict[str, Any]:
        """The case as it exists in the store. Agents read cases; they never invent one."""
        with self._lock_for(case_id):
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
            "child_name": packet.get("child", {}).get("name", packet.get("child_name", "")),
            "dob": packet.get("child", {}).get("dob", packet.get("dob", "")),
            "status": "draft",
            "volunteer_id": packet.get("volunteer_id", ""),
            "supervisor_id": packet.get("supervisor_id", ""),
            "created_at": _now().isoformat(),
            "activated_at": None,
            "referral_packet": packet,
            "test_case": packet.get("test_case", False),
        }
        self.commitments.setdefault(case_id, [])
        self.grants.setdefault(case_id, [])
        self.updates.setdefault(case_id, {})
        self.approvals.setdefault(case_id, [])
        self._audit_log.setdefault(case_id, [])
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
        """Supervisor HITL: grant proposed authorities and advance to monitoring.

        Idempotent: if the case is already active or monitoring, returns the current state
        without re-transitioning. This prevents the orchestrator LLM from failing when it
        redundantly calls activate_case on a case that has already been activated.

        Thread safety: the entire operation is serialised under the per-case RLock. Without
        the lock, a concurrent HTTP handler (portal polling, SSE stream, etc.) can call
        load() and replace self.grants[case_id] wholesale with fresh "proposed" objects from
        Firestore between the mutation loop and put_grants(). When that happens, put_grants
        saves the replaced proposed list rather than the mutated granted one, leaving grants
        permanently stuck at "proposed" while the case advances to "monitoring".
        """
        with self._lock_for(case_id):
            self.load(case_id)
            case = self.cases.get(case_id)
            if not case:
                raise CaseNotFound(f"case {case_id} has not been ingested")
            if case["status"] in ("active", "monitoring"):
                return case
            assert_transition(case["status"], "active")
            case["status"] = "active"
            case["activated_at"] = _now().isoformat()
            case["supervisor_id"] = supervisor_id
            for grant in self.grants.get(case_id, []):
                grant["status"] = "granted"
                grant["granted_by"] = supervisor_id
                grant["revoked"] = False
            assert_transition("active", "monitoring")
            case["status"] = "monitoring"
            self.put_grants(case_id, self.grants.get(case_id, []))
            store.save_case(case_id, case)
            return case

    def grant_for(self, case_id: str, identity: str, purpose: str) -> dict[str, Any] | None:
        with self._lock_for(case_id):
            self.load(case_id)
            for grant in self.grants.get(case_id, []):
                target = grant.get("granted_to") or grant.get("identity") or grant.get("agent")
                grant_purpose = grant.get("purpose") or grant.get("authorized_purpose")
                if (
                    target == identity
                    and grant_purpose == purpose
                    and grant.get("status") == "granted"
                    and not grant.get("revoked")
                ):
                    return grant
            return None

    def set_commitment(self, case_id: str, commitment_id: str, status: str) -> None:
        if status not in COMMITMENT_STATES:
            raise ValueError(f"status must be one of {sorted(COMMITMENT_STATES)}, got {status!r}")
        with self._lock_for(case_id):
            self.load(case_id)
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
            raise ValueError(
                f"no commitment matching {commitment_id!r} in case {case_id}"
            )

    def commitment_states(self, case_id: str) -> dict[str, str]:
        with self._lock_for(case_id):
            self.load(case_id)
            return {row["type"]: row["status"] for row in self.commitments.get(case_id, [])}

    def add_approval(self, case_id: str, approval: dict[str, Any]) -> dict[str, Any]:
        with self._lock_for(case_id):
            self.load(case_id)
            self.approvals.setdefault(case_id, []).append(approval)
            store.append_row(case_id, "human_approvals", approval, str(approval["approval_id"]))
            return approval

    def decide_approval(self, case_id: str, decision: str, decided_by: str) -> dict[str, Any]:
        with self._lock_for(case_id):
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
        with self._lock_for(case_id):
            self.load(case_id)
            return self.approvals.get(case_id, [])

    def put_checkpoint(self, workflow_id: str, body: dict[str, Any]) -> None:
        self.checkpoints[workflow_id] = body
        case_id = body.get("case_id", "")
        if case_id:
            wf_ids = self._case_workflows.setdefault(case_id, [])
            if workflow_id not in wf_ids:
                wf_ids.append(workflow_id)
        store.save_checkpoint(workflow_id, body)

    def get_checkpoint(self, workflow_id: str) -> dict[str, Any] | None:
        return self.checkpoints.get(workflow_id) or store.load_checkpoint(workflow_id)

    def list_checkpoints(self) -> list[dict[str, Any]]:
        """All checkpoints held in memory — used by find_due in memory mode."""
        return list(self.checkpoints.values())

    def update_checkpoint_state(self, workflow_id: str, state: str) -> None:
        cp = self.checkpoints.get(workflow_id)
        if cp is not None:
            cp["state"] = state
            store.save_checkpoint(workflow_id, cp)

    def list_case_checkpoints(self, case_id: str) -> list[dict[str, Any]]:
        """All checkpoints for a case, merging in-memory and Firestore."""
        known: dict[str, dict[str, Any]] = {}
        for wf_id in self._case_workflows.get(case_id, []):
            cp = self.checkpoints.get(wf_id)
            if cp:
                known[wf_id] = cp
        for cp in store.query_checkpoints_for_case(case_id):
            wf_id = cp.get("workflow_id", "")
            if wf_id and wf_id not in known:
                known[wf_id] = cp
                self.checkpoints[wf_id] = cp
                wf_ids = self._case_workflows.setdefault(case_id, [])
                if wf_id not in wf_ids:
                    wf_ids.append(wf_id)
        return list(known.values())

    def set_memory(self, case_id: str, purpose: str, cleaned: dict[str, Any]) -> None:
        with self._lock_for(case_id):
            self.memory.setdefault(case_id, {})[purpose] = cleaned
            store.save_case(case_id, self.cases.get(case_id, {"case_id": case_id}), self.memory[case_id])

    def append_audit(self, case_id: str, event: dict[str, Any]) -> str:
        """Append an audit event.

        Raises AuditMutationRejected if the event_id was already recorded. In Firestore mode
        the immutable writer enforces this at the database level; in memory mode the local list
        is the source of truth.
        """
        from backend.runtime.context import current as _ctx

        event_id = event.get("event_id") or f"evt-{uuid4().hex[:8]}"
        event["event_id"] = event_id
        event.setdefault("trace_id", _ctx().trace_id)
        event.setdefault("timestamp", _now().isoformat())

        with self._lock_for(case_id):
            existing_ids = {e.get("event_id") for e in self._audit_log.get(case_id, [])}
            if event_id in existing_ids:
                raise AuditMutationRejected(f"audit event {event_id} already exists")

            self._audit_log.setdefault(case_id, []).append(event)
            if store.enabled():
                _write_audit_event(case_id, event)
            else:
                store.append_row(case_id, "audit_events", event, event_id)

        return f"cases/{case_id}/audit_events/{event_id}"

    def list_audit(self, case_id: str) -> list[dict[str, Any]]:
        with self._lock_for(case_id):
            self.load(case_id)
            return self._audit_log.get(case_id, [])

    def audit_events(self, case_id: str) -> list[dict[str, Any]]:
        return self.list_audit(case_id)

    def claim_update(self, case_id: str, key: str, payload: dict[str, Any]) -> tuple[dict[str, Any], bool]:
        """Idempotent update claim. Uses Firestore transactions when available, in-process dict otherwise."""
        if store.enabled():
            from backend.infra.idempotency import claim
            return claim(case_id, key, lambda: payload)
        with self._lock_for(case_id):
            bucket = self.updates.setdefault(case_id, {})
            if key in bucket:
                return bucket[key], True
            bucket[key] = payload
            return payload, False

    # -- run state -----------------------------------------------------------------

    def create_run(self, run_id: str, case_id: str) -> dict[str, Any]:
        run = {
            "run_id": run_id,
            "case_id": case_id,
            "state": "queued",
            "current_phase": None,
            "commitment_states": {},
            "trace_id": "",
            "created_at": _now().isoformat(),
            "events": [],
        }
        self.runs[run_id] = run
        store.save_run(run_id, run)
        return run

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        run = self.runs.get(run_id)
        if run is not None:
            return run
        remote = store.load_run(run_id)
        if remote is not None:
            self.runs[run_id] = remote
        return remote

    def update_run(self, run_id: str, **kwargs) -> dict[str, Any] | None:
        run = self.runs.get(run_id)
        if run:
            run.update(kwargs)
            store.save_run(run_id, run)
        return run

    def push_run_event(self, run_id: str, event: dict[str, Any]) -> None:
        run = self.runs.get(run_id)
        if run is not None:
            run.setdefault("events", []).append(event)

    def list_runs_for_case(self, case_id: str) -> list[dict[str, Any]]:
        """All runs for a case. Merges in-memory (live) with Firestore (durable)."""
        known: dict[str, dict[str, Any]] = {}
        for r in self.runs.values():
            if r.get("case_id") == case_id:
                known[r["run_id"]] = r
        for r in store.list_runs_for_case(case_id):
            rid = r.get("run_id", "")
            if rid and rid not in known:
                known[rid] = r
        return sorted(known.values(), key=lambda r: r.get("created_at", ""), reverse=True)


workspace = Workspace()
