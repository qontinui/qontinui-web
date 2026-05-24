"""coord hooks 01 hook invocations

Revision ID: coord_hooks_01_hook_invocations
Revises: phase4_touched_hunks
Create Date: 2026-05-24

Phase 1 of the coord lifecycle-hook taxonomy
(``D:/qontinui-root/qontinui-dev-notes/plans/2026-05-23-coord-hook-taxonomy-phase1-plan.md``
§2 idempotency contract + Phase 1, deliverable 2).

Creates ``coord.hook_invocations`` — the per-``(unit_id, hook_name,
attempt_id)`` idempotency ledger for **side-effecting** lifecycle hooks
(``post_attempt``, ``post_merge``, ``on_retrospective``). Coord-side
``hooks::ledger::claim_invocation`` does ``INSERT … ON CONFLICT DO
NOTHING RETURNING`` against this table: the first call for a key returns
``true`` (run the side effect), every replay returns ``false`` (skip it),
so a crash-mid-hook replay re-runs only the un-fired hooks.

This is the canonical (alembic) half of the dual-source creation; coord
self-heals the identical shape at boot via
``hooks::ledger::ensure_hook_invocations_table`` (same dual pattern as
``coord.agent_worktrees`` / ``coord.primary_trees``), so the surface works
even before this revision is applied.

Columns:

* ``unit_id`` — UUID. The merge proposal / work unit the hook fired for.
  First component of the composite PK.
* ``hook_name`` — TEXT. The ``HookName::as_str()`` wire value
  (``post_merge``, ``on_retrospective``, …). TEXT (not a PG ENUM) so a
  new hook kind never needs a schema migration, matching the
  ``coord.*`` convention (claims kinds are stored as text for the same
  reason).
* ``attempt_id`` — UUID ``NOT NULL`` with the all-zero sentinel default.
  **Why a sentinel, not a nullable PK column:** a nullable column in a
  PG PRIMARY KEY is impossible — PK columns are implicitly ``NOT NULL``,
  so a ``PRIMARY KEY (unit_id, hook_name, attempt_id)`` over a nullable
  ``attempt_id`` would reject the unit-scoped (no-attempt) rows the
  ``post_merge`` / ``on_retrospective`` hooks need. The all-zero UUID
  (``00000000-…``; ``uuid::Uuid::nil()`` on the Rust side) is the
  "unit-scoped, no attempt" marker — never a real attempt id (attempts
  use UUID v7). This keeps the PK a real composite PK (the strongest,
  PG-version-independent dedupe — no reliance on PG15 ``NULLS NOT
  DISTINCT``). Deciding lens: **robustness**.
* ``invoked_at`` — TIMESTAMPTZ DEFAULT now(). When the hook first fired.
* ``result`` — JSONB, nullable. Optional per-hook result payload,
  recorded on first claim only.
* ``tenant_id`` — UUID, nullable. Tenant scope for retention sweeps /
  dashboards.

Indexes:

* PK on ``(unit_id, hook_name, attempt_id)`` — the dedupe key.
* ``idx_hook_invocations_unit`` — "all hooks that fired for this unit",
  newest first.
* ``idx_hook_invocations_tenant`` — partial index for tenant-scoped
  retention sweeps (``coord.hook_invocations`` grows one row per
  ``(unit, hook)``; a janitor mirrors ``agent_worktrees::prune_terminal``).

Chains off ``coord_phase_3_01_merge_proposals`` — the ledger keys on the
merge-proposal ``unit_id`` that table defines, so it is the natural
parent.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_hooks_01_hook_invocations"
down_revision: str = "phase4_touched_hunks"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "hook_invocations",
        sa.Column("unit_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("hook_name", sa.Text(), nullable=False),
        sa.Column(
            "attempt_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            # All-zero sentinel = "unit-scoped, no attempt" (see docstring).
            server_default=sa.text("'00000000-0000-0000-0000-000000000000'"),
        ),
        sa.Column(
            "invoked_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("result", postgresql.JSONB(), nullable=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.PrimaryKeyConstraint("unit_id", "hook_name", "attempt_id"),
        schema="coord",
    )

    op.create_index(
        "idx_hook_invocations_unit",
        "hook_invocations",
        ["unit_id", sa.text("invoked_at DESC")],
        schema="coord",
    )
    op.create_index(
        "idx_hook_invocations_tenant",
        "hook_invocations",
        ["tenant_id"],
        schema="coord",
        postgresql_where=sa.text("tenant_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.idx_hook_invocations_tenant")
    op.execute("DROP INDEX IF EXISTS coord.idx_hook_invocations_unit")
    op.drop_table("hook_invocations", schema="coord")
