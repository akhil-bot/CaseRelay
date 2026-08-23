FROM python:3.12-slim

WORKDIR /app

RUN pip install uv

COPY pyproject.toml .
RUN uv pip install --system "google-adk>=1.0.0" "fastapi>=0.115.0" "uvicorn[standard]>=0.32.0" \
    "google-cloud-firestore>=2.19.0" "google-cloud-pubsub>=2.26.0" "google-cloud-tasks>=2.16.0" \
    "pydantic>=2.9.0" "python-dotenv>=1.0.0"

COPY api/ ./api/

EXPOSE 8080
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8080"]
