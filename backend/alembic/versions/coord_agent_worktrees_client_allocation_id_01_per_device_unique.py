"""coord.agent_worktrees.client_allocation_id — a client-chosen allocation handle

Revision ID: coord_agent_worktrees_client_allocation_id_01
Revises: kpi_02_coord_session_usage
Create Date: 2026-10-11

Phase 2a (web half) of
``2026-10-11-allocate-worktree-killed-before-agent-id-leaks-an-unfindable-ledger-row``
(Decision D3).

Why
===

``allocate-worktree.sh`` learns its ``agent_id`` only from coord's response to
``POST /agents/allocate``. A run killed while that POST is in flight (a
``timeout`` wrapper, a closed terminal) leaves a committed ``coord.agent_worktrees``
row that nothing on the client can name, so it can never be handed back with
``worktree-done``. The fix is a handle the CLIENT picks before it sends: a
UUIDv7 written to a local journal first, then sent on every allocate attempt.
Coord stores it on every row the allocation inserts, and ``worktree-done``
gains a third match arm on it, scoped to ``device_id`` like the other two.

What reads and writes it
========================

* coord's ``POST /agents/allocate`` (qontinui-coord, Phase 2b) writes it on
  every inserted row, constant across coord's internal attempt loop.
* coord's ``WORKTREE_DONE_MATCH_SQL`` gains
  ``OR ($5::uuid IS NOT NULL AND client_allocation_id = $5)`` under the
  existing ``device_id = $1`` scope.

Nothing in qontinui-web reads or writes it; the column exists here because
alembic in qontinui-web is the sole author of the ``coord.*`` schema (served
policy ``production-and-cost`` ``alembic-sole-authorship``), and a coord read
of a new ``coord.*`` column needs its qontinui-web migration to land FIRST.

Shape
=====

``client_allocation_id UUID NULL`` — no default, no CHECK, no FK.

* **NULL means "the caller sent no handle"** — every existing row, and every
  row a client predating Phase 3 allocates. A default would invent a handle
  nobody holds.
* The v7 / ±10 min freshness rule is enforced by coord at the door, not here:
  a CHECK cannot read the server clock stably, and the door's 400 is the
  better refusal.

The index
=========

``uq_agent_worktrees_device_client_alloc_repo`` — UNIQUE on
``(device_id, client_allocation_id, repo) WHERE client_allocation_id IS NOT NULL``.

* **Per device**, because the handle is a device's claim and the match arms
  are device-scoped; one device can never collide with another's handle.
* **Partial**, so every NULL row (all of them, at apply time) is outside it.
* **``repo`` is in the key on purpose — a deliberate widening of plan D3's
  ``(device_id, client_allocation_id)``.** D3 also says the handle is "stored
  on every ``coord.agent_worktrees`` row the allocation inserts", and an
  allocation inserts ONE ROW PER REPO: coord's ``try_insert_all``
  (``qontinui-coord/crates/coord/src/agent_worktrees.rs``) loops over the
  requested repo plus every declared sibling build-dependency, all under the
  same ``device_id``. A two-column key would refuse the second row of every
  sibling-provisioning allocation — most repos here declare siblings. With
  ``repo`` in the key, a replay of the same allocation on the same device
  still collides (same repo, same handle → 23505 → coord's 409), siblings do
  not, and the ``worktree-done`` id arm retires every row the allocation made
  in one call, which is exactly what the POST-in-flight recovery needs.
* The leading ``(device_id, client_allocation_id)`` prefix doubles as the
  lookup index for that id arm.

``CONCURRENTLY``, and why it is safe
====================================

``coord.agent_worktrees`` is a live table written by every allocation, so the
index is built ``CONCURRENTLY`` (a plain build would take a write-blocking
``SHARE`` lock), inside ``op.get_context().autocommit_block()`` because
CONCURRENTLY cannot run in ``env.py``'s wrapping transaction — the same idiom as
``coord_alerts_pagedidx_01`` and ``coord_agent_questions_effect``. Coord's
merge-path ``migration_classifier`` admits exactly this shape: static literals,
``ADD COLUMN IF NOT EXISTS`` nullable with no default, and
``CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS`` inside the autocommit block.

The autocommit block COMMITS the transaction holding the ``ADD COLUMN`` first,
so the column is visible to the build, and it also ends the ``SET LOCAL
lock_timeout`` that guards the ``ADD COLUMN`` — no ``RESET`` is needed (and the
classifier refuses one).

A killed CONCURRENTLY build leaves an INVALID index that ``IF NOT EXISTS``
would then skip. It cannot fail on duplicates here — every row is NULL when it
is built, so the partial index is empty — but an interrupted build is still
possible. Verify with ``pg_index.indisvalid``; if it is invalid, ``DROP INDEX
CONCURRENTLY`` it and re-run.

That repair is deliberately NOT automated in ``upgrade()``, unlike
``agent_questions_alert_episode_01``. Its shape — an ``indisvalid`` probe run
through ``op.get_bind().execute(...)`` and a ``DROP INDEX`` in the upgrade path
— is refused by coord's ``migration_classifier`` (``forbid_unclassifiable_code``
rejects SQL executed through anything but ``op.execute``; any ``DROP`` in the
upgrade path is non-additive), which would park this PR in the escalate path.

Deploy ordering
===============

This revision lands and deploys BEFORE the coord PR that writes the column
(Phase 2b). Additive and nullable, so it is harmless to every coord build that
predates it.

Downgrade
=========

Drops the index, then the column. A coord build that writes the column would
then fail every allocate carrying a handle; roll coord back first.

Idempotency: ``IF NOT EXISTS`` / ``IF EXISTS`` throughout, so a
partially-applied run re-runs cleanly.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_agent_worktrees_client_allocation_id_01"
# KEEP THIS ASSIGNMENT ON ONE LINE. Coord's alembic-graph parser (its mirror of
# this branch feeds deploy-coord.yml's drift gate) is line-scoped, so a
# formatter-wrapped `down_revision = (\n "..."\n)` yields no parent at all and
# counts as a second head — see plan_library_06_scan_root_slug_census.py.
down_revision: str = "kpi_02_coord_session_usage"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the nullable handle, then its per-device, per-repo partial unique index."""
    # Plain literals, never f-strings: the `alembic-schema-arg-gate` pre-commit
    # hook and coord's migration_classifier both read the raw SQL statically.
    #
    # Bound the ACCESS EXCLUSIVE lock wait on a live table. SET LOCAL ends at
    # the commit the autocommit_block below performs, so it cannot leak into a
    # later revision.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.agent_worktrees
            ADD COLUMN IF NOT EXISTS client_allocation_id UUID
        """
    )

    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
                uq_agent_worktrees_device_client_alloc_repo
            ON coord.agent_worktrees (device_id, client_allocation_id, repo)
            WHERE client_allocation_id IS NOT NULL
            """
        )


def downgrade() -> None:
    """Drop the index, then the column. Roll back the coord build that writes it first."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.uq_agent_worktrees_device_client_alloc_repo"
        )
    # Bound the ACCESS EXCLUSIVE lock wait, as the upgrade does. Downgrade has
    # no autocommit_block after the DROP to end the SET LOCAL, so RESET it here
    # (env.py runs the whole batch in one transaction, and a 3s timeout must not
    # leak into the next revision's downgrade). coord's migration_classifier
    # reads the UPGRADE path only, so the RESET it refuses is fine here.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        "ALTER TABLE coord.agent_worktrees DROP COLUMN IF EXISTS client_allocation_id"
    )
    op.execute("RESET lock_timeout")
