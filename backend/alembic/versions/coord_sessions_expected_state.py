"""coord.sessions — `expected` lifecycle state + expected_at (Phase 4 reconcile)

Revision ID: coord_sessions_expected_state
Revises: coord_sessions_progress_status
Create Date: 2026-06-24

Phase 4 of plan ``D:/qontinui-root/plans/
2026-06-24-coord-session-progress-and-stall-detection.md``.

Unifies the Phase-1 continuation-stall detection with the session model: a
dispatched continuation now registers a DURABLE ``state='expected'`` child
session (``coord.sessions``) that must transition ``expected → active`` when the
continuation is consumed. A row that lingers in ``expected`` past
``COORD_EXPECTED_SESSION_STALL_SECS`` (default 600s) is a never-started
continuation — detected as a session stall by the Phase-3 watcher's SEPARATE
expected-branch.

Two schema changes:

1. ``expected_at TIMESTAMPTZ NULL`` — when the ``expected`` row was created (at
   continuation dispatch). NULL for ordinary sessions. Kept OUT of coord's shared
   SELECT (``SESSION_COLUMNS``) and read best-effort, EXACTLY like the Phase-2
   progress columns, so coord deployed AHEAD of this migration is unaffected
   (any ``42703 undefined_column`` degrades to ``None`` / a no-op, never a query
   failure). The expected-row INSERT in ``gates::spawn_continuation`` is itself
   best-effort / fail-open, so a pre-migration coord simply does not create the
   expected trail — the gate-column dispatch journal + the Phase-1 sweeper remain
   the primary durability path.

2. The ``sessions_state_check`` CHECK constraint — ``coord.sessions.state`` is
   ``TEXT`` but constrained by a CHECK (authored in ``coord_session_substrate.py``)
   to ``('active','pending_resolution','stale','closed')``. It MUST be widened to
   admit ``'expected'`` or the expected-row INSERT would be rejected. We DROP and
   re-ADD the constraint with the new value set. (This is the one schema spot
   that is NOT plain TEXT — ``session_status`` by contrast has no DB CHECK, so the
   Phase-2 ``stalled`` vocabulary needed no constraint change.)

Stall-scan index: the Phase-4 watcher scans
``WHERE state='expected' AND expected_at < now() - interval ...`` — a partial
index on ``(expected_at) WHERE state='expected'`` mirrors the
``coord_sessions_active_progress_idx`` posture (``coord_sessions_progress_status``)
and keeps the watcher off a full-table scan.

Raw ``op.execute`` with ``ADD COLUMN IF NOT EXISTS`` / ``DROP CONSTRAINT IF
EXISTS`` — the collision-safe convention used by the other coord.* migrations.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_sessions_expected_state"
down_revision: str | Sequence[str] | None = "coord_sessions_progress_status"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    # 1. The expected-lifecycle timestamp (nullable, fail-open like the Phase-2
    #    progress columns).
    op.execute(
        "ALTER TABLE coord.sessions ADD COLUMN IF NOT EXISTS expected_at TIMESTAMPTZ"
    )
    # 2. Widen the state CHECK to admit 'expected'. DROP-then-ADD (idempotent):
    #    the constraint name is the one authored in coord_session_substrate.py.
    op.execute(
        "ALTER TABLE coord.sessions DROP CONSTRAINT IF EXISTS sessions_state_check"
    )
    op.execute(
        "ALTER TABLE coord.sessions ADD CONSTRAINT sessions_state_check "
        "CHECK (state IN ("
        "'expected',"
        "'active',"
        "'pending_resolution',"
        "'stale',"
        "'closed'"
        "))"
    )
    # 3. Partial index for the Phase-4 expected-stall scan
    #    (WHERE state='expected' AND expected_at < now() - interval ...).
    op.execute(
        "CREATE INDEX IF NOT EXISTS coord_sessions_expected_idx "
        "ON coord.sessions (expected_at) WHERE state = 'expected'"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.coord_sessions_expected_idx")
    # Restore the pre-Phase-4 CHECK (no 'expected'). Any 'expected' rows must be
    # resolved out of that state before downgrading; this re-narrows the domain.
    op.execute(
        "ALTER TABLE coord.sessions DROP CONSTRAINT IF EXISTS sessions_state_check"
    )
    op.execute(
        "ALTER TABLE coord.sessions ADD CONSTRAINT sessions_state_check "
        "CHECK (state IN ("
        "'active',"
        "'pending_resolution',"
        "'stale',"
        "'closed'"
        "))"
    )
    op.execute("ALTER TABLE coord.sessions DROP COLUMN IF EXISTS expected_at")
