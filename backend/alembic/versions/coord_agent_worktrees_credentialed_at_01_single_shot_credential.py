"""coord.agent_worktrees.credentialed_at — the single-shot credential stamp

Revision ID: coord_agent_worktrees_credentialed_at_01
Revises: plan_library_06_scan_root_slug_census
Create Date: 2026-09-16

Phase 3 (web half) of
``2026-09-13-coord-publishes-agent-jwts-on-a-redis-channel-fronted-by-an-unauthenticated-ws-firehose``.

Why
===

Coord's ``events.agent.spawn_requested.<device>`` frames carry the agent's
JWT today, on a Redis channel fronted by an anonymous ``/ws`` firehose. Phase 3
of that plan takes the credential OFF the bus: the frame becomes a
notification, and the runner mints the agent token itself against a
device-authenticated door, ``POST /agents/:agent_id/credential``.

That door is SINGLE-SHOT. A frame observed by anyone else must not be able to
race the runner for the token, so the mint sets this column in the same
transaction and a second call answers ``409 already_credentialed``.

What reads it
=============

* coord's ``POST /agents/:agent_id/credential`` (qontinui-coord,
  ``crates/coord/src/routes.rs``, on the ``require_jwt`` sub-router beside
  ``/agents/:id/refresh-token``): ``SELECT … FOR UPDATE`` on the worktree row,
  refuse 409 when ``credentialed_at IS NOT NULL``, otherwise mint and ``SET
  credentialed_at = now()`` in the same transaction.

Nothing in qontinui-web reads or writes it; the column exists here because
alembic in qontinui-web is the sole author of the ``coord.*`` schema (served
policy ``production-and-cost`` ``alembic-sole-authorship``) and a coord read of
a new ``coord.*`` column needs its qontinui-web migration to land FIRST.

Shape
=====

``credentialed_at TIMESTAMPTZ NULL`` — no default, no index, no CHECK.

* **NULL means "not yet credentialed"**, which is every existing row and every
  row the in-process spawn paths create until the runner build that fetches is
  published. NULL is the value that admits the mint, so a default of ``now()``
  would lock every agent out of its own credential.
* No index: the door reads the row by primary key, and the column is never a
  filter.

Deploy ordering
===============

This revision lands and deploys BEFORE the coord PR that reads the column —
coord's ``deploy-coord.yml`` drift gate reads this branch's alembic graph, and
a coord build that ``SELECT``s a column the DB does not have fails every spawn.
Additive and nullable, so it is harmless to every coord build that predates it.

Downgrade
=========

Drops the column. A coord build that reads it would then fail the credential
door, which is the correct loud failure rather than a silent re-mint; roll
coord back first.

Idempotency: ``IF NOT EXISTS`` / ``IF EXISTS``, so a partially-applied run
re-runs cleanly.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_agent_worktrees_credentialed_at_01"
# KEEP THIS ASSIGNMENT ON ONE LINE. Coord's alembic-graph parser (its mirror of
# this branch feeds deploy-coord.yml's drift gate) is line-scoped, so a
# formatter-wrapped `down_revision = (\n "..."\n)` yields no parent at all and
# counts as a second head — see plan_library_06_scan_root_slug_census.py.
down_revision: str | Sequence[str] | None = "plan_library_06_scan_root_slug_census"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "coord.agent_worktrees"
_COLUMN = "credentialed_at"


def upgrade() -> None:
    """Add the nullable stamp. NULL admits the single-shot mint."""
    op.execute(
        f"ALTER TABLE {_TABLE} ADD COLUMN IF NOT EXISTS {_COLUMN} TIMESTAMPTZ NULL"
    )


def downgrade() -> None:
    """Drop it. Roll the coord build that reads it back first."""
    op.execute(f"ALTER TABLE {_TABLE} DROP COLUMN IF EXISTS {_COLUMN}")
