"""At-head guard: every table in a published schema has a replica identity.

Plan ``2026-10-15-coord-and-web-data-move-off-aws-by-logical-replication``
replicates production with a schema publication (D1)::

    FOR TABLES IN SCHEMA coord, coord_parts, agent, project, devenv, auth,
                         overview, web, cloud,
        TABLE public.alembic_version

A schema publication picks up a table the moment it is created, and once a
table without a replica identity is in a publication that publishes UPDATE and
DELETE, PostgreSQL REFUSES those statements on it with an error. So one future
revision that creates a table with no primary key would make every production
UPDATE/DELETE on that table fail. Revision ``replident_01`` (Phase 1a) fixed the
five tables that had that shape; this guard walks the whole chain to the head
and fails on any table that has it again. It is a standing guard, not a
one-off.

A table passes when PostgreSQL can identify its rows to a subscriber:

* ``relreplident = 'd'`` (DEFAULT) WITH a primary key;
* ``relreplident = 'i'`` (USING INDEX) with a valid index flagged
  ``indisreplident`` — after that index is dropped the table keeps ``'i'`` but
  behaves as NOTHING, so the flag alone is not enough;
* ``relreplident = 'f'`` (FULL).

It fails on ``'d'`` with no primary key and on ``'n'`` (NOTHING). Ordinary
tables and partitioned tables (``relkind`` ``r``/``p``) are checked, so a
partition in ``coord_parts`` is held to the same rule as its parent.

Substrate comes from ``_alembic_harness`` (an ephemeral database inside the
test Postgres, skipped when none is reachable). A skip proves nothing — set
``QONTINUI_TEST_PG_DSN`` (or ``QONTINUI_TEST_PG``) to run it.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.exc import DBAPIError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    run_alembic,
)

#: The plan's D1 publication scope, schema part.
PUBLISHED_SCHEMAS: tuple[str, ...] = (
    "coord",
    "coord_parts",
    "agent",
    "project",
    "devenv",
    "auth",
    "overview",
    "web",
    "cloud",
)

#: The plan's D1 publication scope, single tables outside those schemas.
PUBLISHED_TABLES: tuple[str, ...] = ("public.alembic_version",)

#: The five tables ``replident_01`` gave an identity. The guard covers every
#: published table; this list only pins that the walk is not vacuous.
REPLIDENT_01_TABLES: tuple[str, ...] = (
    "coord.worker_heartbeats",
    "coord.pr_unlandable_attempts",
    "coord.outbound_budget_observations",
    "coord.webhook_pulse",
    "coord.credential_probe_specs",
)

_PUBLISHED_RELATIONS = """
    SELECT c.oid,
           format('%I.%I', n.nspname, c.relname) AS name,
           c.relreplident                       AS ident
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p')
       AND (n.nspname = ANY(:schemas)
            OR format('%I.%I', n.nspname, c.relname) = ANY(:tables))
"""


def published_tables(conn: Connection) -> dict[str, str]:
    """``qualified name -> relreplident`` for every table the publication covers."""
    rows = conn.execute(
        text(f"SELECT name, ident FROM ({_PUBLISHED_RELATIONS}) t ORDER BY name"),
        {"schemas": list(PUBLISHED_SCHEMAS), "tables": list(PUBLISHED_TABLES)},
    ).fetchall()
    return {row[0]: row[1] for row in rows}


def tables_without_replica_identity(conn: Connection) -> list[str]:
    """Every published table whose UPDATE/DELETE a publication would refuse."""
    rows = conn.execute(
        text(
            f"""
            SELECT t.name
              FROM ({_PUBLISHED_RELATIONS}) t
             WHERE NOT (
                     (t.ident = 'd' AND EXISTS (
                         SELECT 1 FROM pg_constraint k
                          WHERE k.conrelid = t.oid AND k.contype = 'p'))
                  OR (t.ident = 'i' AND EXISTS (
                         SELECT 1 FROM pg_index i
                          WHERE i.indrelid = t.oid
                            AND i.indisreplident AND i.indisvalid))
                  OR t.ident = 'f')
             ORDER BY t.name
            """
        ),
        {"schemas": list(PUBLISHED_SCHEMAS), "tables": list(PUBLISHED_TABLES)},
    ).fetchall()
    return [row[0] for row in rows]


def publication_refusals(conn: Connection) -> list[str]:
    """Tables on which a real D1-scoped publication refuses a DELETE.

    The catalog predicate above is the guard; this is the behaviour it stands
    for, read from PostgreSQL itself. It creates the D1 publication over every
    published schema that exists here (``CREATE PUBLICATION`` refuses a missing
    schema) and runs ``DELETE … WHERE false`` on each published table inside a
    savepoint: the replica-identity check runs when the statement starts, so it
    fires on zero rows. The caller owns the transaction and rolls it back.
    """
    schemas = [
        row[0]
        for row in conn.execute(
            text("SELECT nspname FROM pg_namespace WHERE nspname = ANY(:s)"),
            {"s": list(PUBLISHED_SCHEMAS)},
        ).fetchall()
    ]
    scope = ", ".join(f'"{schema}"' for schema in sorted(schemas))
    conn.execute(
        text(
            "CREATE PUBLICATION replident_guard_probe "
            f"FOR TABLES IN SCHEMA {scope}, TABLE public.alembic_version "
            "WITH (publish_via_partition_root = true)"
        )
    )
    refused: list[str] = []
    for name in published_tables(conn):
        savepoint = conn.begin_nested()
        try:
            conn.execute(text(f"DELETE FROM {name} WHERE false"))
        except DBAPIError as exc:
            if "does not have a replica identity" not in str(exc.orig):
                raise
            refused.append(name)
        finally:
            savepoint.rollback()
    return refused


@pytest.fixture(scope="module")
def at_head() -> Iterator[Engine]:
    admin_url = admin_database_url()
    if not can_connect(admin_url):
        pytest.skip(f"no test Postgres reachable at {admin_url}")
    with ephemeral_database(admin_url, "replident_head") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", "head")
        yield engine


def test_every_published_table_at_head_has_a_replica_identity(
    at_head: Engine,
) -> None:
    with at_head.connect() as conn:
        tables = published_tables(conn)
        offenders = tables_without_replica_identity(conn)
    # Non-vacuous: the walk must have reached the tables it was written for,
    # and the scope must match more than a handful of tables.
    for table in (*REPLIDENT_01_TABLES, *PUBLISHED_TABLES):
        assert table in tables, f"{table} is missing at head"
    assert len(tables) > 100, f"only {len(tables)} published tables seen at head"
    assert not offenders, (
        f"table(s) in a published schema with no replica identity at the alembic "
        f"head: {offenders}. Logical replication publishes UPDATE and DELETE for "
        "these schemas, and PostgreSQL REFUSES those statements on a published "
        "table it cannot identify rows of, so production writes to these tables "
        "would fail. Give each a PRIMARY KEY (preferred), or ALTER TABLE … "
        "REPLICA IDENTITY USING INDEX <unique, non-partial index over NOT NULL "
        "columns>, or REPLICA IDENTITY FULL for a small table."
    )


def test_replident_01_tables_use_their_unique_index(at_head: Engine) -> None:
    """The five tables got ``USING INDEX`` on the constraint coord upserts on."""
    with at_head.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT format('%I.%I', n.nspname, c.relname), c.relreplident,
                       ic.relname
                  FROM pg_class c
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                  LEFT JOIN pg_index i
                    ON i.indrelid = c.oid AND i.indisreplident
                  LEFT JOIN pg_class ic ON ic.oid = i.indexrelid
                 WHERE format('%I.%I', n.nspname, c.relname) = ANY(:names)
                """
            ),
            {"names": list(REPLIDENT_01_TABLES)},
        ).fetchall()
    got = {row[0]: (row[1], row[2]) for row in rows}
    assert got == {
        "coord.worker_heartbeats": ("i", "worker_heartbeats_name_replica_id_uq"),
        "coord.pr_unlandable_attempts": ("i", "pr_unlandable_attempts_composite_key"),
        "coord.outbound_budget_observations": (
            "i",
            "outbound_budget_observations_dependency_resource_uq",
        ),
        "coord.webhook_pulse": ("i", "webhook_pulse_repo_event_type_uq"),
        "coord.credential_probe_specs": (
            "i",
            "uq_credential_probe_specs_tenant_token",
        ),
    }


@pytest.mark.parametrize(
    ("mutation", "offender"),
    [
        # What a downgrade of replident_01 (or a drifted production) looks like.
        (
            "ALTER TABLE coord.webhook_pulse REPLICA IDENTITY DEFAULT",
            "coord.webhook_pulse",
        ),
        # NOTHING is refused for UPDATE/DELETE whatever keys the table has.
        (
            "ALTER TABLE coord.worker_heartbeats REPLICA IDENTITY NOTHING",
            "coord.worker_heartbeats",
        ),
        # The identity index is dropped: relreplident stays 'i' but nothing
        # identifies a row any more.
        (
            "ALTER TABLE coord.pr_unlandable_attempts "
            "DROP CONSTRAINT pr_unlandable_attempts_composite_key",
            "coord.pr_unlandable_attempts",
        ),
        # A FUTURE revision that creates a table with no primary key.
        (
            "CREATE TABLE coord.zz_replident_guard_probe (a int, b text)",
            "coord.zz_replident_guard_probe",
        ),
        # The published single table outside the published schemas.
        (
            "ALTER TABLE public.alembic_version DROP CONSTRAINT alembic_version_pkc",
            "public.alembic_version",
        ),
    ],
    ids=["default-no-pk", "nothing", "index-dropped", "new-table", "alembic-version"],
)
def test_the_guard_reds_when_one_table_loses_its_identity(
    at_head: Engine, mutation: str, offender: str
) -> None:
    """The mutation proof, run in a transaction that is rolled back.

    The shared head database is left exactly as the walk produced it, which
    the final assertion re-checks.
    """
    with at_head.connect() as conn:
        transaction = conn.begin()
        try:
            assert tables_without_replica_identity(conn) == []
            conn.execute(text(mutation))
            assert tables_without_replica_identity(conn) == [offender]
        finally:
            transaction.rollback()
        assert tables_without_replica_identity(conn) == []


def test_full_identity_passes_without_a_primary_key(at_head: Engine) -> None:
    """``FULL`` is an accepted identity for a key-less table."""
    with at_head.connect() as conn:
        transaction = conn.begin()
        try:
            conn.execute(text("CREATE TABLE coord.zz_replident_full (a int)"))
            conn.execute(
                text("ALTER TABLE coord.zz_replident_full REPLICA IDENTITY FULL")
            )
            assert tables_without_replica_identity(conn) == []
        finally:
            transaction.rollback()


def test_a_d1_publication_refuses_no_published_table(at_head: Engine) -> None:
    """PostgreSQL itself agrees with the predicate: the publication refuses none."""
    with at_head.connect() as conn:
        transaction = conn.begin()
        try:
            assert publication_refusals(conn) == []
        finally:
            transaction.rollback()


def test_a_d1_publication_refuses_the_table_whose_identity_is_dropped(
    at_head: Engine,
) -> None:
    """The behavioural half of the mutation proof (rolled back)."""
    with at_head.connect() as conn:
        transaction = conn.begin()
        try:
            conn.execute(
                text("ALTER TABLE coord.webhook_pulse REPLICA IDENTITY DEFAULT")
            )
            assert publication_refusals(conn) == ["coord.webhook_pulse"]
        finally:
            transaction.rollback()
