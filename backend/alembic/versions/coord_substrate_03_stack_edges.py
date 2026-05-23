"""coord.stack_edges -- Phase 1 server-side auto-restack DAG

Revision ID: phase1_stack_edges
Revises: workflow_mirror_2026_05_23
Create Date: 2026-05-23

Substrate Phase 1 (server-side parallel auto-restack engine). Mirrors the
coord-side self-heal at
``qontinui-coord/src/restack_engine.rs::ensure_stack_edges_table``. The Rust
engine runs an idempotent ``CREATE TABLE IF NOT EXISTS`` + ``CREATE INDEX IF
NOT EXISTS`` pass at boot AND lazily on first invocation; this migration is
the authoritative alembic record so a fresh canonical PG ends up with the same
shape without depending on a coord boot.

## What the table is

``coord.stack_edges`` is the DAG of which agent ref stacks on which parent.
The engine maintains it as agents register / advance: each time coord
restacks a child ref, it upserts an edge ``(child_ref -> parent_ref)``. The
engine walks these edges transitively so a chain (child stacked on child) is
fully discovered and collapsed server-side in a single land cascade.

## Why raw `op.execute` instead of `op.create_table`

Collision-safe with the coord self-heal: coord may have already created the
table (via ``ensure_stack_edges_table``) before this migration runs.
``op.create_table`` issues a bare ``CREATE TABLE`` that errors if the table
already exists. We emit the exact same idempotent raw SQL the self-heal uses
-- ``CREATE TABLE IF NOT EXISTS`` + ``CREATE INDEX IF NOT EXISTS`` -- so the
two artifacts converge regardless of order. They MUST stay equivalent in
shape; schema changes here must be mirrored in ``ensure_stack_edges_table``
and vice versa.

## Schema rationale

* ``child_ref`` + ``parent_ref`` TEXT -- git ref names
  (``refs/agent/<machine>-<agent>`` / ``refs/heads/main`` etc).
* ``repo`` TEXT -- ``owner/name``.
* PRIMARY KEY ``(repo, child_ref)`` -- one parent per child ref per repo
  (re-stacking UPSERTs the parent_ref). Secondary index on
  ``(repo, parent_ref)`` powers the transitive descendant walk.
* ``kind`` TEXT + CHECK (NOT a PG ENUM -- text+CHECK evolves cleanly without
  ``ALTER TYPE`` per the house pattern). Starts with ``agent_branch``;
  conflict/lane kinds are added by later substrate phases by widening the
  CHECK in a follow-up migration.
* ``tenant_id`` UUID NULLABLE -- lands nullable-first per the canonical
  multi-tenant posture (``coord_tenant_scope_columns``); NOT-NULL tightening
  is a deliberate later migration. PARTIAL index ``WHERE tenant_id IS NOT
  NULL``.
* ``created_at`` TIMESTAMPTZ default now().

## Single head

At authoring time the single alembic head is ``workflow_mirror_2026_05_23``
(verified via ``alembic heads``). Sibling substrate migrations (Phase 0
``coord_canonical_repos``, Phase 3 ``phase3_hot_file_grammars``, and the
companion ``phase1_restack_log``) also chain off this same head; that is
intentional -- the coordinator linearizes the chain at land time (re-pointing
each sibling's ``down_revision`` at the prior so there is one head, exactly
the alembic "merge heads" semantics performed structurally). Per
``feedback_alembic_sibling_head_merge``, if siblings land via plain PRs
instead, an empty merge-heads revision joins the heads.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "phase1_stack_edges"
down_revision: str | Sequence[str] | None = "phase3_hot_file_grammars"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Allowed stack-edge kinds -- keep in sync with the CHECK emitted by
# ``ensure_stack_edges_table`` in ``restack_engine.rs``. Later phases widen
# this (conflict / lane kinds) via a follow-up migration that re-issues the
# CHECK.
_KINDS = ("agent_branch",)


def upgrade() -> None:
    # Collision-safe raw SQL -- equivalent in shape to the coord self-heal so
    # the two artifacts converge regardless of run order.
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.stack_edges (
            child_ref   TEXT NOT NULL,
            parent_ref  TEXT NOT NULL,
            repo        TEXT NOT NULL,
            kind        TEXT NOT NULL DEFAULT 'agent_branch',
            tenant_id   UUID NULL,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT stack_edges_pk PRIMARY KEY (repo, child_ref),
            CONSTRAINT stack_edges_kind_chk CHECK (kind IN ('agent_branch'))
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_stack_edges_parent
            ON coord.stack_edges (repo, parent_ref)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_stack_edges_tenant
            ON coord.stack_edges (tenant_id) WHERE tenant_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.idx_stack_edges_tenant")
    op.execute("DROP INDEX IF EXISTS coord.idx_stack_edges_parent")
    op.execute("DROP TABLE IF EXISTS coord.stack_edges")


# Touch the symbol so linters don't strip it -- same pattern as
# wave_6_01_coord_merge_batches._STATUSES.
_ = _KINDS
