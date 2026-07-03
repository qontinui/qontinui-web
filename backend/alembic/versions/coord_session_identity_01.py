"""coord session-identity registry: derived_name/search_text + sessions join key

Revision ID: coord_session_identity_01
Revises: coord_phase_5_01_agent_worktrees_work_unit_id
Create Date: 2026-07-02

P1/P2 of plan ``2026-07-02-digital-twin-session-identity-registry``.

Purely additive coord-schema changes (qontinui-web alembic is the sole
author of ``coord.*`` DDL; coord Rust only reads/writes):

* ``coord.agent_sessions.derived_name TEXT`` — a human-readable name
  derived coord-side from session context (plan slug / intent / repo).
  NOT unique by design: two sessions doing the same kind of work may
  derive the same name; disambiguation is by id/first_seen. Backfill is
  deliberately NOT done here — the derivation function lives in coord
  Rust only (single implementation), and coord backfills at boot.

* ``coord.agent_sessions.search_text TEXT`` — free-text search fodder
  (intent, plan slug, repo list, ...) coord maintains alongside the
  derived name.

* btree index on ``derived_name`` (non-unique — name lookups) and a GIN
  FTS expression index over ``label || derived_name || search_text``
  (same pattern as ``consolidation_phase1_04_workflows.py``'s
  ``idx_uw_fts``).

* ``coord.sessions.claude_code_session_id UUID`` — join key to
  ``coord.agent_sessions.id``. Deliberately NOT a FK: at
  session-create time the ``agent_sessions`` row may not exist yet
  (the two rows are written by independent ingest paths), and the join
  is forensic — a dangling id must not block a session insert. Partial
  index on the non-NULL subset (joins always start from a known
  session UUID).

Idempotency: mirrors ``coord_agent_session_id_lineage`` — every
statement is guarded by ``to_regclass`` + ``IF NOT EXISTS`` so the
migration is rerunnable against any state the canonical PG might be in
(a partially-bootstrapped dev DB does not blow up, and a coord-side
self-heal that raced ahead does not double-add).

``down_revision`` was ASSIGNED by coord's migration-reserve
(reservation c507152d-1db9-42a3-9ede-c1247a655c10, position 1) — do
not re-point at a locally computed head.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_session_identity_01"
down_revision: str = "coord_phase_5_01_agent_worktrees_work_unit_id"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # coord.agent_sessions — derived_name + search_text + indexes.
    # ------------------------------------------------------------------
    op.execute(
        """
        DO $$
        BEGIN
            IF to_regclass('coord.agent_sessions') IS NOT NULL THEN
                EXECUTE 'ALTER TABLE coord.agent_sessions '
                        'ADD COLUMN IF NOT EXISTS derived_name TEXT';
                EXECUTE 'ALTER TABLE coord.agent_sessions '
                        'ADD COLUMN IF NOT EXISTS search_text TEXT';
                -- Non-unique btree: name lookups; names can collide by
                -- design (disambiguate by id / first_seen).
                EXECUTE 'CREATE INDEX IF NOT EXISTS '
                        'idx_agent_sessions_derived_name '
                        'ON coord.agent_sessions (derived_name)';
                -- GIN FTS over the three human-searchable text fields.
                -- Expression index — alembic's create_index doesn't
                -- cleanly handle expression indexes, so raw SQL (same
                -- pattern as project.unified_workflows idx_uw_fts).
                EXECUTE $sql$
                    CREATE INDEX IF NOT EXISTS idx_agent_sessions_fts
                    ON coord.agent_sessions
                    USING GIN (to_tsvector('english',
                        coalesce(label, '') || ' ' ||
                        coalesce(derived_name, '') || ' ' ||
                        coalesce(search_text, '')))
                $sql$;
            END IF;
        END
        $$
        """
    )

    # ------------------------------------------------------------------
    # coord.sessions — claude_code_session_id join key (NOT a FK: the
    # agent_sessions row may not exist yet at session-create time).
    # ------------------------------------------------------------------
    op.execute(
        """
        DO $$
        BEGIN
            IF to_regclass('coord.sessions') IS NOT NULL THEN
                EXECUTE 'ALTER TABLE coord.sessions '
                        'ADD COLUMN IF NOT EXISTS claude_code_session_id UUID';
                -- Partial index — joins always start from a known
                -- session UUID; never scan the NULL majority.
                EXECUTE 'CREATE INDEX IF NOT EXISTS '
                        'idx_sessions_claude_code_session_id '
                        'ON coord.sessions (claude_code_session_id) '
                        'WHERE claude_code_session_id IS NOT NULL';
            END IF;
        END
        $$
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.idx_sessions_claude_code_session_id")
    op.execute(
        """
        DO $$
        BEGIN
            IF to_regclass('coord.sessions') IS NOT NULL THEN
                EXECUTE 'ALTER TABLE coord.sessions '
                        'DROP COLUMN IF EXISTS claude_code_session_id';
            END IF;
        END
        $$
        """
    )

    op.execute("DROP INDEX IF EXISTS coord.idx_agent_sessions_fts")
    op.execute("DROP INDEX IF EXISTS coord.idx_agent_sessions_derived_name")
    op.execute(
        """
        DO $$
        BEGIN
            IF to_regclass('coord.agent_sessions') IS NOT NULL THEN
                EXECUTE 'ALTER TABLE coord.agent_sessions '
                        'DROP COLUMN IF EXISTS search_text';
                EXECUTE 'ALTER TABLE coord.agent_sessions '
                        'DROP COLUMN IF EXISTS derived_name';
            END IF;
        END
        $$
        """
    )
