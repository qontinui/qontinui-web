"""consolidation phase 8: redo unify_runner_concepts on canonical schema

Revision ID: consolidation_phase8_01_unify_runner_concepts_redo
Revises: coord_phase_6_correlation_topics
Create Date: 2026-05-02

Re-applies the work that ``unify_runner_concepts`` (2026-04-22) was
supposed to land but was no-op'd during the consolidation transplant.
The original assumed the runner-native MIGRATIONS array had created
``runner.runner_connections`` / ``runner.runners``; on canonical PG
those tables came from the alembic chain in ``public`` (later moved to
``auth`` by Phase 7). Comments in ``unify_runner_concepts.py:225`` and
``consolidation_phase2_zz_final_runner_cleanup.py:25`` claimed the
end-state tables would be "created fresh by the consolidation chain" —
they weren't. As a result the ``Runner`` and ``RunnerSession`` ORM
models point at columns / a table that don't exist, and any query
through ``RunnerSession`` errors with ``relation "auth.runner_sessions"
does not exist``.

This revision redoes the original work, but starting from
``auth.runner_connections`` (post-Phase-7 location) instead of
``runner.runner_connections``:

1. Add the four liveness / OS columns to ``auth.runners`` that
   ``unify_runner_concepts`` step 1 was supposed to add:
   ``ws_session_id BIGINT``, ``ws_connected_at TIMESTAMPTZ``,
   ``os TEXT``, ``os_version TEXT``.
2. Add ``runner_id UUID`` to ``auth.runner_connections``.
3. Drop redundant columns ``runner_name``, ``runner_port``,
   ``user_agent`` (carried on ``auth.runners`` instead).
4. Promote ``runner_id`` to NOT NULL + add FK to ``auth.runners(id)
   ON DELETE CASCADE`` + index. The table is empty on canonical
   (verified ``SELECT count(*) = 0``) so no backfill / orphan-delete
   needed.
5. Convert ``id`` from ``INTEGER`` to ``BIGINT`` (and the underlying
   sequence) to match the model's ``BigInteger`` annotation.
6. Rename ``auth.runner_connections`` to ``auth.runner_sessions`` and
   the sequence / indexes to match.

The cross-schema FK
``project.software_test_runs.runner_connection_id → auth.runner_connections(id)``
follows the rename automatically (PG updates constraint references).
The model keeps the column name ``runner_connection_id`` per
``software_test_run.py:63-69``; only the FK target identity changes.

Idempotency: each step uses ``IF NOT EXISTS`` / ``IF EXISTS`` guards
so re-applying on an already-migrated DB is a no-op. On a fresh DB
that already has ``auth.runner_sessions`` (e.g. future schema squash),
the early-return at the top of upgrade skips the entire revision.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "consolidation_phase8_01_unify_runner_concepts_redo"
down_revision: str = "coord_phase_6_correlation_topics"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_UPGRADE_SQL = r"""
DO $$
DECLARE
    has_sessions BOOLEAN;
    has_connections BOOLEAN;
    row_count BIGINT;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'auth' AND table_name = 'runner_sessions'
    ) INTO has_sessions;

    IF has_sessions THEN
        RAISE NOTICE 'phase8_01: auth.runner_sessions already exists; skipping entire revision';
        RETURN;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'auth' AND table_name = 'runner_connections'
    ) INTO has_connections;

    IF NOT has_connections THEN
        RAISE EXCEPTION 'phase8_01: neither auth.runner_sessions nor auth.runner_connections exists; cannot proceed';
    END IF;

    -- Step 1: add liveness / OS columns to auth.runners.
    ALTER TABLE auth.runners ADD COLUMN IF NOT EXISTS ws_session_id BIGINT;
    ALTER TABLE auth.runners ADD COLUMN IF NOT EXISTS ws_connected_at TIMESTAMPTZ;
    ALTER TABLE auth.runners ADD COLUMN IF NOT EXISTS os TEXT;
    ALTER TABLE auth.runners ADD COLUMN IF NOT EXISTS os_version TEXT;

    COMMENT ON COLUMN auth.runners.ws_session_id IS
        'id of the open runner_sessions row while the runner''s WebSocket is connected; NULL when disconnected. Authoritative liveness signal — distinct from last_heartbeat (freshness).';
    COMMENT ON COLUMN auth.runners.ws_connected_at IS
        'When the current WebSocket session opened, NULL when offline.';
    COMMENT ON COLUMN auth.runners.os IS
        'Operating system family (''windows'' / ''macos'' / ''linux'').';
    COMMENT ON COLUMN auth.runners.os_version IS
        'Operating system version string.';

    -- Step 2: add runner_id (nullable for now) to auth.runner_connections.
    ALTER TABLE auth.runner_connections ADD COLUMN IF NOT EXISTS runner_id UUID;

    -- Step 3: drop redundant columns. CASCADE not needed — none of
    -- these are FK targets.
    ALTER TABLE auth.runner_connections DROP COLUMN IF EXISTS runner_name;
    ALTER TABLE auth.runner_connections DROP COLUMN IF EXISTS runner_port;
    ALTER TABLE auth.runner_connections DROP COLUMN IF EXISTS user_agent;

    -- Step 4: empty-table check, then promote runner_id to NOT NULL
    -- + add FK + index. Original unify_runner_concepts had a backfill
    -- step here; canonical has zero rows so we skip it. Bail loudly
    -- if that assumption is wrong.
    SELECT count(*) FROM auth.runner_connections INTO row_count;
    IF row_count > 0 THEN
        RAISE EXCEPTION 'phase8_01: auth.runner_connections has % rows; backfill not implemented for non-empty tables (see unify_runner_concepts.py for the original backfill logic)', row_count;
    END IF;

    ALTER TABLE auth.runner_connections ALTER COLUMN runner_id SET NOT NULL;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'runner_connections_runner_id_fkey'
          AND conrelid = 'auth.runner_connections'::regclass
    ) THEN
        ALTER TABLE auth.runner_connections
            ADD CONSTRAINT runner_connections_runner_id_fkey
            FOREIGN KEY (runner_id) REFERENCES auth.runners(id) ON DELETE CASCADE;
    END IF;

    CREATE INDEX IF NOT EXISTS ix_runner_connections_runner_id
        ON auth.runner_connections (runner_id);

    -- Step 5: id INTEGER -> BIGINT (and the owning sequence). Empty
    -- table makes this trivially safe.
    ALTER TABLE auth.runner_connections ALTER COLUMN id TYPE BIGINT;
    ALTER SEQUENCE auth.runner_connections_id_seq AS BIGINT;

    -- Step 6: rename table + sequence + indexes to runner_sessions.
    ALTER TABLE auth.runner_connections RENAME TO runner_sessions;
    ALTER SEQUENCE auth.runner_connections_id_seq RENAME TO runner_sessions_id_seq;

    -- Rename indexes that carry the old name. PK + FK indexes
    -- auto-renamed by PG; the explicit-named btree indexes don't.
    ALTER INDEX IF EXISTS auth.runner_connections_pkey
        RENAME TO runner_sessions_pkey;
    ALTER INDEX IF EXISTS auth.ix_runner_connections_connected_at
        RENAME TO ix_runner_sessions_connected_at;
    ALTER INDEX IF EXISTS auth.ix_runner_connections_user_id
        RENAME TO ix_runner_sessions_user_id;
    ALTER INDEX IF EXISTS auth.ix_runner_connections_runner_id
        RENAME TO ix_runner_sessions_runner_id;

    -- Rename the FK constraints we just added / preserved so their
    -- names match the table. Cosmetic but keeps psql \d output sane.
    ALTER TABLE auth.runner_sessions
        RENAME CONSTRAINT runner_connections_runner_id_fkey TO runner_sessions_runner_id_fkey;
    ALTER TABLE auth.runner_sessions
        RENAME CONSTRAINT runner_connections_user_id_fkey TO runner_sessions_user_id_fkey;

    RAISE NOTICE 'phase8_01: renamed auth.runner_connections -> auth.runner_sessions and added runners liveness columns';
END $$;
"""


_DOWNGRADE_SQL = r"""
DO $$
DECLARE
    has_sessions BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'auth' AND table_name = 'runner_sessions'
    ) INTO has_sessions;

    IF NOT has_sessions THEN
        RAISE NOTICE 'phase8_01 downgrade: auth.runner_sessions does not exist; nothing to revert';
        RETURN;
    END IF;

    -- Reverse step 6: rename back.
    ALTER TABLE auth.runner_sessions RENAME TO runner_connections;
    ALTER SEQUENCE auth.runner_sessions_id_seq RENAME TO runner_connections_id_seq;

    ALTER INDEX IF EXISTS auth.runner_sessions_pkey
        RENAME TO runner_connections_pkey;
    ALTER INDEX IF EXISTS auth.ix_runner_sessions_connected_at
        RENAME TO ix_runner_connections_connected_at;
    ALTER INDEX IF EXISTS auth.ix_runner_sessions_user_id
        RENAME TO ix_runner_connections_user_id;
    ALTER INDEX IF EXISTS auth.ix_runner_sessions_runner_id
        RENAME TO ix_runner_connections_runner_id;

    ALTER TABLE auth.runner_connections
        RENAME CONSTRAINT runner_sessions_runner_id_fkey TO runner_connections_runner_id_fkey;
    ALTER TABLE auth.runner_connections
        RENAME CONSTRAINT runner_sessions_user_id_fkey TO runner_connections_user_id_fkey;

    -- Reverse step 5: BIGINT -> INTEGER.
    ALTER TABLE auth.runner_connections ALTER COLUMN id TYPE INTEGER;
    ALTER SEQUENCE auth.runner_connections_id_seq AS INTEGER;

    -- Reverse step 4: drop FK + index, allow runner_id NULL.
    ALTER TABLE auth.runner_connections
        DROP CONSTRAINT IF EXISTS runner_connections_runner_id_fkey;
    DROP INDEX IF EXISTS auth.ix_runner_connections_runner_id;
    ALTER TABLE auth.runner_connections ALTER COLUMN runner_id DROP NOT NULL;

    -- Reverse step 3: re-add the dropped columns (nullable, no defaults).
    ALTER TABLE auth.runner_connections ADD COLUMN IF NOT EXISTS runner_name VARCHAR(255);
    ALTER TABLE auth.runner_connections ADD COLUMN IF NOT EXISTS runner_port INTEGER;
    ALTER TABLE auth.runner_connections ADD COLUMN IF NOT EXISTS user_agent VARCHAR(500);

    -- Reverse step 2: drop runner_id.
    ALTER TABLE auth.runner_connections DROP COLUMN IF EXISTS runner_id;

    -- Reverse step 1: drop the four liveness columns from auth.runners.
    ALTER TABLE auth.runners DROP COLUMN IF EXISTS os_version;
    ALTER TABLE auth.runners DROP COLUMN IF EXISTS os;
    ALTER TABLE auth.runners DROP COLUMN IF EXISTS ws_connected_at;
    ALTER TABLE auth.runners DROP COLUMN IF EXISTS ws_session_id;
END $$;
"""


def upgrade() -> None:
    op.execute(_UPGRADE_SQL)


def downgrade() -> None:
    op.execute(_DOWNGRADE_SQL)
