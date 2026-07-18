"""coord memory_links — typed edges between memory records + kind='library'

Revision ID: coord_memory_links
Revises: ghut01_github_user_tokens
Create Date: 2026-07-17

Phase 4 of the Librarian structured-knowledge-library rollout
(``D:/qontinui-root/plans/2026-07-17-librarian-structured-knowledge-library.md``).

Adds the cloud graph layer over the tenant agentic memory substrate:

* ``coord.memory_links`` — typed, directed edges between two
  ``coord.memory_records`` rows of the same tenant. One row per
  ``(tenant, source, target, relation)`` edge; ``relation`` is one of
  ``depends_on`` / ``implements`` / ``supersedes`` / ``related``.
* widens the ``kind`` CHECK on ``coord.memory_records`` to admit the new
  ``'library'`` kind (curated library entries written by the Librarian).

Design notes
============

* ``relation`` is TEXT + CHECK rather than a PG enum — same rationale as
  the sibling ``scope`` / ``kind`` columns on ``coord.memory_records``:
  text+CHECK evolves without ``ALTER TYPE`` acrobatics.
* ``source_id`` / ``target_id`` FKs are ``ON DELETE CASCADE`` — edges die
  with their records (the physical decay prune must never be blocked by,
  or leave behind, dangling graph edges). ``tenant_id`` stays
  ``ON DELETE RESTRICT``, matching the ``coord.memory_records`` posture.
* The edge identity is the partial-free unique index
  ``uq_memory_links_edge`` on ``(tenant_id, source_id, target_id,
  relation)`` — the write path upserts with ``ON CONFLICT ... DO
  NOTHING`` against exactly these columns.
* The ``kind`` CHECK widening is an additive drop+recreate: the original
  CHECK was declared inline (unnamed) in ``coord_memory_records``, so it
  carries PostgreSQL's default name ``memory_records_kind_check``; we
  drop it by that name and recreate it (same name, now explicit) with
  ``'library'`` added. Alembic runs the whole migration in one
  transaction, so no window exists where the column is unconstrained.
* Idempotency: every DDL uses ``IF NOT EXISTS`` / ``IF EXISTS`` so a
  re-run against an already-applied DB is a no-op.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_memory_links"
down_revision: str = "ghut01_github_user_tokens"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The pre-Phase-4 kind set (mirrors the ``coord_memory_records``
# migration) and the widened set this revision installs.
_KINDS_BEFORE = (
    "'observation', 'fact', 'mental_model', 'episode', "
    "'feedback', 'reference', 'rule'"
)
_KINDS_AFTER = _KINDS_BEFORE + ", 'library'"


def upgrade() -> None:
    """Create coord.memory_links + widen the memory_records kind CHECK."""
    # ----------------------------------------------------------------
    # 1. coord.memory_links — typed edges between memory records.
    # ----------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.memory_links (
            link_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id   UUID NOT NULL
                REFERENCES coord.tenants(tenant_id) ON DELETE RESTRICT,
            source_id   UUID NOT NULL
                REFERENCES coord.memory_records(memory_id) ON DELETE CASCADE,
            target_id   UUID NOT NULL
                REFERENCES coord.memory_records(memory_id) ON DELETE CASCADE,
            relation    TEXT NOT NULL
                CHECK (relation IN (
                    'depends_on', 'implements', 'supersedes', 'related'
                )),
            description TEXT,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )

    # Edge identity — the write path's ON CONFLICT target.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_memory_links_edge
            ON coord.memory_links (tenant_id, source_id, target_id, relation)
        """
    )

    # Outbound traversal (graph walk + per-record link hydration).
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_memory_links_tenant_source
            ON coord.memory_links (tenant_id, source_id)
        """
    )

    # Inbound traversal (reverse lookups / cascade bookkeeping).
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_memory_links_tenant_target
            ON coord.memory_links (tenant_id, target_id)
        """
    )

    # ----------------------------------------------------------------
    # 2. Widen the kind CHECK on coord.memory_records: + 'library'.
    #    Additive drop+recreate inside this migration's transaction.
    # ----------------------------------------------------------------
    op.execute(
        """
        ALTER TABLE coord.memory_records
            DROP CONSTRAINT IF EXISTS memory_records_kind_check
        """
    )
    op.execute(
        f"""
        ALTER TABLE coord.memory_records
            ADD CONSTRAINT memory_records_kind_check
                CHECK (kind IN ({_KINDS_AFTER}))
        """
    )


def downgrade() -> None:
    """Reverse: drop coord.memory_links, restore the narrower kind CHECK.

    The kind CHECK is restored to the pre-Phase-4 value set; any
    ``kind='library'`` rows would violate it, so they are re-kinded to
    ``'reference'`` first (annotated in ``source.downgraded_from_kind``
    so the widening re-upgrade can be audited) — a downgrade must not be
    wedged open by data the revision itself admitted.
    """
    op.execute("DROP TABLE IF EXISTS coord.memory_links")

    op.execute(
        """
        UPDATE coord.memory_records
        SET kind = 'reference',
            source = source
                || jsonb_build_object('downgraded_from_kind', 'library'),
            updated_at = now()
        WHERE kind = 'library'
        """
    )
    op.execute(
        """
        ALTER TABLE coord.memory_records
            DROP CONSTRAINT IF EXISTS memory_records_kind_check
        """
    )
    op.execute(
        f"""
        ALTER TABLE coord.memory_records
            ADD CONSTRAINT memory_records_kind_check
                CHECK (kind IN ({_KINDS_BEFORE}))
        """
    )
