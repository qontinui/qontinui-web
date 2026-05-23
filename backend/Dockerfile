# Stage 1: clone qontinui-schemas only (path dep). qontinui is no longer
# a dependency - per architectural-decisions.md "Web - runner WebSocket
# boundary", heavy deps (torch, vision, ML, OCR, embeddings) live on the
# runner side. The cloud-deployed web image is a thin orchestration tier.
FROM python:3.12-slim AS sibling-deps

RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
# Cache-bust keyed on the upstream qontinui-schemas commit. Without an ARG
# referenced here, Docker caches this clone layer indefinitely and silently
# bakes a stale schemas snapshot into the image. That exact trap crash-looped
# staging on 2026-05-23: schemas #58 added the memory shared types at 03:27,
# but the 08:17 web image reused a pre-#58 cached clone and boot-failed on
# `ModuleNotFoundError: qontinui_schemas.generated.per_type.memory_upsert_request`.
# The deploy workflow passes the resolved main SHA, so the layer re-clones only
# when schemas actually moves. A full (non-shallow) clone is required so an
# arbitrary commit SHA can be checked out. Defaults to `main` so a plain local
# `docker build` (no --build-arg) still produces a current image.
ARG SCHEMAS_SHA=main
RUN git clone https://github.com/qontinui/qontinui-schemas.git \
    && git -C qontinui-schemas checkout "$SCHEMAS_SHA"


# Stage 2: runtime image
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    POETRY_NO_INTERACTION=1 \
    POETRY_VIRTUALENVS_CREATE=false

WORKDIR /app

# Runtime system deps. psycopg2-binary ships libpq, so no libpq-dev.
# tini for PID-1 signal handling. postgresql-client for ad-hoc DSN
# probes. gcc / libgl1 / libglib2.0-0 are dropped: they were present
# for qontinui's native vision extensions and OpenCV runtime, neither
# of which is in this image anymore.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini postgresql-client \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir poetry==2.3.2

# Copy qontinui-schemas path-dep target. qontinui is NOT copied -
# web's runtime has no business importing it.
COPY --from=sibling-deps /src/qontinui-schemas /qontinui-schemas

COPY pyproject.toml poetry.lock ./
RUN poetry install --only main --no-root --no-interaction --no-ansi \
    && rm -rf /tmp/poetry-cache

COPY . .

RUN mkdir -p /app/uploads

EXPOSE 8000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
