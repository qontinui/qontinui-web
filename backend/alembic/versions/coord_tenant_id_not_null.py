"""coord tenant_id_not_null — lock tenant_id NOT NULL on all 7 scoped tables

Revision ID: coord_tenant_id_not_null
Revises: coord_devices_tenant_id
Create Date: 2026-05-20

Phase 6 (final) of the default-tenant-propagation rollout
(``D:/qontinui-root/plans/2026-05-20-default-tenant-propagation.md``).

After Phases 1-5 wired tenant resolution through every coord write path,
this revision locks the invariant at the database level: every row in
every tenant-scoped table MUST carry a non-null ``tenant_id``. Defense
in depth — new inserts that fail to stamp ``tenant_id`` now fail at the
DB layer rather than landing as orphaned rows.

Tables locked (all 7 — the 6 from ``coord_tenant_scope_columns`` plus
``coord.devices`` from ``coord_devices_tenant_id``):

* ``coord.devices``
* ``coord.plans``
* ``coord.agent_worktrees``
* ``coord.agent_questions``
* ``coord.agent_logs``
* ``coord.memories``
* ``coord.primary_trees``

Pre-check posture: each ``ALTER COLUMN ... SET NOT NULL`` is preceded by
a PL/pgSQL block that hard-fails with a descriptive ``RAISE EXCEPTION``
if any row in the table still has ``tenant_id IS NULL``. Per
``[[feedback_canonical_db_behind_alembic]]`` — NULL post-Phase-5 is a
real data-integrity gap, not a transient state to paper over. Failing
loudly here is the point.

Coord-side ``ensure_*`` boot helpers deliberately stay at
``ADD COLUMN IF NOT EXISTS`` only — the NOT NULL transition is owned
exclusively by this revision so coord boot doesn't trip the hard-fail
when the canonical-PG migration is behind. See
``coord/src/fleet.rs::ensure_devices_tenant_id`` for the same comment.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_tenant_id_not_null"
down_revision: str = "coord_devices_tenant_id"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Tables that get ``tenant_id`` locked to NOT NULL. Order matches the
# rollout plan's Phase 6 deliverable section so the migration log reads
# top-down with ``coord.devices`` (Phase 1's addition) first.
_LOCKED_TABLES: list[str] = [
    "devices",
    "plans",
    "agent_worktrees",
    "agent_questions",
    "agent_logs",
    "memories",
    "primary_trees",
]


def upgrade() -> None:
    """Pre-check each table for NULL ``tenant_id`` rows then SET NOT NULL.

    Hard-fails with a descriptive ``RAISE EXCEPTION`` if any table still
    has NULL ``tenant_id`` rows — that's a real data-integrity gap from
    a missed Phase 1-5 backfill, not a state to gloss over.
    """
    for table in _LOCKED_TABLES:
        op.execute(
            f"""
            DO $$
            DECLARE null_count INTEGER;
            BEGIN
                SELECT COUNT(*) INTO null_count FROM coord.{table} WHERE tenant_id IS NULL;
                IF null_count > 0 THEN
                    RAISE EXCEPTION 'cannot SET NOT NULL on coord.{table}.tenant_id: % rows still have NULL tenant_id', null_count;
                END IF;
            END
            $$;
            """
        )
        op.execute(f"ALTER TABLE coord.{table} ALTER COLUMN tenant_id SET NOT NULL")


def downgrade() -> None:
    """Drop the NOT NULL constraint on each table.

    Reverts only the constraint — does NOT re-NULL existing rows. The
    backfill from Phase 1's ``coord_devices_tenant_id`` and Phase 0's
    ``coord_tenant_scope_columns`` is preserved; data stays correctly
    stamped, just without the DB-level guard.
    """
    for table in _LOCKED_TABLES:
        op.execute(f"ALTER TABLE coord.{table} ALTER COLUMN tenant_id DROP NOT NULL")
