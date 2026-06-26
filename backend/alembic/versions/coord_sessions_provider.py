"""coord.sessions.provider — AI CLI provider hosting the session (fleet provider-awareness)

Revision ID: coord_sessions_provider
Revises: shadowreap01
Create Date: 2026-06-26

Phase 6 of the runner session-restore redesign
(``qontinui-dev-notes/plans/2026-06-25-runner-session-restore-redesign.md`` §6).

Adds one **nullable** plain-text column to ``coord.sessions`` recording WHICH AI
CLI provider hosts the session (``"claude"``, ``"codex"``, …), propagated from
the runner's ``TerminalSessionRecord.provider`` through ``session/coord_sync.rs``
so the fleet view can render each session's provider. Mirrors the
``coord_sessions_task_run_id`` migration's posture:

* **Nullable, forward-only** — existing rows (terminal panes, peer mirrors,
  legacy rows) predate the field and are deliberately NOT backfilled; expand-only
  per ``reference_alembic_expand_contract_forward_only``. coord stores the durable
  truth; an absent value just means "provider unknown for this row".
* **No index** — unlike ``task_run_id`` (a reverse-lookup key with a partial
  index), ``provider`` is display-only (the fleet view SELECTs it per row, never
  looks a session up BY provider), so an index would be dead weight.
* **alembic is the SOLE author of the coord.* schema** — no Rust
  ``CREATE``/``ALTER`` self-heal for this column (the coord crate's
  ``coord_schema_authorship`` test asserts the live Rust coord.* DDL set is
  empty). The Rust side only SELECT/INSERT/UPDATEs it.
* ``ADD COLUMN IF NOT EXISTS`` / ``DROP COLUMN IF EXISTS`` raw SQL — coord boots
  against this same schema, so re-running against an already-applied DB is a
  no-op (the ``coord.*`` migration house style, cf. ``coord_sessions_task_run_id``
  / ``coord_session_substrate``).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_sessions_provider"
down_revision: str = "shadowreap01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE coord.sessions ADD COLUMN IF NOT EXISTS provider TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE coord.sessions DROP COLUMN IF EXISTS provider")
