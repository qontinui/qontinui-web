"""coord.conflict_resolutions -- Phase 2 first-class-conflict resolution audit

Revision ID: phase2_conflict_resolutions
Revises: phase2_conflicts
Create Date: 2026-05-23

Substrate Phase 2 (first-class conflicts). Mirrors the coord-side self-heal at
``qontinui-coord/src/conflict_engine.rs::ensure_conflict_resolutions_table``.

## What the table is

``coord.conflict_resolutions`` is the ADDITIVE audit log of how each conflict
was resolved. A conflict is resolved purely by APPENDING a row here + flipping
``coord.conflicts.status`` to 'resolved' -- the three sides remain retrievable
by OID from ``refs/conflict/<id>`` after resolution (resolution never rewrites
the conflict object). This append-only shape is what makes the immutability
test pass: the base/ours/theirs blobs are still fetchable post-resolution.

## Why chained off phase2_conflicts (not the shared head)

This table FKs ``coord.conflicts(id)``, so it must come AFTER
``phase2_conflicts`` rather than off the shared ``workflow_mirror_2026_05_23``
head -- the FK target must exist first. (The coordinator's linearization keeps
this ordering when it merges the sibling drafts.)

## Schema rationale

* ``id`` UUID PK.
* ``conflict_id`` UUID FK -> ``coord.conflicts(id)`` ON DELETE CASCADE.
* ``resolution_sha`` TEXT NULL -- the resolved tip that supersedes the conflict.
* ``resolved_by`` TEXT NULL -- agent id / operator email / 'coord-auto-resolver'.
* ``method`` TEXT + CHECK ('auto-identical','auto-commuting','agent','operator')
  -- text+CHECK over a PG ENUM (house pattern). The two ``auto-*`` methods are
  the conservative auto-resolver's ONLY outputs (both sides identical -> blob
  OIDs equal; or Phase-3 ``commute()`` proves the fragment-sets commute).
  Everything else stays 'open' and is resolved via 'agent' / 'operator'.
* ``detail`` JSONB -- method-specific detail (which keys commuted, etc).
* ``tenant_id`` UUID NULLABLE -- nullable-first; PARTIAL index.
* ``created_at`` TIMESTAMPTZ.
* Index on ``(conflict_id, created_at DESC)`` -- the resolution history for a
  conflict, newest first.

## Why raw `op.execute`

Collision-safe with the coord self-heal (``CREATE TABLE/INDEX IF NOT EXISTS``).
Must stay equivalent in shape to ``ensure_conflict_resolutions_table``.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "phase2_conflict_resolutions"
down_revision: str | Sequence[str] | None = "phase2_conflicts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Allowed resolution methods -- keep in sync with the CHECK emitted by
# ``ensure_conflict_resolutions_table`` in ``conflict_engine.rs``.
_METHODS = ("auto-identical", "auto-commuting", "agent", "operator")


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.conflict_resolutions (
            id             UUID PRIMARY KEY,
            conflict_id    UUID NOT NULL,
            resolution_sha TEXT NULL,
            resolved_by    TEXT NULL,
            method         TEXT NOT NULL,
            detail         JSONB NULL,
            tenant_id      UUID NULL,
            created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT conflict_resolutions_method_chk
                CHECK (method IN ('auto-identical','auto-commuting','agent','operator')),
            CONSTRAINT conflict_resolutions_conflict_fk
                FOREIGN KEY (conflict_id) REFERENCES coord.conflicts (id) ON DELETE CASCADE
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_conflict_resolutions_conflict
            ON coord.conflict_resolutions (conflict_id, created_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_conflict_resolutions_tenant
            ON coord.conflict_resolutions (tenant_id) WHERE tenant_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.idx_conflict_resolutions_tenant")
    op.execute("DROP INDEX IF EXISTS coord.idx_conflict_resolutions_conflict")
    op.execute("DROP TABLE IF EXISTS coord.conflict_resolutions")


# Touch the symbol so linters don't strip it.
_ = _METHODS
