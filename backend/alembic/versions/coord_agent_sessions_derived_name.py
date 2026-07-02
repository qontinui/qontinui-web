"""coord.agent_sessions derived_name — stable auto-name for every session

Revision ID: coord_agent_sessions_derived_name
Revises: coord_phase_5_01_agent_worktrees_work_unit_id
Create Date: 2026-07-02

P1 of plan ``2026-07-02-digital-twin-session-identity-registry``: every
session gets a deterministic, human-friendly ``adjective-tint-noun`` name
(e.g. ``calm-ember-otter``) so no surface renders a bare UUID. The value is a
pure function of the session id, computed by the SINGLE implementation in
coord Rust (``session_name::derive`` — blake3(uuid) indexing three frozen
256-word lists, 256^3 ≈ 16.7M combos).

This migration adds ONLY the column. Deliberately:

* **No backfill here.** The derivation function lives in coord Rust;
  duplicating the hash + wordlists in Python just to backfill would create a
  second implementation that must never drift (plan D1/D2 resolution). coord
  fills pre-existing NULL rows via a one-shot boot backfill
  (``session_name::spawn_backfill``) and stamps new rows at session
  first-seen (``upsert_agent_session``).
* **Separate column from ``label``** (plan D2): ``label`` is ALREADY
  auto-filled from worktree-registration intent with COALESCE-sticky
  semantics; writing auto-names into it would race/clobber that flow.
  Display precedence everywhere is ``label ?? derived_name``.
* **NO unique index** (plan D1): at 16.7M combos collisions are rare but
  possible at fleet scale; the P2 resolver treats name→id as
  candidate-returning rather than assuming uniqueness. No index at all yet —
  P1 has no name-keyed lookup path (the pure route computes, it doesn't
  query); P2 adds the search projection + indexes it needs.

coord's readiness surfaces cover the deploy-ordering gap: every consumer is
guarded on ``schema_readiness::AGENT_SESSIONS_DERIVED_NAME`` and picks a
legacy SQL variant while this column is absent — nothing 500s if coord
deploys first.

Idempotency / authorship posture
================================

* DDL uses ``ADD COLUMN IF NOT EXISTS`` / ``DROP ... IF EXISTS`` raw
  ``op.execute`` — the ``coord.*`` migration house style; re-running against
  an already-applied DB is a no-op.
* **alembic is the SOLE author of the coord.* schema.** The Rust side only
  SELECTs / INSERTs / UPDATEs.

Chains off the current single head
``coord_phase_5_01_agent_worktrees_work_unit_id`` (verified: no other
revision lists it as a ``down_revision`` as of 2026-07-02).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_agent_sessions_derived_name"
down_revision: str | Sequence[str] | None = "coord_phase_5_01_agent_worktrees_work_unit_id"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add ``coord.agent_sessions.derived_name`` (nullable text). Idempotent."""
    op.execute(
        """
        ALTER TABLE coord.agent_sessions
            ADD COLUMN IF NOT EXISTS derived_name TEXT
        """
    )


def downgrade() -> None:
    """Drop the derived_name column."""
    op.execute("ALTER TABLE coord.agent_sessions DROP COLUMN IF EXISTS derived_name")
