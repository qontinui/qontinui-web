"""coord.sessions — tool-grain activity columns (tool_name/digest/model/state_started_at)

Revision ID: coord_sessions_tool_activity
Revises: memseq_01
Create Date: 2026-08-19

Phase 1 of plan ``D:/qontinui-root/plans/
2026-08-11-coord-hook-sourced-agent-status.md``.

Extends the EXISTING session-status surface rather than standing up a second
one. ``coord.sessions`` already carries ``session_status`` /
``last_progress_at`` / ``progress_detail`` (``coord_sessions_progress_status``,
plan ``2026-06-24-coord-session-progress-and-stall-detection``), written by
``PATCH /sessions/:id {progress:{...}}`` and the ``coord_report_status`` MCP
tool. A separate ``coord.session_status`` table would be a SECOND session-grain
status store next to the first — two truths and a reconciliation job nobody
wrote. So this is four additive NULL-able columns on the row that already
exists (plan §3.1).

Four new NULL-able columns:

* ``tool_name``          — TEXT NULL. What the session is doing *right now*
                           (the tool the harness just invoked: ``Bash``,
                           ``Edit``, ``Task``, ...). No tool-grain field exists
                           anywhere on the session row today — the coarsest
                           existing signal, ``progress_on_interaction`` in the
                           runner, fires only at the ``send_user_message``
                           boundary and cannot see individual tool calls. Free
                           text, not an enum: the harness's tool vocabulary is
                           not ours to freeze, and a DB CHECK would turn a new
                           tool name into a write failure on a live session.
* ``tool_input_digest``  — TEXT NULL. A DIGEST of the tool input, never the
                           input itself (plan §3.2 — a deliberate divergence
                           from the prior art, recorded so it is not
                           "simplified" away later). coord is multi-tenant and
                           these rows are read by peers; the fleet has already
                           recorded live credentials landing in coord columns
                           twice (``merge_proposals.error`` storing a live
                           ``gho_`` token; restore-configs holding plaintext
                           device creds). Storing raw tool input would be the
                           third. The digest answers the question actually
                           being asked — "is this the same call repeating?" —
                           without carrying the payload.
* ``model``              — TEXT NULL. Which model is driving the session.
                           Free text for the same reason as ``tool_name``:
                           model ids churn faster than migrations.
* ``state_started_at``   — TIMESTAMPTZ NULL. When the session entered its
                           CURRENT ``session_status``, deliberately DISTINCT
                           from ``last_progress_at``. Today every report
                           advances one clock, so "in this state for 40
                           minutes" is inexpressible: a tool ping refreshes
                           liveness AND resets the only available age. Two
                           clocks separate the two questions — a tool ping
                           advances ``last_progress_at`` and leaves
                           ``state_started_at`` alone; a genuine state
                           TRANSITION moves both. This is the single most
                           valuable column in the plan and the input the
                           existing ``session_stall_watcher`` needs to key its
                           600s warn-only predicate on time-in-*state* rather
                           than time-since-any-ping.

No DB enum / CHECK on any of the four, matching ``session_status`` and coord's
other status columns: the vocabulary is enforced in Rust at the WRITE boundary
(a typed 422 on an unknown ``state``), while the row decoder stays fail-open so
one legacy row cannot poison a fleet read.

Fail-open contract (must match the coord Rust side, and identical to the
contract ``coord_sessions_progress_status`` documents): coord DEPLOYS BEFORE
this migration lands. Every read/write of these columns in coord is guarded so
a ``42703 undefined_column`` degrades to ``None`` / a no-op rather than failing
the query — a coord build running against a database WITHOUT these four columns
must still serve ``GET /sessions`` and ``coord_orient``. Landing this migration
simply ACTIVATES persistence; no coord change is required, and the columns are
inert until Phase 2 writes them.

alembic is the SOLE author of ``coord.*`` schema (served policy
``production-and-cost`` ``alembic-sole-authorship``, enforced coord-side by
``qontinui-coord/tests/coord_schema_authorship.rs``), which is why this DDL
lives in qontinui-web even though only coord reads it.

Time-in-state index: the shipped ``session_stall_watcher``
(``crates/coord/src/session_stall_watcher.rs``) scans
``WHERE state='active' AND <clock> < now() - interval ...``; Phase 5 re-keys it
from ``last_progress_at`` onto ``state_started_at``. A partial index on
``(state_started_at) WHERE state='active'`` mirrors the sibling
``coord_sessions_active_progress_idx`` (and the
``coord_sessions_tenant_state_idx`` heartbeat-scan posture in
``coord_session_substrate.py``) and keeps that watcher off a full-table scan.
Partial on ``state='active'`` because a closed/stale session is never a stall
candidate, so the index stays proportional to the LIVE fleet rather than to
session history.

Raw ``op.execute`` with ``ADD COLUMN IF NOT EXISTS`` — the collision-safe
convention used by the other coord.* migrations
(``coord_sessions_progress_status.py`` / ``coord_gate_progress_samples.py``).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_sessions_tool_activity"
down_revision: str | Sequence[str] | None = "memseq_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute("ALTER TABLE coord.sessions ADD COLUMN IF NOT EXISTS tool_name TEXT")
    op.execute(
        "ALTER TABLE coord.sessions ADD COLUMN IF NOT EXISTS tool_input_digest TEXT"
    )
    op.execute("ALTER TABLE coord.sessions ADD COLUMN IF NOT EXISTS model TEXT")
    op.execute(
        "ALTER TABLE coord.sessions "
        "ADD COLUMN IF NOT EXISTS state_started_at TIMESTAMPTZ"
    )
    # Partial index for the time-in-state stall scan
    # (WHERE state='active' AND state_started_at < now() - interval ...).
    op.execute(
        "CREATE INDEX IF NOT EXISTS coord_sessions_active_state_started_idx "
        "ON coord.sessions (state_started_at) WHERE state = 'active'"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.coord_sessions_active_state_started_idx")
    op.execute("ALTER TABLE coord.sessions DROP COLUMN IF EXISTS state_started_at")
    op.execute("ALTER TABLE coord.sessions DROP COLUMN IF EXISTS model")
    op.execute("ALTER TABLE coord.sessions DROP COLUMN IF EXISTS tool_input_digest")
    op.execute("ALTER TABLE coord.sessions DROP COLUMN IF EXISTS tool_name")
