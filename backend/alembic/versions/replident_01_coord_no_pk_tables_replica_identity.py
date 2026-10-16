"""coord: give the five primary-key-less tables a replica identity

Revision ID: replident_01
Revises: coord_pr_holds_01
Create Date: 2026-10-16

Plan ``2026-10-15-coord-and-web-data-move-off-aws-by-logical-replication``,
Phase 1a.

## Why

The plan replicates production to a local subscriber with a schema publication
(``FOR TABLES IN SCHEMA coord, …``). Once a table is in a publication that
publishes UPDATE and DELETE, PostgreSQL REFUSES those statements on it with an
error unless the table has a replica identity: a primary key (what
``REPLICA IDENTITY DEFAULT`` uses), an explicit ``USING INDEX``, or ``FULL``.
The plan's read-only census found exactly five tables with no primary key, all
in ``coord`` and all at ``REPLICA IDENTITY DEFAULT``, so the moment the
publication exists every coord upsert into them would fail:

========================================  ==================================================  ==============================
Table                                     Unique constraint (created in)                      Columns, all ``NOT NULL``
========================================  ==================================================  ==============================
``coord.worker_heartbeats``               ``worker_heartbeats_name_replica_id_uq``            ``(name, replica_id)``
                                          (``coord_agent_debug_01_…``)
``coord.pr_unlandable_attempts``          ``pr_unlandable_attempts_composite_key``            ``(pr_number, head_sha, tier)``
                                          (``pr_unlandable_attempts_01_create_table``)
``coord.outbound_budget_observations``    ``outbound_budget_observations_dependency_resource  ``(dependency, resource)``
                                          _uq`` (``coord_agent_debug_01_…``)
``coord.webhook_pulse``                   ``webhook_pulse_repo_event_type_uq``                ``(repo, event_type)``
                                          (``coord_agent_debug_01_…``)
``coord.credential_probe_specs``          ``uq_credential_probe_specs_tenant_token``          ``(tenant_id, token)``
                                          (``credprobe_01_credential_probe_specs``)
========================================  ==================================================  ==============================

No later revision alters any of these columns' nullability (the only later
change to any of the five is ``worker_hb_body_started_01``'s nullable
``body_started_at``, which is not in the key).

## Decision: ``REPLICA IDENTITY USING INDEX`` on the existing unique index

The plan prefers promoting the unique index to a primary key. It is not done
here, because a promotion costs more than it buys on these tables:

* PostgreSQL's ``ADD PRIMARY KEY USING INDEX`` refuses an index that already
  backs a constraint (``index "…" is already associated with a constraint``),
  so the existing index cannot be promoted in place. A promotion needs a NEW
  unique index built first (``CREATE UNIQUE INDEX CONCURRENTLY``, outside any
  transaction), then ``DROP CONSTRAINT x, ADD CONSTRAINT x PRIMARY KEY USING
  INDEX <new>``. That keeps the constraint NAME — which matters, because coord
  upserts three of these tables with ``ON CONFLICT ON CONSTRAINT <name>``
  (``worker_heartbeats`` in ``worker_ledger.rs`` and
  ``worker_liveness_watcher.rs``, ``outbound_budget_observations`` in
  ``outbound_budget_observer.rs``, ``webhook_pulse`` in ``webhook_pulse.rs``;
  ``pr_unlandable_attempts`` is upserted by column inference and
  ``credential_probe_specs`` has no coord writer) — but it is a concurrent
  index build per table, plus a constraint swap under ``ACCESS EXCLUSIVE``.
* Keeping the unique constraint and adding a primary key beside it instead
  doubles index maintenance on ``worker_heartbeats``, coord's hottest upsert
  target, for no gain.
* Coord's own test bootstraps re-create two of these tables
  (``worker_heartbeats``, ``outbound_budget_observations``) with ``UNIQUE``
  constraints (``CREATE TABLE IF NOT EXISTS`` in ``mcp/tools.rs``), so a
  production primary key would drift from what coord's tests run against.

``REPLICA IDENTITY USING INDEX`` names the same key a promoted primary key
would — the unique, non-partial, immediate index whose columns are all
``NOT NULL`` — so the subscriber identifies a row by exactly the same columns.
It is catalog-only: no index build, no table rewrite, no constraint touched.
Every column of every one of the five keys is ``NOT NULL`` in the chain, so no
nullability changes.

``REPLICA IDENTITY FULL`` is the fallback for a table whose catalog does not
match the chain (the constraint missing, deferrable, partial, invalid, or over
a nullable column — production drift). All five tables are small (the largest,
``worker_heartbeats``, held 15K rows), so FULL costs little; a fallback is
logged by a ``NOTICE``. Nothing changes nullability.

## How each table is handled

Each table is decided from the catalog in its own ``DO`` block, so the
revision is idempotent and safe against drift:

* table absent → nothing (``NOTICE``);
* table already has a primary key → nothing (``DEFAULT`` already uses it);
* identity already ``FULL``, or ``USING INDEX`` on a valid index → nothing;
* the named unique constraint's index qualifies → ``USING INDEX`` it;
* otherwise → ``FULL``.

``ALTER TABLE … REPLICA IDENTITY`` takes ``ACCESS EXCLUSIVE`` for a catalog
update. ``env.py`` runs a deploy batch in one transaction, so in-batch that lock
would be held until the whole batch commits, stalling coord's heartbeat writes.
Each table therefore runs in an ``autocommit_block`` as its own transaction,
under ``SET LOCAL lock_timeout = '3s'``. A lock timeout is the correct outcome
when something holds the table: re-run, and the tables already done are
skipped.

## Downgrade

Returns each of the five to ``REPLICA IDENTITY DEFAULT`` when it has no primary
key, which is the shape of ``coord_pr_holds_01``. Do NOT downgrade while a
publication that publishes UPDATE/DELETE includes these tables: it restores
exactly the failure this revision removes.

## Standing guard

``tests/test_replica_identity_published_schemas.py`` walks the chain to the head
and fails on any table in a published schema (the plan's D1 list, plus
``public.alembic_version``) without a replica identity, so a FUTURE table
created without a primary key is caught before production.

If another revision lands on ``coord_pr_holds_01`` first, re-point
``down_revision`` (and the ``Revises:`` line above), and the parent pinned in
``tests/test_replident_01_migration.py``.
"""

import contextlib
from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "replident_01"
down_revision: str | Sequence[str] | None = "coord_pr_holds_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: ``(table, unique constraint whose index becomes the replica identity)``.
TABLES: tuple[tuple[str, str], ...] = (
    ("worker_heartbeats", "worker_heartbeats_name_replica_id_uq"),
    ("pr_unlandable_attempts", "pr_unlandable_attempts_composite_key"),
    (
        "outbound_budget_observations",
        "outbound_budget_observations_dependency_resource_uq",
    ),
    ("webhook_pulse", "webhook_pulse_repo_event_type_uq"),
    ("credential_probe_specs", "uq_credential_probe_specs_tenant_token"),
)

_SCHEMA = "coord"


def _upgrade_sql(table: str, constraint: str) -> str:
    """The catalog-deciding ``DO`` block for one table (static identifiers only)."""
    return f"""
DO $replident$
DECLARE
    rel   regclass := to_regclass('{_SCHEMA}.{table}');
    ident "char";
    idx   oid;
BEGIN
    IF rel IS NULL THEN
        RAISE NOTICE 'replident_01: {_SCHEMA}.{table} is absent; nothing to do';
        RETURN;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_constraint
                WHERE conrelid = rel AND contype = 'p') THEN
        RETURN;  -- REPLICA IDENTITY DEFAULT already uses the primary key
    END IF;

    SELECT relreplident INTO ident FROM pg_class WHERE oid = rel;
    IF ident = 'f' THEN
        RETURN;
    END IF;
    IF ident = 'i' AND EXISTS (SELECT 1 FROM pg_index
                                WHERE indrelid = rel AND indisreplident
                                  AND indisvalid) THEN
        RETURN;
    END IF;

    SELECT c.conindid INTO idx
      FROM pg_constraint c
      JOIN pg_index i ON i.indexrelid = c.conindid
     WHERE c.conrelid = rel
       AND c.conname = '{constraint}'
       AND c.contype = 'u'
       AND NOT c.condeferrable
       AND i.indisunique AND i.indisvalid AND i.indimmediate
       AND i.indpred IS NULL AND i.indexprs IS NULL
       AND NOT EXISTS (
             SELECT 1
               FROM unnest(i.indkey::int2[]) AS k(attnum)
               JOIN pg_attribute a
                 ON a.attrelid = rel AND a.attnum = k.attnum
              WHERE NOT a.attnotnull);

    IF idx IS NOT NULL THEN
        EXECUTE format('ALTER TABLE %s REPLICA IDENTITY USING INDEX %I',
                       rel, (SELECT relname FROM pg_class WHERE oid = idx));
    ELSE
        RAISE NOTICE 'replident_01: {_SCHEMA}.{table} has no qualifying {constraint} index; using REPLICA IDENTITY FULL';
        EXECUTE format('ALTER TABLE %s REPLICA IDENTITY FULL', rel);
    END IF;
END
$replident$
"""


def _downgrade_sql(table: str) -> str:
    """Return one table to ``DEFAULT`` unless it has gained a primary key."""
    return f"""
DO $replident$
DECLARE
    rel regclass := to_regclass('{_SCHEMA}.{table}');
BEGIN
    IF rel IS NULL THEN
        RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint
                WHERE conrelid = rel AND contype = 'p') THEN
        RETURN;
    END IF;
    IF (SELECT relreplident FROM pg_class WHERE oid = rel) <> 'd' THEN
        EXECUTE format('ALTER TABLE %s REPLICA IDENTITY DEFAULT', rel);
    END IF;
END
$replident$
"""


def _run_in_own_transaction(sql: str) -> None:
    """One table per transaction, its ``ACCESS EXCLUSIVE`` wait bounded to 3 s."""
    op.execute("BEGIN")
    try:
        op.execute("SET LOCAL lock_timeout = '3s'")
        op.execute(sql)
    except BaseException:
        with contextlib.suppress(Exception):
            op.execute("ROLLBACK")
        raise
    op.execute("COMMIT")


def upgrade() -> None:
    """Give each of the five tables a replica identity, decided from the catalog."""
    with op.get_context().autocommit_block():
        for table, constraint in TABLES:
            _run_in_own_transaction(_upgrade_sql(table, constraint))


def downgrade() -> None:
    """Return the five tables to ``REPLICA IDENTITY DEFAULT`` (the parent's shape)."""
    with op.get_context().autocommit_block():
        for table, _constraint in reversed(TABLES):
            _run_in_own_transaction(_downgrade_sql(table))
