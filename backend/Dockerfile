# Stage 1: clone the sibling path-deps that pyproject.toml references
# at ../../qontinui-schemas and ../../qontinui. With WORKDIR=/app in the
# runtime stage, those paths resolve to /qontinui-schemas and /qontinui.
# Cloning here keeps the runtime image free of git.
FROM python:3.12-slim AS sibling-deps

RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone --depth 1 https://github.com/qontinui/qontinui-schemas.git
RUN git clone --depth 1 https://github.com/jspinak/qontinui.git

# Stub for the optional `ml` group's qontinui-train path-dep. Poetry 2.x
# validates path-deps in optional groups even when `--only main` excludes
# them — the path must exist as a parseable poetry project, even though
# we never install it in CI/Docker.
RUN mkdir -p /src/qontinui-train && \
    printf '[project]\nname = "qontinui-train"\nversion = "0.0.0"\ndescription = "stub"\nauthors = [{name = "stub"}]\n' \
        > /src/qontinui-train/pyproject.toml


# Stage 2: runtime image
FROM python:3.12-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    postgresql-client \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Install poetry. 2.x understands the PEP 621 [project] metadata block
# in pyproject.toml; 1.8.3 errors with "fields are required in package
# mode" because it only reads [tool.poetry].
RUN pip install poetry==2.3.2

# Copy sibling path-deps to where pyproject.toml expects them.
# pyproject says `qontinui-schemas = {path = "../../qontinui-schemas"}`,
# which from /app resolves to /qontinui-schemas. Same for qontinui.
COPY --from=sibling-deps /src/qontinui-schemas /qontinui-schemas
COPY --from=sibling-deps /src/qontinui /qontinui
COPY --from=sibling-deps /src/qontinui-train /qontinui-train

# Copy dependency files
COPY pyproject.toml poetry.lock* ./

# Configure poetry to not create virtual env
RUN poetry config virtualenvs.create false

# Install dependencies (--no-dev skips dev group; the optional ml group
# stays disabled, so qontinui-train (which doesn't exist as a public repo)
# is not needed).
# `--only main` is the poetry 2.x replacement for 1.x's `--no-dev` AND
# explicitly excludes the optional `ml` group. We need the latter
# because poetry 2.x validates path-deps in optional groups even when
# not installing them — and qontinui-train doesn't exist as a public
# repo (it's local-dev-only).
RUN poetry install --only main --no-root --no-interaction --no-ansi

# Copy application code
COPY . .

# Create uploads directory
RUN mkdir -p /app/uploads

# Expose port
EXPOSE 8000

# Run database migrations and start server
# Note: Migrations commented out temporarily for debugging
# CMD alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
CMD uvicorn app.main:app --host 0.0.0.0 --port 8000
