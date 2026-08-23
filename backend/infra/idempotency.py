from typing import Any, Callable

from backend.infra.firestore_client import get_db


def claim(
    case_id: str,
    idempotency_key: str,
    write: Callable[[], dict[str, Any]],
) -> tuple[dict[str, Any], bool]:
    """Return (result, is_duplicate). Second claim of the same key is a no-op."""
    db = get_db()
    ref = (
        db.collection("cases")
        .document(case_id)
        .collection("partner_updates")
        .document(idempotency_key)
    )

    @firestore_transaction(db)
    def _tx(transaction):
        snap = ref.get(transaction=transaction)
        if snap.exists:
            return snap.to_dict() or {}, True
        payload = write()
        payload.setdefault("idempotency_key", idempotency_key)
        payload.setdefault("processed", True)
        transaction.set(ref, payload)
        return payload, False

    return _tx()


def firestore_transaction(db):
    from google.cloud import firestore

    def decorator(fn):
        @firestore.transactional
        def wrapped(transaction):
            return fn(transaction)

        return lambda: wrapped(db.transaction())

    return decorator
