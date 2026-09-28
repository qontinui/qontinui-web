"""coord.data_plane_write_auth_daily — durable per-day auth observation of coord session writes

Revision ID: coord_dp_write_auth_daily_01
Revises: cinode_03_dispatch_pr_head_base_sha
Create Date: 2026-09-28

Phase 1 ("observe, durably") of plan
``2026-09-28-anyone-holding-a-session-uuid-can-write-its-transcript-because-session-output-and-event-writes-are-anonymous``.

One table, additive, coord-only.

## Why it exists

coord's ``POST /sessions/:id/output`` and ``POST /sessions/:id/events`` are
mounted on the base router with no auth extractor, so anyone holding a session
UUID can write that session's transcript. Before Phase 3 of the plan refuses a
non-owner, coord must know WHO writes today: which devices, on which runner
build, arrive as the session's owner, as a paired device that does not own the
row, as a non-paired bearer, with a bad token, or with no bearer at all.

coord's existing data-plane observation (``data_plane_observe.rs``) keeps
in-process atomics only. They reset on every deploy and production ``/metrics``
is not scraped, so the question "has every writer upgraded to the build that
presents a device token" cannot be answered from them. This table is the
durable form: coord accumulates in memory and upserts one row per key.

## What writes it, what reads it

* **Writer:** qontinui-coord ``data_plane_observe`` (Phase 1, coord half). It
  classifies each ``/output`` and ``/events`` request into an outcome and
  flushes ``count`` increments with
  ``INSERT ... ON CONFLICT (day, route, outcome, device_id, served_git_sha)
  DO UPDATE SET count = count + EXCLUDED.count, updated_at = now()``.
  A missing table degrades the flush to a warn and dropped counts; it never
  fails a request.
* **Reader:** coord ``coord_query_data_plane_write_auth`` and its HTTP twin
  ``GET /coord/agent-data-plane-write-auth?days=N``. The reader decides whether
  a device runs the Phase 2 runner build by git ancestry of ``served_git_sha``.

## Columns

* ``day DATE``              — UTC day the requests were observed.
* ``route TEXT``            — the observed data-plane route, e.g.
  ``session_output`` / ``session_events``. No CHECK: the closed set lives in
  the Rust ``DataPlaneRoute`` enum that writes it (the
  ``coord.notifications.kind`` convention).
* ``outcome TEXT``          — ``owner`` | ``non_owner`` | ``not_paired`` |
  ``no_tenant_claim`` | ``invalid_token`` | ``anonymous``. No CHECK, same
  reason.
* ``device_id UUID``        — the SESSION ROW's owning device
  (``coord.sessions.device_id``), not the caller. **Sentinel, not NULL:** the
  nil UUID ``00000000-0000-0000-0000-000000000000`` means "no session row"
  (the id named in the path does not exist).
* ``served_git_sha TEXT``   — that device's ``coord.devices.served_git_sha`` at
  flush time. **Sentinel, not NULL:** the empty string means the device
  reported no sha (or there is no device). A reader must treat it as UNKNOWN,
  never as "does not contain" a given commit.
* ``count BIGINT``          — requests observed for the key on that day.
* ``updated_at TIMESTAMPTZ`` — last flush that touched the row. The default
  covers INSERT only; there is no trigger, so the upsert sets it.

## Why sentinels and a plain PRIMARY KEY

``device_id`` and ``served_git_sha`` are part of the key, and PostgreSQL
forces PRIMARY KEY columns ``NOT NULL`` — a NULLable key column is a
self-contradictory DDL (the vet correction to the plan's draft). The
alternative, ``UNIQUE NULLS NOT DISTINCT``, needs PG15. Sentinels keep a plain
PRIMARY KEY that works on every supported PostgreSQL, and the COMMENTs below
state the sentinel meaning on the column so a reader of the catalog finds it.

The PRIMARY KEY leads on ``day``, which is also the reader's only filter
(``day >= current_date - N``), so no further index is created. Rows are bounded
by days x routes x outcomes x active devices x shas per device.

No retention sweep is added; the volume above is small and a prune is a
measured follow-up, not a speculative one.

## Ordering and auto-land

This revision lands and deploys BEFORE the coord change that writes it. coord
registers the table with ``require_table``, so a coord build that writes it
refuses to boot against an unmigrated database — the ordering guarantee.

Shaped to pass coord's merge-time additive-safety classifier (qontinui-coord
``crates/coord/src/pr_merge/migration_classifier.rs``): the upgrade path is one
``CREATE TABLE IF NOT EXISTS`` with a plain column list plus ``COMMENT ON``
statements with plain literal bodies, all as static SQL through ``op.execute``.
The only DROP is in ``downgrade()``, which the classifier does not read as the
upgrade path.

coord OWNS reads/writes of this table; web only authors the DDL. Per fleet
policy coord authors ZERO ``coord.*`` DDL, so THIS web migration is the sole
DDL author.

Chains off ``cinode_03_dispatch_pr_head_base_sha``, the single head of
``origin/main`` at authoring time. If a concurrent land moves the head before
this merges, re-point ``down_revision`` (and the ``Revises:`` line and the
test's pinned parent) onto the new head.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_dp_write_auth_daily_01"
down_revision: str | Sequence[str] | None = "cinode_03_dispatch_pr_head_base_sha"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every SQL string below is a STATIC literal. The coord merge-train migration
# classifier extracts string literals from each execute call and rejects a call
# with none as dynamic. Keep these comments free of apostrophes and of the
# op-dot-call spelling: the classifier lexer does not skip Python comments.
# The SQL bodies must also carry no colon-prefixed word such as a route path
# parameter: the execute call wraps its string in a SQLAlchemy text clause,
# which reads one as a bind parameter and fails the upgrade for want of a value.


def upgrade() -> None:
    """Create coord.data_plane_write_auth_daily and document its sentinels."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.data_plane_write_auth_daily (
            day             DATE        NOT NULL,
            route           TEXT        NOT NULL,
            outcome         TEXT        NOT NULL,
            device_id       UUID        NOT NULL,
            served_git_sha  TEXT        NOT NULL,
            count           BIGINT      NOT NULL,
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT data_plane_write_auth_daily_pkey
                PRIMARY KEY (day, route, outcome, device_id, served_git_sha)
        )
        """
    )

    op.execute(
        """
        COMMENT ON TABLE coord.data_plane_write_auth_daily IS
            'Per-day count of coord session data-plane writes (POST /sessions/{id}/output and /sessions/{id}/events) by auth outcome, keyed by the session row owning device and that device served_git_sha. Written by the coord module data_plane_observe (upsert that increments count); read by coord_query_data_plane_write_auth. Sentinels, not NULLs: device_id is the nil UUID when there is no session row, served_git_sha is the empty string when the device reported no sha. Plan 2026-09-28-anyone-holding-a-session-uuid-can-write-its-transcript-because-session-output-and-event-writes-are-anonymous, Phase 1.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.data_plane_write_auth_daily.route IS
            'The observed data-plane route, e.g. session_output | session_events. Text with no CHECK; the closed set lives in the Rust DataPlaneRoute enum that writes it.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.data_plane_write_auth_daily.outcome IS
            'owner | non_owner | not_paired | no_tenant_claim | invalid_token | anonymous. Text with no CHECK; the closed set lives in the Rust enum that writes it.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.data_plane_write_auth_daily.device_id IS
            'The owning device of the SESSION ROW (coord.sessions.device_id), not the caller. Sentinel: the nil UUID 00000000-0000-0000-0000-000000000000 means no session row exists for the id in the path. Never NULL, because it is part of the primary key.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.data_plane_write_auth_daily.served_git_sha IS
            'coord.devices.served_git_sha of that device at flush time. Sentinel: the empty string means the device reported no sha, or there is no device. A reader treats it as UNKNOWN, never as not containing a commit. Never NULL, because it is part of the primary key.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.data_plane_write_auth_daily.updated_at IS
            'The default covers INSERT only; there is no trigger, so the upsert must set it explicitly.'
        """
    )


def downgrade() -> None:
    """Drop coord.data_plane_write_auth_daily. Its comments go with it."""
    op.execute("DROP TABLE IF EXISTS coord.data_plane_write_auth_daily")
