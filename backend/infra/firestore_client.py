import os

_client = None


def get_db():
    """Firestore client targeting a named database to avoid Agent Runtime encoding bugs.

    Agent Runtime's network proxy URL-encodes parentheses in outgoing requests (both
    gRPC-transcoded and direct HTTP), turning the default database name ``(default)``
    into ``%28default%29`` which Firestore rejects with 400.  A named database
    (``caserelay``) sidesteps this entirely since it contains no special characters.

    Agent Runtime sets GOOGLE_CLOUD_PROJECT to the project *number*; Firestore rejects a
    number when resolving the database, so CASERELAY_PROJECT_ID takes precedence.
    """
    global _client
    if _client is None:
        from google.cloud import firestore

        project = os.environ.get("CASERELAY_PROJECT_ID") or "caserelay"
        _client = firestore.Client(project=project, database="caserelay")
    return _client
