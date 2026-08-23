from fastapi import FastAPI

from backend.memory.bank import preload
from backend.runtime.fleet import run_maya
from backend.runtime.workspace import workspace

app = FastAPI(title="CaseRelay API", version="0.1.0")


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/wake")
def wake(case_id: str = "CR-1042", workflow_id: str = "wf-school-enrollment") -> dict:
    from backend.workflows.durable import resume_wake

    return resume_wake(case_id, workflow_id)


@app.post("/demo/maya")
def demo_maya(case_id: str = "CR-1042") -> dict:
    return run_maya(case_id)


@app.get("/demo/trace")
def demo_trace() -> dict:
    """Hop-by-hop record of the last run: every agent input, tool call, and policy decision."""
    from backend.runtime.trace import tracer

    return {"trace_id": "trace-7821", "hops": tracer.as_table()}


@app.get("/demo/maya/{case_id}")
def demo_snapshot(case_id: str) -> dict:
    return {
        "memory": preload(case_id),
        "commitments": workspace.commitment_states(case_id),
        "audit_count": len(workspace.list_audit(case_id)),
        "approvals": workspace.list_approvals(case_id),
    }
