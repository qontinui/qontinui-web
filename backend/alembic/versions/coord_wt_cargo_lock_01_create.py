"""coord.worktree_cargo_lock — per-device cargo target lock samples

Revision ID: coord_wt_cargo_lock_01
Revises: sched_cond_01_scheduled_tasks_conditions
Create Date: 2026-09-30

Phase 2 (web half) of plan
``2026-09-19-build-slots-are-not-build-parallelism-cargo-target-lock-and-devops-allocation-stats``.

## Why it exists

A coord build slot is an admission count; cargo's per-target-dir
``.cargo-lock`` decides execution. Admitted builds that share one target dir
serialise on that lock, and until now no machine reported who held it or how
many builds were queued behind it. The vet resolved Phase 2 as option A: an
additive ``cargo_locks`` list on the runner's census POST, persisted to a
device-level SIBLING table exactly as ``volumes`` is persisted to
``coord.worktree_volume`` (``twin_07_coord_worktree_census``). A lock is per
target dir, not per worktree, so a column on ``coord.worktree_census`` would be
the wrong grain.

## Shape

One row per shared cargo target dir probed per runner census tick. Idle targets
are included, with the holder columns NULL and ``waiters = 0`` — an idle row is
a positive observation, distinct from "not probed" (no row).

* ``target_key TEXT``       — repo / target dir / profile of one ``.cargo-lock``,
  e.g. ``qontinui-coord/target/debug``.
* ``holder_pid INTEGER``    — pid of the process holding the lock (NULL = idle).
* ``holder_kind TEXT``      — ``build`` | ``sweep`` | ``unknown``, CHECKed
  (``ck_worktree_cargo_lock_holder_kind``). The sweep is a holder because the
  cargo sweep's ``run-locked`` verb takes the same lock.
* ``holder_age_secs BIGINT`` — how long the holder has held it.
* ``holder_cmd TEXT``       — the holder's command line.
* ``waiters INTEGER``       — blocked waiters on the lock (``/proc/locks`` rows
  marked ``->`` on the same inode). NOT NULL DEFAULT 0.
* ``oldest_wait_secs BIGINT`` — age of the longest-waiting waiter (NULL = none).

``device_id`` / ``tenant_id`` / ``observed_at`` and the
``(device_id, observed_at DESC)`` index mirror ``coord.worktree_volume``, so
coord reads the latest rows per device the way ``load_latest_volumes`` does and
prunes on the volumes' schedule.

## What writes it, what reads it

* **Writer:** qontinui-coord ``persist_worktree_census``, from the census
  request's new ``cargo_locks`` field, which the qontinui-runner census tick
  fills from ``/proc/locks`` (Linux only; elsewhere the field is omitted,
  meaning UNKNOWN, never an empty list).
* **Reader:** coord's per-device allocation stats (the plan's Phase 3).

## Ordering and auto-land

This revision lands and deploys BEFORE the coord change that writes it.
Shaped to pass coord's merge-time additive-safety classifier (qontinui-coord
``crates/coord/src/pr_merge/migration_classifier.rs``): one
``CREATE TABLE IF NOT EXISTS`` with a plain column list (the CHECK lives inside
it), a ``COMMENT ON``, and the index built ``CONCURRENTLY IF NOT EXISTS`` inside
``autocommit_block()`` — the classifier cannot see that the table is new and
empty, so it rejects any non-concurrent ``CREATE INDEX``; on an empty table the
concurrent build is instant (precedent ``coord_test_result_heads_01``). No
``op.get_bind()`` read, which the classifier also rejects. The only DROPs are in
``downgrade()``.

coord OWNS reads/writes of this table; web only authors the DDL (served policy
``production-and-cost`` ``alembic-sole-authorship``).

Chains off ``sched_cond_01_scheduled_tasks_conditions``, the single head of
``origin/main`` at authoring time. If a concurrent land moves the head before
this merges, re-point ``down_revision`` (and the ``Revises:`` line and the
test's pinned parent) onto the new head.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_wt_cargo_lock_01"
down_revision: str | Sequence[str] | None = "sched_cond_01_scheduled_tasks_conditions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every SQL string below is a STATIC literal. The coord merge-train migration
# classifier extracts string literals from each execute call and rejects a call
# with none as dynamic. Keep these comments free of apostrophes and of the
# op-dot-call spelling: the classifier lexer does not skip Python comments.
# The SQL bodies must also carry no colon-prefixed word: the execute call wraps
# its string in a SQLAlchemy text clause, which reads one as a bind parameter.


def upgrade() -> None:
    """Create coord.worktree_cargo_lock and its latest-per-device index."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.worktree_cargo_lock (
            id                BIGSERIAL   PRIMARY KEY,
            device_id         UUID        NOT NULL,
            tenant_id         UUID,
            target_key        TEXT        NOT NULL,
            holder_pid        INTEGER,
            holder_kind       TEXT,
            holder_age_secs   BIGINT,
            holder_cmd        TEXT,
            waiters           INTEGER     NOT NULL DEFAULT 0,
            oldest_wait_secs  BIGINT,
            observed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT ck_worktree_cargo_lock_holder_kind
                CHECK (holder_kind IN ('build', 'sweep', 'unknown'))
        )
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.worktree_cargo_lock IS
            'One row per shared cargo target dir (one .cargo-lock) probed per runner census tick, device-level sibling of coord.worktree_volume. Idle targets are included with the holder columns NULL and waiters 0. Written by coord persist_worktree_census from the census cargo_locks field; read by the per-device allocation stats. Plan 2026-09-19-build-slots-are-not-build-parallelism-cargo-target-lock-and-devops-allocation-stats, Phase 2.'
        """
    )
    # The latest lock rows for a given machine, as for coord.worktree_volume.
    # CONCURRENTLY although the table is new and empty, because the coord
    # migration classifier cannot see emptiness and rejects a plain index build.
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_worktree_cargo_lock_device_observed_at
                ON coord.worktree_cargo_lock (device_id, observed_at DESC)
            """
        )


def downgrade() -> None:
    """Drop the index, then coord.worktree_cargo_lock. Its comment goes with it."""
    op.execute("DROP INDEX IF EXISTS coord.idx_worktree_cargo_lock_device_observed_at")
    op.execute("DROP TABLE IF EXISTS coord.worktree_cargo_lock")
