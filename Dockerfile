FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir uv

COPY pyproject.toml ./
RUN uv pip install --system --no-cache \
    "google-adk[a2a]>=2.7.1" \
    "google-cloud-aiplatform[agent_engines,adk]" \
    "google-cloud-firestore" \
    "google-cloud-pubsub" \
    "fastapi>=0.115" \
    "uvicorn[standard]" \
    "pydantic>=2.0" \
    "opentelemetry-exporter-gcp-trace" \
    "sse-starlette" \
    "mcp>=2.0"

# Agent Gateway performs TLS inspection on egress, presenting a certificate signed by a
# private CA. The platform supplies that CA as a build arg when an engine is deployed with
# --agent-gateway-egress; it must be declared here or Docker discards it silently.
ARG AGENT_GATEWAY_ROOT_CERTIFICATES
RUN if [ -n "$AGENT_GATEWAY_ROOT_CERTIFICATES" ]; then \
      apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*; \
      mkdir -p /usr/local/share/ca-certificates; \
      printf "%b" "$AGENT_GATEWAY_ROOT_CERTIFICATES" \
        | awk 'BEGIN {c=0} /BEGIN CERTIFICATE/ {c++} c > 0 { print > "/usr/local/share/ca-certificates/agw-" c ".crt" }'; \
      update-ca-certificates; \
    fi
ENV SSL_CERT_FILE=${AGENT_GATEWAY_ROOT_CERTIFICATES:+/etc/ssl/certs/ca-certificates.crt}
ENV REQUESTS_CA_BUNDLE=${AGENT_GATEWAY_ROOT_CERTIFICATES:+/etc/ssl/certs/ca-certificates.crt}
ENV GRPC_DEFAULT_SSL_ROOTS_FILE_PATH=${AGENT_GATEWAY_ROOT_CERTIFICATES:+/etc/ssl/certs/ca-certificates.crt}

COPY app/ ./app/
COPY backend/ ./backend/
COPY contracts/ ./contracts/
COPY fixtures/ ./fixtures/

ENV PYTHONPATH=/app PYTHONUNBUFFERED=1 PORT=8080
EXPOSE 8080

CMD ["sh", "-c", "uvicorn app.agent_server:app --host 0.0.0.0 --port ${PORT}"]
