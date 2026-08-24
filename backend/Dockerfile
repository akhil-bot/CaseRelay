FROM python:3.12-slim

WORKDIR /app

RUN pip install uv

# Copy dependency manifests first so the install layer is cached independently of source changes.
COPY pyproject.toml uv.lock ./

# Stub the package directories so uv can resolve and install all project dependencies.
RUN mkdir -p backend app contracts && \
    touch backend/__init__.py app/__init__.py contracts/__init__.py

RUN uv pip install --system .

# Now overlay the real source.
COPY backend/ ./backend/
COPY contracts/ ./contracts/
COPY app/ ./app/

EXPOSE 8080
CMD ["uvicorn", "backend.api.main:app", "--host", "0.0.0.0", "--port", "8080"]
