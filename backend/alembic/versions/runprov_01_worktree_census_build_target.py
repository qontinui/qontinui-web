"""runprov 01 — coord.worktree_census build-target provenance (dir + slot)

Revision ID: runprov_01_worktree_census_build_target
Revises: plan_library_02_kind_lock
Create Date: 2026-08-16

Phase 1 (web migration) of plan
``2026-08-16-plan-corpus-authority-and-run-provenance``.

Adds two nullable columns to the append-only ``coord.worktree_census`` oplog:

* ``build_target_dir`` — the build target directory this worktree's run actually
  used (an out-of-tree ``CARGO_TARGET_DIR`` / ``dist`` root).
* ``build_slot`` — the shared build-pool slot identifier that directory belongs
  to (``target-pool/slot-2`` and friends).

Alembic in qontinui-web is the sole author of the ``coord.*`` schema (enforced
coord-side by ``tests/coord_schema_authorship.rs``), so this lives here rather
than in qontinui-coord. Hand-authored — ``alembic revision --autogenerate`` is
never run against ``coord.*``.

## Why the CENSUS and not ``coord.agent_worktrees``

The plan's Phase 1 originally proposed hanging these two columns off
``coord.agent_worktrees`` alongside ``work_unit_id``. Vetting rejected that
placement, and the reason is mechanical rather than stylistic:

* ``coord.agent_worktrees`` rows are written **once, at allocation**
  (``agent_worktrees.rs`` ``try_insert_all``), and the only post-allocation
  write door on that table is ``POST /coord/worktrees/:id/retention``. There is
  no door through which a realized build-target path could ever arrive.
* Neither fact **exists** at allocation time. coord decides a target *mode*
  (``policies::isolation::TargetMode::{Junctioned,Dedicated}``) and returns it
  advisory on ``AllocateResponse.isolation``; the runner/supervisor picks the
  actual directory and pool slot afterwards.

Two allocate-time columns for facts that only come into existence
post-allocation are permanently-NULL columns. The census is the surface that
already observes exactly this class of fact — it carries
``target_present`` / ``target_is_junction`` / ``target_bytes`` /
``attributable_bytes`` — is re-reported by the runner every tick via
``POST /coord/worktree-census/:device_id``, and is already the table the
reclaim engine reads. So the identity of the build target belongs beside its
byte-size, and no new join or cross-service dependency is introduced.

The split that results is one owner per concern:

* ``coord.agent_worktrees.work_unit_id`` — allocation-time identity (which plan
  asked for this worktree). Written by Phase 1's ``POST /agents/allocate``.
* ``coord.worktree_census.build_target_dir`` / ``build_slot`` —
  observation-time disk state (what the run actually used). Reported by the
  runner's census loop.

## Shape

Both are nullable TEXT with no default and no index:

* **Nullable** because the census is an append-only oplog with a long tail of
  historical rows, and because a runner that predates the reporting change
  simply omits them. NULL is "not observed", never "no build target".
* **No index** — consumers reach these columns via the existing hot path
  ``(device_id, observed_at DESC)`` or ``(repo, path)``; neither column is a
  filter key, and the table is high-churn, so an index would be pure write cost.
* **TEXT, not a typed enum** — a pool slot is an operator-chosen string
  (``target-pool/slot-2``); coord must not own that vocabulary.

Additive and reversible: ``downgrade`` drops exactly the two columns.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "runprov_01_worktree_census_build_target"
down_revision: str = "plan_library_02_kind_lock"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "worktree_census",
        sa.Column("build_target_dir", sa.Text(), nullable=True),
        schema="coord",
    )
    op.add_column(
        "worktree_census",
        sa.Column("build_slot", sa.Text(), nullable=True),
        schema="coord",
    )


def downgrade() -> None:
    op.drop_column("worktree_census", "build_slot", schema="coord")
    op.drop_column("worktree_census", "build_target_dir", schema="coord")
