"""Behaviour test for the ``coord_topics_01`` revision.

Phase 1 of plan
``2026-11-16-subproject-topics-agents-and-coord-group-subprojects-into-topics-without-the-operator``.
The revision creates ``coord.topics``, ``coord.topic_members``,
``coord.topic_aliases`` and ``coord.subproject_vectors``. Their shape is the
plan's shared implementation contract, which the coord phases of the same plan
are built against in parallel, so this module pins it.

What is asserted
================

Without a database (always runs):

1. **Chain wiring.** ``revision`` / ``down_revision`` match the pins below, the
   parent (read through the head gate's own parser) names exactly one real
   sibling, and the docstring's ``Revision ID:`` / ``Revises:`` header agrees.
2. **Every statement is ONE static, ``coord.``-qualified SQL literal, and the
   only DROPs are in ``downgrade()``** — also checked with
   ``check_coord_column_drops``'s own scanner.
3. **The tables, comments and uniques are built in ONE transaction**, in the
   declared order, with no ``CONCURRENTLY``, no ``op.get_bind()`` read and no
   ``CREATE EXTENSION`` (coord's migration classifier refuses each; pgvector
   comes from the ancestor ``coord_memory_records``). The ONE exception is
   ``idx_topics_tenant_status``, built last, ``CONCURRENTLY IF NOT EXISTS`` in
   an ``autocommit_block()``, so ``coord.topics`` is never a new-table claim
   (coord's trunk proof greps the bare word ``topics``, which trunk already
   contains). This mirrors the classifier's rules; it does not run the
   classifier or the trunk proof.

Against a real Postgres (skipped when none is reachable):

4. **Upgrade from the parent creates the declared shape**: every column's name,
   order, type, nullability and default (``vector(384)`` by its formatted
   type); every key and every CHECK by its exact definition; every foreign key
   NO ACTION; every index by table, uniqueness, definition and predicate; every
   table comment.
5. **Each vocabulary CHECK** accepts every token and refuses one outside it by
   name; the weight CHECK admits ``0`` and ``1`` and refuses either side.
6. **The uniques**: slug per tenant; one LIVE membership of a subproject in a
   topic (a removal releases it, and the live unique arbitrates an upsert that
   restates its predicate); an alias per tenant case-insensitively; one vector
   per subproject per tenant, of exactly 384 dimensions.
7. **The foreign keys refuse** a dangling topic reference and the delete of a
   topic a member, an alias, a child or a merge still names.
8. **Downgrade removes all four tables and every index, and a re-upgrade
   restores them.**

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, skipped when none is reachable. A skip proves nothing — set
``QONTINUI_TEST_PG_DSN`` (or ``QONTINUI_TEST_PG``) to run it.
"""

from __future__ import annotations

import ast
import re
import sys
import uuid
from collections.abc import Callable, Iterator
from functools import partial
from pathlib import Path
from types import ModuleType

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.exc import DataError, IntegrityError, ProgrammingError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    comment_body_from_source,
    declared_parent_revision_id,
    ephemeral_database,
    index_exists,
    load_revision_module,
    run_alembic,
    table_exists,
    upgrade_execute_calls,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts" / "ci"))

import check_coord_column_drops as guard  # noqa: E402

_REVISION_ID = "coord_topics_01"
_PARENT_REVISION_ID = "contproof_01_gates_continuation_start_proof"
_REVISION_FILENAME = "coord_topics_01_topics_members_aliases_vectors.py"

_SCHEMA = "coord"
_TOPICS = "topics"
_MEMBERS = "topic_members"
_ALIASES = "topic_aliases"
_VECTORS = "subproject_vectors"
_TABLES = (_TOPICS, _MEMBERS, _ALIASES, _VECTORS)
_TIMESTAMPTZ = "timestamp with time zone"

# (name, format_type, nullable, default exactly as pg_get_expr renders it or
# None), in contract order.
_COLUMNS: dict[str, tuple[tuple[str, str, bool, str | None], ...]] = {
    _TOPICS: (
        ("id", "uuid", False, "gen_random_uuid()"),
        ("tenant_id", "uuid", False, None),
        ("slug", "text", False, None),
        ("title", "text", False, None),
        ("summary", "text", True, None),
        ("next_steps", "text", True, None),
        ("status", "text", False, "'proposed'::text"),
        ("parent_topic_id", "uuid", True, None),
        ("intent_ref", "jsonb", True, None),
        ("created_by", "text", False, None),
        ("created_by_session", "uuid", True, None),
        ("merged_into", "uuid", True, None),
        ("last_rollup", "jsonb", True, None),
        ("last_rollup_as_of", _TIMESTAMPTZ, True, None),
        ("created_at", _TIMESTAMPTZ, False, "now()"),
        ("updated_at", _TIMESTAMPTZ, False, "now()"),
    ),
    _MEMBERS: (
        ("id", "uuid", False, "gen_random_uuid()"),
        ("tenant_id", "uuid", False, None),
        ("topic_id", "uuid", False, None),
        ("subproject_id", "uuid", False, None),
        ("weight", "real", False, "0"),
        ("state", "text", False, None),
        ("basis", "jsonb", False, "'[]'::jsonb"),
        ("decided_by", "text", False, None),
        ("decided_by_session", "uuid", True, None),
        ("created_at", _TIMESTAMPTZ, False, "now()"),
        ("updated_at", _TIMESTAMPTZ, False, "now()"),
        ("removed_at", _TIMESTAMPTZ, True, None),
    ),
    _ALIASES: (
        ("tenant_id", "uuid", False, None),
        ("topic_id", "uuid", False, None),
        ("alias", "text", False, None),
        ("created_at", _TIMESTAMPTZ, False, "now()"),
    ),
    _VECTORS: (
        ("tenant_id", "uuid", False, None),
        ("subproject_id", "uuid", False, None),
        ("doc_digest", "text", False, None),
        ("model", "text", False, None),
        ("vector", "vector(384)", False, None),
        ("submitted_by_session", "uuid", True, None),
        ("submitted_at", _TIMESTAMPTZ, False, "now()"),
    ),
}

# Every key, by name -> (table, pg_get_constraintdef).
_KEYS: dict[str, tuple[str, str]] = {
    "topics_pkey": (_TOPICS, "PRIMARY KEY (id)"),
    "uq_topics_tenant_slug": (_TOPICS, "UNIQUE (tenant_id, slug)"),
    "fk_topics_parent_topic": (
        _TOPICS,
        "FOREIGN KEY (parent_topic_id) REFERENCES coord.topics(id)",
    ),
    "fk_topics_merged_into": (
        _TOPICS,
        "FOREIGN KEY (merged_into) REFERENCES coord.topics(id)",
    ),
    "topic_members_pkey": (_MEMBERS, "PRIMARY KEY (id)"),
    "fk_topic_members_topic": (
        _MEMBERS,
        "FOREIGN KEY (topic_id) REFERENCES coord.topics(id)",
    ),
    "topic_aliases_pkey": (_ALIASES, "PRIMARY KEY (tenant_id, alias)"),
    "fk_topic_aliases_topic": (
        _ALIASES,
        "FOREIGN KEY (topic_id) REFERENCES coord.topics(id)",
    ),
    "subproject_vectors_pkey": (_VECTORS, "PRIMARY KEY (tenant_id, subproject_id)"),
}

_FOREIGN_KEYS = (
    "fk_topics_parent_topic",
    "fk_topics_merged_into",
    "fk_topic_members_topic",
    "fk_topic_aliases_topic",
)

# Every CHECK, pinned EXACTLY so a widened or narrowed vocabulary fails here.
_CHECKS: dict[str, tuple[str, str]] = {
    "ck_topics_status": (
        _TOPICS,
        "CHECK ((status = ANY (ARRAY['proposed'::text, 'active'::text, "
        "'dormant'::text, 'retired'::text])))",
    ),
    "ck_topics_created_by": (
        _TOPICS,
        "CHECK ((created_by = ANY (ARRAY['agent'::text, 'coord'::text, "
        "'steward'::text, 'operator'::text])))",
    ),
    "ck_topic_members_weight": (
        _MEMBERS,
        "CHECK (((weight >= (0)::double precision) AND "
        "(weight <= (1)::double precision)))",
    ),
    "ck_topic_members_state": (
        _MEMBERS,
        "CHECK ((state = ANY (ARRAY['proposed'::text, 'confirmed'::text, "
        "'rejected'::text])))",
    ),
    "ck_topic_members_decided_by": (
        _MEMBERS,
        "CHECK ((decided_by = ANY (ARRAY['coord'::text, 'agent'::text, "
        "'steward'::text, 'operator'::text])))",
    ),
}

# Standalone index -> (table, unique, key columns as pg_get_indexdef renders
# them, predicate as pg_get_expr renders it or None).
_INDEXES: dict[str, tuple[str, bool, str, str | None]] = {
    "idx_topics_tenant_status": (_TOPICS, False, "(tenant_id, status)", None),
    "uq_topic_members_live_topic_subproject": (
        _MEMBERS,
        True,
        "(topic_id, subproject_id)",
        "(removed_at IS NULL)",
    ),
    "idx_topic_members_live_subproject": (
        _MEMBERS,
        False,
        "(tenant_id, subproject_id)",
        "(removed_at IS NULL)",
    ),
    "uq_topic_aliases_tenant_lower_alias": (
        _ALIASES,
        True,
        "(tenant_id, lower(alias))",
        None,
    ),
}

_KEY_INDEXES = (
    "topics_pkey",
    "uq_topics_tenant_slug",
    "topic_members_pkey",
    "topic_aliases_pkey",
    "subproject_vectors_pkey",
)

_UPGRADE_STATEMENTS: tuple[str, ...] = (
    "CREATE TABLE IF NOT EXISTS coord.topics (",
    "CREATE TABLE IF NOT EXISTS coord.topic_members (",
    "CREATE TABLE IF NOT EXISTS coord.topic_aliases (",
    "CREATE TABLE IF NOT EXISTS coord.subproject_vectors (",
    "COMMENT ON TABLE coord.topics IS",
    "COMMENT ON TABLE coord.topic_members IS",
    "COMMENT ON TABLE coord.topic_aliases IS",
    "COMMENT ON TABLE coord.subproject_vectors IS",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_topic_members_live_topic_subproject "
    "ON coord.topic_members (",
    "CREATE INDEX IF NOT EXISTS idx_topic_members_live_subproject "
    "ON coord.topic_members (",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_topic_aliases_tenant_lower_alias "
    "ON coord.topic_aliases (",
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_topics_tenant_status "
    "ON coord.topics (",
)

# The one statement that runs in an autocommit_block, after the table
# transaction commits.
_CONCURRENT_STATEMENT = _UPGRADE_STATEMENTS[-1]

# The only tables an in-transaction (non-concurrent) index may be built on: a
# new-table claim coord's trunk proof can discharge, because trunk names
# neither bare word. ``topics`` is NOT among them.
_CLAIMABLE_TABLES = ("coord.topic_members", "coord.topic_aliases")

_DOWNGRADE_STATEMENTS: tuple[str, ...] = (
    "DROP INDEX IF EXISTS coord.uq_topic_aliases_tenant_lower_alias",
    "DROP INDEX IF EXISTS coord.idx_topic_members_live_subproject",
    "DROP INDEX IF EXISTS coord.uq_topic_members_live_topic_subproject",
    "DROP INDEX IF EXISTS coord.idx_topics_tenant_status",
    "DROP TABLE IF EXISTS coord.subproject_vectors",
    "DROP TABLE IF EXISTS coord.topic_aliases",
    "DROP TABLE IF EXISTS coord.topic_members",
    "DROP TABLE IF EXISTS coord.topics",
)

# column -> (table, every accepted token, one token outside, the CHECK).
_VOCABULARIES: dict[str, tuple[str, tuple[str, ...], str, str]] = {
    "status": (
        _TOPICS,
        ("proposed", "active", "dormant", "retired"),
        "archived",
        "ck_topics_status",
    ),
    "created_by": (
        _TOPICS,
        ("agent", "coord", "steward", "operator"),
        "human",
        "ck_topics_created_by",
    ),
    "state": (
        _MEMBERS,
        ("proposed", "confirmed", "rejected"),
        "removed",
        "ck_topic_members_state",
    ),
    "decided_by": (
        _MEMBERS,
        ("coord", "agent", "steward", "operator"),
        "human",
        "ck_topic_members_decided_by",
    ),
}

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a postgres "
        "service; locally, bring one up or set QONTINUI_TEST_PG=host:port."
    ),
)


# ---------------------------------------------------------------------------
# source helpers
# ---------------------------------------------------------------------------


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _revision_module() -> ModuleType:
    return load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")


def _collapsed(sql: str | None) -> str:
    """``sql`` with every whitespace run collapsed to one space."""
    assert sql is not None, "every op.execute takes ONE static string literal"
    return " ".join(sql.split())


# ---------------------------------------------------------------------------
# 1-3. no database
# ---------------------------------------------------------------------------


def test_revision_ids_are_wired_and_the_parent_is_a_real_sibling() -> None:
    module = _revision_module()
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID, (
        "a re-point moves down_revision, the docstring's `Revises:` line AND "
        "_PARENT_REVISION_ID in this test together"
    )
    assert (
        declared_parent_revision_id(_revision_source(), _REVISION_FILENAME)
        == _PARENT_REVISION_ID
    ), "the head gate's own parser must read the same parent"
    pattern = re.compile(
        rf'^revision(?:: str)?\s*=\s*["\']{re.escape(_PARENT_REVISION_ID)}["\']', re.M
    )
    siblings = [
        f.name
        for f in (backend_root() / "alembic" / "versions").glob("*.py")
        if f.name != _REVISION_FILENAME
        and pattern.search(f.read_text(encoding="utf-8"))
    ]
    assert len(siblings) == 1, (
        f"down_revision {_PARENT_REVISION_ID!r} must name exactly one existing "
        f"revision (found {siblings})"
    )
    assert module.branch_labels is None
    assert module.depends_on is None


def test_docstring_header_matches_the_identifiers() -> None:
    source = _revision_source()
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_PARENT_REVISION_ID)}$", source, re.M)


def test_every_statement_is_static_coord_sql_and_drops_live_in_downgrade() -> None:
    upgrade_calls = upgrade_execute_calls(_revision_path())
    downgrade_calls = upgrade_execute_calls(_revision_path(), function="downgrade")
    for call in upgrade_calls:
        sql = _collapsed(call.sql)
        assert " coord." in f" {sql}", sql
        assert "DROP" not in sql.upper(), sql
    assert tuple(_collapsed(call.sql) for call in downgrade_calls) == (
        _DOWNGRADE_STATEMENTS
    )

    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops, [(d.table, d.column) for d in scan.drops]
    assert not scan.unresolved, scan.unresolved
    assert not scan.violations, scan.violations


def test_statement_shapes_avoid_what_coords_classifier_refuses() -> None:
    calls = upgrade_execute_calls(_revision_path())
    assert len(calls) == len(_UPGRADE_STATEMENTS), [_collapsed(c.sql) for c in calls]
    for call, head in zip(calls, _UPGRADE_STATEMENTS, strict=True):
        sql = _collapsed(call.sql)
        assert sql.startswith(head), (head, call.sql)
        assert "EXTENSION" not in sql.upper(), (
            "coord's migration classifier refuses CREATE EXTENSION; pgvector "
            "comes from the ancestor coord_memory_records"
        )
        concurrent = head == _CONCURRENT_STATEMENT
        assert ("CONCURRENTLY" in sql.upper()) is concurrent, sql
        assert call.in_autocommit_block is concurrent, (
            f"{head!r}: only the coord.topics index leaves the table transaction"
        )
        if sql.startswith("CREATE") and " INDEX " in sql and not concurrent:
            target = sql.split(" ON ", 1)[1].split(" ", 1)[0]
            assert target in _CLAIMABLE_TABLES, (
                f"{head!r} makes {target} a new-table claim coord cannot prove"
            )

    tree = ast.parse(_revision_source())
    upgrade = next(
        n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "upgrade"
    )
    blocks = [n for n in ast.walk(upgrade) if isinstance(n, ast.With)]
    assert len(blocks) == 1, "one autocommit_block, for the concurrent index only"
    attrs = {n.attr for n in ast.walk(tree) if isinstance(n, ast.Attribute)}
    assert "get_bind" not in attrs, "coord's migration classifier rejects bind reads"


# ---------------------------------------------------------------------------
# 4-8. real Postgres
# ---------------------------------------------------------------------------


def _uid() -> str:
    return str(uuid.uuid4())


def _vector(dims: int = 384) -> str:
    """A pgvector text literal of ``dims`` dimensions."""
    return "[" + ",".join(["0.5"] * dims) + "]"


def _insert(conn: Connection, table: str, row: dict[str, object]) -> None:
    columns = ", ".join(row)
    values = ", ".join(f":{k}" for k in row)
    conn.execute(text(f"INSERT INTO coord.{table} ({columns}) VALUES ({values})"), row)


def _insert_id(conn: Connection, table: str, row: dict[str, object]) -> str:
    columns = ", ".join(row)
    values = ", ".join(f":{k}" for k in row)
    return str(
        conn.execute(
            text(
                f"INSERT INTO coord.{table} ({columns}) VALUES ({values}) RETURNING id"
            ),
            row,
        ).scalar_one()
    )


def _delete_topic(conn: Connection, topic_id: str) -> None:
    conn.execute(text("DELETE FROM coord.topics WHERE id = :id"), {"id": topic_id})


def _topic_row(tenant: str, **overrides: object) -> dict[str, object]:
    row: dict[str, object] = {
        "tenant_id": tenant,
        "slug": f"topic-{uuid.uuid4().hex[:12]}",
        "title": "a topic",
        "created_by": "agent",
    }
    row.update(overrides)
    return row


def _member_row(tenant: str, topic_id: str, **overrides: object) -> dict[str, object]:
    row: dict[str, object] = {
        "tenant_id": tenant,
        "topic_id": topic_id,
        "subproject_id": _uid(),
        "state": "proposed",
        "decided_by": "coord",
    }
    row.update(overrides)
    return row


def _refusal(engine: Engine, write: Callable[[Connection], object]) -> tuple[str, str]:
    """Run ``write`` in its own transaction, require an integrity violation, and
    return its SQLSTATE and the constraint it named."""
    with pytest.raises(IntegrityError) as excinfo:
        with engine.begin() as conn:
            write(conn)
    orig = excinfo.value.orig
    diag = getattr(orig, "diag", None)
    return (
        str(getattr(orig, "pgcode", "")),
        str(getattr(diag, "constraint_name", "")),
    )


@pytest.fixture(scope="module")
def topics_db() -> Iterator[Engine]:
    """One ephemeral database upgraded to the revision, shared by tests 4-7."""
    if not can_connect(admin_database_url()):
        pytest.skip("Postgres not reachable at the conftest URL")
    with ephemeral_database(admin_database_url(), "coord_tp01") as (engine, url):
        run_alembic(backend_root(), url, "upgrade", _REVISION_ID)
        yield engine


@_needs_pg
@pytest.mark.parametrize("table", _TABLES)
def test_upgrade_creates_every_column_in_contract_order(
    topics_db: Engine, table: str
) -> None:
    expected = _COLUMNS[table]
    with topics_db.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT a.attname AS column_name,
                       format_type(a.atttypid, a.atttypmod) AS column_type,
                       NOT a.attnotnull AS nullable,
                       pg_get_expr(d.adbin, d.adrelid) AS column_default
                  FROM pg_attribute a
                  LEFT JOIN pg_attrdef d
                         ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                 WHERE a.attrelid = to_regclass(:q)
                   AND a.attnum > 0 AND NOT a.attisdropped
                 ORDER BY a.attnum
                """
            ),
            {"q": f"coord.{table}"},
        ).all()
    assert [r.column_name for r in rows] == [c[0] for c in expected]
    for row, (name, column_type, nullable, default) in zip(rows, expected, strict=True):
        assert row.column_type == column_type, (name, row)
        assert row.nullable is nullable, (name, row)
        if default is None:
            assert row.column_default is None, (name, row)
        else:
            assert row.column_default is not None, (name, row)
            assert row.column_default == default, (name, row)


@_needs_pg
def test_a_minimal_insert_gets_the_declared_defaults(topics_db: Engine) -> None:
    tenant = _uid()
    with topics_db.begin() as conn:
        topic = _insert_id(conn, _TOPICS, _topic_row(tenant))
        member = _insert_id(conn, _MEMBERS, _member_row(tenant, topic))
        _insert(conn, _ALIASES, {"tenant_id": tenant, "topic_id": topic, "alias": "a"})
        subproject = _uid()
        _insert(
            conn,
            _VECTORS,
            {
                "tenant_id": tenant,
                "subproject_id": subproject,
                "doc_digest": "sha256:x",
                "model": "minilm-l6-v2-256@sentence-transformers",
                "vector": _vector(),
            },
        )
    with topics_db.connect() as conn:
        t = conn.execute(
            text(
                "SELECT status, created_at, updated_at, last_rollup, "
                "last_rollup_as_of, merged_into FROM coord.topics WHERE id = :id"
            ),
            {"id": topic},
        ).one()
        m = conn.execute(
            text(
                "SELECT weight, basis, removed_at, created_at, updated_at "
                "FROM coord.topic_members WHERE id = :id"
            ),
            {"id": member},
        ).one()
        a = conn.execute(
            text("SELECT created_at FROM coord.topic_aliases WHERE tenant_id = :t"),
            {"t": tenant},
        ).one()
        v = conn.execute(
            text(
                "SELECT submitted_at, vector_dims(vector) AS dims "
                "FROM coord.subproject_vectors WHERE subproject_id = :s"
            ),
            {"s": subproject},
        ).one()
    assert t.status == "proposed"
    assert t.created_at is not None and t.created_at == t.updated_at
    assert t.last_rollup is None and t.last_rollup_as_of is None, (
        "only coord's rollup writes the cache; NULL reads as never rolled up"
    )
    assert t.merged_into is None
    assert m.weight == 0
    assert m.basis == []
    assert m.removed_at is None, "a new member is live"
    assert m.created_at == m.updated_at
    assert a.created_at is not None
    assert v.submitted_at is not None and v.dims == 384


@_needs_pg
def test_upgrade_creates_every_key_and_check_by_its_exact_definition(
    topics_db: Engine,
) -> None:
    with topics_db.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT c.conname, c.contype, rel.relname,
                       pg_get_constraintdef(c.oid) AS definition,
                       c.confdeltype, c.confupdtype
                  FROM pg_constraint c
                  JOIN pg_class rel ON rel.oid = c.conrelid
                  JOIN pg_namespace n ON n.oid = rel.relnamespace
                 WHERE n.nspname = 'coord'
                   AND rel.relname IN
                       ('topics', 'topic_members', 'topic_aliases',
                        'subproject_vectors')
                   AND c.contype IN ('p', 'u', 'f', 'c')
                """
            )
        ).all()
    by_name = {r.conname: r for r in rows}
    assert set(by_name) == set(_KEYS) | set(_CHECKS), "a constraint was added or lost"
    for name, (table, definition) in _KEYS.items():
        assert by_name[name].relname == table, name
        assert by_name[name].definition == definition, by_name[name]
    for name in _FOREIGN_KEYS:
        # 'a' = NO ACTION: a topic is retired or merged, never deleted.
        assert (by_name[name].confdeltype, by_name[name].confupdtype) == ("a", "a")
    for name, (table, definition) in _CHECKS.items():
        assert (by_name[name].relname, by_name[name].contype) == (table, "c"), name
        assert by_name[name].definition == definition, by_name[name]


@_needs_pg
def test_upgrade_creates_every_index_valid_with_its_definition(
    topics_db: Engine,
) -> None:
    with topics_db.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT ic.relname AS index_name, tc.relname AS table_name,
                       i.indisunique, i.indisvalid, i.indisready,
                       pg_get_indexdef(i.indexrelid) AS indexdef,
                       pg_get_expr(i.indpred, i.indrelid) AS predicate
                  FROM pg_index i
                  JOIN pg_class ic ON ic.oid = i.indexrelid
                  JOIN pg_class tc ON tc.oid = i.indrelid
                  JOIN pg_namespace n ON n.oid = tc.relnamespace
                 WHERE n.nspname = 'coord'
                   AND tc.relname IN
                       ('topics', 'topic_members', 'topic_aliases',
                        'subproject_vectors')
                """
            )
        ).all()
    by_name = {r.index_name: r for r in rows}
    assert set(by_name) == set(_INDEXES) | set(_KEY_INDEXES), (
        "an index was added or lost"
    )
    for row in rows:
        assert row.indisvalid and row.indisready, f"{row.index_name} is not valid"
    for name, (table, unique, columns, predicate) in _INDEXES.items():
        row = by_name[name]
        assert row.table_name == table, name
        assert row.indisunique is unique, name
        assert f"USING btree {columns}" in row.indexdef, row.indexdef
        assert row.predicate == predicate, (name, row.predicate)


@_needs_pg
def test_every_published_table_has_a_replica_identity(topics_db: Engine) -> None:
    # The coord schema is in the logical-replication publication: a table with
    # no primary key there refuses every UPDATE and DELETE.
    with topics_db.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT c.relname, c.relreplident,
                       EXISTS (SELECT 1 FROM pg_index i
                                WHERE i.indrelid = c.oid AND i.indisprimary) AS has_pk
                  FROM pg_class c
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'coord'
                   AND c.relname IN
                       ('topics', 'topic_members', 'topic_aliases',
                        'subproject_vectors')
                """
            )
        ).all()
    assert len(rows) == len(_TABLES)
    for row in rows:
        assert (row.relreplident, row.has_pk) == ("d", True), row


@_needs_pg
@pytest.mark.parametrize("table", _TABLES)
def test_each_table_carries_the_comment_its_revision_writes(
    topics_db: Engine, table: str
) -> None:
    expected = comment_body_from_source(
        _revision_source(), f"coord.{table}", object_kind="TABLE"
    )
    with topics_db.connect() as conn:
        actual = conn.execute(
            text("SELECT obj_description(to_regclass(:q), 'pg_class')"),
            {"q": f"coord.{table}"},
        ).scalar_one()
    assert actual == expected


@_needs_pg
@pytest.mark.parametrize("column", sorted(_VOCABULARIES))
def test_each_vocabulary_accepts_its_tokens_and_refuses_another(
    topics_db: Engine, column: str
) -> None:
    table, accepted, rejected, constraint = _VOCABULARIES[column]
    tenant = _uid()
    with topics_db.begin() as conn:
        parent = _insert_id(conn, _TOPICS, _topic_row(tenant))

    def row(token: str) -> dict[str, object]:
        if table == _TOPICS:
            return _topic_row(tenant, **{column: token})
        return _member_row(tenant, parent, **{column: token})

    with topics_db.begin() as conn:
        for token in accepted:
            _insert(conn, table, row(token))
    assert _refusal(topics_db, lambda conn: _insert(conn, table, row(rejected))) == (
        "23514",
        constraint,
    )


@_needs_pg
def test_the_weight_is_bounded_to_the_unit_interval(topics_db: Engine) -> None:
    tenant = _uid()
    with topics_db.begin() as conn:
        topic = _insert_id(conn, _TOPICS, _topic_row(tenant))
        for weight in (0, 0.5, 1):
            _insert(conn, _MEMBERS, _member_row(tenant, topic, weight=weight))
    for weight in (-0.01, 1.01):
        member = _member_row(tenant, topic, weight=weight)
        assert _refusal(topics_db, partial(_insert, table=_MEMBERS, row=member)) == (
            "23514",
            "ck_topic_members_weight",
        )


@_needs_pg
def test_a_slug_is_unique_per_tenant(topics_db: Engine) -> None:
    tenant, other_tenant = _uid(), _uid()
    with topics_db.begin() as conn:
        _insert(conn, _TOPICS, _topic_row(tenant, slug="overlord"))
        _insert(conn, _TOPICS, _topic_row(other_tenant, slug="overlord"))
    duplicate = _topic_row(tenant, slug="overlord")
    assert _refusal(topics_db, lambda conn: _insert(conn, _TOPICS, duplicate)) == (
        "23505",
        "uq_topics_tenant_slug",
    )


@_needs_pg
def test_a_subproject_is_a_live_member_of_a_topic_once(topics_db: Engine) -> None:
    index = "uq_topic_members_live_topic_subproject"
    tenant, subproject = _uid(), _uid()
    with topics_db.begin() as conn:
        topic = _insert_id(conn, _TOPICS, _topic_row(tenant))
        other_topic = _insert_id(conn, _TOPICS, _topic_row(tenant))
        first = _insert_id(
            conn, _MEMBERS, _member_row(tenant, topic, subproject_id=subproject)
        )
        # Multi-membership: the same subproject in another topic is admitted.
        _insert(
            conn, _MEMBERS, _member_row(tenant, other_topic, subproject_id=subproject)
        )
    second = _member_row(tenant, topic, subproject_id=subproject, state="confirmed")
    assert _refusal(topics_db, lambda conn: _insert(conn, _MEMBERS, second)) == (
        "23505",
        index,
    )

    # Removal stamps removed_at and releases the slot; the ledger keeps both.
    with topics_db.begin() as conn:
        conn.execute(
            text("UPDATE coord.topic_members SET removed_at = now() WHERE id = :id"),
            {"id": first},
        )
        _insert(conn, _MEMBERS, second)
    with topics_db.connect() as conn:
        count = conn.execute(
            text(
                "SELECT count(*) FROM coord.topic_members "
                "WHERE topic_id = :t AND subproject_id = :s"
            ),
            {"t": topic, "s": subproject},
        ).scalar_one()
    assert count == 2


@_needs_pg
def test_the_live_unique_arbitrates_an_upsert_that_restates_its_predicate(
    topics_db: Engine,
) -> None:
    tenant = _uid()
    with topics_db.begin() as conn:
        topic = _insert_id(conn, _TOPICS, _topic_row(tenant))
    member = _member_row(tenant, topic)
    columns = ", ".join(member)
    values = ", ".join(f":{k}" for k in member)
    insert = f"INSERT INTO coord.topic_members ({columns}) VALUES ({values})"
    upsert = text(
        f"{insert} ON CONFLICT (topic_id, subproject_id) WHERE removed_at IS NULL "
        "DO NOTHING"
    )
    with topics_db.begin() as conn:
        assert conn.execute(upsert, member).rowcount == 1
        assert conn.execute(upsert, member).rowcount == 0, "a replay is a no-op"

    bare = text(f"{insert} ON CONFLICT (topic_id, subproject_id) DO NOTHING")
    with pytest.raises(ProgrammingError) as excinfo:
        with topics_db.begin() as conn:
            conn.execute(bare, member)
    assert getattr(excinfo.value.orig, "pgcode", None) == "42P10"


@_needs_pg
def test_an_alias_is_unique_per_tenant_whatever_its_case(topics_db: Engine) -> None:
    tenant, other_tenant = _uid(), _uid()
    with topics_db.begin() as conn:
        topic = _insert_id(conn, _TOPICS, _topic_row(tenant))
        other = _insert_id(conn, _TOPICS, _topic_row(tenant))
        foreign = _insert_id(conn, _TOPICS, _topic_row(other_tenant))
        _insert(
            conn,
            _ALIASES,
            {"tenant_id": tenant, "topic_id": topic, "alias": "Overlord"},
        )
        _insert(
            conn,
            _ALIASES,
            {"tenant_id": other_tenant, "topic_id": foreign, "alias": "overlord"},
        )
    clash: dict[str, object] = {
        "tenant_id": tenant,
        "topic_id": other,
        "alias": "OVERLORD",
    }
    assert _refusal(topics_db, lambda conn: _insert(conn, _ALIASES, clash)) == (
        "23505",
        "uq_topic_aliases_tenant_lower_alias",
    )


@_needs_pg
def test_one_vector_per_subproject_of_exactly_384_dimensions(
    topics_db: Engine,
) -> None:
    tenant, subproject = _uid(), _uid()
    row: dict[str, object] = {
        "tenant_id": tenant,
        "subproject_id": subproject,
        "doc_digest": "d1",
        "model": "m",
        "vector": _vector(),
    }
    with topics_db.begin() as conn:
        _insert(conn, _VECTORS, row)
        # Another tenant is another key space.
        _insert(conn, _VECTORS, {**row, "tenant_id": _uid()})
    assert _refusal(
        topics_db, lambda conn: _insert(conn, _VECTORS, {**row, "doc_digest": "d2"})
    ) == ("23505", "subproject_vectors_pkey")

    with pytest.raises(DataError) as excinfo:
        with topics_db.begin() as conn:
            _insert(
                conn,
                _VECTORS,
                {**row, "subproject_id": _uid(), "vector": _vector(383)},
            )
    assert getattr(excinfo.value.orig, "pgcode", None) == "22000"
    assert "expected 384 dimensions" in str(excinfo.value.orig)


@_needs_pg
def test_the_foreign_keys_refuse_a_dangling_topic(topics_db: Engine) -> None:
    tenant = _uid()
    cases: tuple[tuple[str, dict[str, object], str], ...] = (
        (_MEMBERS, _member_row(tenant, _uid()), "fk_topic_members_topic"),
        (
            _ALIASES,
            {"tenant_id": tenant, "topic_id": _uid(), "alias": "x"},
            "fk_topic_aliases_topic",
        ),
        (_TOPICS, _topic_row(tenant, parent_topic_id=_uid()), "fk_topics_parent_topic"),
        (_TOPICS, _topic_row(tenant, merged_into=_uid()), "fk_topics_merged_into"),
    )
    for table, row, constraint in cases:
        assert _refusal(topics_db, partial(_insert, table=table, row=row)) == (
            "23503",
            constraint,
        )


@_needs_pg
def test_a_topic_anything_names_is_not_deleted(topics_db: Engine) -> None:
    tenant = _uid()
    with topics_db.begin() as conn:
        with_member = _insert_id(conn, _TOPICS, _topic_row(tenant))
        _insert(conn, _MEMBERS, _member_row(tenant, with_member))
        with_alias = _insert_id(conn, _TOPICS, _topic_row(tenant))
        _insert(
            conn,
            _ALIASES,
            {"tenant_id": tenant, "topic_id": with_alias, "alias": f"a-{_uid()}"},
        )
        with_child = _insert_id(conn, _TOPICS, _topic_row(tenant))
        _insert(conn, _TOPICS, _topic_row(tenant, parent_topic_id=with_child))
        merge_target = _insert_id(conn, _TOPICS, _topic_row(tenant))
        _insert(conn, _TOPICS, _topic_row(tenant, merged_into=merge_target))

    for topic, constraint in (
        (with_member, "fk_topic_members_topic"),
        (with_alias, "fk_topic_aliases_topic"),
        (with_child, "fk_topics_parent_topic"),
        (merge_target, "fk_topics_merged_into"),
    ):
        assert _refusal(topics_db, partial(_delete_topic, topic_id=topic)) == (
            "23503",
            constraint,
        )


@_needs_pg
def test_downgrade_removes_all_four_tables_and_re_upgrade_restores_them() -> None:
    root = backend_root()
    with ephemeral_database(admin_database_url(), "coord_tp01d") as (engine, url):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        for table in _TABLES:
            assert not table_exists(engine, _SCHEMA, table), table
        run_alembic(root, url, "upgrade", _REVISION_ID)
        for table in _TABLES:
            assert table_exists(engine, _SCHEMA, table), table
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        for table in _TABLES:
            assert not table_exists(engine, _SCHEMA, table), table
        for name in (*_INDEXES, *_KEY_INDEXES):
            assert not index_exists(engine, name), name
        run_alembic(root, url, "upgrade", _REVISION_ID)
        for table in _TABLES:
            assert table_exists(engine, _SCHEMA, table), table
        for name in (*_INDEXES, *_KEY_INDEXES):
            assert index_exists(engine, name), name
