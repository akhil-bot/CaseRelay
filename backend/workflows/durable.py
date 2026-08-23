import json
import os
from datetime import datetime, timedelta, timezone

from backend.memory import bank as memory
from backend.runtime.workspace import workspace


def write_checkpoint(case_id: str, workflow_id: str = "wf-school-enrollment") -> dict:
    next_wake = datetime.now(timezone.utc) + timedelta(days=17)
    body = {
        "workflow_id": workflow_id,
        "case_id": case_id,
        "current_step": "sleeping",
        "commitment_states": workspace.commitment_states(case_id),
        "next_wake": next_wake.isoformat(),
        "retry_count": 0,
        "completed": False,
    }
    workspace.put_checkpoint(workflow_id, body)
    memory.write(case_id, "checkpoint", {"workflow_id": workflow_id, "current_step": "sleeping"})
    _publish_wake(case_id, workflow_id)
    return body


def _publish_wake(case_id: str, workflow_id: str) -> None:
    project = os.environ.get("GOOGLE_CLOUD_PROJECT", "caserelay")
    topic = os.environ.get("PUBSUB_TOPIC_EVENTS", "caserelay-events")
    try:
        from google.cloud import pubsub_v1

        pubsub_v1.PublisherClient().publish(
            f"projects/{project}/topics/{topic}",
            json.dumps(
                {"event_type": "workflow_wake", "case_id": case_id, "workflow_id": workflow_id}
            ).encode(),
        ).result(timeout=10)
    except Exception:
        return


def resume_wake(case_id: str, workflow_id: str = "wf-school-enrollment") -> dict:
    checkpoint = workspace.get_checkpoint(workflow_id) or write_checkpoint(case_id, workflow_id)
    checkpoint["current_step"] = "awake"
    workspace.put_checkpoint(workflow_id, checkpoint)
    memory.write(case_id, "checkpoint", {"workflow_id": workflow_id, "current_step": "awake"})
    return checkpoint
