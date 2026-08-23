from datetime import datetime, timezone

from backend.infra.firestore_client import get_db
from backend.state.fixtures import agent_cards, referral_packet


def seed_cr1042_skeleton() -> dict:
    db = get_db()
    packet = referral_packet()
    case_id = packet["case_id"]
    now = datetime.now(timezone.utc)
    db.collection("cases").document(case_id).set(
        {
            "case_id": case_id,
            "child_name": packet["child"]["name"],
            "status": "draft",
            "volunteer_id": packet["volunteer_id"],
            "supervisor_id": packet["supervisor_id"],
            "created_at": now,
            "activated_at": None,
            "closed_at": None,
            "retention_policy": packet["retention_policy"],
            "source_document_ref": packet["source_document_ref"],
        }
    )
    for card in agent_cards():
        card = {**card, "created_at": now, "updated_at": now, "endpoint": ""}
        db.collection("agent_cards").document(card["agent_id"]).set(card)
    return {"case_id": case_id, "status": "draft", "agent_cards": len(agent_cards())}


if __name__ == "__main__":
    print(seed_cr1042_skeleton())
