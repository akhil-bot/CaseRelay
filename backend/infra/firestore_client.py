import os

_client = None


def get_db():
    """Firestore client pinned to the project ID.

    Agent Runtime sets GOOGLE_CLOUD_PROJECT to the project *number*, and Firestore rejects a
    number when resolving the (default) database, so CASERELAY_PROJECT_ID takes precedence.
    """
    global _client
    if _client is None:
        from google.cloud import firestore

        project = os.environ.get("CASERELAY_PROJECT_ID") or "caserelay"
        _client = firestore.Client(project=project)
    return _client
