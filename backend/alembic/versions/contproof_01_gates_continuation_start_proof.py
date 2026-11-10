"""coord.gates — continuation_start_proven_at / continuation_start_attempt

Revision ID: contproof_01_gates_continuation_start_proof
Revises: coord_ci_runs_head_sha_idx_01
Create Date: 2026-11-10

Phase 1 (web slice) of plan
``2026-11-10-coord-counts-a-gate-continuation-consumed-only-once-its-session-proves-it-started``.
Authored by alembic in ``qontinui-web`` — coord authors zero ``coord.*`` DDL
(served policy ``production-and-cost`` ``alembic-sole-authorship``).

## What this is for

Today a gate continuation counts as STARTED the moment the runner CLAIMS it:
``gates::mark_continuation_consumed`` calls ``sessions::claim_expected_session``
on the consume, before any process could have launched. On nilan, 2026-11-10,
a usage-limit account migration re-pinned gate ``40c60006``'s continuation onto
a pane whose ``claude`` binary was mid-reinstall; the pane exited 127 nine
seconds after spawn, and coord still held the continuation as consumed and its
session as started (coord finding ``5ac26e5e``).

The plan moves "started" onto an event only the launched CLI can cause — its
SessionStart hook, relayed by the runner to coord's
``POST /coord/agent-gates/{gate_id}/continuation-started`` receiver, accepted
only when the relayed ``claude_session_id`` equals the placeholder session's
bound ``claude_code_session_id``. Coord needs somewhere durable to record that
proof:

- ``continuation_start_proven_at TIMESTAMPTZ NULL`` — when coord accepted the
  start proof for the CURRENT attempt. NULL means "no proof yet" for a consumed
  continuation (or "not applicable" for an unconsumed one). The respawn receiver
  (``continuation-respawned``) sets it back to NULL so a re-pinned pane must
  prove its own start (plan D4).
- ``continuation_start_attempt INTEGER NULL`` — which attempt the last proof or
  respawn reset referred to, as reported by the runner. Lets a proof from an
  earlier pane be told apart from the current one.

## Why both are NULLABLE with no default

Unlike ``continuation_spawn_attempts`` (a counter read by ``<`` and therefore
``NOT NULL DEFAULT 0``), these are an EVENT stamp and the attempt that event
named. NULL is the honest value for every existing gate: no proof was ever
recorded for any of them, and inventing one (``now()``, ``0``) would make the
backfilled rows read as proven — the exact absence-is-not-zero failure the plan
exists to remove (served policy ``verification-and-evidence``
``unknown-must-not-render-as-a-default``). Adding a nullable column with no
default is metadata-only on PostgreSQL at any table size.

## NO index change

Phase 3's deadline scan is anchored on ``continuation_consumed_at`` age and the
consumed outcome, which already prune ``coord.gates`` to a handful of rows; the
``continuation_start_proven_at IS NULL`` term is applied to those. An index on a
column that is NULL for nearly every row and never the leading predicate would
cost a write on every proof and buy nothing — the same posture as
``contspawn_01`` and ``contstall_01``.

## House conventions followed

Raw ``op.execute`` with ``ADD COLUMN IF NOT EXISTS`` / ``DROP COLUMN IF EXISTS``
— mirrors ``contspawn_01_gates_continuation_spawn_attempts`` exactly
(collision-safe and order-safe against the separate coord consumer PR). Touches
only ``coord.*``, and every statement names its schema, which is what the
``alembic-schema-arg-gate`` pre-commit hook
(``.pre-commit-hooks/check_alembic_schema_args.py``) audits for raw
``op.execute`` SQL. Because both columns are nullable with no default, the
``IF NOT EXISTS`` idiom's known blind spot (it is idempotent in a column's
existence, not its constraints) has nothing to miss here.

Coord reads these columns only AFTER this migration is live ("web migration
FIRST", served policy ``production-and-cost`` ``alembic-sole-authorship``). The
coord side probes the column's presence and treats an absent column as proof
UNKNOWN, keeping today's claim-on-consume behaviour, so the two PRs are
order-safe either way.

Chains off the current single head ``coord_ci_runs_head_sha_idx_01`` (computed
from ``origin/main`` 4f5ea9f01 on 2026-11-10 with
``scripts/ci/count_alembic_heads.py``: exactly one head across 738 revisions).
coord re-points ``down_revision`` at land time if the head moves.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "contproof_01_gates_continuation_start_proof"
down_revision: str | Sequence[str] | None = "coord_ci_runs_head_sha_idx_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the continuation start-proof stamp and its attempt to coord.gates."""
    # When coord accepted the launched CLI's start proof for the current
    # attempt. NULL = unproven (the honest value for every existing row); the
    # respawn receiver resets it to NULL so a re-pinned pane proves its own
    # start.
    op.execute("""
        ALTER TABLE coord.gates
            ADD COLUMN IF NOT EXISTS continuation_start_proven_at TIMESTAMPTZ NULL
        """)
    # The runner-reported attempt the last proof (or respawn reset) named.
    op.execute("""
        ALTER TABLE coord.gates
            ADD COLUMN IF NOT EXISTS continuation_start_attempt INTEGER NULL
        """)


def downgrade() -> None:
    """Drop the continuation start-proof columns."""
    op.execute(
        "ALTER TABLE coord.gates DROP COLUMN IF EXISTS continuation_start_attempt"
    )
    op.execute(
        "ALTER TABLE coord.gates DROP COLUMN IF EXISTS continuation_start_proven_at"
    )
