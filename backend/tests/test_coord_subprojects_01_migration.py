"""Behaviour test for the ``coord_subprojects_01`` revision.

Phase 1 of plan
``2026-11-08-subprojects-group-sessions-gates-and-plans-and-say-why-one-stalled``.
The revision creates ``coord.subprojects`` (one row per subproject) and
``coord.subproject_members`` (its durable membership ledger). Their shape is the
plan's wire contract, which the coord and web phases of the same plan are built
against in parallel, so this module pins it.

What is asserted
================

Without a database (always runs):

1. **Chain wiring.** ``revision`` / ``down_revision`` match the pins below, the
   parent (read through the head gate's own parser) names exactly one real
   sibling, and the docstring's ``Revision ID:`` / ``Revises:`` header agrees (a
   re-point is three coupled edits: the assignment, that header, and
   ``_PARENT_REVISION_ID`` here).
2. **Every statement is ONE static, ``coord.``-qualified SQL literal, and the
   only DROPs are in ``downgrade()``** — the upgrade path is also checked with
   ``check_coord_column_drops``'s own scanner.
3. **The tables, their comments and every index are built in ONE transaction**,
   in the declared order: no ``autocommit_block()``, no ``CONCURRENTLY``, and
   no ``op.get_bind()`` read. A non-concurrent index on a table the same file
   creates is what coord's migration classifier admits as a new-table claim.

Against a real Postgres (skipped when none is reachable):

4. **Upgrade from the parent creates the declared shape**: every column's name,
   order, type, nullability and default; the defaults a minimal insert gets;
   every key and every CHECK by its exact definition (so a vocabulary widened
   on either side fails here), both foreign keys NO ACTION; every index by
   table, uniqueness, key columns, predicate and validity; both table
   comments.
5. **Each vocabulary CHECK** (``title_source``, ``origin``, ``status``,
   ``member_kind``, ``joined_via``) accepts every one of its tokens and refuses
   a token outside it, naming its own constraint.
6. **The member-key CHECKs**: a ``work_unit`` member must name its unit, and a
   ``session`` member must name at least one of its three keys — any one of
   them suffices. Each kind carries ONLY its own keys: a ``session`` member
   with a ``work_unit_id``, or a ``work_unit`` member with any session key, is
   refused by name.
7. **The uniques**: a second LIVE membership of the same key in the same
   tenant is refused by name, stamping ``removed_at`` releases the key (the
   ledger keeps both rows), and another tenant is another key space. The
   ``coord_session_id`` rule binds only pending rows (``agent_session_id IS
   NULL``), so binding the harness id releases it. The slug is unique per
   tenant.
8. **Each live unique arbitrates a coord upsert** whose ``ON CONFLICT`` restates
   the index predicate (a second write is a no-op, not an error), and an
   upsert that does not restate it is refused — the predicate is part of the
   contract a coord writer must spell.
9. **The foreign keys refuse** a member of an unknown subproject and a merge
   pointer to nothing, and refuse deleting a subproject that a member or a
   merge still names.
10. **Downgrade removes both tables and every index, and a re-upgrade restores
    them.**

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
from pathlib import Path
from types import ModuleType

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.exc import IntegrityError, ProgrammingError

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

_REVISION_ID = "coord_subprojects_01"
_PARENT_REVISION_ID = "coord_test_result_runs_01"
_REVISION_FILENAME = "coord_subprojects_01_create.py"

_SCHEMA = "coord"
_SUBPROJECTS = "subprojects"
_MEMBERS = "subproject_members"
_TIMESTAMPTZ = "timestamp with time zone"

# (name, information_schema data_type, nullable, default substring or None), in
# the contract's declaration order.
_SUBPROJECT_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("id", "uuid", False, "gen_random_uuid()"),
    ("tenant_id", "uuid", False, None),
    ("slug", "text", False, None),
    ("title", "text", False, None),
    ("title_source", "text", False, "'root_session'"),
    ("goal", "text", True, None),
    ("origin", "text", False, None),
    ("status", "text", False, "'open'"),
    ("root_agent_session_id", "uuid", True, None),
    ("next_steps_note", "text", True, None),
    ("next_steps_note_by", "text", True, None),
    ("next_steps_note_at", _TIMESTAMPTZ, True, None),
    ("merged_into", "uuid", True, None),
    ("last_verdict", "jsonb", True, None),
    ("last_verdict_as_of", _TIMESTAMPTZ, True, None),
    ("created_at", _TIMESTAMPTZ, False, "now()"),
    ("updated_at", _TIMESTAMPTZ, False, "now()"),
    ("closed_at", _TIMESTAMPTZ, True, None),
)

_MEMBER_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("id", "uuid", False, "gen_random_uuid()"),
    ("tenant_id", "uuid", False, None),
    ("subproject_id", "uuid", False, None),
    ("member_kind", "text", False, None),
    ("agent_session_id", "uuid", True, None),
    ("coord_session_id", "uuid", True, None),
    ("allocation_agent_id", "uuid", True, None),
    ("work_unit_id", "uuid", True, None),
    ("joined_via", "text", False, None),
    ("via_ref", "text", True, None),
    ("via_session", "uuid", True, None),
    ("snapshot", "jsonb", True, None),
    ("snapshot_at", _TIMESTAMPTZ, True, None),
    ("added_at", _TIMESTAMPTZ, False, "now()"),
    ("added_by", "text", True, None),
    ("removed_at", _TIMESTAMPTZ, True, None),
)

# Every key, by name -> (table, pg_get_constraintdef).
_KEYS: dict[str, tuple[str, str]] = {
    "subprojects_pkey": (_SUBPROJECTS, "PRIMARY KEY (id)"),
    "uq_subprojects_tenant_slug": (_SUBPROJECTS, "UNIQUE (tenant_id, slug)"),
    "fk_subprojects_merged_into": (
        _SUBPROJECTS,
        "FOREIGN KEY (merged_into) REFERENCES coord.subprojects(id)",
    ),
    "subproject_members_pkey": (_MEMBERS, "PRIMARY KEY (id)"),
    "fk_subproject_members_subproject": (
        _MEMBERS,
        "FOREIGN KEY (subproject_id) REFERENCES coord.subprojects(id)",
    ),
}

# Every CHECK, by name -> (table, pg_get_constraintdef), pinned EXACTLY so that
# a vocabulary widened (or narrowed) in the revision fails here even when the
# behaviour tests in 5 and 6 still pass.
_CHECKS: dict[str, tuple[str, str]] = {
    "ck_subprojects_title_source": (
        _SUBPROJECTS,
        "CHECK ((title_source = ANY (ARRAY['root_session'::text, 'explicit'::text])))",
    ),
    "ck_subprojects_origin": (
        _SUBPROJECTS,
        "CHECK ((origin = ANY (ARRAY['operator_prompt'::text, 'autonomous'::text, "
        "'scheduled'::text, 'orphan_continuation'::text, 'operator_created'::text, "
        "'backfill'::text])))",
    ),
    "ck_subprojects_status": (
        _SUBPROJECTS,
        "CHECK ((status = ANY (ARRAY['open'::text, 'done'::text, 'archived'::text])))",
    ),
    "ck_subproject_members_member_kind": (
        _MEMBERS,
        "CHECK ((member_kind = ANY (ARRAY['session'::text, 'work_unit'::text])))",
    ),
    "ck_subproject_members_joined_via": (
        _MEMBERS,
        "CHECK ((joined_via = ANY (ARRAY['root'::text, 'parent'::text, "
        "'gate_continuation'::text, 'work_unit_dispatch'::text, 'spawn'::text, "
        "'declared'::text, 'operator_move'::text, 'auto_attach'::text, "
        "'followup_edge'::text, 'split'::text, 'backfill'::text, "
        "'merge'::text])))",
    ),
    "ck_subproject_members_work_unit_key": (
        _MEMBERS,
        "CHECK (((member_kind <> 'work_unit'::text) OR (work_unit_id IS NOT NULL)))",
    ),
    "ck_subproject_members_session_key": (
        _MEMBERS,
        "CHECK (((member_kind <> 'session'::text) OR "
        "(agent_session_id IS NOT NULL) OR (coord_session_id IS NOT NULL) OR "
        "(allocation_agent_id IS NOT NULL)))",
    ),
    "ck_subproject_members_no_work_unit_on_session": (
        _MEMBERS,
        "CHECK (((member_kind = 'work_unit'::text) OR (work_unit_id IS NULL)))",
    ),
    "ck_subproject_members_no_session_key_on_work_unit": (
        _MEMBERS,
        "CHECK (((member_kind = 'session'::text) OR "
        "((agent_session_id IS NULL) AND (coord_session_id IS NULL) AND "
        "(allocation_agent_id IS NULL))))",
    ),
}

# Every standalone index -> (table, unique, key columns as pg_get_indexdef
# renders them, predicate as pg_get_expr renders it or None).
_INDEXES: dict[str, tuple[str, bool, str, str | None]] = {
    "idx_subprojects_tenant_status_updated": (
        _SUBPROJECTS,
        False,
        "(tenant_id, status, updated_at DESC)",
        None,
    ),
    "idx_subproject_members_live_subproject": (
        _MEMBERS,
        False,
        "(tenant_id, subproject_id)",
        "(removed_at IS NULL)",
    ),
    "idx_subproject_members_subproject_history": (
        _MEMBERS,
        False,
        "(tenant_id, subproject_id, removed_at)",
        None,
    ),
    "uq_subproject_members_live_agent_session": (
        _MEMBERS,
        True,
        "(tenant_id, agent_session_id)",
        "((removed_at IS NULL) AND (agent_session_id IS NOT NULL))",
    ),
    "uq_subproject_members_live_work_unit": (
        _MEMBERS,
        True,
        "(tenant_id, work_unit_id)",
        "((removed_at IS NULL) AND (work_unit_id IS NOT NULL))",
    ),
    "uq_subproject_members_live_allocation": (
        _MEMBERS,
        True,
        "(tenant_id, allocation_agent_id)",
        "((removed_at IS NULL) AND (allocation_agent_id IS NOT NULL))",
    ),
    "uq_subproject_members_live_pending_coord_session": (
        _MEMBERS,
        True,
        "(tenant_id, coord_session_id)",
        "((removed_at IS NULL) AND (agent_session_id IS NULL) "
        "AND (coord_session_id IS NOT NULL))",
    ),
}

# The indexes the keys bring with them, beside ``_INDEXES``.
_KEY_INDEXES = (
    "subprojects_pkey",
    "uq_subprojects_tenant_slug",
    "subproject_members_pkey",
)

# Every ``op.execute`` in ``upgrade()``, in order, by its leading words. Each
# index statement is ``CREATE [UNIQUE] INDEX IF NOT EXISTS <name> ON <table>``
# on a table created above it: the exact shape coord's migration classifier
# admits as a new-table claim.
_UPGRADE_STATEMENTS: tuple[str, ...] = (
    "CREATE TABLE IF NOT EXISTS coord.subprojects (",
    "CREATE TABLE IF NOT EXISTS coord.subproject_members (",
    "COMMENT ON TABLE coord.subprojects IS",
    "COMMENT ON TABLE coord.subproject_members IS",
    "CREATE INDEX IF NOT EXISTS idx_subprojects_tenant_status_updated "
    "ON coord.subprojects (",
    "CREATE INDEX IF NOT EXISTS idx_subproject_members_live_subproject "
    "ON coord.subproject_members (",
    "CREATE INDEX IF NOT EXISTS idx_subproject_members_subproject_history "
    "ON coord.subproject_members (",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_subproject_members_live_agent_session "
    "ON coord.subproject_members (",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_subproject_members_live_work_unit "
    "ON coord.subproject_members (",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_subproject_members_live_allocation "
    "ON coord.subproject_members (",
    "CREATE UNIQUE INDEX IF NOT EXISTS "
    "uq_subproject_members_live_pending_coord_session "
    "ON coord.subproject_members (",
)

# Every ``op.execute`` in ``downgrade()``, exactly: the indexes, then the
# members table, then the table it references.
_DOWNGRADE_STATEMENTS: tuple[str, ...] = (
    "DROP INDEX IF EXISTS coord.uq_subproject_members_live_pending_coord_session",
    "DROP INDEX IF EXISTS coord.uq_subproject_members_live_allocation",
    "DROP INDEX IF EXISTS coord.uq_subproject_members_live_work_unit",
    "DROP INDEX IF EXISTS coord.uq_subproject_members_live_agent_session",
    "DROP INDEX IF EXISTS coord.idx_subproject_members_subproject_history",
    "DROP INDEX IF EXISTS coord.idx_subproject_members_live_subproject",
    "DROP INDEX IF EXISTS coord.idx_subprojects_tenant_status_updated",
    "DROP TABLE IF EXISTS coord.subproject_members",
    "DROP TABLE IF EXISTS coord.subprojects",
)

# column -> (table, every accepted token, one token outside the vocabulary,
# the constraint that refuses it).
_VOCABULARIES: dict[str, tuple[str, tuple[str, ...], str, str]] = {
    "title_source": (
        _SUBPROJECTS,
        ("root_session", "explicit"),
        "derived",
        "ck_subprojects_title_source",
    ),
    "origin": (
        _SUBPROJECTS,
        (
            "operator_prompt",
            "autonomous",
            "scheduled",
            "orphan_continuation",
            "operator_created",
            "backfill",
        ),
        "manual",
        "ck_subprojects_origin",
    ),
    "status": (
        _SUBPROJECTS,
        ("open", "done", "archived"),
        "stalled",
        "ck_subprojects_status",
    ),
    "member_kind": (
        _MEMBERS,
        ("session", "work_unit"),
        "gate",
        "ck_subproject_members_member_kind",
    ),
    "joined_via": (
        _MEMBERS,
        (
            "root",
            "parent",
            "gate_continuation",
            "work_unit_dispatch",
            "spawn",
            "declared",
            "operator_move",
            "auto_attach",
            "followup_edge",
            "split",
            "backfill",
            "merge",
        ),
        "inherited",
        "ck_subproject_members_joined_via",
    ),
}

# A live-membership unique -> (its key column, the predicate an ON CONFLICT
# must restate to name it as the arbiter, the member shape that carries the
# key and no other live key).
_LIVE_UNIQUES: dict[str, tuple[str, str, dict[str, object]]] = {
    "uq_subproject_members_live_agent_session": (
        "agent_session_id",
        "removed_at IS NULL AND agent_session_id IS NOT NULL",
        {"member_kind": "session"},
    ),
    "uq_subproject_members_live_work_unit": (
        "work_unit_id",
        "removed_at IS NULL AND work_unit_id IS NOT NULL",
        {"member_kind": "work_unit", "agent_session_id": None},
    ),
    "uq_subproject_members_live_allocation": (
        "allocation_agent_id",
        "removed_at IS NULL AND allocation_agent_id IS NOT NULL",
        {"member_kind": "session", "agent_session_id": None},
    ),
    "uq_subproject_members_live_pending_coord_session": (
        "coord_session_id",
        "removed_at IS NULL AND agent_session_id IS NULL "
        "AND coord_session_id IS NOT NULL",
        {"member_kind": "session", "agent_session_id": None},
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


def test_tables_comments_and_indexes_are_built_in_one_transaction() -> None:
    calls = upgrade_execute_calls(_revision_path())
    assert len(calls) == len(_UPGRADE_STATEMENTS), [_collapsed(c.sql) for c in calls]
    for call, head in zip(calls, _UPGRADE_STATEMENTS, strict=True):
        sql = _collapsed(call.sql)
        assert sql.startswith(head), (head, call.sql)
        assert "CONCURRENTLY" not in sql.upper(), (
            "a concurrent build runs outside the transaction: a cancelled one "
            "leaves an INVALID unique that an IF NOT EXISTS retry keeps"
        )
        assert call.in_autocommit_block is False, (
            f"{head!r} must run in the transaction that creates its table, so "
            "the tables and their uniques commit together; coord's migration "
            "classifier admits a non-concurrent CREATE INDEX on a table the "
            "same file creates as a new-table claim"
        )

    tree = ast.parse(_revision_source())
    upgrade = next(
        n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "upgrade"
    )
    blocks = [n for n in ast.walk(upgrade) if isinstance(n, ast.With)]
    assert not blocks, "no autocommit_block: one transaction holds every statement"
    attrs = {n.attr for n in ast.walk(tree) if isinstance(n, ast.Attribute)}
    assert "get_bind" not in attrs, "coord's migration classifier rejects bind reads"


# ---------------------------------------------------------------------------
# 4-10. real Postgres
# ---------------------------------------------------------------------------


def _uid() -> str:
    return str(uuid.uuid4())


def _insert(conn: Connection, table: str, row: dict[str, object]) -> str:
    """INSERT ``row`` into ``coord.<table>`` and return the new row's id."""
    columns = ", ".join(row)
    values = ", ".join(f":{k}" for k in row)
    new_id = conn.execute(
        text(f"INSERT INTO coord.{table} ({columns}) VALUES ({values}) RETURNING id"),
        row,
    ).scalar_one()
    return str(new_id)


def _subproject_row(tenant: str, **overrides: object) -> dict[str, object]:
    """A valid ``coord.subprojects`` row in ``tenant``, ``overrides`` applied."""
    row: dict[str, object] = {
        "tenant_id": tenant,
        "slug": f"sp-{uuid.uuid4().hex[:12]}",
        "title": "a subproject",
        "origin": "operator_prompt",
    }
    row.update(overrides)
    return row


def _member_row(
    tenant: str, subproject_id: str, **overrides: object
) -> dict[str, object]:
    """A valid live session member in ``tenant``, ``overrides`` applied."""
    row: dict[str, object] = {
        "tenant_id": tenant,
        "subproject_id": subproject_id,
        "member_kind": "session",
        "agent_session_id": _uid(),
        "joined_via": "root",
    }
    row.update(overrides)
    return row


def _kind_keys(kind: str) -> dict[str, object]:
    """The keys a member of ``kind`` carries, and only those: a session member
    its harness id, a work-unit member its unit, and a kind outside the
    vocabulary none at all (so only the ``member_kind`` CHECK can refuse it)."""
    if kind == "session":
        return {"agent_session_id": _uid()}
    if kind == "work_unit":
        return {"agent_session_id": None, "work_unit_id": _uid()}
    return {"agent_session_id": None}


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
def subprojects_db() -> Iterator[Engine]:
    """One ephemeral database upgraded to the revision, shared by tests 4-9."""
    if not can_connect(admin_database_url()):
        pytest.skip("Postgres not reachable at the conftest URL")
    with ephemeral_database(admin_database_url(), "coord_sp01") as (engine, url):
        run_alembic(backend_root(), url, "upgrade", _REVISION_ID)
        yield engine


@_needs_pg
@pytest.mark.parametrize(
    ("table", "expected"),
    [(_SUBPROJECTS, _SUBPROJECT_COLUMNS), (_MEMBERS, _MEMBER_COLUMNS)],
    ids=[_SUBPROJECTS, _MEMBERS],
)
def test_upgrade_creates_every_column_in_contract_order(
    subprojects_db: Engine,
    table: str,
    expected: tuple[tuple[str, str, bool, str | None], ...],
) -> None:
    with subprojects_db.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name, data_type, is_nullable, column_default
                  FROM information_schema.columns
                 WHERE table_schema = 'coord' AND table_name = :t
                 ORDER BY ordinal_position
                """
            ),
            {"t": table},
        ).all()
    assert [r.column_name for r in rows] == [c[0] for c in expected]
    for row, (name, data_type, nullable, default) in zip(rows, expected, strict=True):
        assert row.data_type == data_type, (name, row)
        assert (row.is_nullable == "YES") is nullable, (name, row)
        if default is None:
            assert row.column_default is None, (name, row)
        else:
            assert row.column_default is not None, (name, row)
            assert default in row.column_default, (name, row)


@_needs_pg
def test_a_minimal_insert_gets_the_declared_defaults(subprojects_db: Engine) -> None:
    tenant = _uid()
    with subprojects_db.begin() as conn:
        subproject = _insert(conn, _SUBPROJECTS, _subproject_row(tenant))
        member = _insert(conn, _MEMBERS, _member_row(tenant, subproject))
    with subprojects_db.connect() as conn:
        sp = conn.execute(
            text(
                "SELECT title_source, status, created_at, updated_at, closed_at, "
                "merged_into, last_verdict, last_verdict_as_of "
                "FROM coord.subprojects WHERE id = :id"
            ),
            {"id": subproject},
        ).one()
        m = conn.execute(
            text(
                "SELECT added_at, removed_at, snapshot "
                "FROM coord.subproject_members WHERE id = :id"
            ),
            {"id": member},
        ).one()
    assert sp.title_source == "root_session"
    assert sp.status == "open"
    assert sp.created_at is not None and sp.created_at == sp.updated_at
    assert sp.closed_at is None and sp.merged_into is None
    assert sp.last_verdict is None and sp.last_verdict_as_of is None, (
        "only the reconciler tick writes the verdict cache; NULL reads as unknown"
    )
    assert m.added_at is not None
    assert m.removed_at is None, "a new member is live"
    assert m.snapshot is None


@_needs_pg
def test_upgrade_creates_every_key_and_check_by_its_exact_definition(
    subprojects_db: Engine,
) -> None:
    # Keys and CHECKs only: PostgreSQL 18 also lists every NOT NULL column in
    # pg_constraint (contype 'n'), which this contract does not pin.
    with subprojects_db.connect() as conn:
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
                   AND rel.relname IN ('subprojects', 'subproject_members')
                   AND c.contype IN ('p', 'u', 'f', 'c')
                """
            )
        ).all()
    by_name = {r.conname: r for r in rows}
    assert set(by_name) == set(_KEYS) | set(_CHECKS), "a constraint was added or lost"
    for name, (table, definition) in _KEYS.items():
        assert by_name[name].relname == table, name
        assert by_name[name].definition == definition, by_name[name]
    for name in ("fk_subprojects_merged_into", "fk_subproject_members_subproject"):
        # 'a' = NO ACTION: a subproject is archived or merged, never deleted,
        # so a delete that would orphan the ledger is refused, not cascaded.
        assert (by_name[name].confdeltype, by_name[name].confupdtype) == ("a", "a")
    for name, (table, definition) in _CHECKS.items():
        assert (by_name[name].relname, by_name[name].contype) == (table, "c"), name
        assert by_name[name].definition == definition, by_name[name]


@_needs_pg
def test_upgrade_creates_every_index_valid_with_its_definition(
    subprojects_db: Engine,
) -> None:
    with subprojects_db.connect() as conn:
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
                   AND tc.relname IN ('subprojects', 'subproject_members')
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
@pytest.mark.parametrize("table", [_SUBPROJECTS, _MEMBERS])
def test_each_table_carries_the_comment_its_revision_writes(
    subprojects_db: Engine, table: str
) -> None:
    expected = comment_body_from_source(
        _revision_source(), f"coord.{table}", object_kind="TABLE"
    )
    with subprojects_db.connect() as conn:
        actual = conn.execute(
            text("SELECT obj_description(to_regclass(:q), 'pg_class')"),
            {"q": f"coord.{table}"},
        ).scalar_one()
    assert actual == expected


@_needs_pg
@pytest.mark.parametrize("column", sorted(_VOCABULARIES))
def test_each_vocabulary_accepts_its_tokens_and_refuses_another(
    subprojects_db: Engine, column: str
) -> None:
    table, accepted, rejected, constraint = _VOCABULARIES[column]
    tenant = _uid()
    with subprojects_db.begin() as conn:
        parent = _insert(conn, _SUBPROJECTS, _subproject_row(tenant))

    def row(token: str) -> dict[str, object]:
        if table == _SUBPROJECTS:
            return _subproject_row(tenant, **{column: token})
        if column == "member_kind":
            # Each kind carries exactly its own keys (a kind outside the
            # vocabulary carries none), so only the vocabulary can refuse.
            return _member_row(tenant, parent, member_kind=token, **_kind_keys(token))
        return _member_row(tenant, parent, **{column: token})

    with subprojects_db.begin() as conn:
        for token in accepted:
            _insert(conn, table, row(token))
    assert _refusal(
        subprojects_db, lambda conn: _insert(conn, table, row(rejected))
    ) == (
        "23514",
        constraint,
    )


@_needs_pg
@pytest.mark.parametrize(
    ("overrides", "constraint"),
    [
        (
            {
                "member_kind": "work_unit",
                "agent_session_id": None,
                "work_unit_id": None,
            },
            "ck_subproject_members_work_unit_key",
        ),
        (
            {"member_kind": "session", "agent_session_id": None},
            "ck_subproject_members_session_key",
        ),
    ],
    ids=["work_unit-without-its-unit", "session-without-any-key"],
)
def test_a_member_without_the_key_its_kind_needs_is_refused(
    subprojects_db: Engine, overrides: dict[str, object], constraint: str
) -> None:
    tenant = _uid()
    with subprojects_db.begin() as conn:
        parent = _insert(conn, _SUBPROJECTS, _subproject_row(tenant))
    member = _member_row(tenant, parent, **overrides)
    assert _refusal(subprojects_db, lambda conn: _insert(conn, _MEMBERS, member)) == (
        "23514",
        constraint,
    )


@_needs_pg
def test_a_session_member_carrying_a_work_unit_is_refused(
    subprojects_db: Engine,
) -> None:
    # Admitted, it would hold the unit's tenant-wide live slot in
    # uq_subproject_members_live_work_unit and lock the unit's own row out.
    tenant = _uid()
    with subprojects_db.begin() as conn:
        parent = _insert(conn, _SUBPROJECTS, _subproject_row(tenant))
    member = _member_row(tenant, parent, work_unit_id=_uid())
    assert _refusal(subprojects_db, lambda conn: _insert(conn, _MEMBERS, member)) == (
        "23514",
        "ck_subproject_members_no_work_unit_on_session",
    )


@_needs_pg
@pytest.mark.parametrize(
    "key", ["agent_session_id", "coord_session_id", "allocation_agent_id"]
)
def test_a_work_unit_member_carrying_any_session_key_is_refused(
    subprojects_db: Engine, key: str
) -> None:
    tenant = _uid()
    with subprojects_db.begin() as conn:
        parent = _insert(conn, _SUBPROJECTS, _subproject_row(tenant))
    overrides: dict[str, object] = {
        "member_kind": "work_unit",
        "agent_session_id": None,
        "work_unit_id": _uid(),
        key: _uid(),
    }
    member = _member_row(tenant, parent, **overrides)
    assert _refusal(subprojects_db, lambda conn: _insert(conn, _MEMBERS, member)) == (
        "23514",
        "ck_subproject_members_no_session_key_on_work_unit",
    )


@_needs_pg
@pytest.mark.parametrize(
    "key", ["agent_session_id", "coord_session_id", "allocation_agent_id"]
)
def test_any_one_session_key_makes_a_session_member(
    subprojects_db: Engine, key: str
) -> None:
    tenant = _uid()
    overrides: dict[str, object] = {"agent_session_id": None, key: _uid()}
    with subprojects_db.begin() as conn:
        parent = _insert(conn, _SUBPROJECTS, _subproject_row(tenant))
        _insert(conn, _MEMBERS, _member_row(tenant, parent, **overrides))
        # A work-unit member needs no session key at all.
        _insert(
            conn,
            _MEMBERS,
            _member_row(
                tenant,
                parent,
                member_kind="work_unit",
                agent_session_id=None,
                work_unit_id=_uid(),
                joined_via="auto_attach",
            ),
        )


@_needs_pg
@pytest.mark.parametrize(
    "index",
    [
        "uq_subproject_members_live_agent_session",
        "uq_subproject_members_live_work_unit",
        "uq_subproject_members_live_allocation",
    ],
)
def test_a_key_is_a_live_member_of_one_subproject_per_tenant(
    subprojects_db: Engine, index: str
) -> None:
    key, _predicate, shape = _LIVE_UNIQUES[index]
    tenant, other_tenant, value = _uid(), _uid(), _uid()
    with subprojects_db.begin() as conn:
        first_subproject = _insert(conn, _SUBPROJECTS, _subproject_row(tenant))
        second_subproject = _insert(conn, _SUBPROJECTS, _subproject_row(tenant))
        foreign_subproject = _insert(conn, _SUBPROJECTS, _subproject_row(other_tenant))
        first = _insert(
            conn,
            _MEMBERS,
            _member_row(tenant, first_subproject, **shape, **{key: value}),
        )
        # Another tenant is another key space.
        _insert(
            conn,
            _MEMBERS,
            _member_row(other_tenant, foreign_subproject, **shape, **{key: value}),
        )

    second = _member_row(tenant, second_subproject, **shape, **{key: value})
    assert _refusal(subprojects_db, lambda conn: _insert(conn, _MEMBERS, second)) == (
        "23505",
        index,
    )

    # A move: stamping removed_at on the old row releases the key for the new one.
    with subprojects_db.begin() as conn:
        conn.execute(
            text(
                "UPDATE coord.subproject_members SET removed_at = now() WHERE id = :id"
            ),
            {"id": first},
        )
        _insert(conn, _MEMBERS, second)
    with subprojects_db.connect() as conn:
        ledger = conn.execute(
            text(
                f"SELECT subproject_id::text AS subproject_id, removed_at IS NULL AS live "
                f"FROM coord.subproject_members "
                f"WHERE tenant_id = :t AND {key} = :v ORDER BY removed_at IS NULL"
            ),
            {"t": tenant, "v": value},
        ).all()
    assert [(r.subproject_id, r.live) for r in ledger] == [
        (first_subproject, False),
        (second_subproject, True),
    ], "the ledger keeps the removed row beside the live one"


@_needs_pg
def test_the_coord_session_key_binds_only_pending_rows(subprojects_db: Engine) -> None:
    index = "uq_subproject_members_live_pending_coord_session"
    tenant, coord_session = _uid(), _uid()
    with subprojects_db.begin() as conn:
        first_subproject = _insert(conn, _SUBPROJECTS, _subproject_row(tenant))
        second_subproject = _insert(conn, _SUBPROJECTS, _subproject_row(tenant))
        # A BOUND row (harness id known) that also records the coord session id
        # is outside the rule ...
        _insert(
            conn,
            _MEMBERS,
            _member_row(tenant, first_subproject, coord_session_id=coord_session),
        )
        # ... so a PENDING row keyed by the same coord session id is admitted.
        pending = _insert(
            conn,
            _MEMBERS,
            _member_row(
                tenant,
                second_subproject,
                agent_session_id=None,
                coord_session_id=coord_session,
            ),
        )

    another_pending = _member_row(
        tenant, first_subproject, agent_session_id=None, coord_session_id=coord_session
    )
    assert _refusal(
        subprojects_db, lambda conn: _insert(conn, _MEMBERS, another_pending)
    ) == ("23505", index)

    # Binding the harness id onto the pending row takes it out of the rule.
    with subprojects_db.begin() as conn:
        conn.execute(
            text(
                "UPDATE coord.subproject_members SET agent_session_id = :a WHERE id = :id"
            ),
            {"a": _uid(), "id": pending},
        )
        _insert(conn, _MEMBERS, another_pending)


@_needs_pg
def test_a_slug_is_unique_per_tenant(subprojects_db: Engine) -> None:
    tenant, other_tenant = _uid(), _uid()
    slug = "scheduled:return-to-main"
    with subprojects_db.begin() as conn:
        _insert(
            conn, _SUBPROJECTS, _subproject_row(tenant, slug=slug, origin="scheduled")
        )
        _insert(
            conn,
            _SUBPROJECTS,
            _subproject_row(other_tenant, slug=slug, origin="scheduled"),
        )
    duplicate = _subproject_row(tenant, slug=slug, origin="scheduled")
    assert _refusal(
        subprojects_db, lambda conn: _insert(conn, _SUBPROJECTS, duplicate)
    ) == (
        "23505",
        "uq_subprojects_tenant_slug",
    )

    # The standing-subproject upsert (D4 rule 5) arbitrates on the constraint.
    columns = ", ".join(duplicate)
    values = ", ".join(f":{k}" for k in duplicate)
    upsert = text(
        f"INSERT INTO coord.subprojects ({columns}) VALUES ({values}) "
        "ON CONFLICT (tenant_id, slug) DO NOTHING"
    )
    with subprojects_db.begin() as conn:
        assert conn.execute(upsert, duplicate).rowcount == 0


@_needs_pg
@pytest.mark.parametrize("index", sorted(_LIVE_UNIQUES))
def test_each_live_unique_arbitrates_an_upsert_that_restates_its_predicate(
    subprojects_db: Engine, index: str
) -> None:
    key, predicate, shape = _LIVE_UNIQUES[index]
    tenant = _uid()
    with subprojects_db.begin() as conn:
        parent = _insert(conn, _SUBPROJECTS, _subproject_row(tenant))
    member = _member_row(tenant, parent, **shape, **{key: _uid()})
    columns = ", ".join(member)
    values = ", ".join(f":{k}" for k in member)
    insert = f"INSERT INTO coord.subproject_members ({columns}) VALUES ({values})"

    upsert = text(
        f"{insert} ON CONFLICT (tenant_id, {key}) WHERE {predicate} DO NOTHING"
    )
    with subprojects_db.begin() as conn:
        assert conn.execute(upsert, member).rowcount == 1
        assert conn.execute(upsert, member).rowcount == 0, "a replay is a no-op"

    # Without the predicate PostgreSQL cannot infer a partial arbiter (42P10).
    bare = text(f"{insert} ON CONFLICT (tenant_id, {key}) DO NOTHING")
    with pytest.raises(ProgrammingError) as excinfo:
        with subprojects_db.begin() as conn:
            conn.execute(bare, member)
    assert getattr(excinfo.value.orig, "pgcode", None) == "42P10"


@_needs_pg
def test_the_foreign_keys_refuse_a_dangling_reference(subprojects_db: Engine) -> None:
    tenant = _uid()
    orphan = _member_row(tenant, _uid())
    assert _refusal(subprojects_db, lambda conn: _insert(conn, _MEMBERS, orphan)) == (
        "23503",
        "fk_subproject_members_subproject",
    )
    merged_into_nothing = _subproject_row(tenant, merged_into=_uid())
    assert _refusal(
        subprojects_db, lambda conn: _insert(conn, _SUBPROJECTS, merged_into_nothing)
    ) == ("23503", "fk_subprojects_merged_into")


@_needs_pg
def test_a_subproject_a_member_or_a_merge_names_is_not_deleted(
    subprojects_db: Engine,
) -> None:
    tenant = _uid()
    with subprojects_db.begin() as conn:
        with_member = _insert(conn, _SUBPROJECTS, _subproject_row(tenant))
        _insert(conn, _MEMBERS, _member_row(tenant, with_member))
        merge_target = _insert(conn, _SUBPROJECTS, _subproject_row(tenant))
        _insert(conn, _SUBPROJECTS, _subproject_row(tenant, merged_into=merge_target))

    delete = text("DELETE FROM coord.subprojects WHERE id = :id")
    assert _refusal(
        subprojects_db, lambda conn: conn.execute(delete, {"id": with_member})
    ) == ("23503", "fk_subproject_members_subproject")
    assert _refusal(
        subprojects_db, lambda conn: conn.execute(delete, {"id": merge_target})
    ) == ("23503", "fk_subprojects_merged_into")


@_needs_pg
def test_downgrade_removes_both_tables_and_re_upgrade_restores_them() -> None:
    root = backend_root()
    tables = (_SUBPROJECTS, _MEMBERS)
    with ephemeral_database(admin_database_url(), "coord_sp01d") as (engine, url):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        for table in tables:
            assert not table_exists(engine, _SCHEMA, table), table
        run_alembic(root, url, "upgrade", _REVISION_ID)
        for table in tables:
            assert table_exists(engine, _SCHEMA, table), table
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        for table in tables:
            assert not table_exists(engine, _SCHEMA, table), table
        for name in (*_INDEXES, *_KEY_INDEXES):
            assert not index_exists(engine, name), name
        run_alembic(root, url, "upgrade", _REVISION_ID)
        for table in tables:
            assert table_exists(engine, _SCHEMA, table), table
        for name in (*_INDEXES, *_KEY_INDEXES):
            assert index_exists(engine, name), name
