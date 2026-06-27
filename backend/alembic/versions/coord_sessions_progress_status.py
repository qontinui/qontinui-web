"""coord.sessions — session_status + progress columns (status/progress first-class)

Revision ID: coord_sessions_progress_status
Revises: drop_line_budget_columns_01
Create Date: 2026-06-24

Phase 2 of plan ``D:/qontinui-root/plans/
2026-06-24-coord-session-progress-and-stall-detection.md``.

Makes session *status* + *progress* first-class on ``coord.sessions`` (the
lifecycle home — it already carries ``parent_session_id`` for continuation
lineage, so progress belongs here, NOT on the per-(device, work_unit)
``coord.agent_status`` row whose grain is wrong for a session lifecycle).

Three new NULL-able columns:

* ``session_status``    — TEXT NULL. A SECOND axis ALONGSIDE the existing
                          ``state`` column (active|pending_resolution|stale|
                          closed), NOT a replacement: a row can be
                          ``state='active'`` AND ``session_status='stalled'``
                          (the "stalled ≠ stale" distinction — stale = no
                          heartbeat / dead; stalled = heartbeating but
                          ``last_progress_at`` not advancing). Contract values
                          are ``working`` | ``blocked`` | ``stalled`` | ``done``,
                          enforced in Rust (``SessionStatus`` enum in
                          ``qontinui-coord/src/sessions.rs``) — no DB enum /
                          CHECK, matching coord's other status columns so the
                          vocabulary can evolve without a migration.
* ``last_progress_at``  — TIMESTAMPTZ NULL. Monotonic progress signal advanced
                          on work-cycle boundaries (via ``PATCH /sessions/:id``
                          ``{progress:{...}}`` and the ``coord_report_status``
                          MCP tool). ORTHOGONAL to ``last_heartbeat_at`` (a
                          session can heartbeat without progressing). NULL until
                          the session first reports progress.
* ``progress_detail``   — JSONB NULL. Free-form checkpoint/step detail
                          accompanying the latest progress report.

Fail-open contract (must match the coord Rust side): coord DEPLOYS BEFORE this
migration lands. Every read/write of these columns in coord is guarded so a
``42703 undefined_column`` degrades to ``None`` / a no-op rather than failing
the query. Landing this migration simply ACTIVATES persistence; no coord change
is required.

Stall-scan index: Phase 3's ``session_stall_watcher`` will scan
``WHERE state='active' AND last_progress_at < now() - interval ...`` — a partial
index on ``(last_progress_at) WHERE state='active'`` mirrors the
``coord_sessions_tenant_state_idx`` heartbeat-scan posture
(``coord_session_substrate.py``) and keeps the watcher off a full-table scan.

Raw ``op.execute`` with ``ADD COLUMN IF NOT EXISTS`` — the collision-safe
convention used by the other coord.* migrations
(``coord_gate_progress_samples.py`` / ``coord_singleauthored_01_gates``).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_sessions_progress_status"
down_revision: str | Sequence[str] | None = "tgha01_tenant_github_accounts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        "ALTER TABLE coord.sessions ADD COLUMN IF NOT EXISTS session_status TEXT"
    )
    op.execute(
        "ALTER TABLE coord.sessions "
        "ADD COLUMN IF NOT EXISTS last_progress_at TIMESTAMPTZ"
    )
    op.execute(
        "ALTER TABLE coord.sessions ADD COLUMN IF NOT EXISTS progress_detail JSONB"
    )
    # Partial index for the Phase 3 stall-watcher scan
    # (WHERE state='active' AND last_progress_at < now() - interval ...).
    op.execute(
        "CREATE INDEX IF NOT EXISTS coord_sessions_active_progress_idx "
        "ON coord.sessions (last_progress_at) WHERE state = 'active'"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.coord_sessions_active_progress_idx")
    op.execute("ALTER TABLE coord.sessions DROP COLUMN IF EXISTS progress_detail")
    op.execute("ALTER TABLE coord.sessions DROP COLUMN IF EXISTS last_progress_at")
    op.execute("ALTER TABLE coord.sessions DROP COLUMN IF EXISTS session_status")
