"""coord.hot_file_grammars -- Phase 3 patch-commutation registry

Revision ID: phase3_hot_file_grammars
Revises: workflow_mirror_2026_05_23
Create Date: 2026-05-23

Substrate Phase 3 (patch-commutation for hot files). Mirrors the coord-side
self-heal at
``qontinui-coord/src/hot_file_grammars.rs::ensure_hot_file_grammars_table``.
The Rust scheduler already runs an idempotent ``CREATE TABLE IF NOT EXISTS``
+ ``CREATE INDEX IF NOT EXISTS`` pass at boot; this migration is the
authoritative alembic record so a fresh canonical PG ends up with the same
shape without depending on a coord boot.

## Why raw `op.execute` instead of `op.create_table`

This migration MUST be collision-safe with the coord self-heal: coord may
have already created the table (via ``ensure_hot_file_grammars_table``)
before this migration runs. ``op.create_table`` issues a bare ``CREATE
TABLE`` that errors if the table already exists. We therefore emit the exact
same idempotent raw SQL the self-heal uses -- ``CREATE TABLE IF NOT EXISTS``
+ ``CREATE INDEX IF NOT EXISTS`` -- so the two artifacts converge regardless
of order. The two **must** stay byte-for-byte equivalent in shape; schema
changes here must be mirrored in ``ensure_hot_file_grammars_table`` and
vice versa.

## Schema rationale

* ``repo`` + ``path`` TEXT, composite PRIMARY KEY. One grammar per
  ``(repo, path)``; re-registering a path UPSERTs.
* ``grammar_kind`` TEXT + CHECK (NOT a PG ENUM -- text+CHECK evolves cleanly
  without ``ALTER TYPE`` per the house pattern). Allowed values mirror
  ``GrammarKind::as_str`` in ``hot_file_grammars.rs``:
  ``cargo_lock`` | ``alembic_versions`` | ``pnpm_lock`` | ``pg_schema_sql``.
* ``tenant_id`` UUID NULLABLE -- lands nullable-first per the canonical
  multi-tenant posture (``coord_tenant_scope_columns``); NOT-NULL
  tightening is a deliberate later migration. Partial index
  ``WHERE tenant_id IS NOT NULL``.
* ``created_at`` TIMESTAMPTZ default now().

## Single head

At authoring time the single alembic head is ``workflow_mirror_2026_05_23``
(verified via the revision-graph scan). A sibling Phase 0 substrate
migration also chains off this same head; that is intentional -- the
coordinator linearizes the chain at land time (it re-points one sibling's
``down_revision`` at the other so there is one head, exactly the alembic
"merge heads" semantics performed structurally). Per
``feedback_alembic_sibling_head_merge``, if both siblings land via plain PRs
instead, an empty merge-heads revision joins the two heads.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "phase3_hot_file_grammars"
down_revision: str | Sequence[str] | None = "coord_canonical_repos"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Allowed grammar kinds -- keep in sync with
# ``qontinui-coord/src/hot_file_grammars.rs::GrammarKind::as_str`` and the
# CHECK constraint emitted by ``ensure_hot_file_grammars_table``.
_KINDS = (
    "cargo_lock",
    "alembic_versions",
    "pnpm_lock",
    "pg_schema_sql",
)


def upgrade() -> None:
    # Collision-safe raw SQL -- byte-equivalent to the coord self-heal so the
    # two artifacts converge regardless of run order.
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.hot_file_grammars (
            repo         TEXT NOT NULL,
            path         TEXT NOT NULL,
            grammar_kind TEXT NOT NULL,
            tenant_id    UUID NULL,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT hot_file_grammars_pk PRIMARY KEY (repo, path),
            CONSTRAINT hot_file_grammars_kind_chk
                CHECK (grammar_kind IN ('cargo_lock','alembic_versions','pnpm_lock','pg_schema_sql'))
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_hot_file_grammars_tenant
            ON coord.hot_file_grammars (tenant_id) WHERE tenant_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.idx_hot_file_grammars_tenant")
    op.execute("DROP TABLE IF EXISTS coord.hot_file_grammars")


# Touch the symbol so linters don't strip it -- same pattern as
# wave_6_01_coord_merge_batches._STATUSES.
_ = _KINDS
