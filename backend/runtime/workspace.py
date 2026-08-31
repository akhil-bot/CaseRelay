import threading
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from backend.audit.writer import AuditMutationRejected, append_event as _write_audit_event
from backend.runtime import event_log
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
        """Remove every trace of a case, including the state that outlives the case document.

        Checkpoints and the case lock live in top-level collections, so deleting the case
        aggregate alone leaves them behind. An abandoned checkpoint is still due, so the
        sweep keeps firing wakes for a case that can no longer be loaded; an abandoned lock
        makes every future wake for that id conflict. Both must go with the case.
        """
        with self._lock_for(case_id):
            store.delete_case(case_id)
            store.delete_runs_for_case(case_id)
            store.delete_case_lock(case_id)
            self.drop_case_checkpoints(case_id)
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
            # Denormalised off the packet so listing a caseload by advocate does
            # not mean opening every case to find out whose it is.
            "volunteer_name": packet.get("volunteer_name", ""),
            "supervisor_id": packet.get("supervisor_id", ""),
            # Likewise denormalised: it is what separates a draft with work
            # waiting on a supervisor from one that has had nothing extracted
            # yet, and a queue of gates should not have to open every draft in
            # the system to tell those two apart. Written here so a case carries
            # the answer from birth rather than only once something is stored.
            "commitment_count": 0,
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

    def update_referral(self, case_id: str, service: str, **fields: Any) -> dict[str, Any]:
        """Merge fields into one referral row of the case's packet and persist the case.

        This is how a fact the platform learns from a partner becomes a fact about the
        case. A referral that started with nobody named on the other side gets a contact
        here once someone takes it on, and every later reader — narration included — sees
        the person rather than the organisation.
        """
        with self._lock_for(case_id):
            self.load(case_id)
            case = self.cases.get(case_id)
            if not case:
                raise CaseNotFound(f"case {case_id} has not been ingested")
            packet = case.get("referral_packet") or {}
            for row in packet.get("referrals", []):
                if row.get("type") == service:
                    row.update(fields)
                    store.save_case(case_id, case)
                    return row
            raise ValueError(f"no {service!r} referral in case {case_id}")

    def put_commitments(self, case_id: str, rows: list[dict[str, Any]]) -> None:
        self.commitments[case_id] = rows
        store.save_rows(case_id, "commitments", rows, "commitment_id")
        self.sync_commitment_count(case_id)

    def sync_commitment_count(self, case_id: str) -> None:
        """Keep the case's denormalised commitment count level with its commitments.

        Commitments are a subcollection, so counting them means reading the case
        aggregate. Carrying the number on the case itself is what lets a caseload
        listing answer "is this draft waiting on anyone?" without doing that once
        per case.

        Written only when it has drifted, so this costs nothing on the ordinary
        path and quietly corrects cases stored before the field existed.
        """
        case = self.cases.get(case_id)
        if case is None:
            return
        counted = len(self.commitments.get(case_id, []))
        if case.get("commitment_count") != counted:
            case["commitment_count"] = counted
            store.save_case(case_id, case)

    def put_grants(self, case_id: str, grants: list[dict[str, Any]]) -> None:
        self.grants[case_id] = grants
        store.save_rows(case_id, "authority_grants", grants, "grant_id")

    def activate(self, case_id: str, supervisor_id: str) -> dict[str, Any]:
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
                self._grant_proposed(case_id, case.get("supervisor_id") or supervisor_id)
                return case
            assert_transition(case["status"], "active")
            case["status"] = "active"
            case["activated_at"] = _now().isoformat()
            case["supervisor_id"] = supervisor_id
            self._grant_proposed(case_id, supervisor_id)
            assert_transition("active", "monitoring")
            case["status"] = "monitoring"
            store.save_case(case_id, case)
            return case

    def _grant_proposed(self, case_id: str, supervisor_id: str) -> list[str]:
        """Flip every still-proposed grant on this case to granted. Caller holds the lock.

        Also runs on the idempotent path of :meth:`activate`, so a second activation
        repairs a case whose intake finished after the first one was recorded.
        """
        flipped = []
        for grant in self.grants.get(case_id, []):
            if grant.get("status") == "granted" and not grant.get("revoked"):
                continue
            grant["status"] = "granted"
            grant["granted_by"] = supervisor_id
            grant["revoked"] = False
            flipped.append(str(grant.get("purpose") or grant.get("grant_id") or ""))
        if flipped:
            self.put_grants(case_id, self.grants.get(case_id, []))
        return flipped

    def upsert_grant(self, case_id: str, grant: dict[str, Any], *, canonical: bool) -> dict[str, Any]:
        """Add or replace one grant, keyed by purpose, atomically against other writers.

        A canonical grant proposed after the case was activated inherits that decision.
        Intake writes its five grants one at a time and a supervisor can decide before the
        last one lands; a grant arriving after that moment would otherwise stay `proposed`
        for ever, because activate() is idempotent and never revisits it. The gateway then
        denies that specialist at fan-out and its commitment can never be fulfilled.

        Only the five canonical grants inherit the decision. An agent still cannot invent
        an authority the supervisor never saw.
        """
        with self._lock_for(case_id):
            self.load(case_id)
            case = self.cases.get(case_id)
            if not case:
                raise CaseNotFound(f"case {case_id} has not been ingested")
            if canonical and case.get("activated_at"):
                grant = {
                    **grant,
                    "status": "granted",
                    "granted_by": case.get("supervisor_id", ""),
                    "revoked": False,
                }
            rows = [
                g for g in self.grants.get(case_id, [])
                if g.get("purpose") != grant.get("purpose")
            ]
            rows.append(grant)
            self.put_grants(case_id, rows)
            return grant

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

    def set_commitment(self, case_id: str, commitment_id: str, status: str) -> dict | None:
        """Write a commitment status.

        Returns None on success.  Returns a refusal dict and writes the
        commitment as ``blocked`` when the deterministic commitment guard
        detects an explicit contradiction between the partner tool response
        and a ``completed`` claim.
        """
        if status not in COMMITMENT_STATES:
            raise ValueError(f"status must be one of {sorted(COMMITMENT_STATES)}, got {status!r}")

        from backend.guards.commitment_guard import (
            build_approval,
            build_audit_event,
            check as _guard_check,
            resolve_service_type,
        )

        service = resolve_service_type(commitment_id)
        refusal = _guard_check(case_id, service or commitment_id, status) if service else None

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
                    if refusal:
                        row["status"] = "blocked"
                        row["guard_refusal"] = refusal
                    else:
                        row["status"] = status
                        row.pop("guard_refusal", None)
                    row["last_update"] = _now().isoformat()
                    store.append_row(case_id, "commitments", row, str(row["commitment_id"]))

                    if refusal and service:
                        packet = self.cases.get(case_id, {}).get("referral_packet", {})
                        org = ""
                        for ref in packet.get("referrals", []):
                            if ref.get("type") == service:
                                org = ref.get("target_org", "")
                                break
                        self.add_approval(case_id, build_approval(case_id, service, refusal, org))
                        try:
                            self.append_audit(case_id, build_audit_event(service, refusal))
                        except Exception:
                            pass
                    return refusal
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
            aid = approval.get("approval_id")
            if aid:
                for existing in self.approvals.get(case_id, []):
                    if existing.get("approval_id") == aid:
                        return existing
            self.approvals.setdefault(case_id, []).append(approval)
            store.append_row(case_id, "human_approvals", approval, str(approval["approval_id"]))
            return approval

    def decide_approval(
        self, case_id: str, decision: str, decided_by: str, approval_id: str
    ) -> dict[str, Any]:
        """Record a human decision against one named approval.

        Matched by id, never by position. A case can hold several pending approvals at
        once — safeguarding escalations alongside an unrelated supervisor notice — so
        deciding the most recently appended record would attribute the operator's ruling
        to whichever one happened to land last. An approval that has already been decided
        is returned untouched, so a repeated POST cannot rewrite the first ruling.
        """
        with self._lock_for(case_id):
            self.load(case_id)
            for approval in self.approvals.get(case_id, []):
                if str(approval.get("approval_id")) != str(approval_id):
                    continue
                if approval.get("decision") != "pending":
                    return approval
                approval["decision"] = decision
                approval["decided_by"] = decided_by
                store.append_row(case_id, "human_approvals", approval, str(approval["approval_id"]))
                return approval
            return {"decision": "none"}

    def list_approvals(self, case_id: str) -> list[dict[str, Any]]:
        with self._lock_for(case_id):
            self.load(case_id)
            return self.approvals.get(case_id, [])

    def pending_approvals(self, case_id: str) -> list[dict[str, Any]]:
        """What is waiting on a person for this case, without opening the case.

        `list_approvals` re-syncs the whole aggregate, which is right for a
        caller that is about to work on the case. A sweep across every case
        asking only "is anything waiting here?" is not: paying an aggregate load
        per case is what made the approvals queue the slowest read on the
        control plane by an order of magnitude.
        """
        if store.enabled():
            return store.list_pending_approvals(case_id)
        with self._lock_for(case_id):
            return [a for a in self.approvals.get(case_id, []) if a.get("decision") == "pending"]

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

    def drop_case_checkpoints(self, case_id: str) -> list[str]:
        """Delete every checkpoint belonging to a case and return the ids that were removed.

        The store is queried by case_id rather than trusting this process's workflow index,
        because an instance that never served the case has an empty index and would otherwise
        leave the documents in place.
        """
        wf_ids = {
            cp["workflow_id"]
            for cp in self.list_case_checkpoints(case_id)
            if cp.get("workflow_id")
        }
        wf_ids.update(
            wf_id for wf_id, cp in self.checkpoints.items() if cp.get("case_id") == case_id
        )
        for wf_id in wf_ids:
            self.checkpoints.pop(wf_id, None)
        self._case_workflows.pop(case_id, None)
        store.delete_checkpoints_for_case(case_id)
        return sorted(wf_ids)

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
        """Add an event to the run's live view, then queue it for durable storage.

        The in-memory list is updated first because the SSE stream reads it: a phase must
        never wait on a write to narrate itself. The event's position in that list is its
        sequence number, so what is stored keeps the order the stream showed.
        """
        run = self.runs.get(run_id)
        if run is None:
            return
        events = run.setdefault("events", [])
        events.append(event)
        event_log.append(run_id, len(events) - 1, event)

    def run_events(self, run_id: str) -> list[dict[str, Any]]:
        """A run's events, preferring the live view held by the process that produced them.

        An instance that did not run the case has no local view — after a restart, that is
        every run — so the durable log is read instead.
        """
        run = self.runs.get(run_id)
        if run is not None and run.get("events"):
            return list(run["events"])
        return store.load_run_events(run_id)

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
