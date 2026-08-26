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

# qontinui-cloud-control — the BACKEND half of the composed cloud build.
#
# qontinui.io's FRONTEND is enforced-composed: `frontend/scripts/vercel-install.sh`
# links the overlay and exits non-zero if it did not land, so the deployed app
# always ships cloud-control's admin/billing/organization pages. The backend
# half was never wired, so those pages called routes this image does not serve:
# measured 2026-08-26 against production, /api/v1/admin/{stats,users,projects},
# /api/v1/billing/subscription and /api/v1/pricing/plans ALL returned 404 while
# OSS protected routes returned 401 — the discriminator that separates "route
# absent" from "route present but unauthenticated". Those routes moved here-to-
# there in the 2026-04-30 carve-out (03b28e0e) and nothing replaced them.
#
# Same pin as the frontend (`frontend/cloud-control.pin`), passed in by
# deploy-web.yml, so BOTH halves of one deployment are the same cloud-control
# commit. A second pin would be a new silent-drift axis between them.
# Defaults to `main` so a plain local `docker build` still produces an image.
# The repo is public (AGPL-3.0) — no credential needed, same as CI.
ARG CLOUD_CONTROL_SHA=main
RUN git clone https://github.com/qontinui/qontinui-cloud-control.git \
    && git -C qontinui-cloud-control checkout "$CLOUD_CONTROL_SHA"


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

COPY --from=sibling-deps /src/qontinui-cloud-control /qontinui-cloud-control

COPY pyproject.toml poetry.lock ./
RUN poetry install --only main --no-root --no-interaction --no-ansi \
    && rm -rf /tmp/poetry-cache

# Install cloud-control AFTER poetry so the lock resolves first, exactly as
# backend-ci.yml does it (`pip install -e` into the same environment). It is a
# separate step rather than a poetry dependency for the same reason the
# frontend overlay is not a `file:` dep: an OSS install must stay clean, and a
# path dep in the committed manifest would break every build without the
# sibling present.
COPY . .

RUN pip install --no-cache-dir -e /qontinui-cloud-control

# COMPOSE-OR-FAIL. The frontend install script refuses to exit 0 unless the
# overlay landed, and this is the backend's half of that guarantee. Without it
# a clone or install failure would produce a GREEN deploy of an image serving
# none of cloud-control's routes — which is precisely the state production was
# in, undetected, and it is indistinguishable from a correct OSS build from the
# outside. An import alone is not enough: the package registers its routers via
# `add_route_registrar` at import time, so assert a registrar actually landed.
# Docker keeps the previous image serving when a build fails, so failing loud
# here costs no availability.
RUN python -c "\
import qontinui_cloud_control;\
import app.extensions as ext;\
n = len(ext._route_registrars);\
assert n > 0, 'cloud-control imported but registered no route registrars';\
print(f'composed backend OK: {n} cloud-control route registrar(s)')"

RUN mkdir -p /app/uploads

EXPOSE 8000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
