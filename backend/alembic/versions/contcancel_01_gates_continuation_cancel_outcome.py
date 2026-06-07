"""coord.gates — continuation cancel + honest spawn-outcome columns

Revision ID: contcancel_01_gates_continuation_cancel_outcome
Revises: blast_radius_gate_cols_01
Create Date: 2026-06-07

Phase 1 of plan
``D:/qontinui-root/plans/2026-06-07-coord-continuation-cancel-and-outcome.md``
(coord gate-continuation lifecycle — cancel + honest spawn outcomes).

Extends ``replaycols_01_gates_continuation`` (the dispatch/consume replay
markers) with the lifecycle stamps the cancel route + the runner's honest
outcome ack need:

- ``continuation_cancelled_at TIMESTAMPTZ NULL`` — when a pending (dispatched,
  unconsumed) continuation was withdrawn. NULL = not cancelled (the
  overwhelming majority). Cancel governs only the post-dispatch window; a
  registered-but-not-yet-dispatched gate is withdrawn by muting/rejecting the
  GATE, not this column.
- ``continuation_cancelled_by TEXT NULL`` — the actor who cancelled. TEXT, NOT
  UUID, **intentionally**: the canceller is heterogeneous — a session
  owner-token subject, an operator bearer subject, or the ``_gate-registration``
  refresh path — so a UUID column would force lossy coercion or spurious NULLs.
  The sibling ``continuation_consumed_by`` IS UUID because its writer is ALWAYS
  a device (``req.device_id``). This asymmetry is deliberate (deciding priority:
  robustness > clean code); do NOT "normalize" this column to UUID.
- ``continuation_cancel_reason TEXT NULL`` — free-form reason (e.g.
  ``"taken over by session <id>"``). NULL = not cancelled.
- ``continuation_consumed_outcome TEXT NULL`` — the runner's HONEST spawn
  result, recorded after the terminal/headless session actually opened:
  ``spawned`` | ``spawn_failed: <detail>`` | NULL = a pre-outcome ack (the
  runner acked the claim but hasn't reported a result yet, or an older runner
  that never reports one). Distinguishes a genuinely-spawned continuation from
  silently-lost work that coord would otherwise record as merely "consumed".

## NO index change

``ix_gates_continuation_pending`` (from ``replaycols_01``) stays a SUPERSET:
its predicate is ``continuation_dispatched_at IS NOT NULL AND
continuation_consumed_at IS NULL``. The pending-poll's new ``AND
continuation_cancelled_at IS NULL`` filter is applied at QUERY time on the
handful of rows the partial index already prunes to — same posture as the
existing 24h freshness window (kept in the query, not the index, so the index
predicate stays IMMUTABLE-safe; see
``reference_alembic_now_index_and_offline_sql_gap``). Adding the cancelled
column to the predicate would stay IMMUTABLE-safe but buys nothing for the few
pending rows, so it is omitted. There is therefore nothing to drop on
downgrade beyond the four columns.

## House conventions followed

Raw ``op.execute`` with ``ADD COLUMN IF NOT EXISTS`` per column — mirrors the
sibling ``replaycols_01_gates_continuation`` exactly (collision-safe against any
canonical PG that already carries them from a self-heal mirror). Touches **only**
``coord.gates``; makes no assumption about non-coord tables. Downgrade drops the
four columns (no index to drop).

alembic is the SOLE author of ``coord.*`` schema
(``proj_alembic_sole_author_coord_schema``); the coord Rust binary asserts table
presence at boot and never authors DDL in production. coord Phase 2 reads these
columns best-effort (WARN, not crash-loop, if absent) so this migration MUST be
live before the coord deploy — same "web migration FIRST" rule as new coord.*
tables.

## Head reservation

Both ``revision`` and ``down_revision`` are RESERVED via a coord head-claim
(``kind=alembic_revision resource_key=blast_radius_gate_cols_01``, result
``claimed`` TTL 1800s, session ``4bbf3f51``) — do not re-derive from a later
``alembic heads``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
# NOTE: both ``revision`` and ``down_revision`` are RESERVED via a coord
# head-claim (resource_key=blast_radius_gate_cols_01) — do not re-derive from a
# later ``alembic heads``.
revision: str = "contcancel_01_gates_continuation_cancel_outcome"
down_revision: str | Sequence[str] | None = "blast_radius_gate_cols_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE coord.gates
            ADD COLUMN IF NOT EXISTS continuation_cancelled_at TIMESTAMPTZ
        """
    )
    # TEXT, NOT UUID — the canceller is heterogeneous (session owner-token /
    # operator bearer subject / refresh path). See the module docstring; do not
    # normalize to UUID.
    op.execute(
        """
        ALTER TABLE coord.gates
            ADD COLUMN IF NOT EXISTS continuation_cancelled_by TEXT
        """
    )
    op.execute(
        """
        ALTER TABLE coord.gates
            ADD COLUMN IF NOT EXISTS continuation_cancel_reason TEXT
        """
    )
    # spawned | spawn_failed: <detail> | NULL = pre-outcome ack.
    op.execute(
        """
        ALTER TABLE coord.gates
            ADD COLUMN IF NOT EXISTS continuation_consumed_outcome TEXT
        """
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE coord.gates DROP COLUMN IF EXISTS continuation_consumed_outcome"
    )
    op.execute(
        "ALTER TABLE coord.gates DROP COLUMN IF EXISTS continuation_cancel_reason"
    )
    op.execute(
        "ALTER TABLE coord.gates DROP COLUMN IF EXISTS continuation_cancelled_by"
    )
    op.execute(
        "ALTER TABLE coord.gates DROP COLUMN IF EXISTS continuation_cancelled_at"
    )
