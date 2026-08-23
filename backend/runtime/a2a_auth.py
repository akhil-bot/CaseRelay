"""Authenticated HTTP client for agent-to-agent calls.

Deployed specialists are reached through the Agent Runtime /api passthrough, which sits behind
Google's API frontend and rejects unauthenticated requests. RemoteA2aAgent's default client sends
no credentials, so it needs one that mints and refreshes an access token from the caller's own
service account.
"""

import httpx

SCOPE = "https://www.googleapis.com/auth/cloud-platform"


class GoogleAuth(httpx.Auth):
    """Attaches a bearer token from Application Default Credentials, refreshing when stale."""

    def __init__(self) -> None:
        import google.auth

        self._credentials, _ = google.auth.default(scopes=[SCOPE])

    def auth_flow(self, request: httpx.Request):
        import google.auth.transport.requests

        if not self._credentials.valid:
            self._credentials.refresh(google.auth.transport.requests.Request())
        request.headers["Authorization"] = f"Bearer {self._credentials.token}"
        yield request


def authenticated_client(timeout: float = 600.0) -> httpx.AsyncClient:
    return httpx.AsyncClient(auth=GoogleAuth(), timeout=timeout)
