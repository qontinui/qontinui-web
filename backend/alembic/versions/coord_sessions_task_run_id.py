"""coord.sessions.task_run_id — runner SessionManager key for session automation

Revision ID: coord_sessions_task_run_id
Revises: twin_09_drop_qontinui_cloud_target
Create Date: 2026-06-04

Phase 0 of the session-automation injection-engine plan
(``D:/qontinui-root/qontinui-dev-notes/plans/2026-06-04-session-automation-injection-engine-design.md``,
checklist ``2026-06-04-session-automation-phase0-checklist.md`` item W1).

Adds one **nullable** plain-text column to ``coord.sessions`` so a coord row can
carry the runner-side ``SessionManager`` key for the authenticated
``ClaudeSession`` it mirrors:

* ``task_run_id TEXT`` (nullable) — the runner's UUIDv4 ``task_run_id`` (the
  ``claude_session::SessionManager`` map key, NOT the coord UUIDv7 ``id``).
  Carried so a future inject event addressed by the durable coord
  ``session_id`` resolves to the live ``ClaudeSession`` via
  ``SessionManager.get(task_run_id)``. Nullable because the overwhelming
  majority of existing rows (terminal panes, peer-mirrored sessions, legacy
  rows) have no associated ``SessionManager`` session, and we deliberately do
  **not** backfill — expand-only / forward-only per the
  ``reference_alembic_expand_contract_forward_only`` rule. coord stores the
  durable truth; the runner keeps its own hot-path index.

Optional reverse-lookup index ``ix_coord_sessions_task_run_id`` (partial, only
rows where ``task_run_id IS NOT NULL``) so coord-side joins / observability can
resolve a ``task_run_id`` to its session row without a full scan, while keeping
the index small (most rows are NULL).

Idempotency / authorship posture
================================

* DDL uses ``ADD COLUMN IF NOT EXISTS`` / ``DROP COLUMN IF EXISTS`` raw SQL —
  matching the ``coord.*`` migration house style (see
  ``coord_sessions_plan_linkage`` / ``coord_session_substrate``). coord boots
  against this same schema, so re-running against an already-applied DB must be
  a no-op.
* The partial index predicate (``WHERE task_run_id IS NOT NULL``) uses only an
  IMMUTABLE expression — no ``now()`` — so it is safe on real Postgres (cf.
  ``reference_alembic_now_index_and_offline_sql_gap``).
* **alembic is the SOLE author of the coord.* schema.** No Rust
  ``CREATE``/``ALTER`` self-heal for this column — the coord crate's
  ``coord_schema_authorship`` test asserts the live Rust coord.* DDL set is
  empty. The Rust side only SELECTs / INSERTs / UPDATEs this column.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_sessions_task_run_id"
down_revision: str = "deploy_effect_01_coord_deploy_tables"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE coord.sessions ADD COLUMN IF NOT EXISTS task_run_id TEXT")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_coord_sessions_task_run_id "
        "ON coord.sessions (task_run_id) WHERE task_run_id IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.ix_coord_sessions_task_run_id")
    op.execute("ALTER TABLE coord.sessions DROP COLUMN IF EXISTS task_run_id")
