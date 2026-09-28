"""Structural and round-trip test for alembic ``coord_dp_write_auth_daily_01``.

Plan
``2026-09-28-anyone-holding-a-session-uuid-can-write-its-transcript-because-session-output-and-event-writes-are-anonymous``
Phase 1.

``coord.data_plane_write_auth_daily`` is the durable counter coord's
``data_plane_observe`` upserts into. The property that carries the design is the
PRIMARY KEY over ``(day, route, outcome, device_id, served_git_sha)`` with
sentinels instead of NULLs: the key must be total (no NULL can enter it), the
sentinels must be ordinary distinct key values, and the writer's upsert must
increment rather than overwrite.

Without a database (always runs):

1. Chain wiring: the parent is a real sibling and the ``Revises:`` header agrees.
2. Every DDL object is ``coord.``-qualified, the only DROP is in
   ``downgrade()``, and the column-drop guard reads the upgrade path as
   dropping nothing.
3. Both directions are pure ``op.execute`` with static SQL, and the upgrade is
   one idempotent ``CREATE TABLE`` with no CHECK, FK, trigger or extra index.

With a database (skipped when none is reachable; a skip proves nothing). Point
the tests at a live instance with ``QONTINUI_TEST_PG=host:port``:

4. Column types, nullability, defaults, and the primary key's column order.
5. The key refuses NULL in the sentinel columns, admits the sentinels as
   ordinary values, and the writer's ``ON CONFLICT`` upsert increments.
6. The table and column comments land as the source writes them, and both
   sentinels are named in the catalog.
7. ``upgrade()`` is idempotent, and up, down, up leaves no residue.
"""

from __future__ import annotations

import ast
import datetime
import re
import sys
import uuid
from pathlib import Path

import pytest
import sqlalchemy
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_comment,
    comment_body_from_source,
    ephemeral_database,
    load_revision_module,
    run_alembic,
    scalar,
    table_exists,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts" / "ci"))

import check_coord_column_drops as guard  # noqa: E402

_REVISION_ID = "coord_dp_write_auth_daily_01"
_REVISION_FILENAME = "coord_dp_write_auth_daily_01_create.py"

# Pinned as a literal, not read back from the module: the head this revision
# was authored against. A moved head is re-pointed in the revision AND here.
_PARENT_REVISION_ID = "cinode_03_dispatch_pr_head_base_sha"

_SCHEMA = "coord"
_TABLE = "data_plane_write_auth_daily"
_QUALIFIED = f"{_SCHEMA}.{_TABLE}"
_PK_COLUMNS = "day,route,outcome,device_id,served_git_sha"

_NIL_UUID = uuid.UUID(int=0)

# (name, information_schema data_type, nullable, default-substring or None)
_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("day", "date", False, None),
    ("route", "text", False, None),
    ("outcome", "text", False, None),
    ("device_id", "uuid", False, None),
    ("served_git_sha", "text", False, None),
    ("count", "bigint", False, None),
    ("updated_at", "timestamp with time zone", False, "now()"),
)

_COMMENTED = ("route", "outcome", "device_id", "served_git_sha", "updated_at")

# The writer's upsert, as the plan specifies it for coord's flush.
_UPSERT_SQL = f"""
    INSERT INTO {_QUALIFIED}
        (day, route, outcome, device_id, served_git_sha, count)
    VALUES (:day, :route, :outcome, :device_id, :sha, :n)
    ON CONFLICT (day, route, outcome, device_id, served_git_sha)
    DO UPDATE SET count = {_TABLE}.count + EXCLUDED.count, updated_at = now()
"""

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "test Postgres unreachable via DATABASE_URL (under pytest, conftest.py "
        "derives DATABASE_URL from QONTINUI_TEST_PG=host:port, so set that)"
    ),
)


# ---------------------------------------------------------------------------
# source helpers
# ---------------------------------------------------------------------------


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _tree() -> ast.Module:
    return ast.parse(_revision_source(), filename=str(_revision_path()))


def _function(tree: ast.Module, name: str) -> ast.FunctionDef:
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError(f"{_REVISION_FILENAME} has no top-level {name}()")


def _sql_literals(fn: ast.FunctionDef) -> list[str]:
    """Every string constant inside ``fn`` except its own docstring."""
    doc = ast.get_docstring(fn, clean=False)
    return [
        node.value
        for node in ast.walk(fn)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and node.value != doc
    ]


# ---------------------------------------------------------------------------
# 1. chain wiring
# ---------------------------------------------------------------------------


def test_revision_ids_are_wired_and_the_parent_is_a_real_sibling() -> None:
    module = load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID

    versions_dir = backend_root() / "alembic" / "versions"
    pattern = re.compile(
        rf'^revision(?:: str)?\s*=\s*["\']{re.escape(_PARENT_REVISION_ID)}["\']',
        re.M,
    )
    siblings = [
        f
        for f in versions_dir.glob("*.py")
        if f.name != _REVISION_FILENAME
        and pattern.search(f.read_text(encoding="utf-8"))
    ]
    assert len(siblings) == 1, (
        f"down_revision {_PARENT_REVISION_ID!r} must name exactly one existing "
        f"sibling (found {[f.name for f in siblings]})"
    )
    assert module.branch_labels is None
    assert module.depends_on is None


def test_docstring_header_matches_the_identifiers() -> None:
    source = _revision_source()
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_PARENT_REVISION_ID)}$", source, re.M)


# ---------------------------------------------------------------------------
# 2. coord-qualified, and the only DROP is in downgrade()
# ---------------------------------------------------------------------------

_TABLE_OBJECT_RE = re.compile(
    r"(?:CREATE\s+TABLE|DROP\s+TABLE|ALTER\s+TABLE|COMMENT\s+ON\s+TABLE"
    r"|COMMENT\s+ON\s+COLUMN)(?:\s+IF\s+(?:NOT\s+)?EXISTS)?\s+([A-Za-z_.\"]+)",
    re.I,
)


def test_every_ddl_object_is_coord_qualified() -> None:
    tree = _tree()
    seen = 0
    for fn_name in ("upgrade", "downgrade"):
        for sql in _sql_literals(_function(tree, fn_name)):
            for obj in _TABLE_OBJECT_RE.findall(sql):
                seen += 1
                assert obj == _QUALIFIED or obj.startswith(f"{_QUALIFIED}."), (
                    f"{fn_name}(): object {obj!r} is not {_QUALIFIED}"
                )
    assert seen >= 3, "the object regex matched nothing; it is not measuring"


def test_the_only_drop_is_inside_downgrade() -> None:
    tree = _tree()
    up = "\n".join(_sql_literals(_function(tree, "upgrade")))
    assert not re.search(r"\bDROP\b", up, re.I), "upgrade() must not DROP anything"
    down = "\n".join(_sql_literals(_function(tree, "downgrade")))
    assert re.search(rf"DROP\s+TABLE\s+IF\s+EXISTS\s+{_QUALIFIED}\b", down, re.I)


def test_the_drop_guard_reads_the_upgrade_path_as_dropping_nothing() -> None:
    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops, [(d.table, d.column) for d in scan.drops]
    assert not scan.unresolved, scan.unresolved
    assert not scan.violations, scan.violations


# ---------------------------------------------------------------------------
# 3. static SQL through op.execute only; one plain CREATE TABLE
# ---------------------------------------------------------------------------


def test_both_directions_are_static_op_execute_with_no_bind() -> None:
    calls = [
        node
        for node in ast.walk(_tree())
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "op"
    ]
    assert calls, "no op calls found"
    assert {c.func.attr for c in calls} == {"execute"}  # type: ignore[attr-defined]
    for call in calls:
        assert len(call.args) == 1 and isinstance(call.args[0], ast.Constant), (
            f"op.execute at line {call.lineno} must take one static SQL literal"
        )
        assert isinstance(call.args[0].value, str)


def test_no_sql_body_carries_a_bind_parameter_spelling() -> None:
    """``op.execute`` wraps a string in ``text()``, which reads ``:word`` as a
    bind parameter. A route path such as ``/sessions/:id/output`` in a COMMENT
    body therefore fails the upgrade with "A value is required for bind
    parameter 'id'" (measured while authoring this revision)."""
    tree = _tree()
    for fn_name in ("upgrade", "downgrade"):
        for sql in _sql_literals(_function(tree, fn_name)):
            hits = re.findall(r"(?<![:\w]):[A-Za-z_]\w*", sql)
            assert not hits, f"{fn_name}(): bind-parameter spelling {hits} in SQL"


def test_upgrade_is_one_plain_idempotent_create_table_keyed_on_the_five_columns() -> (
    None
):
    up = "\n".join(_sql_literals(_function(_tree(), "upgrade")))
    assert len(re.findall(r"CREATE\s+TABLE", up, re.I)) == 1
    assert re.search(rf"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+{_QUALIFIED}\b", up)
    assert re.search(
        r"PRIMARY\s+KEY\s*\(\s*day,\s*route,\s*outcome,\s*device_id,\s*served_git_sha\s*\)",
        up,
    ), "the primary key must be (day, route, outcome, device_id, served_git_sha)"
    # Additive-only: nothing but the table and its comments.
    assert not re.search(r"CREATE\s+(?:UNIQUE\s+)?INDEX", up, re.I)
    assert not re.search(r"CREATE\s+TRIGGER", up, re.I), "house convention: no triggers"
    assert not re.search(r"\bCHECK\s*\(", up, re.I), "vocabulary columns carry no CHECK"
    assert not re.search(r"\bREFERENCES\b", up, re.I), "the counter takes no FK"
    # Statement-leading only: the comment bodies legitimately say INSERT/UPDATE.
    for sql in _sql_literals(_function(_tree(), "upgrade")):
        assert re.match(r"\s*(?:CREATE\s+TABLE|COMMENT\s+ON)\b", sql, re.I), (
            f"upgrade() runs a statement that is neither the table nor a comment: {sql[:80]!r}"
        )


# ---------------------------------------------------------------------------
# live database
# ---------------------------------------------------------------------------

_DEVICE = uuid.UUID("00000000-0000-4000-8000-00000000d001")
_DAY = datetime.date(2026, 9, 28)


def _columns(engine: Engine) -> dict[str, tuple[str, bool, str | None]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name, data_type, is_nullable, column_default
                  FROM information_schema.columns
                 WHERE table_schema = :schema AND table_name = :table
                """
            ),
            {"schema": _SCHEMA, "table": _TABLE},
        ).all()
    return {r[0]: (r[1], r[2] == "YES", r[3]) for r in rows}


def _pk(engine: Engine) -> object:
    return scalar(
        engine,
        f"""
        SELECT string_agg(a.attname, ',' ORDER BY k.ord)
          FROM pg_constraint c
          CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
          JOIN pg_attribute a
            ON a.attrelid = c.conrelid AND a.attnum = k.attnum
         WHERE c.conrelid = '{_QUALIFIED}'::regclass
           AND c.contype = 'p'
        """,
    )


def _upsert(
    engine: Engine,
    *,
    n: int,
    outcome: str = "anonymous",
    device_id: uuid.UUID = _DEVICE,
    sha: str = "",
) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(_UPSERT_SQL),
            {
                "day": _DAY,
                "route": "session_output",
                "outcome": outcome,
                "device_id": device_id,
                "sha": sha,
                "n": n,
            },
        )


def _count(engine: Engine) -> int:
    value = scalar(engine, f"SELECT count(*) FROM {_QUALIFIED}")
    assert isinstance(value, int)
    return value


@_needs_pg
def test_table_shape_and_primary_key() -> None:
    with ephemeral_database(admin_database_url(), "dpwa01_shape") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        got = _columns(engine)
        for name, data_type, nullable, default in _COLUMNS:
            assert name in got, f"{_QUALIFIED} is missing {name}"
            got_type, got_nullable, got_default = got[name]
            assert got_type == data_type, f"{name}: {got_type} != {data_type}"
            assert got_nullable is nullable, f"{name}: nullable {got_nullable}"
            if default is None:
                assert got_default is None, f"{name}: unexpected {got_default}"
            else:
                assert got_default is not None and default in got_default
        assert set(got) == {c[0] for c in _COLUMNS}, f"unexpected {set(got)}"
        assert _pk(engine) == _PK_COLUMNS


@_needs_pg
def test_sentinels_are_key_values_nulls_are_refused_and_the_upsert_increments() -> None:
    with ephemeral_database(admin_database_url(), "dpwa01_key") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        # The writer's upsert increments rather than overwrites.
        _upsert(engine, n=3)
        _upsert(engine, n=4)
        assert _count(engine) == 1
        assert scalar(engine, f"SELECT count FROM {_QUALIFIED}") == 7

        # The sentinels are ordinary, distinct key values.
        _upsert(engine, n=1, device_id=_NIL_UUID)
        _upsert(engine, n=1, sha="0123abcd")
        _upsert(engine, n=1, outcome="owner")
        assert _count(engine) == 4
        _upsert(engine, n=2, device_id=_NIL_UUID)
        assert (
            scalar(
                engine,
                f"SELECT count FROM {_QUALIFIED} WHERE device_id = :d",
                d=_NIL_UUID,
            )
            == 3
        )

        # NULL cannot enter the key: that is what the sentinels stand in for.
        for column, kwargs in (
            ("device_id", {"device_id": None}),
            ("served_git_sha", {"sha": None}),
        ):
            with pytest.raises(sqlalchemy.exc.IntegrityError) as excinfo:
                _upsert(engine, n=1, **kwargs)  # type: ignore[arg-type]
            orig = excinfo.value.orig
            assert getattr(orig, "pgcode", None) == "23502", f"not NOT NULL: {orig!r}"
            assert orig.diag.column_name == column  # type: ignore[union-attr]


@_needs_pg
def test_comments_land_as_the_source_writes_them_and_name_both_sentinels() -> None:
    source = _revision_source()
    with ephemeral_database(admin_database_url(), "dpwa01_cmt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        table_comment = scalar(
            engine, f"SELECT obj_description('{_QUALIFIED}'::regclass)"
        )
        assert table_comment == comment_body_from_source(
            source, _QUALIFIED, object_kind="TABLE"
        )
        assert "data_plane_observe" in str(table_comment)
        for column in _COMMENTED:
            assert column_comment(engine, _TABLE, column) == comment_body_from_source(
                source, f"{_QUALIFIED}.{column}"
            ), f"comment on {column} differs from the revision source"
        assert str(_NIL_UUID) in str(column_comment(engine, _TABLE, "device_id"))
        assert "empty string" in str(column_comment(engine, _TABLE, "served_git_sha"))


@_needs_pg
def test_upgrade_is_idempotent() -> None:
    with ephemeral_database(admin_database_url(), "dpwa01_idem") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _upsert(engine, n=5)

        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        assert table_exists(engine, _SCHEMA, _TABLE)
        assert scalar(engine, f"SELECT count FROM {_QUALIFIED}") == 5


@_needs_pg
def test_up_down_up_leaves_no_residue() -> None:
    with ephemeral_database(admin_database_url(), "dpwa01_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _upsert(engine, n=1)

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, _SCHEMA, _TABLE)

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
        assert _count(engine) == 0
