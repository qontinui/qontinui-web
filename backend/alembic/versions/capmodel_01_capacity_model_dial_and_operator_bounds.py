"""capacity-model dial + operator placement bounds on fleet_runtime_policy

Revision ID: capmodel_01
Revises: pr_events_mergeability_head_idx_01
Create Date: 2026-11-05

Phase 3 of plan
``2026-11-05-one-free-resource-model-places-sessions-builds-and-ci`` ("the
off-switch exists before anything reads it"). coord authors zero DDL
(``[policy: alembic-sole-authorship]``), so the columns its later phases read
land here first and deploy before any coord code names them.

Five nullable columns on **both** ``coord.fleet_runtime_policy`` and
``coord.fleet_runtime_policy_versions``:

```text
capacity_model_mode           TEXT     CHECK IN ('off','enforce')   plan D9 dial; NULL = enforce
capacity_model_off_consumers  TEXT[]   no CHECK (vocabulary in coord) plan D9 per-consumer off list
min_session_target            INTEGER  no CHECK (validated by coord)  10-17 D4 operator bound
max_session_target            INTEGER  no CHECK (validated by coord)  10-17 D4 operator bound
offload_enabled               BOOLEAN                                 10-17 D4 operator bound
```

**The dial (plan D9).** ``capacity_model_mode`` takes ``off | enforce`` and
NULL means ``enforce``: consumers ship enabled, and the off-switch is a
separate, product-reachable preference. It is a FIXED vocabulary, so it gets a
CHECK, the stance ``wthr_01`` takes for ``worktree_headroom_mode``.
``capacity_model_off_consumers`` names the consumers individually switched off
while the mode is ``enforce``; NULL and the empty array both mean none is. Its
vocabulary is NOT fixed (each consuming phase of the plan adds a name), so it
is validated at coord's write door against a closed list in coord's code, not
by a CHECK that would make every new consumer a migration and retroactively
invalidate snapshot rows. A reader ignores a name it does not know.

**The versions-table CHECK.** ``fleet_res_tel_02`` keeps snapshot rows
deliberately free of value CHECKs, so that a later widening of the live
table's allowed set cannot retroactively invalidate history. This revision
follows ``wthr_01`` instead, which CHECKs its mode on the versions table too:
a snapshot row is an INSERT of the parent's value, and a two-value vocabulary
that ships with ``NULL = enforce`` has no widening in view. The consequence is
recorded here because it is easy to miss: a later change to the mode's
vocabulary must alter BOTH CHECKs, and a narrowing must leave the versions
CHECK wide (or re-add it ``NOT VALID``), or the old snapshot rows fail it.

**The bounds (plan 2026-10-17-fleet-work-placement-minimizes-time-to-merged-pr
D4).** Its ``fleet_placement::OperatorBounds`` carries ``min_session_target``,
``max_session_target`` and ``offload_enabled`` and has had no store; these
columns are that store, named 1:1 after the struct's fields so the reader maps
them without a rename. NULL = no operator bound. They are tunable ranges, so
coord validates them at the door, the same split ``sess_guard_01`` argues for
its session floors: ``>= 0``, ``min <= max``, and an upper bound the paired
Phase 3 coord PR defines (``MAX_SESSION_TARGET_CEILING``).

**The type contract.** The bounds are ``INTEGER``, not an unsigned type:
``OperatorBounds`` holds ``u32``, which rust-postgres decodes only from an
``OID``, so coord reads ``Option<i32>`` (and ``Option<bool>`` for offload) and
validates ``>= 0`` at its write door. That door check is NOT a database
invariant: there is deliberately no CHECK, so a row written around the door is
never checked. A consumer therefore converts with ``u32::try_from`` and reads
a failure as UNKNOWN, never with a cast (``-1 as u32`` is 4294967295, an
unbounded session target). That is the signed column with a door check that
the ``fleet_res_tel_03`` and ``sess_guard_01`` controls already use. A NULL
column is a bound the operator did not set: a reader must not substitute a
value the operator never wrote (in particular, NULL ``offload_enabled`` is not
``false``). How a partly-NULL row maps into the all-or-nothing
``Known<OperatorBounds>`` is the consuming phase's decision.

Every column lands on the parent AND the versions table in this one revision,
per the rule ``fleet_res_tel_02`` wrote into the versions table's COMMENT: a
partial snapshot is an audit trail that lies while still reporting as
versioned. Both ALTERs commit or neither does (transactional DDL).

Every ``op.execute`` is a static string literal: coord's merge-train migration
classifier cannot inspect a dynamic argument. Existing rows keep NULL (the dial
reads ``enforce``, no consumer is off, no bound is set); there is nothing to
backfill.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "capmodel_01"
down_revision: str | Sequence[str] | None = "pr_events_mergeability_head_idx_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# down_revision is the single alembic head on origin/main at authoring time.
# If `alembic-heads-pr` reports HEAD_COUNT=2 after another revision lands,
# re-point this line and `_PARENT_REVISION_ID` in
# tests/test_capmodel_01_capacity_model_dial_migration.py together.

_POLICY_TABLES: tuple[str, ...] = (
    "coord.fleet_runtime_policy",
    "coord.fleet_runtime_policy_versions",
)

# The interface the migration test pins (name + DDL type); the SQL below
# spells the same columns as static literals and the test asserts they agree.
# The paired Phase 3 coord PR adds `fleet_policy::CAPACITY_CONTROL_COLS` naming
# exactly these, in this order; a rename here is a rename there.
_COLUMNS: tuple[tuple[str, str], ...] = (
    ("capacity_model_mode", "TEXT"),
    ("capacity_model_off_consumers", "TEXT[]"),
    ("min_session_target", "INTEGER"),
    ("max_session_target", "INTEGER"),
    ("offload_enabled", "BOOLEAN"),
)


def upgrade() -> None:
    """Add the dial and the bounds to the parent and the versions table."""
    op.execute(
        """
        ALTER TABLE coord.fleet_runtime_policy
            ADD COLUMN IF NOT EXISTS capacity_model_mode TEXT NULL
                CHECK (capacity_model_mode IN ('off', 'enforce')),
            ADD COLUMN IF NOT EXISTS capacity_model_off_consumers TEXT[] NULL,
            ADD COLUMN IF NOT EXISTS min_session_target INTEGER NULL,
            ADD COLUMN IF NOT EXISTS max_session_target INTEGER NULL,
            ADD COLUMN IF NOT EXISTS offload_enabled BOOLEAN NULL
        """
    )
    op.execute(
        """
        ALTER TABLE coord.fleet_runtime_policy_versions
            ADD COLUMN IF NOT EXISTS capacity_model_mode TEXT NULL
                CHECK (capacity_model_mode IN ('off', 'enforce')),
            ADD COLUMN IF NOT EXISTS capacity_model_off_consumers TEXT[] NULL,
            ADD COLUMN IF NOT EXISTS min_session_target INTEGER NULL,
            ADD COLUMN IF NOT EXISTS max_session_target INTEGER NULL,
            ADD COLUMN IF NOT EXISTS offload_enabled BOOLEAN NULL
        """
    )

    # -- parent comments ---------------------------------------------------
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_runtime_policy.capacity_model_mode IS
            'Capacity-model dial (plan '
            '2026-11-05-one-free-resource-model-places-sessions-builds-and-ci '
            'D9): off | enforce. NULL = enforce: consumers ship enabled and off '
            'is the separate preference. A reader whose read FAILS keeps its '
            'last successfully read value and, before its first one, its '
            'legacy reader; a failed read never resolves to NULL''s enforce. '
            'Fixed vocabulary, hence the CHECK.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_runtime_policy.capacity_model_off_consumers IS
            'Capacity-model consumers switched off individually while '
            'capacity_model_mode is enforce (plan '
            '2026-11-05-one-free-resource-model-places-sessions-builds-and-ci '
            'D9). NULL and the empty array both mean none is. The vocabulary '
            'is a closed list in coord''s fleet_policy.rs, validated at '
            'coord''s write door rather than by a CHECK, because each '
            'consuming phase adds a name; a reader ignores, and logs, a name '
            'it does not know.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_runtime_policy.min_session_target IS
            'Operator bound: the minimum session target per host (plan '
            '2026-10-17-fleet-work-placement-minimizes-time-to-merged-pr D4; '
            'coord fleet_placement::OperatorBounds.min_session_target), '
            'clamping the model''s session slots. NULL = no bound. Validated '
            'by coord (>= 0, <= max_session_target), not by a CHECK.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_runtime_policy.max_session_target IS
            'Operator bound: the maximum session target per host (plan '
            '2026-10-17-fleet-work-placement-minimizes-time-to-merged-pr D4; '
            'coord fleet_placement::OperatorBounds.max_session_target), '
            'clamping the model''s session slots. NULL = no bound. Validated '
            'by coord (>= 0, >= min_session_target), not by a CHECK.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_runtime_policy.offload_enabled IS
            'Operator bound: whether heavy verification (C3) may be offloaded '
            'to another host, per tenant (plan '
            '2026-10-17-fleet-work-placement-minimizes-time-to-merged-pr D4; '
            'coord fleet_placement::OperatorBounds.offload_enabled). NULL = '
            'not set by the operator, which is not the same fact as false.'
        """
    )

    # -- versions comments -------------------------------------------------
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_runtime_policy_versions.capacity_model_mode IS
            'Snapshot of coord.fleet_runtime_policy.capacity_model_mode; see '
            'that column. Snapshot rows written before revision capmodel_01 '
            'carry NULL: the dial did not exist. Immutable: never UPDATE or '
            'DELETE a row here.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN
            coord.fleet_runtime_policy_versions.capacity_model_off_consumers IS
            'Snapshot of coord.fleet_runtime_policy.capacity_model_off_consumers; '
            'see that column. Snapshot rows written before revision '
            'capmodel_01 carry NULL. Immutable: never UPDATE or DELETE a row '
            'here.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_runtime_policy_versions.min_session_target IS
            'Snapshot of coord.fleet_runtime_policy.min_session_target; see '
            'that column. Snapshot rows written before revision capmodel_01 '
            'carry NULL: no bound was stored. Immutable: never UPDATE or '
            'DELETE a row here.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_runtime_policy_versions.max_session_target IS
            'Snapshot of coord.fleet_runtime_policy.max_session_target; see '
            'that column. Snapshot rows written before revision capmodel_01 '
            'carry NULL: no bound was stored. Immutable: never UPDATE or '
            'DELETE a row here.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_runtime_policy_versions.offload_enabled IS
            'Snapshot of coord.fleet_runtime_policy.offload_enabled; see that '
            'column. Snapshot rows written before revision capmodel_01 carry '
            'NULL: no bound was stored. Immutable: never UPDATE or DELETE a '
            'row here.'
        """
    )


def downgrade() -> None:
    """Drop the five columns from both tables. Exact reverse of upgrade().

    The CHECK constraints and COMMENTs go with their columns. The DROPs are
    static literals inside this body, where the coord column-drop guard
    expects them.
    """
    op.execute(
        """
        ALTER TABLE coord.fleet_runtime_policy_versions
            DROP COLUMN IF EXISTS capacity_model_mode,
            DROP COLUMN IF EXISTS capacity_model_off_consumers,
            DROP COLUMN IF EXISTS min_session_target,
            DROP COLUMN IF EXISTS max_session_target,
            DROP COLUMN IF EXISTS offload_enabled
        """
    )
    op.execute(
        """
        ALTER TABLE coord.fleet_runtime_policy
            DROP COLUMN IF EXISTS capacity_model_mode,
            DROP COLUMN IF EXISTS capacity_model_off_consumers,
            DROP COLUMN IF EXISTS min_session_target,
            DROP COLUMN IF EXISTS max_session_target,
            DROP COLUMN IF EXISTS offload_enabled
        """
    )
