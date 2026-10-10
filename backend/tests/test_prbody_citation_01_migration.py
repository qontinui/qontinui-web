"""Structural and round-trip test for alembic ``prbody_citation_01``.

Plan ``2026-10-05-a-pr-body-citation-outlives-the-body-that-created-it`` Phase 1.

``coord.pr_body_citation_watermarks`` and ``coord.work_unit_citation_retractions``
are a contract coord's pr_body re-derivation codes against: the watermark is
upserted on ``(repo, pr_number)`` and joined to ``coord.work_unit_pr_citations``
on ``repo`` as spelled there, and the ledger's ``pending`` rows are
conflict-targeted on the partial unique index. The properties pinned here are
the ones that would break coord at runtime while every migration gate stays
green.

Without a database (always runs):

1. Chain wiring: the parent names one real sibling and the ``Revises:`` header
   agrees with ``down_revision``.
2. Every DDL object is ``coord.``-qualified, the only DROPs are in
   ``downgrade()``, and the column-drop guard reads the upgrade path as dropping
   nothing.
3. Both directions are pure ``op.execute`` with static SQL.
4. ``repo`` carries NO lowercase CHECK: the join key is the webhook's
   ``repository.full_name``, which coord does not lowercase.

With a database (skipped when none is reachable; a skip proves nothing). Point
the tests at a live instance with ``QONTINUI_TEST_PG=host:port``:

5. Column types, nullability and defaults, keys and indexes.
6. Each key and CHECK rejects what it names, a mixed-case repo is storable,
   NOT NULL names its column, and the pending index admits one pending row per
   citation but any number of terminal ones.
7. The table and column comments land as the source writes them.
8. ``upgrade()`` is idempotent, and up, down, up leaves no residue.
"""

from __future__ import annotations

import ast
import re
import sys
import uuid
from datetime import UTC, datetime
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
    index_exists,
    load_revision_module,
    run_alembic,
    scalar,
    table_exists,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts" / "ci"))

import check_coord_column_drops as guard  # noqa: E402

_REVISION_ID = "prbody_citation_01"
_REVISION_FILENAME = "prbody_citation_01_watermarks_and_retractions.py"

# Pinned as a literal, not read back from the module, so a re-point of
# down_revision is a deliberate two-file change.
_PARENT_REVISION_ID = "cinode_02_required_capabilities"

_SCHEMA = "coord"
_WATERMARKS = "pr_body_citation_watermarks"
_RETRACTIONS = "work_unit_citation_retractions"
_TABLES = (_WATERMARKS, _RETRACTIONS)

# (name, information_schema data_type, nullable, has_default)
_WATERMARK_COLUMNS: tuple[tuple[str, str, bool, bool], ...] = (
    ("repo", "text", False, False),
    ("pr_number", "integer", False, False),
    ("body_updated_at", "timestamp with time zone", False, False),
    ("body_sha256", "text", False, False),
    ("observed_at", "timestamp with time zone", False, True),
)
_RETRACTION_COLUMNS: tuple[tuple[str, str, bool, bool], ...] = (
    ("id", "uuid", False, True),
    ("tenant_id", "uuid", True, False),
    ("work_unit_id", "uuid", False, False),
    ("repo", "text", False, False),
    ("pr_number", "integer", False, False),
    ("source", "text", False, False),
    ("delivery_scope", "jsonb", True, False),
    ("cited_at", "timestamp with time zone", True, False),
    ("body_updated_at", "timestamp with time zone", False, False),
    ("state", "text", False, False),
    ("recorded_at", "timestamp with time zone", False, True),
    ("applied_at", "timestamp with time zone", True, False),
)
_COLUMNS = {_WATERMARKS: _WATERMARK_COLUMNS, _RETRACTIONS: _RETRACTION_COLUMNS}

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


def _revision_module():
    return load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")


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
    module = _revision_module()
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID, (
        f"down_revision is {module.down_revision!r}; if the revision was "
        "re-pointed onto a moved head, _PARENT_REVISION_ID was not updated with it"
    )
    versions_dir = backend_root() / "alembic" / "versions"
    pattern = re.compile(
        rf'^revision(?:: str)?\s*=\s*["\']{re.escape(_PARENT_REVISION_ID)}["\']', re.M
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
# 2. coord-qualified, and the only DROPs are in downgrade()
# ---------------------------------------------------------------------------


def test_every_ddl_object_is_coord_qualified() -> None:
    tree = _tree()
    allowed = "|".join(re.escape(t) for t in _TABLES)
    for fn_name in ("upgrade", "downgrade"):
        for sql in _sql_literals(_function(tree, fn_name)):
            for obj in re.findall(
                r"(?:CREATE\s+TABLE|DROP\s+TABLE|ALTER\s+TABLE|COMMENT\s+ON\s+TABLE"
                r"|COMMENT\s+ON\s+COLUMN)(?:\s+IF\s+(?:NOT\s+)?EXISTS)?\s+([A-Za-z_.\"]+)",
                sql,
                re.I,
            ):
                assert re.fullmatch(rf"{_SCHEMA}\.(?:{allowed})(\.\w+)?", obj), (
                    f"{fn_name}(): object {obj!r} is not one of this revision's tables"
                )
            for target in re.findall(r"INDEX\b[^;]*?\bON\s+([A-Za-z_.\"]+)", sql, re.I):
                assert re.fullmatch(rf"{_SCHEMA}\.(?:{allowed})", target), (
                    f"{fn_name}(): index target {target!r} is not this revision's table"
                )


def test_every_drop_is_inside_downgrade() -> None:
    tree = _tree()
    up = "\n".join(_sql_literals(_function(tree, "upgrade")))
    assert not re.search(r"\bDROP\b", up, re.I), "upgrade() must not DROP anything"
    down = "\n".join(_sql_literals(_function(tree, "downgrade")))
    for table in _TABLES:
        assert re.search(
            rf"DROP\s+TABLE\s+IF\s+EXISTS\s+{_SCHEMA}\.{table}\b", down, re.I
        )


def test_the_drop_guard_reads_the_upgrade_path_as_dropping_nothing() -> None:
    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops, [(d.table, d.column) for d in scan.drops]
    assert not scan.unresolved, scan.unresolved
    assert not scan.violations, scan.violations


def test_no_foreign_key_is_declared() -> None:
    # The ledger must survive the unit it records, and a FK would also take a
    # lock on a table coord writes. Only the DDL is scanned: the comments say
    # "not a foreign key" in prose.
    ddl = [
        sql
        for sql in _sql_literals(_function(_tree(), "upgrade"))
        if not re.match(r"\s*COMMENT\s+ON\b", sql, re.I)
    ]
    assert ddl
    for sql in ddl:
        assert not re.search(r"\bREFERENCES\b|\bFOREIGN\s+KEY\b", sql, re.I), sql


def test_repo_has_no_lowercase_check() -> None:
    # repo is the join key to coord.work_unit_pr_citations.repo, which holds the
    # webhook's repository.full_name un-normalised. A lowercase CHECK would make
    # every watermark write for a mixed-case repo fail.
    up = "\n".join(_sql_literals(_function(_tree(), "upgrade")))
    assert not re.search(r"lower\s*\(\s*repo\s*\)", up, re.I)


# ---------------------------------------------------------------------------
# 3. static SQL through op.execute only
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


def test_upgrade_ddl_is_idempotent_by_construction() -> None:
    up = "\n".join(_sql_literals(_function(_tree(), "upgrade")))
    for table in _TABLES:
        assert re.search(
            rf"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+{_SCHEMA}\.{table}\b", up
        )
    for create in re.findall(r"CREATE\s+(?:UNIQUE\s+)?INDEX\b[^\n]*", up, re.I):
        assert re.search(r"IF\s+NOT\s+EXISTS", create, re.I), create
    assert not re.search(r"CREATE\s+TRIGGER", up, re.I), "house convention: no triggers"


# ---------------------------------------------------------------------------
# live database
# ---------------------------------------------------------------------------


_UPDATED = datetime(2026, 10, 5, 7, 0, tzinfo=UTC)
# Every row a test writes lives under this repo. It is deliberately mixed case:
# the webhook's full_name is stored un-normalised and must be storable.
_REPO = "qontinui/PRBody01-Test-Repo"
_SHA = "0" * 64


def _columns(engine: Engine, table: str) -> dict[str, tuple[str, bool, str | None]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name, data_type, is_nullable, column_default
                  FROM information_schema.columns
                 WHERE table_schema = :schema AND table_name = :table
                """
            ),
            {"schema": _SCHEMA, "table": table},
        ).all()
    return {r[0]: (r[1], r[2] == "YES", r[3]) for r in rows}


def _insert(engine: Engine, table: str, params: dict[str, object]) -> None:
    cols = ", ".join(params)
    binds = ", ".join(f":{k}" for k in params)
    with engine.begin() as conn:
        conn.execute(
            text(f"INSERT INTO coord.{table} ({cols}) VALUES ({binds})"), params
        )


def _watermark(**overrides: object) -> dict[str, object]:
    params: dict[str, object] = {
        "repo": _REPO,
        "pr_number": 1,
        "body_updated_at": _UPDATED,
        "body_sha256": _SHA,
    }
    params.update(overrides)
    return params


_UNIT = uuid.UUID("01a10dde-0000-7000-8000-000000000001")


def _retraction(**overrides: object) -> dict[str, object]:
    params: dict[str, object] = {
        "work_unit_id": _UNIT,
        "repo": _REPO,
        "pr_number": 1,
        "source": "pr_body",
        "body_updated_at": _UPDATED,
        "state": "pending",
    }
    params.update(overrides)
    return params


def _assert_rejected_by(
    engine: Engine, table: str, constraint: str, params: dict[str, object]
) -> None:
    """The insert fails, and the database names ``constraint`` as the reason."""
    with pytest.raises(sqlalchemy.exc.IntegrityError) as excinfo:
        _insert(engine, table, params)
    diag = getattr(excinfo.value.orig, "diag", None)
    assert diag is not None, f"driver error carries no diag: {excinfo.value.orig!r}"
    assert diag.constraint_name == constraint, (
        f"{params}: rejected by {diag.constraint_name!r}, expected {constraint!r}"
    )


def _assert_not_null(
    engine: Engine, table: str, params: dict[str, object], column: str
) -> None:
    params = {**params, column: None}
    with pytest.raises(sqlalchemy.exc.IntegrityError) as excinfo:
        _insert(engine, table, params)
    orig = excinfo.value.orig
    assert getattr(orig, "pgcode", None) == "23502", f"not a NOT NULL: {orig!r}"
    assert orig.diag.column_name == column  # type: ignore[union-attr]


def _count(engine: Engine, table: str) -> int:
    value = scalar(
        engine, f"SELECT count(*) FROM coord.{table} WHERE repo = :repo", repo=_REPO
    )
    assert isinstance(value, int)
    return value


def _primary_key(engine: Engine, table: str) -> object:
    return scalar(
        engine,
        f"""
        SELECT string_agg(a.attname, ',' ORDER BY k.ord)
          FROM pg_constraint c
          CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
          JOIN pg_attribute a
            ON a.attrelid = c.conrelid AND a.attnum = k.attnum
         WHERE c.conrelid = 'coord.{table}'::regclass
           AND c.contype = 'p'
        """,
    )


@_needs_pg
def test_table_shape_keys_and_indexes() -> None:
    with ephemeral_database(admin_database_url(), "prbc01_shape") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        for table, columns in _COLUMNS.items():
            got = _columns(engine, table)
            for name, data_type, nullable, has_default in columns:
                assert name in got, f"coord.{table} is missing {name}"
                got_type, got_nullable, got_default = got[name]
                assert got_type == data_type, (
                    f"{table}.{name}: {got_type} != {data_type}"
                )
                assert got_nullable is nullable, (
                    f"{table}.{name}: nullable {got_nullable}"
                )
                assert (got_default is not None) is has_default, (
                    f"{table}.{name}: default {got_default!r}"
                )
            assert set(got) == {c[0] for c in columns}, f"unexpected columns {set(got)}"

        assert _primary_key(engine, _WATERMARKS) == "repo,pr_number"
        assert _primary_key(engine, _RETRACTIONS) == "id"

        assert index_exists(engine, "idx_work_unit_citation_retractions_one_pending")
        assert index_exists(engine, "idx_work_unit_citation_retractions_repo_pr")
        pending_def = scalar(
            engine,
            "SELECT indexdef FROM pg_indexes WHERE schemaname = 'coord' "
            "AND indexname = 'idx_work_unit_citation_retractions_one_pending'",
        )
        assert isinstance(pending_def, str)
        assert "UNIQUE" in pending_def
        assert "(work_unit_id, repo, pr_number)" in pending_def
        assert "WHERE (state = 'pending'::text)" in pending_def


@_needs_pg
def test_keys_checks_and_nulls_behave() -> None:
    with ephemeral_database(admin_database_url(), "prbc01_rows") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        # --- watermarks
        _insert(engine, _WATERMARKS, _watermark())
        _assert_rejected_by(engine, _WATERMARKS, f"{_WATERMARKS}_pkey", _watermark())
        for expected, bad in (
            (f"{_WATERMARKS}_repo_nonblank_check", _watermark(repo="  ")),
            (f"{_WATERMARKS}_pr_number_positive_check", _watermark(pr_number=0)),
        ):
            _assert_rejected_by(engine, _WATERMARKS, expected, bad)
        for column in ("repo", "pr_number", "body_updated_at", "body_sha256"):
            _assert_not_null(engine, _WATERMARKS, _watermark(pr_number=2), column)
        assert _count(engine, _WATERMARKS) == 1
        observed = scalar(
            engine,
            f"SELECT observed_at FROM coord.{_WATERMARKS} WHERE repo = :repo",
            repo=_REPO,
        )
        assert observed is not None, "observed_at defaults on insert"

        # --- retractions
        _insert(engine, _RETRACTIONS, _retraction())
        # One pending row per citation: a second is refused by the partial index.
        _assert_rejected_by(
            engine,
            _RETRACTIONS,
            "idx_work_unit_citation_retractions_one_pending",
            _retraction(),
        )
        # Terminal states are not limited: the same citation may be retracted,
        # superseded, and retracted again over a PR's life.
        for state in ("applied", "applied", "withdrawn", "superseded", "ambiguous"):
            _insert(engine, _RETRACTIONS, _retraction(state=state))
        # A pending row on another PR of the same unit is a different citation.
        _insert(engine, _RETRACTIONS, _retraction(pr_number=2))
        for expected, bad in (
            (
                f"{_RETRACTIONS}_state_check",
                _retraction(pr_number=3, state="retracted"),
            ),
            (f"{_RETRACTIONS}_repo_nonblank_check", _retraction(repo="")),
            (f"{_RETRACTIONS}_pr_number_positive_check", _retraction(pr_number=-1)),
        ):
            _assert_rejected_by(engine, _RETRACTIONS, expected, bad)
        for column in (
            "work_unit_id",
            "repo",
            "pr_number",
            "source",
            "body_updated_at",
            "state",
        ):
            _assert_not_null(engine, _RETRACTIONS, _retraction(state="applied"), column)
        assert _count(engine, _RETRACTIONS) == 7

        # The conflict targets coord's writer relies on: a bare ON CONFLICT DO
        # NOTHING absorbs a second pending row (the partial unique index), and
        # the watermark upsert resolves on the primary key.
        with engine.begin() as conn:
            dup = conn.execute(
                text(
                    f"INSERT INTO coord.{_RETRACTIONS} "
                    "(work_unit_id, repo, pr_number, source, body_updated_at, state) "
                    f"SELECT work_unit_id, repo, pr_number, source, body_updated_at, state "
                    f"FROM coord.{_RETRACTIONS} WHERE state = 'pending' AND pr_number = 1 "
                    "ON CONFLICT DO NOTHING"
                )
            )
            assert dup.rowcount == 0, "a second pending row is absorbed"
            up = conn.execute(
                text(
                    f"INSERT INTO coord.{_WATERMARKS} "
                    "(repo, pr_number, body_updated_at, body_sha256, observed_at) "
                    "SELECT repo, pr_number, body_updated_at + interval '1 second', "
                    "'ff', now() FROM coord." + _WATERMARKS + " "
                    "ON CONFLICT (repo, pr_number) DO UPDATE SET "
                    "body_updated_at = EXCLUDED.body_updated_at, "
                    "body_sha256 = EXCLUDED.body_sha256, observed_at = now()"
                )
            )
            assert up.rowcount == 1
        assert _count(engine, _RETRACTIONS) == 7
        assert _count(engine, _WATERMARKS) == 1

        with engine.connect() as conn:
            defaults = conn.execute(
                text(
                    f"""
                    SELECT count(*) FILTER (WHERE id IS NULL),
                           count(*) FILTER (WHERE recorded_at IS NULL),
                           count(*) FILTER (WHERE applied_at IS NOT NULL)
                      FROM coord.{_RETRACTIONS} WHERE repo = :repo
                    """
                ),
                {"repo": _REPO},
            ).one()
        assert tuple(defaults) == (0, 0, 0), (
            "id and recorded_at default; applied_at does not"
        )


@_needs_pg
def test_comments_land_as_the_source_writes_them() -> None:
    source = _revision_source()
    with ephemeral_database(admin_database_url(), "prbc01_cmt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        for table, columns in _COLUMNS.items():
            table_comment = scalar(
                engine, f"SELECT obj_description('coord.{table}'::regclass)"
            )
            assert table_comment == comment_body_from_source(
                source, f"{_SCHEMA}.{table}", object_kind="TABLE"
            )
            for column, *_rest in columns:
                assert column_comment(
                    engine, table, column
                ) == comment_body_from_source(source, f"{_SCHEMA}.{table}.{column}"), (
                    f"comment on {table}.{column} differs from the revision source"
                )


@_needs_pg
def test_upgrade_is_idempotent() -> None:
    with ephemeral_database(admin_database_url(), "prbc01_idem") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _insert(engine, _WATERMARKS, _watermark())
        _insert(engine, _RETRACTIONS, _retraction())

        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        for table in _TABLES:
            assert table_exists(engine, _SCHEMA, table)
            assert _count(engine, table) == 1, (
                "the re-run must not disturb existing rows"
            )


@_needs_pg
def test_up_down_up_leaves_no_residue() -> None:
    with ephemeral_database(admin_database_url(), "prbc01_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _insert(engine, _WATERMARKS, _watermark())
        _insert(engine, _RETRACTIONS, _retraction())

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        for table in _TABLES:
            assert not table_exists(engine, _SCHEMA, table)
        assert not index_exists(
            engine, "idx_work_unit_citation_retractions_one_pending"
        )

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        for table in _TABLES:
            assert table_exists(engine, _SCHEMA, table)
            assert _count(engine, table) == 0, (
                "the table comes back empty, not restored"
            )
