"""coord.restack_log -- Phase 1 server-side auto-restack oplog

Revision ID: phase1_restack_log
Revises: phase1_stack_edges
Create Date: 2026-05-23

Substrate Phase 1 (server-side parallel auto-restack engine). Mirrors the
coord-side self-heal at
``qontinui-coord/src/restack_engine.rs::ensure_restack_log_table``. The Rust
engine runs an idempotent ``CREATE TABLE IF NOT EXISTS`` + ``CREATE INDEX IF
NOT EXISTS`` pass at boot AND lazily on first invocation; this migration is
the authoritative alembic record.

## What the table is

``coord.restack_log`` is the append-only oplog of every server-side restack
attempt -- one row per descendant per land cascade. It exists for idempotency
+ audit: the engine re-runs cleanly (a restack of an already-current ref is a
``clean-noop`` row, no ref write), and an operator can reconstruct exactly
what coord moved and why.

## Why raw `op.execute` instead of `op.create_table`

Collision-safe with the coord self-heal (coord may have created the table
first). Same posture + rationale as ``phase1_stack_edges`` / the Phase 3
``phase3_hot_file_grammars`` migration. The DDL here MUST stay equivalent in
shape to ``ensure_restack_log_table``.

## Schema rationale

* ``id`` UUID PRIMARY KEY default ``gen_random_uuid()``.
* ``repo`` TEXT, ``child_ref`` TEXT -- the agent ref restacked.
* ``old_sha`` / ``new_sha`` TEXT NULLABLE -- pre/post ref tips
  (``new_sha`` is NULL on conflict / skipped outcomes where no ref moved).
* ``base_sha`` TEXT -- the new canonical-main tip the ref was rebased onto.
* ``outcome`` TEXT + CHECK in
  (``applied``, ``clean-noop``, ``conflict``, ``tree-verify-failed``,
  ``skipped``). text+CHECK, not a PG ENUM, per the house pattern.
* ``detail`` JSONB NULLABLE -- structured per-attempt detail (replay base,
  conflict message + bounded diff snippet, tree-verify failure reason).
* ``tenant_id`` UUID NULLABLE -- nullable-first multi-tenant posture; PARTIAL
  index ``WHERE tenant_id IS NOT NULL``.
* ``created_at`` TIMESTAMPTZ default now().

## Chaining

Chains off ``phase1_stack_edges`` (its companion). At land time the
coordinator linearizes the full substrate chain off the real single head
``workflow_mirror_2026_05_23``.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "phase1_restack_log"
down_revision: str | Sequence[str] | None = "phase1_stack_edges"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Allowed restack outcomes -- keep in sync with the CHECK emitted by
# ``ensure_restack_log_table`` in ``restack_engine.rs`` and the ``outcome``
# strings the engine writes.
_OUTCOMES = (
    "applied",
    "clean-noop",
    "conflict",
    "tree-verify-failed",
    "skipped",
)


def upgrade() -> None:
    # Collision-safe raw SQL -- equivalent in shape to the coord self-heal.
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.restack_log (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            repo        TEXT NOT NULL,
            child_ref   TEXT NOT NULL,
            old_sha     TEXT NULL,
            new_sha     TEXT NULL,
            base_sha    TEXT NOT NULL,
            outcome     TEXT NOT NULL,
            detail      JSONB NULL,
            tenant_id   UUID NULL,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT restack_log_outcome_chk
                CHECK (outcome IN ('applied','clean-noop','conflict','tree-verify-failed','skipped'))
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_restack_log_repo_child
            ON coord.restack_log (repo, child_ref, created_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_restack_log_tenant
            ON coord.restack_log (tenant_id) WHERE tenant_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.idx_restack_log_tenant")
    op.execute("DROP INDEX IF EXISTS coord.idx_restack_log_repo_child")
    op.execute("DROP TABLE IF EXISTS coord.restack_log")


# Touch the symbol so linters don't strip it.
_ = _OUTCOMES
