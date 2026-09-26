"""coord.sessions: the index the unfiltered ``/coord/sessions/fleet`` walk lacks.

Plan ``2026-09-12-fleet-principal-session-routes-disagree-about-being-capped``,
Phase 4.

What it serves
==============

``GET /coord/sessions/fleet`` (qontinui-coord
``crates/coord/src/session_fleet.rs`` ``build_fleet_sql``) pages a tenant's
sessions with a keyset cursor::

    SELECT ... FROM coord.sessions AS s
     WHERE s.tenant_id = $1
       [AND s.closed_at IS NULL]
       [AND s.device_id = $n] [AND s.state = $n]
       [AND (s.started_at, s.id) < ($k::timestamptz, $i::uuid)]
     ORDER BY s.started_at DESC, s.id DESC
     LIMIT $n

The keyset predicate is a ROW comparison, which a btree can drive as an index
condition. Two ``coord_session_substrate`` indexes serve the FILTERED walks:
``coord_sessions_device_idx (device_id, started_at DESC)`` for ``?device_id=``
and ``coord_sessions_tenant_state_idx (tenant_id, state, started_at DESC)`` for
``?state=``.

The UNFILTERED walk (tenant only) has neither. The tenant index's middle column
is ``state``, so with ``state`` unconstrained its entries are not in
``started_at`` order and a range on ``started_at`` cannot be read off it: every
page is a scan of the tenant's whole history plus a sort, however small the
``LIMIT``. This index is exactly the route's ``ORDER BY`` behind the tenant
equality, INCLUDING the ``id DESC`` tiebreaker, so:

* page 1 is an index scan that stops after ``LIMIT`` rows, with no ``Sort``;
* every later page seeks straight to ``(started_at, id) < ($k, $i)`` — the row
  comparison is an index condition on the full two-column key, where the
  existing indexes (neither of which contains ``id``) could at best use the
  leading column and recheck the tiebreak.

The default walk also carries ``s.closed_at IS NULL``. That is applied as a
filter on the index scan rather than baked in as a partial predicate, because
``?include_closed=true`` walks the same order without it and a partial index
would not serve that case.

Scope, stated plainly: this is THROUGHPUT on the unfiltered case only. The
correctness cliff (rows unreachable at any page size) was closed in coord by
qontinui-coord#2079 and its follow-up; every reader is correct without this
index, only slower.

Building: locks
===============

``CREATE INDEX CONCURRENTLY IF NOT EXISTS`` inside
``op.get_context().autocommit_block()``, the shape of the recent coord index
precedents (``coord_iops_idx_01``, ``coord_obs_idx_01``,
``coord_pg_overload_idx_01``). ``coord.sessions`` takes continuous heartbeat
writes; a plain build's ``SHARE`` lock would stall them for the length of the
build, while CONCURRENTLY takes ``SHARE UPDATE EXCLUSIVE`` only.

No in-migration guards (no catalog read, no DROP on the upgrade path, no
``SET``), deliberately: coord's fail-closed migration classifier
(``pr_merge/migration_classifier.rs``) admits only DDL it can prove additive,
which is why ``coord_iops_idx_01`` shipped in this same provable form. The
killed-build hazard — a CONCURRENTLY build interrupted mid-way leaves an INVALID
index that ``IF NOT EXISTS`` then skips forever — is therefore checked AFTER
the deploy, by this read, which must return ``indisvalid = true``::

    SELECT c.relname, i.indisvalid
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'coord_sessions_tenant_started_idx';

Recovery for an INVALID result is a follow-up revision running
``DROP INDEX CONCURRENTLY IF EXISTS coord.coord_sessions_tenant_started_idx``
and then this revision's CREATE again. Never a plain ``DROP INDEX``.

Additive and expand-only: no table, column or existing index is altered, so
there is no column-before-migration hazard with coord. ``downgrade`` drops the
one index, CONCURRENTLY.

Hand-authored, never ``--autogenerate``d [policy: production-and-cost
alembic-sole-authorship]; every statement is schema-qualified ``coord.`` and
passed as a literal at its ``op.execute`` call site so
``.pre-commit-hooks/check_alembic_schema_args.py`` actually analyses it.

Behaviour test: ``tests/test_coord_sessions_fleet_idx_01_migration.py``. It
asserts the index is absent at the parent and valid after upgrade with the
intended key list, that coord's unfiltered first page and keyset continuation
ride it with no ``Sort`` (and that the same continuation DOES need a sort at the
parent revision — the "before" half of the plan's EXPLAIN verification), and
that downgrade removes it with the rows intact.

Revision ID: coord_sessions_fleet_idx_01
Revises: coord_iops_idx_01
Create Date: 2026-09-26

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_sessions_fleet_idx_01"
down_revision: str | None = "coord_iops_idx_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """One additive CONCURRENTLY index; verify ``indisvalid`` after deploy."""
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                coord_sessions_tenant_started_idx
            ON coord.sessions (tenant_id, started_at DESC, id DESC)
            """
        )


def downgrade() -> None:
    """Drop the additive index. The table and its rows survive."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS coord.coord_sessions_tenant_started_idx"
        )
