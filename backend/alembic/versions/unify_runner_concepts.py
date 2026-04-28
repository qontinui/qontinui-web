"""unify runner concepts

Revision ID: unify_runner_concepts
Revises: e8a3c5b9d142
Create Date: 2026-04-22

Phase 2 of unified-runner-architecture (see
``qontinui-dev-notes/development/unified-runner-architecture.md``).

Collapses the historical three-table ``runner`` model
(``runners`` + ``runner_connections`` + ``runner_devices``) into a
single canonical ``runners`` table backed by a session-history table.

Changes
-------

1. Add liveness / OS columns to ``runner.runners``:
   * ``ws_session_id`` BIGINT NULL — id of the open WS session row
     (non-null while the runner's WebSocket is open).
   * ``ws_connected_at`` TIMESTAMPTZ NULL — when the WS opened.
   * ``os`` TEXT NULL — OS family ("windows" / "macos" / "linux").
   * ``os_version`` TEXT NULL — OS version string.

2. Backfill ``runner.runners`` rows from any open
   ``runner.runner_connections`` rows (``disconnected_at IS NULL``).
   Match on ``(user_id, runner_name)`` with a ``MAX(connected_at)``
   tiebreaker for duplicates. If a matching ``runners`` row exists,
   stamp its ``ws_session_id``; otherwise insert a new row using the
   connection's ``runner_name`` as the runner ``name``.

3. Rename ``runner.runner_connections`` → ``runner.runner_sessions``.
   Drop the now-redundant columns (``runner_name``, ``runner_port``,
   ``user_agent``) carried on ``runners`` instead. Add ``runner_id
   UUID NOT NULL`` FK to ``runner.runners(id) ON DELETE CASCADE``,
   backfilled from step 2. Sessions that fail to find a ``runners``
   parent are deleted (orphans).

4. Drop ``runner.runner_devices`` entirely — legacy desktop
   registration, fully superseded by the unified ``runners`` model.

Schema preconditions
--------------------
This migration assumes the qontinui-runner's native migration v20
has already run on the target DB (``ALTER TABLE … SET SCHEMA
runner``). The ``runner`` schema must exist with ``runner.runners``
and ``runner.runner_connections`` present. On a fresh DB volume,
launch the qontinui-runner once before applying this revision.

Idempotency
-----------
``op.add_column`` calls fail loudly on re-add. The backfill, rename,
and drop SQL is wrapped in DO-blocks that early-return when the
target state is already in place, so ``alembic upgrade head`` can be
re-run without spurious errors after a partial apply.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "unify_runner_concepts"
down_revision: str = "e8a3c5b9d142"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# ---------------------------------------------------------------------------
# Backfill SQL — runs *after* the new columns are added on runners and
# *before* the rename of runner_connections (which renames runner_name
# out of existence). Idempotent: stamping ws_session_id twice is a
# no-op when the value already matches.
# ---------------------------------------------------------------------------
_BACKFILL_FROM_CONNECTIONS = """
DO $$
DECLARE
    inserted INT := 0;
    stamped  INT := 0;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'runner' AND table_name = 'runner_connections'
    ) THEN
        RAISE NOTICE 'runner.runner_connections missing; skipping backfill';
        RETURN;
    END IF;

    -- Build a temp table of the most-recent open connection per
    -- (user_id, runner_name). NULL runner_name rows are skipped — we
    -- have no name to upsert onto runners.name.
    CREATE TEMP TABLE _open_conns ON COMMIT DROP AS
    SELECT DISTINCT ON (c.user_id, c.runner_name)
        c.id            AS conn_id,
        c.user_id       AS user_id,
        c.runner_name   AS runner_name,
        c.runner_port   AS runner_port,
        c.ip_address    AS ip_address,
        c.connected_at  AS connected_at
    FROM runner.runner_connections c
    WHERE c.disconnected_at IS NULL
      AND c.runner_name IS NOT NULL
    ORDER BY c.user_id, c.runner_name, c.connected_at DESC;

    -- Insert rows for connections that don't have a matching runners row.
    INSERT INTO runner.runners (
        user_id, name, hostname, port, capabilities,
        server_mode, restate_enabled, restate_healthy,
        last_heartbeat, status, created_at,
        ws_session_id, ws_connected_at
    )
    SELECT
        o.user_id,
        o.runner_name,
        COALESCE(o.ip_address, 'unknown'),
        COALESCE(o.runner_port, 0),
        '[]'::jsonb,
        false,
        false,
        false,
        o.connected_at,
        'healthy',
        o.connected_at,
        o.conn_id,
        o.connected_at
    FROM _open_conns o
    WHERE NOT EXISTS (
        SELECT 1 FROM runner.runners r
        WHERE r.user_id = o.user_id AND r.name = o.runner_name
    );
    GET DIAGNOSTICS inserted = ROW_COUNT;

    -- Stamp ws_session_id / ws_connected_at on the matched runners rows.
    UPDATE runner.runners r
    SET ws_session_id = o.conn_id,
        ws_connected_at = o.connected_at
    FROM _open_conns o
    WHERE r.user_id = o.user_id
      AND r.name = o.runner_name
      AND (r.ws_session_id IS DISTINCT FROM o.conn_id);
    GET DIAGNOSTICS stamped = ROW_COUNT;

    RAISE NOTICE 'Backfill: inserted % runner rows, stamped % existing rows',
        inserted, stamped;
END $$;
"""


# ---------------------------------------------------------------------------
# Reshape SQL: backfill runner_id on the renamed table, drop orphans, then
# promote runner_id to NOT NULL + add FK + index. Runs *after* the
# alembic-helper rename and *before* dropping the redundant columns.
# Idempotent on re-run.
# ---------------------------------------------------------------------------
_BACKFILL_RUNNER_ID = """
DO $$
DECLARE
    orphan_count INT;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'runner' AND table_name = 'runner_sessions'
    ) THEN
        RAISE NOTICE 'runner.runner_sessions missing; skipping runner_id backfill';
        RETURN;
    END IF;

    -- Backfill runner_id by matching on (user_id, runner_name). The
    -- runner_name column is still present at this stage (we drop it
    -- below in the alembic-helper step).
    UPDATE runner.runner_sessions s
    SET runner_id = r.id
    FROM runner.runners r
    WHERE s.runner_id IS NULL
      AND r.user_id = s.user_id
      AND r.name = s.runner_name;

    -- Sessions that still have NULL runner_id are orphans (no matching
    -- (user_id, runner_name) pair on runners). Delete them — they
    -- have no logical owner and cannot satisfy the NOT NULL promotion.
    DELETE FROM runner.runner_sessions WHERE runner_id IS NULL;
    GET DIAGNOSTICS orphan_count = ROW_COUNT;
    IF orphan_count > 0 THEN
        RAISE NOTICE 'Deleted % orphan runner_sessions rows '
            '(no matching (user_id, runner_name) on runners)',
            orphan_count;
    END IF;
END $$;
"""


# ---------------------------------------------------------------------------
# Drop runner_devices entirely. Wrapped in a DO block to handle the
# (unlikely) case where the table doesn't exist on a partially-applied
# DB.
# ---------------------------------------------------------------------------
_DROP_RUNNER_DEVICES = """
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'runner' AND table_name = 'runner_devices'
    ) THEN
        DROP TABLE runner.runner_devices CASCADE;
        RAISE NOTICE 'Dropped runner.runner_devices CASCADE';
    ELSE
        RAISE NOTICE 'runner.runner_devices not present; nothing to drop';
    END IF;
END $$;
"""


def upgrade() -> None:
    # 1. Add liveness / OS columns to runner.runners.
    op.add_column(
        "runners",
        sa.Column("ws_session_id", sa.BigInteger(), nullable=True),
        schema="runner",
    )
    op.add_column(
        "runners",
        sa.Column("ws_connected_at", sa.DateTime(timezone=True), nullable=True),
        schema="runner",
    )
    op.add_column(
        "runners",
        sa.Column("os", sa.Text(), nullable=True),
        schema="runner",
    )
    op.add_column(
        "runners",
        sa.Column("os_version", sa.Text(), nullable=True),
        schema="runner",
    )

    # 2. Backfill ws_session_id from any open runner_connections rows.
    op.execute(_BACKFILL_FROM_CONNECTIONS)

    # 3. Rename runner_connections -> runner_sessions, then reshape.
    op.rename_table(
        "runner_connections",
        "runner_sessions",
        schema="runner",
    )
    # Add nullable runner_id; backfill; drop orphans; then promote NOT NULL.
    op.add_column(
        "runner_sessions",
        sa.Column("runner_id", postgresql.UUID(as_uuid=True), nullable=True),
        schema="runner",
    )
    op.execute(_BACKFILL_RUNNER_ID)
    op.alter_column(
        "runner_sessions",
        "runner_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=False,
        schema="runner",
    )
    op.create_foreign_key(
        "runner_sessions_runner_id_fkey",
        "runner_sessions",
        "runners",
        ["runner_id"],
        ["id"],
        source_schema="runner",
        referent_schema="runner",
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_runner_sessions_runner_id",
        "runner_sessions",
        ["runner_id"],
        schema="runner",
    )

    # Drop the now-redundant columns now carried on runners.
    op.drop_column("runner_sessions", "runner_name", schema="runner")
    op.drop_column("runner_sessions", "runner_port", schema="runner")
    op.drop_column("runner_sessions", "user_agent", schema="runner")

    # 4. Drop runner_devices entirely.
    op.execute(_DROP_RUNNER_DEVICES)


def downgrade() -> None:
    """Best-effort downgrade.

    Restores the renamed table to ``runner_connections``, re-adds the
    dropped columns as NULL, and recreates an empty ``runner_devices``
    shell. Backfilled ``runner.runners`` rows are intentionally NOT
    removed — they're harmless extra fleet entries and there's no clean
    way to distinguish migration-created rows from legitimate ones.
    Cannot restore ``runner_devices`` row contents.
    """
    # Re-add dropped columns on runner_sessions before dropping the FK.
    op.add_column(
        "runner_sessions",
        sa.Column("runner_name", sa.String(length=255), nullable=True),
        schema="runner",
    )
    op.add_column(
        "runner_sessions",
        sa.Column("runner_port", sa.Integer(), nullable=True),
        schema="runner",
    )
    op.add_column(
        "runner_sessions",
        sa.Column("user_agent", sa.String(length=500), nullable=True),
        schema="runner",
    )

    # Repopulate runner_name from the parent runner row before losing the FK.
    op.execute(
        """
        UPDATE runner.runner_sessions s
        SET runner_name = r.name
        FROM runner.runners r
        WHERE s.runner_id = r.id
        """
    )

    # Drop FK + index + runner_id column.
    op.drop_index(
        "ix_runner_sessions_runner_id",
        table_name="runner_sessions",
        schema="runner",
    )
    op.drop_constraint(
        "runner_sessions_runner_id_fkey",
        "runner_sessions",
        schema="runner",
        type_="foreignkey",
    )
    op.drop_column("runner_sessions", "runner_id", schema="runner")

    # Rename back.
    op.rename_table(
        "runner_sessions",
        "runner_connections",
        schema="runner",
    )

    # Drop the new columns from runners.
    op.drop_column("runners", "os_version", schema="runner")
    op.drop_column("runners", "os", schema="runner")
    op.drop_column("runners", "ws_connected_at", schema="runner")
    op.drop_column("runners", "ws_session_id", schema="runner")

    # Recreate an empty runner_devices shell — best effort.
    op.create_table(
        "runner_devices",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("device_id", sa.String(length=255), nullable=False),
        sa.Column("device_name", sa.String(length=255), nullable=False),
        sa.Column("platform", sa.String(length=50), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("device_id"),
        schema="runner",
    )
