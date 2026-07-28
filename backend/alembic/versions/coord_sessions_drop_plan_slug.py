"""coord.sessions drop plan_slug — CONTRACT half of the plan_slug → work_unit_slug rename

Revision ID: coord_sessions_drop_plan_slug
Revises: memory_jobs_02_kind_aware_dedupe
Create Date: 2026-07-28

Stage 2d of plan
``D:/qontinui-root/plans/2026-07-06-coord-plan-slug-to-work-unit-slug-rename.md``
("retire the legacy plan_slug path across coord").

This is the **contract** half of the expand/contract column rename started by
``coord_sessions_work_unit_slug`` (Stage 2a). The rollout ordering documented
there (expand → dual-write → stop-write → contract) has completed its first
three steps: ``work_unit_slug`` shipped and was backfilled, coord dual-wrote
both columns, and the serving coord image has since been verified to contain
ZERO SQL references to ``plan_slug``. Dropping the legacy column is now safe —
no deployed writer or reader names it.

* ``plan_slug TEXT`` (nullable, added by ``coord_sessions_plan_linkage``) is
  dropped. The column has NO index (verified), so this is a bare
  ``DROP COLUMN`` — catalog-only, no table rewrite, no dependent objects.

**Lock posture (deliberate).** ``DROP COLUMN`` takes an ``ACCESS EXCLUSIVE``
lock on ``coord.sessions`` — the table behind every session registration and
~40s heartbeat. Same guard as ``coord_sessions_work_unit_slug``:
``SET LOCAL lock_timeout`` so the lock acquisition fails FAST rather than
queueing behind an in-flight query (a queued ``ACCESS EXCLUSIVE`` request
itself blocks every new reader that arrives behind it). alembic runs the
migration in one transaction, so ``SET LOCAL`` holds for the drop.

Downgrade
=========

Honestly reversible: re-add ``plan_slug TEXT`` (nullable) and re-backfill it
from ``work_unit_slug`` — the successor column has carried the union of both
columns' values since the Stage 2a backfill, so this restores every slug the
drop discarded. The backfill runs in ``op.get_context().autocommit_block()``
(same split as the Stage 2a upgrade): entering the block commits the
``ADD COLUMN``, releasing its ``ACCESS EXCLUSIVE`` lock before the
row-rewriting ``UPDATE`` begins, and the ``plan_slug IS NULL`` guard makes a
re-run a no-op.

Idempotency / authorship posture
================================

* DDL uses ``ADD COLUMN IF NOT EXISTS`` / ``DROP COLUMN IF EXISTS`` raw SQL —
  matching the ``coord.*`` migration house style (see
  ``coord_sessions_plan_linkage``). coord boots against this same schema, so
  re-running against an already-applied DB must be a no-op.
* **alembic is the SOLE author of the coord.* schema.** No Rust
  ``CREATE``/``ALTER`` self-heal; after this revision the coord crate neither
  reads nor writes ``plan_slug`` anywhere.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_sessions_drop_plan_slug"
down_revision: str | Sequence[str] | None = "memory_jobs_02_kind_aware_dedupe"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Bound the DDL's lock wait: a queued ACCESS EXCLUSIVE request blocks every
    # reader that arrives behind it, so fail fast instead of stalling coord's
    # session hot path behind one slow in-flight query.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute("ALTER TABLE coord.sessions DROP COLUMN IF EXISTS plan_slug")
    # env.py runs every pending migration in ONE enclosing transaction, so
    # without a reset this SET LOCAL would silently apply to any migration
    # that runs after this one in the same batch (e.g. a fresh-DB replay).
    op.execute("SET LOCAL lock_timeout = DEFAULT")


def downgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute("ALTER TABLE coord.sessions ADD COLUMN IF NOT EXISTS plan_slug TEXT")

    # Backfill OUTSIDE the DDL transaction: entering the autocommit block commits
    # the ADD COLUMN, releasing its ACCESS EXCLUSIVE lock before this
    # row-rewriting UPDATE begins. work_unit_slug has carried the union of both
    # columns' values since the Stage 2a backfill, so this restores every slug
    # the upgrade dropped. Guarded by `plan_slug IS NULL` so a re-run is a no-op.
    with op.get_context().autocommit_block():
        op.execute(
            "UPDATE coord.sessions SET plan_slug = work_unit_slug "
            "WHERE work_unit_slug IS NOT NULL AND plan_slug IS NULL"
        )
