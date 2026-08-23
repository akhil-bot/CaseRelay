FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir uv

COPY pyproject.toml ./
RUN uv pip install --system --no-cache \
    "google-adk[a2a]>=2.7.1" \
    "google-cloud-aiplatform[agent_engines,adk]" \
    "google-cloud-firestore" \
    "google-cloud-pubsub" \
    "google-cloud-tasks" \
    "fastapi>=0.115" \
    "uvicorn[standard]" \
    "pydantic>=2.0" \
    "opentelemetry-exporter-gcp-trace" \
    "sse-starlette"

COPY app/ ./app/
COPY backend/ ./backend/
COPY contracts/ ./contracts/
COPY fixtures/ ./fixtures/

ENV PYTHONPATH=/app PYTHONUNBUFFERED=1 PORT=8080
EXPOSE 8080

CMD ["sh", "-c", "uvicorn app.agent_server:app --host 0.0.0.0 --port ${PORT}"]
