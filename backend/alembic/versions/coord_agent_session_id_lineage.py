"""coord.agent_sessions lookup + agent_session_id lineage columns

Revision ID: coord_agent_session_id_lineage
Revises: coord_phase_2_01_claims_audit_steal_columns
Create Date: 2026-05-18

Phase 1 of plan ``D:/qontinui-root/plans/coord-agent-session-id-tracking.md``
(Side B). Adds a new lineage axis — ``agent_session_id UUID`` — to every
coord audit / mutation table so that "show me every coord-mediated action
attributable to Claude Code session X" becomes a single SQL query.

This migration is **purely additive**:

* New lookup table ``coord.agent_sessions`` carrying the Claude Code
  session UUID (PK), the owning ``auth.users`` row (nullable), the
  device the session is bound to (nullable FK to ``coord.devices`` —
  see "Schema drift" below), and first/last-seen timestamps. ``label``
  is an optional human-readable hint ("ufix-2026-05-18" etc.). The
  upsert side (coord HTTP handlers) is shipped in plan Phase 2 / Side A;
  this migration only stands the table up so handler PRs can target a
  live column set.

* New column ``agent_session_id UUID NULL`` on the following tables,
  each with a partial index on the non-NULL subset and a FK to
  ``coord.agent_sessions(id) ON DELETE SET NULL`` so deleting a
  session does not cascade-drop forensic history:

  - ``coord.agent_worktrees``
  - ``coord.claims_audit``
  - ``coord.build_events``
  - ``coord.merge_proposals``
  - ``coord.coordinator_decisions`` (orthogonal to the pre-existing
    ``session_id TEXT`` column, which tracks coordinator-iteration
    sessions per ``consolidation_phase2_v_29_coordinator.py:32`` — the
    two concepts coexist on the same row.)
  - ``coord.devices`` (latest active Claude session bound to the
    device, for fleet-view filtering. ``coord.machines`` was retired by
    ``ud01_unify_devices_registry`` 2026-05-18 — the plan's original
    bullet referenced the old table; here we land the lineage column
    on the unified replacement.)

Nullability rationale: per plan §"Non-goals" the column is NULL today
because Claude Code does not yet surface its session UUID through a
documented surface (Side C2 of the plan tracks the upstream feature
request). Phase 6 of the rollout tightens to NOT NULL once C1 / C2
saturate; the migration that flips nullability will live in its own
revision.

FK / ON DELETE choice: ``SET NULL`` over ``CASCADE`` because the
``coord.agent_sessions`` row is a soft-deleted concept (closed_at
timestamp signals end-of-life; row stays). If an operator hard-deletes
a session row for GDPR / forgetting, the audit history must survive
with a NULL lineage cell — not vaporise. Sibling shape to the
``coord.events.machine_id`` ``ON DELETE SET NULL`` rationale in
``ud01_unify_devices_registry`` and the ``agent_worktrees.machine_id``
note in ``coord_phase_1_01_agent_worktrees`` (both prefer audit-row
survival over referential strictness).

Idempotency: ``coord.agent_worktrees``, ``coord.merge_proposals`` and
``coord.machines`` were historically runner-self-healed before the
alembic surface caught up. Recent main has alembic owning all six
target tables, but defensively the column-add statements use
``ADD COLUMN IF NOT EXISTS`` via ``op.execute`` plus a ``to_regclass``
guard so a partially-bootstrapped DB (e.g. a fresh dev environment
that ran self-heal once before this revision lands) does not blow up.
Partial indexes and the FK constraint use the matching ``IF NOT
EXISTS`` / ``DO $$`` guards so the migration is rerunnable in any
state the canonical PG might be in (per
``feedback_canonical_db_behind_alembic`` the canonical migrator may
lag — runtime self-heal is the recovery, but alembic should not
double-add either).

Chains off the current single head ``coord_phase_2_01_claims_audit_steal_columns``
(verified empirically against origin/main 2026-05-18 per
``feedback_verify_origin_state_before_phase_start``).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_agent_session_id_lineage"
down_revision: str = "coord_phase_2_01_claims_audit_steal_columns"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Tables that get the new agent_session_id column. Order matters only
# for the cosmetic SQL stream when --sql-rendered; runtime is
# commutative.
_TARGET_TABLES: tuple[str, ...] = (
    "agent_worktrees",
    "claims_audit",
    "build_events",
    "merge_proposals",
    "coordinator_decisions",
    "devices",
)


def upgrade() -> None:
    # ------------------------------------------------------------------
    # Step 1 — create the lookup table.
    # ------------------------------------------------------------------
    # ``CREATE TABLE IF NOT EXISTS`` because a future runner self-heal
    # path may stand the table up early (the runner uses the same
    # pattern for ``coord.merge_proposals`` per
    # ``qontinui-runner/src-tauri/src/database/pg/merge_proposals.rs:30``).
    # Belt + braces — alembic stamps this revision regardless.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.agent_sessions (
            id           UUID PRIMARY KEY,
            user_id      UUID REFERENCES auth.users(id),
            first_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_seen    TIMESTAMPTZ NOT NULL DEFAULT now(),
            device_id    UUID REFERENCES coord.devices(device_id),
            label        TEXT,
            closed_at    TIMESTAMPTZ
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_agent_sessions_user "
        "ON coord.agent_sessions (user_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_agent_sessions_device "
        "ON coord.agent_sessions (device_id)"
    )
    # Live-sessions index — the dashboard query is
    # ``WHERE closed_at IS NULL ORDER BY last_seen DESC``, see plan
    # Side D Phase 4. Partial index keeps it tiny.
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_agent_sessions_live "
        "ON coord.agent_sessions (last_seen DESC) "
        "WHERE closed_at IS NULL"
    )

    # ------------------------------------------------------------------
    # Step 2 — add agent_session_id column + partial index + FK on each
    # target table, guarded by to_regclass so the migration is safe to
    # run against a partially-bootstrapped DB.
    # ------------------------------------------------------------------
    for table in _TARGET_TABLES:
        # Column add (idempotent — IF NOT EXISTS).
        op.execute(
            f"""
            DO $$
            BEGIN
                IF to_regclass('coord.{table}') IS NOT NULL THEN
                    EXECUTE 'ALTER TABLE coord.{table} '
                            'ADD COLUMN IF NOT EXISTS agent_session_id UUID';
                END IF;
            END
            $$
            """
        )
        # Partial index on the non-NULL subset — lineage queries always
        # filter on a known session UUID, never scan the NULL majority.
        op.execute(
            f"""
            DO $$
            BEGIN
                IF to_regclass('coord.{table}') IS NOT NULL THEN
                    EXECUTE 'CREATE INDEX IF NOT EXISTS '
                            'idx_{table}_agent_session '
                            'ON coord.{table} (agent_session_id) '
                            'WHERE agent_session_id IS NOT NULL';
                END IF;
            END
            $$
            """
        )
        # FK to agent_sessions. ``ADD CONSTRAINT IF NOT EXISTS`` does
        # not exist in PG; emulate with a pg_constraint lookup.
        op.execute(
            f"""
            DO $$
            BEGIN
                IF to_regclass('coord.{table}') IS NOT NULL
                   AND NOT EXISTS (
                       SELECT 1 FROM pg_constraint
                       WHERE conname = '{table}_agent_session_id_fkey'
                   )
                THEN
                    EXECUTE 'ALTER TABLE coord.{table} '
                            'ADD CONSTRAINT {table}_agent_session_id_fkey '
                            'FOREIGN KEY (agent_session_id) '
                            'REFERENCES coord.agent_sessions(id) '
                            'ON DELETE SET NULL';
                END IF;
            END
            $$
            """
        )


def downgrade() -> None:
    # Drop in reverse-dependency order: FK + index + column on each
    # target table FIRST, then the lookup table.
    for table in _TARGET_TABLES:
        op.execute(
            f"""
            DO $$
            BEGIN
                IF to_regclass('coord.{table}') IS NOT NULL THEN
                    EXECUTE 'ALTER TABLE coord.{table} '
                            'DROP CONSTRAINT IF EXISTS '
                            '{table}_agent_session_id_fkey';
                END IF;
            END
            $$
            """
        )
        op.execute(
            f"DROP INDEX IF EXISTS coord.idx_{table}_agent_session"
        )
        op.execute(
            f"""
            DO $$
            BEGIN
                IF to_regclass('coord.{table}') IS NOT NULL THEN
                    EXECUTE 'ALTER TABLE coord.{table} '
                            'DROP COLUMN IF EXISTS agent_session_id';
                END IF;
            END
            $$
            """
        )

    op.execute("DROP INDEX IF EXISTS coord.idx_agent_sessions_live")
    op.execute("DROP INDEX IF EXISTS coord.idx_agent_sessions_device")
    op.execute("DROP INDEX IF EXISTS coord.idx_agent_sessions_user")
    op.execute("DROP TABLE IF EXISTS coord.agent_sessions")
