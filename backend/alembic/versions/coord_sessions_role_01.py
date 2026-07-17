"""coord.sessions.role — searchable specialized agent sessions

Revision ID: coord_sessions_role_01
Revises: coord_claude_acct_usage_01
Create Date: 2026-07-17

Phase 8 of plan ``D:/qontinui-root/plans/2026-07-17-session-autonomy-fabric.md``
(shepherd desired-state reconciliation, claim-first + role tags).

Adds ONE nullable column to ``coord.sessions``:

* ``role`` — TEXT NULL. The *specialized agent role* this session was spawned
  to fill (``merge_shepherd``, ``merge_fixer``, …). ``NULL`` for the
  overwhelming majority of sessions — an operator terminal, an ad-hoc Claude
  tab, a peer mirror — which fill no declared role at all. Written by the
  session-create path and by the progress-report path
  (``PATCH /sessions/:id {progress:{role:...}}``); read back by the fleet
  queries that answer "is a shepherd running for this tenant, and where?".

Why a THIRD axis (and not a reuse of ``session_kind`` / ``session_status``)
==========================================================================

``coord.sessions`` already carries two orthogonal axes and this is a third,
equally orthogonal one:

* ``session_kind``   — WHAT HOSTS the session (terminal_shell | terminal_claude
                       | …). A structural/transport fact.
* ``state``          — LIVENESS (active | pending_resolution | stale | closed).
* ``session_status`` — the WORK axis (working | blocked | stalled | done).
* ``role``  (NEW)    — WHAT JOB the session was spawned to do.

A merge shepherd is ``session_kind='terminal_claude'``,
``state='active'``, ``session_status='working'``, ``role='merge_shepherd'``.
All four are simultaneously true; none of the existing three can express the
fourth without overloading a vocabulary that other readers already gate on.

No CHECK constraint — deliberately
==================================

The role vocabulary is enforced in **Rust**, not in the DB, matching the
``session_status`` precedent set by ``coord_sessions_progress_status.py``
("Contract values are … enforced in Rust … no DB enum / CHECK, matching
coord's other status columns so the vocabulary can evolve without a
migration"). Adding a shepherd/fixer/auditor role must never require an
alembic round-trip. The live ``policy_rules_mode_kind_check`` CHECK is the
cautionary tale in the other direction: a DB-side enumeration that froze a
vocabulary and forced a v2 escape hatch.

Search index
============

The reader this column exists for is "which sessions in MY tenant are filling
role R" — i.e. ``WHERE tenant_id = $1 AND role = $2``. A PARTIAL index
``(tenant_id, role) WHERE role IS NOT NULL`` keeps the index to the handful of
role-bearing rows instead of indexing the NULL bulk of the table, mirroring the
partial-index posture of ``coord_sessions_active_progress_idx`` (the stall-scan
index in ``coord_sessions_progress_status.py``) and of ``coord.alerts``'
resolved-at partial index.

Fail-open contract (must match the coord Rust side)
===================================================

Coord DEPLOYS BEFORE this migration lands. Every read/write of ``role`` in
coord is guarded so a ``42703 undefined_column`` degrades to ``None`` / a
no-op rather than failing the query: the session-create INSERT attempts the
new shape first and falls back to the role-less statement
(``is_missing_column_error``), and the progress-advance UPDATE swallows the
error entirely. Landing this migration simply ACTIVATES persistence; no coord
change is required.

Raw ``op.execute`` with ``ADD COLUMN IF NOT EXISTS`` / ``IF NOT EXISTS`` — the
collision-safe convention used by the other coord.* migrations
(``coord_sessions_progress_status.py`` / ``coord_claude_acct_usage_01``).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_sessions_role_01"
down_revision: str | Sequence[str] | None = "coord_claude_acct_usage_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add coord.sessions.role + its partial (tenant_id, role) search index."""
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute("ALTER TABLE coord.sessions ADD COLUMN IF NOT EXISTS role TEXT")
    # Partial: only role-bearing rows are searchable by role, and only those
    # rows pay index-maintenance cost on write.
    op.execute(
        "CREATE INDEX IF NOT EXISTS coord_sessions_tenant_role_idx "
        "ON coord.sessions (tenant_id, role) WHERE role IS NOT NULL"
    )


def downgrade() -> None:
    """Drop the index then the column (reverse of upgrade)."""
    op.execute("DROP INDEX IF EXISTS coord.coord_sessions_tenant_role_idx")
    op.execute("ALTER TABLE coord.sessions DROP COLUMN IF EXISTS role")
