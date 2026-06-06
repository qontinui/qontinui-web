"""coord.gates — continuation-replay markers + pending partial index

Revision ID: replaycols_01_gates_continuation
Revises: chkguard_01_behind_default_count
Create Date: 2026-06-06

Phase 2b of plan
``D:/qontinui-root/plans/2026-06-06-agent-runtime-ws-flap-and-spawn-replay.md``
(agent-runtime WS-flap + spawn-replay — the missed-continuation replay surface).

When a gate's continuation is dispatched while the target device's relay WS is
flapping, the spawn is silently dropped (no replay). The coord side (already
coded, merges independently) records a *dispatched* marker on the gate and lets
the runner poll for an unconsumed continuation, then *acks* it once spawned.
This migration adds the four persisted fields that read/write path needs:

- ``continuation_dispatched_at TIMESTAMPTZ NULL`` — when coord emitted the gate
  continuation. NULL = no continuation dispatched (the overwhelming majority of
  gate rows).
- ``continuation_dispatched_payload JSONB NULL`` — the dispatched spawn payload
  the runner replays. Carries ``target_device_id`` (the pending-poll filter
  key, read as ``payload->>'target_device_id'``) among the spawn fields.
- ``continuation_consumed_at TIMESTAMPTZ NULL`` — when the runner acked the
  replayed continuation. NULL while pending; stamped once on ack.
- ``continuation_consumed_by UUID NULL`` — the device id that acked / consumed
  the continuation (audit + idempotent-ack guard).

Plus a partial index to serve the runner's pending-poll efficiently. The poll
read predicate is::

    continuation_dispatched_at IS NOT NULL
      AND continuation_consumed_at IS NULL
      AND continuation_dispatched_at > now() - interval '24 hours'
      AND continuation_dispatched_payload->>'target_device_id' = $1

The index predicate carries ONLY the stable, IMMUTABLE half::

    continuation_dispatched_at IS NOT NULL AND continuation_consumed_at IS NULL

CRITICAL: the index predicate MUST NOT reference ``now()`` (or any other
non-IMMUTABLE function). PostgreSQL rejects non-IMMUTABLE functions in a
partial-index predicate — this exact mistake shipped once and only surfaced
against a real PG (see ``reference_alembic_now_index_and_offline_sql_gap``).
The 24h freshness window therefore stays in the *query*, not the index; the
partial index already prunes to the small pending set, and ``> now() - 24h`` is
a cheap residual filter on that handful of rows. The index leads on
``continuation_dispatched_at`` so the query's ordering/recency filter rides the
index.

## House conventions followed

Raw ``op.execute`` with ``ADD COLUMN IF NOT EXISTS`` for the columns so the
migration is collision-safe against any canonical PG that might already carry
them from a self-heal mirror — same convention as the sibling
``coord_gates_observation_cols`` on this same table. The index uses
``op.create_index(... postgresql_where=sa.text(...))`` with ``schema="coord"``
(matching ``c0bdef_coord_build_events``'s partial-index posture); downgrade
drops it via ``DROP INDEX IF EXISTS coord.<name>`` then drops the four columns.

Touches **only** ``coord.gates`` (created earlier in this same linear chain by
``coord_singleauthored_01_gates``); makes no assumption about non-coord tables.

alembic is the SOLE author of ``coord.*`` schema
(``proj_alembic_sole_author_coord_schema``); the coord Rust binary asserts table
presence at boot and never authors DDL in production. These columns + index are
authored here, not in Rust.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
# NOTE: both ``revision`` and ``down_revision`` are RESERVED via a coord
# head-claim (resource_key=chkguard_01_behind_default_count) — do not re-derive
# from a later ``alembic heads``.
revision: str = "replaycols_01_gates_continuation"
down_revision: str | Sequence[str] | None = "coord_singleauthored_11_merge_class_columns"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE coord.gates
            ADD COLUMN IF NOT EXISTS continuation_dispatched_at TIMESTAMPTZ
        """
    )
    op.execute(
        """
        ALTER TABLE coord.gates
            ADD COLUMN IF NOT EXISTS continuation_dispatched_payload JSONB
        """
    )
    op.execute(
        """
        ALTER TABLE coord.gates
            ADD COLUMN IF NOT EXISTS continuation_consumed_at TIMESTAMPTZ
        """
    )
    op.execute(
        """
        ALTER TABLE coord.gates
            ADD COLUMN IF NOT EXISTS continuation_consumed_by UUID
        """
    )
    op.create_index(
        "ix_gates_continuation_pending",
        "gates",
        ["continuation_dispatched_at"],
        schema="coord",
        # IMMUTABLE-only predicate — NO now(); the 24h window lives in the query.
        postgresql_where=sa.text(
            "continuation_dispatched_at IS NOT NULL "
            "AND continuation_consumed_at IS NULL"
        ),
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.ix_gates_continuation_pending")
    op.execute("ALTER TABLE coord.gates DROP COLUMN IF EXISTS continuation_consumed_by")
    op.execute("ALTER TABLE coord.gates DROP COLUMN IF EXISTS continuation_consumed_at")
    op.execute(
        "ALTER TABLE coord.gates DROP COLUMN IF EXISTS continuation_dispatched_payload"
    )
    op.execute(
        "ALTER TABLE coord.gates DROP COLUMN IF EXISTS continuation_dispatched_at"
    )
