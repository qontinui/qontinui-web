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
* ``relreplident = 'f'`` (FULL) when every column's type has a default
  equality operator — under FULL the SUBSCRIBER finds the old row by comparing
  every column, and a ``json`` / ``point`` / ``xml`` column stalls its apply
  with "could not identify an equality operator". The publisher accepts such a
  table, so only this predicate catches it.

It fails on ``'d'`` with no primary key, on ``'n'`` (NOTHING), and on FULL
over a column with no equality operator. Ordinary tables and partitioned
tables (``relkind`` ``r``/``p``) are checked, and so is every partition of a
published partitioned table, whichever schema the partition lives in.

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

# A relation is published when it, or any partitioned ancestor of it, is in the
# scope: a partition of a published partitioned table is published (its
# changes are what the parent's publication carries) wherever the partition
# itself lives, and the publisher checks the PARTITION's replica identity.
# ``pg_partition_ancestors`` includes the relation itself, but returns NO rows
# for a table that is neither a partition nor partitioned, so the relation's own
# schema and name are tested directly as well.
_PUBLISHED_RELATIONS = """
    SELECT c.oid,
           format('%I.%I', n.nspname, c.relname) AS name,
           c.relreplident                       AS ident
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p')
       AND (n.nspname = ANY(:schemas)
            OR format('%I.%I', n.nspname, c.relname) = ANY(:tables)
            OR EXISTS (
             SELECT 1
               FROM pg_partition_ancestors(c.oid) AS anc(relid)
               JOIN pg_class ac ON ac.oid = anc.relid
               JOIN pg_namespace an ON an.oid = ac.relnamespace
              WHERE an.nspname = ANY(:schemas)
                 OR format('%I.%I', an.nspname, ac.relname) = ANY(:tables)))
"""

# A column the subscriber cannot compare under REPLICA IDENTITY FULL. With FULL
# the apply worker finds the old row by comparing EVERY column with its type's
# default equality operator (``tuples_equal`` → ``lookup_type_cache``), and a
# type without one stalls apply with "could not identify an equality operator
# for type …". This mirrors the type cache: a default btree or hash opclass on
# the type, or on a type it is implicitly binary-coercible to (``varchar`` →
# ``text``; NOT ``xml`` → ``text``, whose cast is not implicit), or the
# polymorphic opclass for an enum / range / multirange / composite; a domain is
# read through to its base type and an array through to its element. Known
# limits (none occurs in the published schemas today): a composite passes
# without checking its fields, an array of a domain is not read through to the
# domain's base type, and generated columns are not skipped. Observed by the
# implementing session against a throwaway pg16 subscription (not recorded in
# this repo): json, point, xml, json[] and a domain over
# json fail; text, varchar, jsonb, uuid, int[], enums, domains over text,
# bytea, inet, cidr, int4range, char, name, numeric and pgvector's vector pass.
_COLUMN_WITHOUT_EQUALITY = """
    SELECT 1
      FROM pg_attribute a
      JOIN pg_type ty ON ty.oid = a.atttypid
      JOIN LATERAL (SELECT CASE WHEN ty.typtype = 'd' THEN ty.typbasetype
                                ELSE ty.oid END AS oid) b1 ON true
      JOIN pg_type t1 ON t1.oid = b1.oid
      JOIN LATERAL (SELECT CASE WHEN t1.typcategory = 'A' AND t1.typelem <> 0
                                THEN t1.typelem ELSE t1.oid END AS oid) b2 ON true
      JOIN pg_type bt ON bt.oid = b2.oid
     WHERE a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
       AND NOT EXISTS (
             SELECT 1
               FROM pg_opclass oc
               JOIN pg_am am ON am.oid = oc.opcmethod
              WHERE am.amname IN ('btree', 'hash') AND oc.opcdefault
                AND (oc.opcintype = bt.oid
                     OR EXISTS (SELECT 1 FROM pg_cast k
                                 WHERE k.castsource = bt.oid
                                   AND k.casttarget = oc.opcintype
                                   AND k.castmethod = 'b'
                                   AND k.castcontext = 'i')
                     OR (oc.opcintype = 'anyenum'::regtype AND bt.typtype = 'e')
                     OR (oc.opcintype = 'anyrange'::regtype AND bt.typtype = 'r')
                     OR (oc.opcintype = 'anymultirange'::regtype
                         AND bt.typtype = 'm')
                     OR (oc.opcintype = 'record'::regtype AND bt.typtype = 'c')))
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
                  OR (t.ident = 'f'
                      AND NOT EXISTS ({_COLUMN_WITHOUT_EQUALITY})))
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
        # FULL over a column the SUBSCRIBER cannot compare: the publisher
        # accepts these, and the subscriber's apply stalls on the first
        # UPDATE/DELETE ("could not identify an equality operator").
        (
            "CREATE TABLE coord.zz_full_json (a int, doc json);"
            "ALTER TABLE coord.zz_full_json REPLICA IDENTITY FULL",
            "coord.zz_full_json",
        ),
        (
            "CREATE TABLE coord.zz_full_point (a int, p point);"
            "ALTER TABLE coord.zz_full_point REPLICA IDENTITY FULL",
            "coord.zz_full_point",
        ),
        (
            "CREATE TABLE coord.zz_full_xml (a int, x xml);"
            "ALTER TABLE coord.zz_full_xml REPLICA IDENTITY FULL",
            "coord.zz_full_xml",
        ),
        (
            "CREATE TABLE coord.zz_full_json_array (a int, docs json[]);"
            "ALTER TABLE coord.zz_full_json_array REPLICA IDENTITY FULL",
            "coord.zz_full_json_array",
        ),
        # A partition OUTSIDE the published schemas, of a published partitioned
        # parent: the publisher checks the partition's own identity.
        (
            "CREATE TABLE coord.zz_part_parent (a int NOT NULL)"
            " PARTITION BY LIST (a);"
            "ALTER TABLE coord.zz_part_parent REPLICA IDENTITY FULL;"
            "CREATE TABLE public.zz_part_child PARTITION OF coord.zz_part_parent"
            " FOR VALUES IN (1)",
            "public.zz_part_child",
        ),
    ],
    ids=[
        "default-no-pk",
        "nothing",
        "index-dropped",
        "new-table",
        "alembic-version",
        "full-json",
        "full-point",
        "full-xml",
        "full-json-array",
        "partition-outside-scope",
    ],
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


def test_full_identity_passes_when_every_column_is_comparable(
    at_head: Engine,
) -> None:
    """``FULL`` over comparable types passes, and an unpublished partition is out.

    The no-false-positive half of the FULL and partition rules: every type here
    replicated an UPDATE under FULL on a real pg16 subscription.
    """
    with at_head.connect() as conn:
        transaction = conn.begin()
        try:
            conn.execute(
                text(
                    "CREATE TYPE coord.zz_enum AS ENUM ('a');"
                    "CREATE DOMAIN coord.zz_dom AS text;"
                    "CREATE TABLE coord.zz_replident_full ("
                    " c_text text, c_varchar varchar(5), c_int int, c_jsonb jsonb,"
                    " c_uuid uuid, c_ts timestamptz, c_intarr int[],"
                    " c_enum coord.zz_enum, c_dom coord.zz_dom, c_bytea bytea,"
                    " c_inet inet, c_cidr cidr, c_range int4range, c_char char(3),"
                    " c_name name, c_numeric numeric, c_vec vector(3));"
                    "ALTER TABLE coord.zz_replident_full REPLICA IDENTITY FULL;"
                    # A partition outside every published scope, under an
                    # unpublished parent, is not published.
                    "CREATE TABLE public.zz_unpub_parent (a int NOT NULL)"
                    " PARTITION BY LIST (a);"
                    "CREATE TABLE public.zz_unpub_child PARTITION OF"
                    " public.zz_unpub_parent FOR VALUES IN (1)"
                )
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
