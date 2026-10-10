"""custody 01 — coord.worktree_census checkout-occupancy (custody) columns

Revision ID: custody_01_worktree_census_occupancy
Revises: cihost_01_ci_host_agent_fleet
Create Date: 2026-09-26

Phase 1a (web migration) of plan
``2026-09-07-shared-checkout-occupancy-is-invisible-to-coord``.

The runner's census loop already sends the scalar ``custody_*`` fields for
every worktree carrying a WIP-custody record (the record the ``Stop`` hook
writes into the worktree's ``$GIT_DIR``); ``custody_occupants`` arrives with the
companion runner change that reads every per-session custody slot. coord's
census consumer
(``qontinui-coord`` ``crates/coord/src/worktree_census.rs``, ``WorktreeItem`` /
``CENSUS_COLS_FULL``) drops every one of them, because there is no column to
land them in. That is why a shared checkout's occupancy — which session is in
it, when it was last seen, whether its uncommitted work is captured — is
invisible to coord. This revision adds the columns; the companion coord PR adds
a new column tier to ``worktree_census.rs`` that reads and writes them, and
that tier falls back on SQLSTATE 42703 (undefined column) until this lands.

Alembic in qontinui-web is the sole author of the ``coord.*`` schema (served
policy ``production-and-cost`` ``alembic-sole-authorship``), so this lives here
rather than in qontinui-coord, and it lands FIRST. Hand-authored —
``alembic revision --autogenerate`` is never run against ``coord.*``.

## Columns

* ``custody_session_id`` TEXT — the session that last wrote the custody record.
* ``custody_session_name`` TEXT — that session's display name
  (``Session-Name``, the ``ListAgents`` address).
* ``custody_last_seen`` TIMESTAMPTZ — when the record was last written.
* ``custody_wip_state`` TEXT — the record's ``wip_state`` (``captured`` /
  ``deferred`` / ``stash_create_failed`` / ...); a runner-owned vocabulary.
* ``custody_wip_ref`` TEXT — the ``refs/wip/...`` snapshot ref, if any.
* ``custody_work_unit_id`` TEXT — the coord work unit the session declared.
* ``custody_plan_slug`` TEXT — the plan stem the session declared.
* ``custody_occupants`` JSONB — every custody slot found for the worktree, one
  object per session, newest first (a shared checkout can hold several).

## Shape

Same rules as ``runprov_01_worktree_census_build_target``:

* **Nullable, no default** — the census is an append-only oplog with a long
  tail of historical rows, and a runner that predates the reporting change
  omits the fields. NULL is "not observed", never "unoccupied".
* **No index** — consumers reach rows via the existing
  ``(device_id, observed_at DESC)`` / ``(repo, path)`` paths; the table is
  high-churn, so an index would be pure write cost.
* **TEXT, not enums** — ``wip_state`` and the identifiers are vocabularies the
  runner and the custody recorder own; coord must not pin them.

Additive, idempotent and reversible. The DDL is ONE static ``ALTER TABLE ...
ADD COLUMN IF NOT EXISTS`` literal (coord's migration classifier refuses a bare
``op.add_column``; precedent ``sched_cond_01_scheduled_tasks_conditions``), and
``downgrade`` drops exactly these eight columns with ``DROP COLUMN IF EXISTS``.
``IF NOT EXISTS`` is type-blind, which is why the test pins every type.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "custody_01_worktree_census_occupancy"
down_revision: str = "cihost_01_ci_host_agent_fleet"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the eight nullable custody columns. Idempotent.

    The SQL is written INLINE: coord's migration classifier
    (``pr_merge/migration_classifier.rs`` ``static_execute_sql``) accepts only
    string literals directly inside ``op.execute(...)`` and treats a name as
    dynamic SQL. The column names and types are the interface coord's
    ``worktree_census.rs`` reads; the test pins both.
    """
    op.execute(
        """
        ALTER TABLE coord.worktree_census
            ADD COLUMN IF NOT EXISTS custody_session_id TEXT,
            ADD COLUMN IF NOT EXISTS custody_session_name TEXT,
            ADD COLUMN IF NOT EXISTS custody_last_seen TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS custody_wip_state TEXT,
            ADD COLUMN IF NOT EXISTS custody_wip_ref TEXT,
            ADD COLUMN IF NOT EXISTS custody_work_unit_id TEXT,
            ADD COLUMN IF NOT EXISTS custody_plan_slug TEXT,
            ADD COLUMN IF NOT EXISTS custody_occupants JSONB
        """
    )


def downgrade() -> None:
    """Drop the eight custody columns."""
    op.execute(
        """
        ALTER TABLE coord.worktree_census
            DROP COLUMN IF EXISTS custody_occupants,
            DROP COLUMN IF EXISTS custody_plan_slug,
            DROP COLUMN IF EXISTS custody_work_unit_id,
            DROP COLUMN IF EXISTS custody_wip_ref,
            DROP COLUMN IF EXISTS custody_wip_state,
            DROP COLUMN IF EXISTS custody_last_seen,
            DROP COLUMN IF EXISTS custody_session_name,
            DROP COLUMN IF EXISTS custody_session_id
        """
    )
