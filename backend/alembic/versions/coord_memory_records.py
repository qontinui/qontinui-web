"""coord memory_records — tenant agentic memory substrate

Revision ID: coord_memory_records
Revises: coord_session_output_stream
Create Date: 2026-07-10

Phase 0 of the tenant-agentic-memory rollout
(``D:/qontinui-root/plans/2026-07-10-tenant-agentic-memory-web-backend.md``).

Creates the per-tenant agentic memory substrate:

* ``coord.memory_records``      — the memory store itself. Each row is one
                                   memory item (observation / fact /
                                   mental_model / episode / feedback /
                                   reference / rule) scoped to a tenant and
                                   optionally narrower (runner / agent /
                                   session via ``scope`` + ``scope_ref``).
                                   Hybrid retrieval: a 384-dim pgvector
                                   embedding (HNSW, cosine) for semantic
                                   search + a STORED tsvector generated
                                   column (GIN) for lexical search.
* ``coord.memory_observations`` — twin watcher rows, one per tenant per
                                   observation tick (row count / bytes /
                                   embedding coverage / quota utilization /
                                   drift class). Append-only oplog, same
                                   conventions as the sibling
                                   ``coord.*_observations`` tables.
* ``coord.tenant_policies``     — two new quota knobs:
                                   ``memory_quota_bytes`` (256 MiB default)
                                   and ``memory_row_quota`` (500k default).

Design notes
============

* ``scope`` / ``kind`` are TEXT + CHECK rather than PG enums — same rationale
  as the sibling observation tables: text+CHECK evolves without ``ALTER TYPE``
  acrobatics.
* ``content_tsv`` is a ``GENERATED ALWAYS AS ... STORED`` column —
  ``to_tsvector(regconfig, text)`` with an explicit config is immutable, so it
  is legal in a generated column. Requires raw SQL (no alembic op).
* The HNSW index requires **pgvector >= 0.5.0**. ``upgrade()`` therefore
  starts with a precondition assert: create the extension if absent, attempt
  ``ALTER EXTENSION vector UPDATE`` when the installed version is older, and
  fail with a clear message if it still is. The 32 KB content cap is
  app-enforced, not a DB constraint.
* ``memory_observations.tenant_id`` carries no FK — matches the sibling
  observation-oplog posture (history rows must never block a tenant delete
  and are pruned by the watcher, not by cascade).
* Idempotency: every DDL uses ``IF NOT EXISTS`` / ``IF EXISTS`` so a re-run
  against an already-applied DB is a no-op.
"""

import re
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_memory_records"
down_revision: str = "coord_session_output_stream"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# HNSW index support landed in pgvector 0.5.0.
_MIN_PGVECTOR = (0, 5, 0)

# Default per-tenant memory quotas: 256 MiB / 500k rows.
_DEFAULT_MEMORY_QUOTA_BYTES = 256 * 1024 * 1024
_DEFAULT_MEMORY_ROW_QUOTA = 500_000


def _pgvector_version() -> tuple[int, ...] | None:
    """Return the installed pgvector extension version, or None if absent."""
    conn = op.get_bind()
    row = conn.execute(
        sa.text("SELECT extversion FROM pg_extension WHERE extname = 'vector'")
    ).scalar()
    if row is None:
        return None
    parts = re.findall(r"\d+", str(row))
    return tuple(int(p) for p in parts) if parts else None


def _assert_pgvector_supports_hnsw() -> None:
    """Precondition: pgvector >= 0.5.0 (HNSW indexes).

    Creates the extension if missing, attempts an in-place
    ``ALTER EXTENSION vector UPDATE`` when the installed version is too
    old, and raises a clear error if it still is afterwards.
    """
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    version = _pgvector_version()
    if version is not None and version < _MIN_PGVECTOR:
        # A newer .so may already be installed server-side; try the
        # in-place catalog update before giving up.
        op.execute("ALTER EXTENSION vector UPDATE")
        version = _pgvector_version()

    if version is None or version < _MIN_PGVECTOR:
        found = ".".join(str(p) for p in version) if version else "absent"
        raise RuntimeError(
            "coord_memory_records requires pgvector >= 0.5.0 for HNSW "
            f"indexes; installed extension version is {found}. Upgrade the "
            "pgvector package on the PostgreSQL server (and re-run this "
            "migration) before creating coord.memory_records."
        )


def upgrade() -> None:
    """Create memory_records + memory_observations + tenant_policies quotas."""
    # ----------------------------------------------------------------
    # 0. Precondition — pgvector present and >= 0.5.0 (HNSW support).
    # ----------------------------------------------------------------
    _assert_pgvector_supports_hnsw()

    # ----------------------------------------------------------------
    # 1. coord.memory_records — the tenant memory store.
    #
    # FK posture:
    # * tenant_id     → coord.tenants(tenant_id) ON DELETE RESTRICT —
    #   same posture as coord.devices / coord.sessions: memories can't
    #   be orphaned by a tenant delete; the operator purges first.
    # * superseded_by → self-FK to the record that replaced this one
    #   (consolidation / correction lineage).
    #
    # Raw SQL because of the vector(384) column and the STORED
    # generated tsvector column.
    # ----------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.memory_records (
            memory_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id          UUID NOT NULL
                REFERENCES coord.tenants(tenant_id) ON DELETE RESTRICT,
            scope              TEXT NOT NULL DEFAULT 'tenant'
                CHECK (scope IN ('tenant', 'runner', 'agent', 'session')),
            scope_ref          TEXT,
            kind               TEXT NOT NULL
                CHECK (kind IN (
                    'observation', 'fact', 'mental_model', 'episode',
                    'feedback', 'reference', 'rule'
                )),
            title              TEXT NOT NULL,
            content            TEXT NOT NULL,
            content_hash       TEXT NOT NULL,
            embedding          vector(384),
            embedding_model    TEXT,
            content_tsv        tsvector GENERATED ALWAYS AS (
                to_tsvector('english', title || ' ' || content)
            ) STORED,
            importance         REAL NOT NULL DEFAULT 0.5,
            access_count       INTEGER NOT NULL DEFAULT 0,
            last_accessed_at   TIMESTAMPTZ,
            valid_from         TIMESTAMPTZ NOT NULL DEFAULT now(),
            valid_until        TIMESTAMPTZ,
            superseded_by      UUID
                REFERENCES coord.memory_records(memory_id),
            consolidated_from  UUID[],
            source             JSONB NOT NULL DEFAULT '{}',
            is_tombstone       BOOLEAN NOT NULL DEFAULT false,
            created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT memory_records_tenant_content_hash_key
                UNIQUE (tenant_id, content_hash)
        )
        """
    )

    # Semantic retrieval: HNSW over the cosine distance (pgvector >= 0.5.0).
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_memory_records_embedding_hnsw
            ON coord.memory_records
            USING hnsw (embedding vector_cosine_ops)
            WITH (m = 16, ef_construction = 64)
        """
    )

    # Lexical retrieval: GIN over the generated tsvector.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_memory_records_content_tsv
            ON coord.memory_records USING gin (content_tsv)
        """
    )

    # Per-tenant browse: newest-first within a kind.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_memory_records_tenant_kind_created
            ON coord.memory_records (tenant_id, kind, created_at DESC)
        """
    )

    # Scope-narrowed lookups (runner / agent / session memories).
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_memory_records_tenant_scope
            ON coord.memory_records (tenant_id, scope, scope_ref)
        """
    )

    # ----------------------------------------------------------------
    # 2. coord.memory_observations — twin watcher oplog, one row per
    #    tenant per observation tick. No unique constraint — this is
    #    intentionally a history oplog (same tenant recurs every tick).
    # ----------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.memory_observations (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id           UUID NOT NULL,
            observed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            row_count           BIGINT NOT NULL,
            bytes               BIGINT NOT NULL,
            embedding_coverage  DOUBLE PRECISION NOT NULL,
            model_versions      TEXT[] NOT NULL DEFAULT '{}',
            latest_write_at     TIMESTAMPTZ,
            quota_utilization   DOUBLE PRECISION NOT NULL,
            drift_class         TEXT NOT NULL
        )
        """
    )

    # Latest-per-tenant lookup + staleness window.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_memory_observations_tenant_observed
            ON coord.memory_observations (tenant_id, observed_at DESC)
        """
    )

    # ----------------------------------------------------------------
    # 3. coord.tenant_policies — per-tenant memory quota knobs.
    #    Defaults: 256 MiB / 500k rows.
    # ----------------------------------------------------------------
    op.execute(
        f"""
        ALTER TABLE coord.tenant_policies
            ADD COLUMN IF NOT EXISTS memory_quota_bytes BIGINT NOT NULL
                DEFAULT {_DEFAULT_MEMORY_QUOTA_BYTES},
            ADD COLUMN IF NOT EXISTS memory_row_quota BIGINT NOT NULL
                DEFAULT {_DEFAULT_MEMORY_ROW_QUOTA}
        """
    )


def downgrade() -> None:
    """Reverse: drop the two quota columns, then the two tables.

    Indexes drop with their tables. ``coord.memory_records`` has no
    inbound FKs from other tables (the self-FK drops with it), so plain
    DROPs suffice.
    """
    op.execute(
        """
        ALTER TABLE coord.tenant_policies
            DROP COLUMN IF EXISTS memory_row_quota,
            DROP COLUMN IF EXISTS memory_quota_bytes
        """
    )
    op.execute("DROP TABLE IF EXISTS coord.memory_observations")
    op.execute("DROP TABLE IF EXISTS coord.memory_records")
