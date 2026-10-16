"""coordmem 01 — coord.memories_latest: the latest version per (tenant_id, name), absent when that version is a tombstone

Revision ID: coordmem_01
Revises: coordconv_01
Create Date: 2026-10-16

Phase 1 of plan ``2026-10-16-coord-memories-latest-view-crosses-tenants``
(qontinui-dev-notes ``plans/``), from coord findings ``0eaac777`` and
``7db707df``.

What it is for
==============

``coord.memories`` is append-only: every write adds a row, and every reader
goes through this view. The definition it replaces (``coord_tenant_scope_columns``,
kept by ``coordrls_01``, which only set ``security_invoker``) had two defects.

1. **Cross-tenant.** ``SELECT DISTINCT ON (name)`` kept ONE row per name across
   ALL tenants. Every reader filters ``tenant_id`` AFTER the view, so a tenant's
   memory vanished whenever another tenant held a higher version of the same
   name. ``tenant_id`` was not a ``DISTINCT ON`` key, so the planner could not
   push a reader's tenant filter below the ``DISTINCT ON`` either.
2. **A tombstone never retracted a name.** ``WHERE NOT is_tombstone`` ran BEFORE
   ``DISTINCT ON``, so a name whose latest version is a tombstone served its
   previous live version. ``DELETE /coord/memory/:name`` appends exactly such a
   tombstone, so a delete never removed a name from any read. That contradicted
   coord's documented contract (``get_one``: "404 ... if the latest version is
   a tombstone") and the bridge's designed removal path
   (``app/jobs/memory_bridge.py``).

The new definition takes the latest version per ``(tenant_id, name)`` inside a
subquery, then drops it when it is a tombstone.

What changes for whom
=====================

* coord's ``GET /coord/memory/list`` and ``GET /coord/memory/:name`` (and the
  admin pages that proxy them) return each tenant's own latest memory, and a
  deleted memory 404s, as their docs already say.
* ``app/services/memory_store.py`` (the bridge's two reads) gets one row per
  ``(tenant, name)``; a deleted memory leaves the key set, and the bridge then
  tombstones its bridged ``coord.memory_records`` row. Measured in production on
  2026-10-16: exactly one such row, in a tester tenant, and no memory name held
  by more than one tenant.
* coord's ``coord_memories_count`` metric counts live memories per tenant and
  name (203 -> 202 on 2026-10-16).

No reader code changes: every filtering reader already filters on
``tenant_id``, and that filter now reaches the ``DISTINCT ON`` subquery.

The view's identity
===================

``CREATE OR REPLACE VIEW`` keeps the view's OID, owner, ACL and dependencies.
The grants ``coordrls_01`` gave ``coord_tenant`` and ``coord_tenant_preflight``
therefore survive. ``DROP`` and ``CREATE`` would have changed the OID and opened
a window in which every reader errors.

``CREATE OR REPLACE VIEW`` RESETS the view's options unless its own ``WITH``
clause sets them, so ``security_invoker = true`` is in the statement itself.
``tests/test_coord_views_security_invoker.py`` reds a coord view without it.
The column list is unchanged in names, types and order, which
``CREATE OR REPLACE VIEW`` requires.

The lock
========

The replace takes ``AccessExclusiveLock`` on the view (and ``AccessShareLock``
on ``coord.memories``). ``alembic/env.py`` runs a whole upgrade batch in ONE
transaction, so inside it that lock would be held until the deploy batch
commits. The change therefore runs in an ``autocommit_block`` as a transaction
of its own, ``BEGIN; SET LOCAL lock_timeout = '3s'; ...; COMMIT``, the
``coordrls_01`` idiom: the lock lasts only the replace. A reader holding the
view makes the run fail fast, and a re-run is a no-op. Entering the block
commits the batch so far, which is accepted: the revision is idempotent.

Downgrade
=========

Restores the parent's object exactly: the ``coord_tenant_scope_columns``
definition verbatim (``PREVIOUS_SELECT``), still ``security_invoker = true``
(which ``coordrls_01`` set), and no comment (production had none). The
companion test asserts ``pg_get_viewdef``, the options, the ACL, the owner and
the OID against the parent.

Landing
=======

coord's migration classifier rejects ``CREATE OR REPLACE VIEW`` and the explicit
``BEGIN`` / ``COMMIT``, so the PR is escalate-path-matched and is cleared through
``coord_submit_escalate_evidence`` once ``Migration Reversal Gate`` is green.

Chains off ``coordconv_01``
===========================

The single alembic head on ``origin/main`` at ``16d9e297f`` (``poetry run
alembic heads`` printed exactly one). If another revision lands first,
re-point ``down_revision``, the ``Revises:`` line above and
``_PARENT_REVISION_ID`` in the companion test together. No ``alembic merge``.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "coordmem_01"
down_revision: str | Sequence[str] | None = "coordconv_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


#: The view this revision re-defines.
VIEW = "coord.memories_latest"

#: The view's columns, in its existing order (``CREATE OR REPLACE VIEW``
#: requires the list unchanged).
COLUMNS: tuple[str, ...] = (
    "memory_id",
    "name",
    "version",
    "content",
    "description",
    "type",
    "written_by_agent",
    "written_by_device",
    "written_at",
    "is_tombstone",
    "tenant_id",
)

_COLS = ", ".join(COLUMNS)

#: The latest version per (tenant_id, name); absent when that version is a
#: tombstone. The tombstone filter sits OUTSIDE the ``DISTINCT ON`` on purpose:
#: inside it, a tombstone would expose the previous live version.
MEMORIES_LATEST_SELECT = f"""
    SELECT {_COLS}
      FROM (SELECT DISTINCT ON (tenant_id, name) {_COLS}
              FROM coord.memories
             ORDER BY tenant_id, name, version DESC) AS latest
     WHERE NOT is_tombstone
"""

#: ``coord_tenant_scope_columns``' definition, verbatim: what downgrade() restores.
PREVIOUS_SELECT = """
            SELECT DISTINCT ON (name)
                memory_id, name, version, content, description, type,
                written_by_agent, written_by_device, written_at, is_tombstone,
                tenant_id
            FROM coord.memories
            WHERE NOT is_tombstone
            ORDER BY name, version DESC
"""

#: The catalog comment the upgrade sets, so a reader of the schema learns the
#: semantics without the plan.
VIEW_COMMENT = (
    "Latest version of each memory per (tenant_id, name); a name whose latest "
    "version is a tombstone is absent. Defined by qontinui-web alembic revision "
    "coordmem_01. security_invoker, so row-level security on coord.memories "
    "filters a coord_tenant reader."
)


def replace_view_sql(select: str, comment: str | None) -> str:
    """Re-define the view as one short transaction of its own (see the module docs)."""
    comment_sql = "NULL" if comment is None else "'" + comment.replace("'", "''") + "'"
    return (
        "BEGIN; SET LOCAL lock_timeout = '3s'; "
        f"CREATE OR REPLACE VIEW {VIEW} WITH (security_invoker = true) AS {select}; "
        f"COMMENT ON VIEW {VIEW} IS {comment_sql}; "
        "COMMIT"
    )


def upgrade() -> None:
    """Re-define ``coord.memories_latest`` per (tenant_id, name), tombstone-aware."""
    with op.get_context().autocommit_block():
        op.execute(replace_view_sql(MEMORIES_LATEST_SELECT, VIEW_COMMENT))


def downgrade() -> None:
    """Restore the parent's definition, options and (absent) comment exactly."""
    with op.get_context().autocommit_block():
        op.execute(replace_view_sql(PREVIOUS_SELECT, None))
