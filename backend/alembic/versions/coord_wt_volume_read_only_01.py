"""coord.worktree_volume.read_only — whether an observed volume is mounted read-only

Revision ID: coord_wt_volume_read_only_01
Revises: ci_job_res_02
Create Date: 2026-11-04

Phase 2 (qontinui-web migration half) of plan
``2026-11-03-devops-headroom-grades-read-only-and-esp-volumes-against-the-disk-floor``
(design decisions D1, D3 and D5).

coord authors zero ``coord.*`` DDL (``[policy: alembic-sole-authorship]``;
re-checked at authoring against ``coord-schema-moves-to-the-coord-repo``:
qontinui-coord ``origin/main`` carries no ``crates/coord-migrations/migrations/``
and that crate still declares itself not authoritative), so the column coord's
volume grade reads lands here, and this revision must be APPLIED in production
before the coord PR that reads or writes it deploys (plan Phase 3, held on a
``schema_object_exists`` gate for ``coord.worktree_volume.read_only``).

Why
===

coord grades every census volume against the tenant's 30 GiB disk floor. A
full read-only ISO (nawa ``/mnt/winiso``, 0 bytes free) publishes the same
numbers as a full writable volume, so it reads as a capacity breach on a
healthy machine. Whether a mount is read-only is not derivable from bytes: only
the publisher knows it (the runner's ``sysinfo`` ``Disk::is_read_only()``,
plan Phase 4). This column carries that fact.

Semantics
=========

``NULL`` means the publisher did not say: every existing row, and every runner
build predating plan Phase 4. It reads UNKNOWN, NEVER ``false`` (served policy
``verification-and-evidence`` ``silent-empty-is-unknown``), which is why there
is no default and no backfill: a default of ``false`` would assert every
existing volume writable, and a backfill could only guess.

What writes and reads it
========================

Written by coord's ``persist_worktree_census`` from the census body's per-volume
``read_only`` field (``POST /coord/worktree-census/<device_id>``), fed by the
runner's 60 s volume publisher. Read by coord's ``load_latest_volumes`` readers
for the per-volume grade (``other_volume_grade``) and served on
``/coord/fleet/volumes`` and ``/coord/devices/<id>/volumes``.

No index
========

Nothing filters or sorts on it: it qualifies a reading already selected by the
existing ``(device_id, observed_at DESC)`` index. coord writes this table on
every census tick, so an index would be pure write amplification.

Head choice
===========

``down_revision`` is the single head of ``origin/main`` at authoring time
(``scripts/ci/count_alembic_heads.py``: ``HEAD_COUNT=1``, ``HEAD=ci_job_res_02``).
If another alembic revision lands first, re-point ``down_revision`` and the
``Revises:`` header together; the companion test reads the parent from this
file. No ``alembic merge``. Hand-authored; ``--autogenerate`` is never run
against ``coord.*``.

Safety
======

Nullable with no default, so the ADD is catalogue-only and rewrites no row. The
ACCESS EXCLUSIVE wait is bounded with ``SET LOCAL lock_timeout = '3s'`` and
restored afterwards (belt-and-braces: env.py's ``_reset_revision_settings``
already RESETs lock_timeout after each applied step). Every SQL string is a
static literal, so the revision renders unchanged in offline ``--sql`` mode,
and the comment carries no ``:word`` sequence, which SQLAlchemy ``text()``
would read as a bind parameter. ``ADD COLUMN IF NOT EXISTS`` matches on NAME
only; acceptable because no earlier revision spells this column on this table.
Downgrade drops it ``IF EXISTS``; the data does not return.

Merge-train classifier disposition
==================================

Every statement is a shape coord's migration classifier admits
(``SET LOCAL lock_timeout``, ``ADD COLUMN IF NOT EXISTS`` with no default,
``COMMENT ON COLUMN`` with a plain literal), so a Blocked verdict on this
revision is a real finding, not an expected one.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_wt_volume_read_only_01"
down_revision: str | Sequence[str] | None = "ci_job_res_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the nullable read_only column, with its comment."""
    op.execute("SET LOCAL lock_timeout = '3s'")

    # IF NOT EXISTS matches on NAME only; acceptable because no revision in
    # this chain spells this column on this table.
    op.execute(
        """
        ALTER TABLE coord.worktree_volume
            ADD COLUMN IF NOT EXISTS read_only BOOLEAN
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.worktree_volume.read_only IS
            'Whether the publisher observed this volume mounted read-only '
            '(the runner sysinfo Disk is_read_only). A read-only volume is not '
            'graded against the disk floor, since capacity is not the question. '
            'Written by coord persist_worktree_census from the census volume '
            'read_only field (POST /coord/worktree-census/<device_id>); read by '
            'coord load_latest_volumes for the per-volume grade and served on '
            '/coord/fleet/volumes '
            '(plan 2026-11-03-devops-headroom-grades-read-only-and-esp-volumes-against-the-disk-floor). '
            'NULL = the publisher did not say (every runner build predating the '
            'field); read as UNKNOWN, never as false.'
        """
    )

    # Belt-and-braces: env.py's _reset_revision_settings already RESETs
    # lock_timeout after each applied step.
    op.execute("SET LOCAL lock_timeout = DEFAULT")


def downgrade() -> None:
    """Drop the column (a catalogue inverse; the data does not return)."""
    op.execute("SET LOCAL lock_timeout = '3s'")

    op.execute(
        """
        ALTER TABLE coord.worktree_volume
            DROP COLUMN IF EXISTS read_only
        """
    )

    op.execute("SET LOCAL lock_timeout = DEFAULT")
