"""coord.stream_consumer_dedup - consume-side idempotency keys for JetStream consumers

Revision ID: coord_stream_consumer_dedup_01
Revises: coord_ci_job_queue_waits_01
Create Date: 2026-11-22

Phase 1 of plan
``2026-11-22-deliveries-become-durable-github-intake-redelivery-sweep-and-jetstream-authority``
(design decisions D3 and D5). Additive: one new table.

## What writes it

``qontinui-coord`` ``consume_dedup`` (Phase 6), by every JetStream consumer
whose authority has flipped to ``jetstream``: before acting on a message it
INSERTs ``(consumer, event_key)`` ``ON CONFLICT DO NOTHING`` and skips the
message when no row was inserted. This absorbs a double publish (a crash
between publish and the ``processed_at`` stamp) and a redelivery that arrives
after the stream duplicate window.

## Retention

24 hours, ample for the five-attempt redelivery horizon. A coord worker
deletes rows with ``consumed_at`` older than 24 hours in capped batches (the
index below serves that scan).

## Column notes

Primary key ``(consumer, event_key)``: the claim key. ``consumed_at``
TIMESTAMPTZ NOT NULL DEFAULT now(). Index ``ix_stream_consumer_dedup_consumed``
on ``(consumed_at)``.

## No FK, no ORM model

Keys are opaque text chosen by each consumer. No SQLAlchemy model.

## Two-repo ordering

alembic in qontinui-web is the SOLE author of ``coord.*`` schema; this lands
and is applied before the coord PR (Phase 6) that writes the table.

## Head choice

Chains off ``coord_ci_job_queue_waits_01`` (same PR). Do not add an
``alembic merge``.

## Safety

``CREATE ... IF NOT EXISTS``, re-runnable ``COMMENT ON``; no existing table is
touched. ``downgrade()`` drops the index then the table, ``IF EXISTS``. Static
SQL, valid under ``alembic --sql``.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_stream_consumer_dedup_01"
down_revision: str | Sequence[str] | None = "coord_ci_job_queue_waits_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every SQL string below is a STATIC literal (coord merge-train classifier).


def upgrade() -> None:
    """Create coord.stream_consumer_dedup, its index and comments."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.stream_consumer_dedup (
            consumer     TEXT        NOT NULL,
            event_key    TEXT        NOT NULL,
            consumed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT stream_consumer_dedup_pkey PRIMARY KEY (consumer, event_key)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_stream_consumer_dedup_consumed
            ON coord.stream_consumer_dedup (consumed_at)
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.stream_consumer_dedup IS
            'Consume-side idempotency keys, one row per (consumer, event_key). Written by the coord module consume_dedup (INSERT ON CONFLICT DO NOTHING before acting) for each JetStream consumer whose authority is jetstream. Retained 24 hours by a coord worker. Plan 2026-11-22-deliveries-become-durable-github-intake-redelivery-sweep-and-jetstream-authority, Phase 1.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.stream_consumer_dedup.event_key IS
            'Opaque key chosen by the consumer, typically the X-GitHub-Delivery GUID or the stream message id.'
        """
    )


def downgrade() -> None:
    """Drop the index and coord.stream_consumer_dedup."""
    op.execute("DROP INDEX IF EXISTS coord.ix_stream_consumer_dedup_consumed")
    op.execute("DROP TABLE IF EXISTS coord.stream_consumer_dedup")
