"""coord.process_events + relations + watermarks — the factory's own event log

Revision ID: coord_proclog_01
Revises: coord_agent_worktrees_client_allocation_id_01
Create Date: 2026-10-12

Phase 1 of plan ``2026-10-11-process-twin-event-log-and-flow-metrics``
(VETTED 2026-10-12). coord authors **zero** DDL
(``[policy: alembic-sole-authorship]``), so every table the plan reads lands
here, in qontinui-web, and must be **applied in production before any coord
read of it deploys** (coord's projector is Phase 2; every coord read degrades
to UNKNOWN on 42P01 until then). ``down_revision`` is this repo's local single
alembic head; re-point it if another revision lands first — never author an
``alembic merge`` revision for it.

The gap
=======

coord holds ~40 process-relevant stores (work units, gates, sessions, merge
proposals, PR events, scheduler ticks, claims audit, operator touches, …),
each with its own key space, timestamp meaning and retention — the scheduler
ring is 48 h, closed sessions are pruned after 7 d. There is no durable,
joined event log of the factory itself, so flow metrics, conformance and
process forecasts have nothing to read. This revision creates that log in the
OCEL 2.0 relational shape (plan D3): one row per event, one row per
event–object relation (E2O), one row per object–object relation (O2O).

Tables
======

``coord.process_events`` — one row per lifecycle-significant event.
    ``tenant_id`` is NULL only for a fleet-scope event (the tick-scope
    ``train.occupancy_hourly`` rows, plan D5); the idempotency key is therefore
    ``UNIQUE NULLS NOT DISTINCT (tenant_id, source, source_key)`` — a plain
    UNIQUE would let every fleet-scope replay insert a duplicate, since NULLs
    compare distinct. Every projector write is ``INSERT … ON CONFLICT (tenant_id,
    source, source_key) DO NOTHING`` against that index. ``activity`` is a
    closed vocabulary owned by coord's code, so it takes no CHECK here (a new
    activity must not need a migration). ``evidence_tier`` and ``time_basis``
    are closed categorical labels and DO take CHECKs: an evidence tier is a
    label, never a number (``[policy: unknown-must-not-render-as-a-default]``).
    ``(occurred_at)`` is the age index the batched retention delete needs.

``coord.process_event_objects`` — E2O. ``occurred_at`` is denormalised from
    the event so a per-object trace is one index range scan on
    ``(tenant_id, object_type, object_id, occurred_at)``. Rows cascade with
    their event, so the warm-tier retention sweep deletes events only.

``coord.process_object_links`` — O2O, upserted: a re-observation moves
    ``last_observed_at``. Only ``resolved`` and ``ambiguous`` resolutions are
    links (plan D5); anything else stays in the event's ``attrs``. Keyed
    ``NULLS NOT DISTINCT`` for the same reason as the events.
    ``(last_observed_at)`` serves its retention prune (Phase 5); the reverse
    ``(tenant_id, to_type, to_id)`` index serves the "which PRs implement this
    work unit" direction the unique key's prefix cannot.

``coord.process_log_watermarks`` — one row per ``(source, stamp column)`` the
    projector pages on (plan D1: most sources have several independent
    lifecycle stamps and no single monotone "changed at"). ``completed_at`` is
    set by a one-shot source such as Phase 4's JetStream replay.

No FK to tenants, and no trigger: this is an observation log, and a
best-effort insert must never fail for referential bookkeeping (the
``coordtouch_01_operator_touches`` rationale); triggers on source tables were
rejected in plan D1 because a twin bug would then fail a business write.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_proclog_01"
down_revision: str | Sequence[str] | None = "coord_agent_worktrees_client_allocation_id_01"  # fmt: skip
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the four log tables and their indexes. Idempotent; no rows."""
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")

    # ------------------------------------------------------------------
    # Events.
    # ------------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.process_events (
            event_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id      UUID NULL,
            activity       TEXT NOT NULL,
            occurred_at    TIMESTAMPTZ NOT NULL,
            recorded_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            source         TEXT NOT NULL,
            source_key     TEXT NOT NULL,
            actor          TEXT NULL,
            evidence_tier  TEXT NOT NULL,
            time_basis     TEXT NOT NULL,
            attrs          JSONB NOT NULL DEFAULT '{}'::jsonb
        )
        """
    )
    # Dropped-then-added so a re-run converges on the current CHECK body.
    op.execute(
        """
        ALTER TABLE coord.process_events
            DROP CONSTRAINT IF EXISTS ck_process_events_evidence_tier
        """
    )
    op.execute(
        """
        ALTER TABLE coord.process_events
            ADD CONSTRAINT ck_process_events_evidence_tier
            CHECK (evidence_tier IN ('coord_observed', 'derived',
                                     'agent_reported', 'operator'))
        """
    )
    op.execute(
        """
        ALTER TABLE coord.process_events
            DROP CONSTRAINT IF EXISTS ck_process_events_time_basis
        """
    )
    op.execute(
        """
        ALTER TABLE coord.process_events
            ADD CONSTRAINT ck_process_events_time_basis
            CHECK (time_basis IN ('event', 'insert', 'observed', 'declared'))
        """
    )
    # The idempotency key and every projector write's ON CONFLICT target.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_process_events_source_key
            ON coord.process_events (tenant_id, source, source_key)
            NULLS NOT DISTINCT
        """
    )
    # A tenant's events in time order: the flow, conformance and export reads.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_process_events_tenant_occurred_at
            ON coord.process_events (tenant_id, occurred_at)
        """
    )
    # The age index the batched warm-tier retention delete pages on.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_process_events_occurred_at
            ON coord.process_events (occurred_at)
        """
    )

    # ------------------------------------------------------------------
    # Event-to-object relations (E2O).
    # ------------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.process_event_objects (
            event_id     UUID NOT NULL
                REFERENCES coord.process_events(event_id) ON DELETE CASCADE,
            tenant_id    UUID NULL,
            object_type  TEXT NOT NULL,
            object_id    TEXT NOT NULL,
            qualifier    TEXT NOT NULL,
            occurred_at  TIMESTAMPTZ NOT NULL,
            PRIMARY KEY (event_id, object_type, object_id, qualifier)
        )
        """
    )
    # A per-object trace, and a per-type fold, as one index range scan.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_process_event_objects_object_trace
            ON coord.process_event_objects
               (tenant_id, object_type, object_id, occurred_at)
        """
    )

    # ------------------------------------------------------------------
    # Object-to-object relations (O2O).
    # ------------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.process_object_links (
            link_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id          UUID NULL,
            from_type          TEXT NOT NULL,
            from_id            TEXT NOT NULL,
            to_type            TEXT NOT NULL,
            to_id              TEXT NOT NULL,
            qualifier          TEXT NOT NULL,
            resolution         TEXT NOT NULL,
            source             TEXT NOT NULL,
            first_observed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_observed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        ALTER TABLE coord.process_object_links
            DROP CONSTRAINT IF EXISTS ck_process_object_links_resolution
        """
    )
    op.execute(
        """
        ALTER TABLE coord.process_object_links
            ADD CONSTRAINT ck_process_object_links_resolution
            CHECK (resolution IN ('resolved', 'ambiguous'))
        """
    )
    # The upsert key: a re-observation of the same link from the same source
    # moves last_observed_at instead of inserting a second row.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_process_object_links_link
            ON coord.process_object_links
               (tenant_id, from_type, from_id, to_type, to_id, qualifier, source)
            NULLS NOT DISTINCT
        """
    )
    # The reverse direction (to -> from) the unique key's prefix cannot serve.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_process_object_links_to
            ON coord.process_object_links (tenant_id, to_type, to_id)
        """
    )
    # The retention prune (Phase 5).
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_process_object_links_last_observed_at
            ON coord.process_object_links (last_observed_at)
        """
    )

    # ------------------------------------------------------------------
    # Projector watermarks, one per (source, stamp column).
    # ------------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.process_log_watermarks (
            source           TEXT NOT NULL,
            stamp            TEXT NOT NULL,
            watermark_ts     TIMESTAMPTZ NULL,
            watermark_key    TEXT NULL,
            rows_projected   BIGINT NOT NULL DEFAULT 0,
            late_rows_found  BIGINT NOT NULL DEFAULT 0,
            last_error       TEXT NULL,
            completed_at     TIMESTAMPTZ NULL,
            updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (source, stamp)
        )
        """
    )


def downgrade() -> None:
    """Drop the four tables. Relations first; their indexes go with them."""
    op.execute("DROP TABLE IF EXISTS coord.process_log_watermarks")
    op.execute("DROP TABLE IF EXISTS coord.process_object_links")
    op.execute("DROP TABLE IF EXISTS coord.process_event_objects")
    op.execute("DROP TABLE IF EXISTS coord.process_events")
