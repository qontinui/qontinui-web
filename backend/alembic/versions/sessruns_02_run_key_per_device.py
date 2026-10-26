"""coord.session_runs — the run key is per device

Revision ID: sessruns_02_run_key_per_device
Revises: sessruns_01_session_runs
Create Date: 2026-10-26

Follow-up to ``sessruns_01_session_runs`` for plan
``2026-10-23-session-duration-by-work-type-and-per-device-session-load``
(D1), found by the runner-side review before any writer shipped.

The defect
==========

``sessruns_01`` keyed a run ``UNIQUE (tenant_id, claude_code_session_id,
run_seq)`` (``uq_session_runs_session_run``). ``run_seq`` is counted by the
runner lifecycle store of ONE device: a session handed off or respawned onto
another device starts ``run_seq`` 1 on that device for the same
``claude_code_session_id``, which collides with the source device run 1 and
would be refused (or, as an upsert, would overwrite the source run).

The fix
=======

The run key becomes ``UNIQUE (tenant_id, device_id, claude_code_session_id,
run_seq)`` (``uq_session_runs_device_session_run``). A run is per device:
``run_seq`` is an ordinal per device, a same-device resume takes the next one,
and a handed-off session has runs on each device it ran on, non-overlapping in
time. The table comment and the ``run_seq`` column comment are rewritten to
say so; ``downgrade()`` restores the old key and the old comments verbatim.

The re-point rule
=================

``down_revision`` is this repo single alembic head at authoring time and is
deliberately NOT pinned to it: ``alembic-graph-pr.yml`` serialises alembic PRs,
so a revision that lands ahead of this one re-forks the chain and this line is
re-pointed at the new head. Re-point it; do NOT author an ``alembic merge``
revision and do NOT order it with coord dependency labels.

Safety
======

``coord.session_runs`` is EMPTY in production when this lands: no writer is
deployed (the coord ingest of that plan Phase 3 and the runner emitter of
Phase 4 are unmerged), so building the new unique index scans no rows and the
constraint swap is instant. It is still one ``ALTER TABLE`` statement, so the
two keys are swapped atomically, under ``lock_timeout`` 3s so a lock wait fails
fast instead of queueing behind a long transaction.

Re-running is harmless: the statement drops BOTH constraint names ``IF
EXISTS`` before adding the new one, so a re-applied upgrade (or a partially
applied one) converges on the same single key. ``downgrade()`` is the mirror
image. On a non-empty table the downgrade can fail, by design: two devices may
legitimately hold the same ``(claude_code_session_id, run_seq)``, which the old
key cannot represent.

Merge-train classifier disposition
==================================

The verdict of the coord migration classifier
(``crates/coord/src/pr_merge/migration_classifier.rs``) on this file is
UNKNOWN: it was not run against it. An ``ALTER TABLE`` on an existing table
is not a new-table create, so ``AutoSafeIfNewTables`` is not expected; the
likely verdict is ``Reject`` (operator-reviewed land). Every SQL string is a
static literal, so no call is rejected as dynamic.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "sessruns_02_run_key_per_device"
down_revision: str | Sequence[str] | None = "sessruns_01_session_runs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every SQL string below is a STATIC literal. The coord merge-train migration
# classifier extracts string literals from each execute call and rejects a call
# with none as dynamic.


def upgrade() -> None:
    """Swap the run key to include device_id, and reword the two comments."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.session_runs
            DROP CONSTRAINT IF EXISTS uq_session_runs_session_run,
            DROP CONSTRAINT IF EXISTS uq_session_runs_device_session_run,
            ADD CONSTRAINT uq_session_runs_device_session_run
                UNIQUE (tenant_id, device_id, claude_code_session_id, run_seq)
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.session_runs IS
            'The durable session RUN record: one row per open-to-close interval of one runner lifecycle-store record on one device (one Claude session run), keyed (tenant_id, device_id, claude_code_session_id, run_seq), emitted by the runner at open and close, kept 400 days by coord. A session handed off or respawned onto another device has a run on each device it ran on, non-overlapping in time. Distinct from coord.sessions, which is presence (revived, reaped, pruned after 7 days) and cannot answer how long a run held a slot. Plan 2026-10-23-session-duration-by-work-type-and-per-device-session-load (D1).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.session_runs.run_seq IS
            'Run ordinal within one claude_code_session_id ON ONE DEVICE, starting at 1. A record re-opened on the same device after a close (boot resume, same-device handoff adoption) keeps the session id and takes the next run_seq, so wall time is never double-counted and a resume is visible. A session handed off or respawned onto another device starts at 1 there: it has runs on each device it ran on, non-overlapping in time.'
        """
    )


def downgrade() -> None:
    """Restore the sessruns_01 run key and its two comments verbatim."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.session_runs
            DROP CONSTRAINT IF EXISTS uq_session_runs_device_session_run,
            DROP CONSTRAINT IF EXISTS uq_session_runs_session_run,
            ADD CONSTRAINT uq_session_runs_session_run
                UNIQUE (tenant_id, claude_code_session_id, run_seq)
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.session_runs IS
            'The durable session RUN record: one row per open-to-close interval of one runner lifecycle-store record (one Claude session run), keyed (tenant_id, claude_code_session_id, run_seq), emitted by the runner at open and close, kept 400 days by coord. Distinct from coord.sessions, which is presence (revived, reaped, pruned after 7 days) and cannot answer how long a run held a slot. Plan 2026-10-23-session-duration-by-work-type-and-per-device-session-load (D1).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.session_runs.run_seq IS
            'Run ordinal within one claude_code_session_id, starting at 1. A record re-opened after a close (boot resume, handoff adoption) keeps the session id and takes the next run_seq, so wall time is never double-counted and a resume is visible.'
        """
    )
