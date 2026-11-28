"""coordmem 02 — coord.memories: uniqueness is per (tenant_id, name, version), and the name-only index goes

Revision ID: coordmem_02
Revises: pr_fix_ctx_head_sha_01
Create Date: 2026-10-19

Phase 2a of plan ``2026-10-16-coord-memories-latest-view-crosses-tenants``
(qontinui-dev-notes ``plans/``), from coord findings ``0eaac777`` and
``7db707df``.

What it is for
==============

Every writer of ``coord.memories`` numbers versions per tenant
(``INSERT … SELECT COALESCE(MAX(version), 0) + 1 … WHERE name = $2 AND tenant_id
= $n``), but the table's key was ``UNIQUE (name, version)`` across ALL tenants.
Two tenants writing the same name therefore collided on ``unique_violation``
at version 1, and the refusal was an oracle: it told tenant B that tenant A
holds that name. Once row-level security hides other tenants' rows, a global
key would also report rows the writer cannot see. ``coordmem_01`` made the
READ side per tenant; this revision makes the KEY per tenant.

What changes
============

* ``memories_name_version_key UNIQUE (name, version)`` becomes
  ``memories_tenant_id_name_version_key UNIQUE (tenant_id, name, version)``.
  The build cannot fail on data: uniqueness of ``(name, version)`` implies
  uniqueness of ``(tenant_id, name, version)``, and ``tenant_id`` is NOT NULL.
* ``idx_memories_name_latest (name, version DESC)`` is dropped. Every reader
  and writer now filters on ``name`` AND ``tenant_id``, so the new key serves
  the next-version probe, the history read and the version read, and the old
  index is a pure write cost. Nothing in qontinui-web names it (`git grep`); the plan's vet reported the same of coord and the runner.

Mechanism
=========

1. ``CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS`` in an
   ``autocommit_block``. A leftover INVALID index of that name (an interrupted
   concurrent build, which ``IF NOT EXISTS`` would silently keep) is found in
   the catalog, dropped ``CONCURRENTLY`` and rebuilt.
2. One transaction with ``SET LOCAL lock_timeout = '3s'``: ``ADD CONSTRAINT …
   UNIQUE USING INDEX`` then ``DROP CONSTRAINT`` of the old key. Both take
   ``AccessExclusiveLock`` on ``coord.memories`` for milliseconds; the table is
   about 200 rows.
3. ``DROP INDEX CONCURRENTLY IF EXISTS`` of the name index.

Every step decides from the catalog and does nothing when already done, so a
retry after a partial run (``alembic_version`` has not moved because the batch
committed inside the autocommit block) is a no-op.

Downgrade
=========

REFUSES when any ``(name, version)`` is held by more than one row: the old
global key cannot be rebuilt over that data. The message names the count and
the remedy. Otherwise it rebuilds ``idx_memories_name_latest`` and
``memories_name_version_key`` (a concurrent index, then ``USING INDEX``) and
drops the per-tenant key. ``check_coord_column_drops.py`` ignores
``DROP CONSTRAINT`` and reads only table and column drops, so neither drop
here is its business.

Landing
=======

coord's migration classifier rejects explicit ``BEGIN`` / ``COMMIT`` and
``DROP CONSTRAINT``, so the PR is escalate-path-matched and is cleared through
``coord_submit_escalate_evidence`` once ``Migration Reversal Gate`` is green.

Chains off ``pr_fix_ctx_head_sha_01``
=====================================

The single alembic head on ``origin/main`` when this was written
(``alembic heads`` printed exactly one). The plan text said ``coordmem_01`` and
then ``ingcred_01``; both are ancestors of this head. If another revision lands
first, re-point ``down_revision``, the ``Revises:`` line above and
``_PARENT_REVISION_ID`` in the companion test together. No ``alembic merge``.
"""

import contextlib
from collections.abc import Iterator, Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "coordmem_02"
down_revision: str | Sequence[str] | None = "pr_fix_ctx_head_sha_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = "coord.memories"
NEW_KEY = "memories_tenant_id_name_version_key"
OLD_KEY = "memories_name_version_key"
NAME_INDEX = "idx_memories_name_latest"

#: The per-tenant key's columns, and the old global key's.
NEW_KEY_COLUMNS = "tenant_id, name, version"
OLD_KEY_COLUMNS = "name, version"
NAME_INDEX_COLUMNS = "name, version DESC"

_LOCK = "SET LOCAL lock_timeout = '3s'"

_CONSTRAINT_EXISTS = sa.text(
    "SELECT count(*) FROM pg_catalog.pg_constraint "
    "WHERE conrelid = 'coord.memories'::regclass AND conname = :name"
)

# ``indisvalid`` of an index on the table, by name; no row when absent.
_INDEX_VALID = sa.text(
    "SELECT i.indisvalid FROM pg_catalog.pg_index i "
    "JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid "
    "WHERE i.indrelid = 'coord.memories'::regclass AND c.relname = :name"
)

_SHARED_VERSIONS = sa.text(
    "SELECT count(*) FROM (SELECT 1 FROM coord.memories "
    "GROUP BY name, version HAVING count(*) > 1) AS shared"
)


def _scalar(query: sa.TextClause, name: str | None = None) -> object | None:
    params = {} if name is None else {"name": name}
    return op.get_bind().execute(query, params).scalar()


def _has_constraint(name: str) -> bool:
    return bool(_scalar(_CONSTRAINT_EXISTS, name))


def _build_index(name: str, columns: str, *, unique: bool) -> None:
    """Build an index concurrently, replacing an INVALID leftover.

    ``IF NOT EXISTS`` keeps an index an interrupted build left INVALID, and an
    INVALID unique index enforces nothing, so a constraint built on it would
    be a lie. Dropping it first makes the build real.
    """
    if _scalar(_INDEX_VALID, name) is False:
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS coord.{name}")
    kind = "UNIQUE INDEX" if unique else "INDEX"
    op.execute(
        f"CREATE {kind} CONCURRENTLY IF NOT EXISTS {name} ON {TABLE} ({columns})"
    )


def _swap_constraint(add: str, drop: str) -> None:
    """Promote ``add``'s index to a constraint and drop ``drop``, in one short transaction.

    The catalog is read first, then ONE multi-statement string runs, so a
    failure (the 3s lock timeout) rolls the whole transaction back on the
    server instead of leaving the session inside an aborted block.
    """
    statements = []
    if not _has_constraint(add):
        statements.append(
            f"ALTER TABLE {TABLE} ADD CONSTRAINT {add} UNIQUE USING INDEX {add}"
        )
    if _has_constraint(drop):
        statements.append(f"ALTER TABLE {TABLE} DROP CONSTRAINT {drop}")
    if statements:
        op.execute("BEGIN; " + _LOCK + "; " + "; ".join(statements) + "; COMMIT")


@contextlib.contextmanager
def _bounded_waits() -> Iterator[None]:
    """Bound the waits of the CONCURRENTLY statements, which sit outside the 3s transaction.

    They wait for every older transaction on the database, so an idle-in-
    transaction session would stall a deploy with no error. A timeout here fails
    the run; the INVALID-leftover handling and the catalog-decided steps make a
    re-run safe.
    """
    op.execute("SET lock_timeout = '60s'")
    try:
        yield
    finally:
        op.execute("RESET lock_timeout")


def upgrade() -> None:
    """Swap the global key for a per-tenant one, then drop the name index."""
    with op.get_context().autocommit_block(), _bounded_waits():
        _build_index(NEW_KEY, NEW_KEY_COLUMNS, unique=True)
        _swap_constraint(add=NEW_KEY, drop=OLD_KEY)
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS coord.{NAME_INDEX}")


def downgrade() -> None:
    """Restore the global key and the name index, refusing over shared (name, version)."""
    with op.get_context().autocommit_block(), _bounded_waits():
        shared = int(_scalar(_SHARED_VERSIONS) or 0)
        if shared:
            raise RuntimeError(
                "coordmem_02 downgrade refused: "
                + str(shared)
                + " (name, version) pair(s) in coord.memories are held by more than one"
                + " tenant, so the global unique key "
                + OLD_KEY
                + " cannot be rebuilt over this data. Rename or delete the colliding"
                + " memories of all but one tenant, then downgrade again."
            )
        _build_index(NAME_INDEX, NAME_INDEX_COLUMNS, unique=False)
        _build_index(OLD_KEY, OLD_KEY_COLUMNS, unique=True)
        _swap_constraint(add=OLD_KEY, drop=NEW_KEY)
