"""worktree_headroom_mode control + cpu_busy_permille sample column

Revision ID: wthr_01
Revises: coord_sessions_fleet_idx_01
Create Date: 2026-10-05

Phase 1 of plan
``2026-10-03-worktree-cap-is-a-static-4gb-guess-blind-to-live-cpu-and-memory-headroom``.
coord authors zero DDL (``[policy: alembic-sole-authorship]``), so the columns
its later phases read land here first and deploy before any coord code.

Three columns:

```text
coord.fleet_runtime_policy.worktree_headroom_mode           TEXT NULL  CHECK IN ('off','shadow','enforce')
coord.fleet_runtime_policy_versions.worktree_headroom_mode  TEXT NULL  CHECK IN ('off','shadow','enforce')
coord.device_resource_samples.cpu_busy_permille             SMALLINT NULL CHECK 0..1000
```

The control column is added to the parent AND the versions table in this one
revision, per the rule ``fleet_res_tel_02`` wrote into the versions table's
COMMENT: a partial snapshot is an audit trail that lies while still reporting
as versioned. Both ALTERs commit or neither does (transactional DDL).

Unlike the numeric controls of ``fleet_res_tel_03`` (tunable ranges, validated
at the door), the mode is a FIXED vocabulary, so it gets a CHECK, the same
stance ``fleet_policy_01`` takes for ``level``. NULL means "no override" and
coord reads it as the plan's default (``shadow``); it is not ``off``.

``cpu_busy_permille`` is a ratio in thousandths of whole-host CPU busy time
over the sample interval, so 0..=1000. NULL = NOT REPORTED (a runner build
that predates the field, or a probe that failed); it must never be read as
zero, which would claim an idle CPU.

Every ``op.execute`` is a static string literal: coord's merge-train migration
classifier cannot inspect a dynamic argument. Existing rows keep NULL; no
backfill, since no observation exists to backfill from.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "wthr_01"
down_revision: str | Sequence[str] | None = "coord_sessions_fleet_idx_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# down_revision is the single alembic head on origin/main at re-point time (2026-10-09).
# If `alembic-heads-pr` reports HEAD_COUNT=2 after another revision lands,
# re-point this line and `_PARENT_REVISION_ID` in
# tests/test_wthr_01_worktree_headroom_mode_migration.py together.

_MODE_TABLES: tuple[str, ...] = (
    "coord.fleet_runtime_policy",
    "coord.fleet_runtime_policy_versions",
)
_SAMPLE_TABLE = "coord.device_resource_samples"

# The interface the migration test pins (name + DDL type); the SQL below
# spells the same columns as static literals and the test asserts they agree.
_COLUMNS: tuple[tuple[str, str, str], ...] = (
    ("coord.fleet_runtime_policy", "worktree_headroom_mode", "TEXT"),
    ("coord.fleet_runtime_policy_versions", "worktree_headroom_mode", "TEXT"),
    ("coord.device_resource_samples", "cpu_busy_permille", "SMALLINT"),
)


def upgrade() -> None:
    """Add the mode control to parent + versions, and the CPU sample column."""
    op.execute(
        """
        ALTER TABLE coord.fleet_runtime_policy
            ADD COLUMN IF NOT EXISTS worktree_headroom_mode TEXT NULL
                CHECK (worktree_headroom_mode IN ('off', 'shadow', 'enforce'))
        """
    )
    op.execute(
        """
        ALTER TABLE coord.fleet_runtime_policy_versions
            ADD COLUMN IF NOT EXISTS worktree_headroom_mode TEXT NULL
                CHECK (worktree_headroom_mode IN ('off', 'shadow', 'enforce'))
        """
    )
    op.execute(
        """
        ALTER TABLE coord.device_resource_samples
            ADD COLUMN IF NOT EXISTS cpu_busy_permille SMALLINT NULL
                CHECK (cpu_busy_permille BETWEEN 0 AND 1000)
        """
    )

    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_runtime_policy.worktree_headroom_mode IS
            'Worktree-allocation headroom gate mode: off | shadow | enforce '
            '(plan 2026-10-03-worktree-cap-is-a-static-4gb-guess). NULL = no '
            'override; coord reads it as the plan default (shadow), which is '
            'NOT the same fact as off. Fixed vocabulary, hence the CHECK.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN
            coord.fleet_runtime_policy_versions.worktree_headroom_mode IS
            'Snapshot of coord.fleet_runtime_policy.worktree_headroom_mode — '
            'see that column. Snapshot rows written before revision wthr_01 '
            'carry NULL: the control did not exist, so no override was in '
            'force. Immutable: never UPDATE or DELETE a row here.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.device_resource_samples.cpu_busy_permille IS
            'Whole-host CPU busy time over the sample interval, in thousandths '
            '(0..=1000). NULL = NOT REPORTED (a runner build that predates the '
            'field, or a failed probe) and must NEVER be read as 0, which '
            'would claim an idle CPU.'
        """
    )


def downgrade() -> None:
    """Drop the three columns. Exact reverse of upgrade().

    The CHECK constraints and COMMENTs go with their columns. The DROPs are
    static literals inside this body, where the coord column-drop guard
    expects them.
    """
    op.execute(
        """
        ALTER TABLE coord.fleet_runtime_policy
            DROP COLUMN IF EXISTS worktree_headroom_mode
        """
    )
    op.execute(
        """
        ALTER TABLE coord.fleet_runtime_policy_versions
            DROP COLUMN IF EXISTS worktree_headroom_mode
        """
    )
    op.execute(
        """
        ALTER TABLE coord.device_resource_samples
            DROP COLUMN IF EXISTS cpu_busy_permille
        """
    )
