"""coord worktree census — symlink-resolved volume paths (build target + worktree)

Revision ID: wtcensus_volpath_01_resolved_volume_paths
Revises: ci_measure_01_dispatch_measurement
Create Date: 2026-11-22

Phase 1 (web migration, meant to land first; coord's column ladder keeps coord
correct whichever deploys first) of plan
``2026-11-22-coord-charges-a-build-in-a-symlinked-agent-worktree-to-root``.

Adds two nullable TEXT columns to every census table coord writes from the
runner's ``POST /coord/worktree-census/:device_id``:

* ``coord.worktree_census``          (the append-only oplog)
* ``coord.worktree_census_latest``   (one row per key, ``wtcensus_split_01``)
* ``coord.worktree_census_history``  (state intervals, ``wtcensus_split_01``)

The columns:

* ``build_target_volume_path`` — ``build_target_dir`` with every symlink and
  junction resolved: the canonicalised nearest EXISTING ancestor of that path,
  rejoined with the lexical remainder (the target directory may not exist yet).
* ``worktree_volume_path`` — the same resolution applied to the row's ``path``.

## Why

On a Linux fleet box ``agent-worktrees/<id>`` is often a symlink into
``/data/qontinui/agent-worktrees/<id>``. The runner reports ``path`` and
``build_target_dir`` UNRESOLVED on purpose (they are the identity other
consumers compare against), so coord's string-prefix volume matching
(``volume_key_for_path``) charges a symlinked worktree's dedicated build, and
its checkout, to ``/`` instead of ``/data``. Coord needs the path the bytes
actually land under; the runner is the only party that can observe it. The
runner sends a resolved PATH, not a volume key: coord derives the volume on its
own side, against the mount points it already observes.

## Shape

Same as ``runprov_01_worktree_census_build_target``: nullable TEXT, no default,
no index. NULL means NOT OBSERVED (a runner predating the field, or a row with
no build target) and never "on the root volume"; a consumer that reads NULL
falls back to the unresolved column, labelled. Neither column is a filter key,
and ``worktree_census_latest`` must keep its primary key as its ONLY index so
every per-walk update stays a HOT update.

All three tables get both columns in this one revision: the split tables mirror
the legacy oplog column-for-column (``test_wtcensus_split_01_migration`` reds a
head where they drift).

``ADD COLUMN IF NOT EXISTS`` keeps ``upgrade()`` idempotent; ``downgrade()``
drops exactly the two columns from the three tables.

Alembic in qontinui-web is the sole author of the ``coord.*`` schema (served
policy ``production-and-cost`` ``alembic-sole-authorship``). Hand-authored.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "wtcensus_volpath_01_resolved_volume_paths"
down_revision: str | Sequence[str] | None = "ci_measure_01_dispatch_measurement"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every SQL string below is a STATIC literal. The coord merge-train migration
# classifier extracts string literals from each execute call and rejects a call
# with none as dynamic. These comments also avoid apostrophes and the
# op-dot-call spelling, following the sibling coord revisions.


def upgrade() -> None:
    """Add both resolved-path columns to the three census tables."""
    # coord writes these tables on every census walk; bound the lock wait so a
    # blocked apply fails fast instead of queueing in front of coord.
    op.execute("SET LOCAL lock_timeout = '3s'")

    op.execute(
        """
        ALTER TABLE coord.worktree_census
            ADD COLUMN IF NOT EXISTS build_target_volume_path TEXT,
            ADD COLUMN IF NOT EXISTS worktree_volume_path TEXT
        """
    )
    op.execute(
        """
        ALTER TABLE coord.worktree_census_latest
            ADD COLUMN IF NOT EXISTS build_target_volume_path TEXT,
            ADD COLUMN IF NOT EXISTS worktree_volume_path TEXT
        """
    )
    op.execute(
        """
        ALTER TABLE coord.worktree_census_history
            ADD COLUMN IF NOT EXISTS build_target_volume_path TEXT,
            ADD COLUMN IF NOT EXISTS worktree_volume_path TEXT
        """
    )

    op.execute(
        """
        COMMENT ON COLUMN coord.worktree_census_latest.build_target_volume_path IS
            'build_target_dir with symlinks and junctions resolved: the '
            'canonicalised nearest existing ancestor joined with the lexical '
            'remainder, as the runner observed it. Coord derives the volume a '
            'build is charged to from this path. NULL = NOT OBSERVED (an older '
            'runner, or no build target), never the root volume; fall back to '
            'build_target_dir, labelled.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.worktree_census_latest.worktree_volume_path IS
            'The row path with symlinks and junctions resolved, as the runner '
            'observed it. Coord derives the volume a checkout lives on from '
            'this path. NULL = NOT OBSERVED (an older runner), never the root '
            'volume; fall back to path, labelled.'
        """
    )

    op.execute("SET LOCAL lock_timeout = DEFAULT")


def downgrade() -> None:
    """Drop both columns from the three census tables. Exact reverse of upgrade()."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.worktree_census_history
            DROP COLUMN IF EXISTS worktree_volume_path,
            DROP COLUMN IF EXISTS build_target_volume_path
        """
    )
    op.execute(
        """
        ALTER TABLE coord.worktree_census_latest
            DROP COLUMN IF EXISTS worktree_volume_path,
            DROP COLUMN IF EXISTS build_target_volume_path
        """
    )
    op.execute(
        """
        ALTER TABLE coord.worktree_census
            DROP COLUMN IF EXISTS worktree_volume_path,
            DROP COLUMN IF EXISTS build_target_volume_path
        """
    )
    op.execute("SET LOCAL lock_timeout = DEFAULT")
