"""coord.overlord_passes.runner_started_at + coord.overlord_pass_rows.nudge_measured_at

Revision ID: overlord_04_runner_start_and_nudge_time
Revises: coord_test_result_runs_01
Create Date: 2026-11-08

Phase 1 of plan
``2026-11-02-overlord-flow-cannot-see-a-same-build-restart-and-credits-a-nudge-that-never-landed``.

coord authors **zero** DDL (``[policy: alembic-sole-authorship]``), so both
columns land here, in qontinui-web, before the coord PR that writes them.

The gap
=======

``GET /coord/overlord/flow`` counts a STOPPED session that is missing from a
later full pass as closed (``closed_by: absent``) only when every pass in
between names one runner build (``runner_build``). A runner restart onto the
SAME build is invisible to that check: the pass ledger records the build a pass
screened and nothing that identifies the runner PROCESS. Measured 2026-11-02
(finding ``07ee0f09-ff6c-4247-8647-0e60757c3aa7``): one restart produced 49 of
49 ``closed_by: absent`` rows, all with the same duration.

A pass row records whether the session progressed since a ``/next-move`` nudge
(``progress_since_nudge``) but not WHICH ``/next-move`` it measured. A nudge that
was typed and never landed leaves the transcript's last ``/next-move`` as the
earlier one, so the next pass's measurement is credited to the later nudge.

Columns
=======

``coord.overlord_passes.runner_started_at TIMESTAMPTZ NULL``
    When the runner PROCESS the pass screened started, derived by triage as
    ``now - uptimeSeconds`` from the runner's ``/health``, read on both sides of
    the screen. NULL = not read, or the two reads disagreed past coord's
    tolerance (a restart during the screen). NULL is UNKNOWN, never "no
    restart": coord then refuses to read an absence as a close.

``coord.overlord_pass_rows.nudge_measured_at TIMESTAMPTZ NULL``
    The time of the ``/next-move`` prompt that ``progress_since_nudge`` was
    measured against. NULL = no measurement, or a row written before the field
    existed. coord credits a row's measurement to a nudge only when this is at
    or after the nudge row's ``observed_at``.

Nullable, no DEFAULT, no CHECK: the value is validated app-side and a NULL is
load-bearing.

Ordering
========

This revision must be APPLIED before the coord PR whose
``POST /coord/overlord/passes`` stores these columns deploys; that coord PR's
``schema.manifest`` bump to this revision is gated on it being the migrator
head. ``down_revision`` is the local single head at authoring time and is
re-pointed, not merged, if another revision lands first.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "overlord_04_runner_start_and_nudge_time"
down_revision: str | Sequence[str] | None = "coord_test_result_runs_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (table, column, DDL type) as data; the migration test pins these against the
# static SQL below, which spells the same columns as STATIC literals because
# coord's migration classifier can only inspect static op.execute literals.
_ADDED_COLUMNS: tuple[tuple[str, str, str], ...] = (
    ("overlord_passes", "runner_started_at", "TIMESTAMPTZ"),
    ("overlord_pass_rows", "nudge_measured_at", "TIMESTAMPTZ"),
)


def upgrade() -> None:
    """Add the two nullable columns and their comments, in one transaction."""
    # Bound the ACCESS EXCLUSIVE lock wait first (house style): a QUEUED lock
    # request blocks every reader of the table behind it. `alembic/env.py`
    # restores lock_timeout after each revision.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.overlord_passes
            ADD COLUMN IF NOT EXISTS runner_started_at TIMESTAMPTZ
        """
    )
    op.execute(
        """
        ALTER TABLE coord.overlord_pass_rows
            ADD COLUMN IF NOT EXISTS nudge_measured_at TIMESTAMPTZ
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.overlord_passes.runner_started_at IS
            'When the runner PROCESS this pass screened started: now minus '
            '/health uptimeSeconds, read by triage on both sides of the screen '
            '(plan 2026-11-02-overlord-flow-cannot-see-a-same-build-restart-and-'
            'credits-a-nudge-that-never-landed). NULL = not read, or the two reads '
            'disagreed past the tolerance (a restart during the screen). NULL is '
            'UNKNOWN, never no restart: an absence across it is not a close.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.overlord_pass_rows.nudge_measured_at IS
            'When the /next-move prompt that progress_since_nudge measured was '
            'sent. coord credits the measurement to a nudge only when this is at '
            'or after that nudge row''s observed_at. NULL = no measurement, or a '
            'row written before the field existed (read as today''s behaviour).'
        """
    )


def downgrade() -> None:
    """Drop the columns upgrade() added. Exact reverse; comments go with them."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.overlord_pass_rows
            DROP COLUMN IF EXISTS nudge_measured_at
        """
    )
    op.execute(
        """
        ALTER TABLE coord.overlord_passes
            DROP COLUMN IF EXISTS runner_started_at
        """
    )
