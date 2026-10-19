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
  index is a pure write cost. Nothing names it in coord, web or the runner.

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

from collections.abc import Sequence

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


def _build_unique_index(name: str, columns: str) -> None:
    """Build a unique index concurrently, replacing an INVALID leftover.

    ``IF NOT EXISTS`` keeps an index an interrupted build left INVALID, and an
    INVALID unique index enforces nothing, so the constraint built on it would
    be a lie. Dropping it first makes the build real.
    """
    if _scalar(_INDEX_VALID, name) is False:
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS coord.{name}")
    op.execute(
        f"CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS {name} ON {TABLE} ({columns})"
    )


def _swap_constraint(add: str, drop: str) -> None:
    """Promote ``add``'s index to a constraint and drop ``drop``, in one short transaction."""
    if _has_constraint(add):
        if _has_constraint(drop):
            op.execute("BEGIN")
            op.execute(_LOCK)
            op.execute(f"ALTER TABLE {TABLE} DROP CONSTRAINT {drop}")
            op.execute("COMMIT")
        return
    op.execute("BEGIN")
    op.execute(_LOCK)
    op.execute(f"ALTER TABLE {TABLE} ADD CONSTRAINT {add} UNIQUE USING INDEX {add}")
    if _has_constraint(drop):
        op.execute(f"ALTER TABLE {TABLE} DROP CONSTRAINT {drop}")
    op.execute("COMMIT")


def upgrade() -> None:
    """Swap the global key for a per-tenant one, then drop the name index."""
    with op.get_context().autocommit_block():
        _build_unique_index(NEW_KEY, NEW_KEY_COLUMNS)
        _swap_constraint(add=NEW_KEY, drop=OLD_KEY)
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS coord.{NAME_INDEX}")


def downgrade() -> None:
    """Restore the global key and the name index, refusing over shared (name, version)."""
    with op.get_context().autocommit_block():
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
        op.execute(
            f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {NAME_INDEX} "
            f"ON {TABLE} (name, version DESC)"
        )
        _build_unique_index(OLD_KEY, OLD_KEY_COLUMNS)
        _swap_constraint(add=OLD_KEY, drop=NEW_KEY)
