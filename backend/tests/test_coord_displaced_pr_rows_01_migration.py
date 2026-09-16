"""Structural and round-trip test for alembic ``coord_displaced_pr_rows_01``.

Plan ``2026-09-13-coord-ff-lands-a-pr-it-never-mirrors-so-its-citation-can-never-be-observed``
Phase 1a.

``coord.displaced_pr_rows`` is a contract another repo codes against: coord's
archive CTE copies a ``coord.repo_branches`` row into it column for column, and
coord's realizations read UNIONs the two tables. So the properties pinned here
are the ones that would break coord at runtime while every migration gate stays
green:

Without a database (always runs):

1. Chain wiring: the parent names one real sibling and the ``Revises:`` header
   agrees with ``down_revision``.
2. Every DDL object is ``coord.``-qualified, the only DROP is in
   ``downgrade()``, and the column-drop guard reads the upgrade path as dropping
   nothing.
3. Both directions are pure ``op.execute`` with static SQL, which is what the
   coord merge-train classifier can read and what offline ``--sql`` mode needs.

With a database (skipped when none is reachable; a skip proves nothing). The
harness connects with ``DATABASE_URL``, but under pytest ``conftest.py``
overwrites that variable at import time from ``QONTINUI_TEST_PG``, so point the
tests at a live instance with ``QONTINUI_TEST_PG=host:port``:

4. At THIS revision, every carried column has exactly the type of the
   same-named ``coord.repo_branches`` column, read from the same database
   rather than from a copy of the types. A drift here is a UNION type error
   inside coord.
4b. The same comparison at ``heads``. Test 4 stops at this revision, so it
    cannot see a LATER revision that alters a carried column on
    ``repo_branches`` without altering it here too; this one can.
5. The key is ``(repo, pr_number)``, ``source`` accepts exactly its two values,
   the carried columns are nullable with no default, and the two timestamps
   default to ``now()``.
6. There is no ``tenant_id`` column, because ``repo_branches`` has none.
7. The table and column comments land as the source writes them.
8. ``upgrade()`` is idempotent, and up, down, up leaves no residue.
"""

from __future__ import annotations

import ast
import re
import sys
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

_REVISION_ID = "coord_displaced_pr_rows_01"
_REVISION_FILENAME = "coord_displaced_pr_rows_01_create.py"

# Pinned as a literal, not read back from the module, so a re-point of
# down_revision is a deliberate two-file change. Whoever re-points the revision
# onto a moved head updates this line, the assignment, and the Revises header.
_PARENT_REVISION_ID = "coord_prepaid_balances_01"

_SCHEMA = "coord"
_TABLE = "displaced_pr_rows"

# The columns copied from coord.repo_branches. Their types are NOT pinned here:
# the live tests read them off repo_branches in the same database. The shape
# test compares them at this revision; the heads test compares them after the
# whole chain, which is the one that catches a later repo_branches alteration.
_CARRIED_COLUMNS = (
    "branch",
    "base_branch",
    "head_sha",
    "pr_state",
    "close_cause",
    "merge_commit_sha",
    "merged_at",
    "touched_files",
)

# (name, information_schema data_type, nullable, default-substring or None)
_OWN_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("repo", "text", False, None),
    ("pr_number", "integer", False, None),
    ("source", "text", False, None),
    ("displaced_by_pr_number", "integer", True, None),
    ("displaced_at", "timestamp with time zone", False, "now()"),
    ("last_refreshed_at", "timestamp with time zone", False, "now()"),
)

_SOURCES = ("rebind", "first_observation")

_COMMENTED_COLUMNS = (
    "repo",
    "pr_number",
    "branch",
    "source",
    "displaced_by_pr_number",
    "displaced_at",
    "last_refreshed_at",
)

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
    parent = _PARENT_REVISION_ID

    versions_dir = backend_root() / "alembic" / "versions"
    pattern = re.compile(
        rf'^revision(?:: str)?\s*=\s*["\']{re.escape(parent)}["\']', re.M
    )
    siblings = [
        f
        for f in versions_dir.glob("*.py")
        if f.name != _REVISION_FILENAME
        and pattern.search(f.read_text(encoding="utf-8"))
    ]
    assert len(siblings) == 1, (
        f"down_revision {parent!r} must name exactly one existing sibling "
        f"(found {[f.name for f in siblings]})"
    )
    assert module.branch_labels is None
    assert module.depends_on is None


def test_docstring_header_matches_the_identifiers() -> None:
    # The author re-points down_revision when main moves before landing; the
    # Revises header must move with it.
    source = _revision_source()
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_PARENT_REVISION_ID)}$", source, re.M)


# ---------------------------------------------------------------------------
# 2. coord-qualified, and the only DROP is in downgrade()
# ---------------------------------------------------------------------------


def test_every_ddl_object_is_coord_qualified() -> None:
    tree = _tree()
    for fn_name in ("upgrade", "downgrade"):
        for sql in _sql_literals(_function(tree, fn_name)):
            for obj in re.findall(
                r"(?:CREATE\s+TABLE|DROP\s+TABLE|ALTER\s+TABLE|COMMENT\s+ON\s+TABLE"
                r"|COMMENT\s+ON\s+COLUMN)(?:\s+IF\s+(?:NOT\s+)?EXISTS)?\s+([A-Za-z_.\"]+)",
                sql,
                re.I,
            ):
                assert obj.startswith(f"{_SCHEMA}.{_TABLE}"), (
                    f"{fn_name}(): object {obj!r} is not coord.{_TABLE}"
                )


def test_every_drop_is_inside_downgrade() -> None:
    tree = _tree()
    up = "\n".join(_sql_literals(_function(tree, "upgrade")))
    assert not re.search(r"\bDROP\b", up, re.I), "upgrade() must not DROP anything"
    down = "\n".join(_sql_literals(_function(tree, "downgrade")))
    assert re.search(rf"DROP\s+TABLE\s+IF\s+EXISTS\s+{_SCHEMA}\.{_TABLE}\b", down, re.I)


def test_the_drop_guard_reads_the_upgrade_path_as_dropping_nothing() -> None:
    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops, [(d.table, d.column) for d in scan.drops]
    assert not scan.unresolved, scan.unresolved
    assert not scan.violations, scan.violations


# ---------------------------------------------------------------------------
# 3. static SQL through op.execute only
# ---------------------------------------------------------------------------


def test_both_directions_are_static_op_execute_with_no_bind() -> None:
    tree = _tree()
    calls = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "op"
    ]
    assert calls, "no op calls found"
    assert {c.func.attr for c in calls} == {"execute"}  # type: ignore[attr-defined]
    for call in calls:
        # coord merge-train classifier: an execute with no static string literal
        # is rejected as dynamic SQL it cannot inspect.
        assert len(call.args) == 1 and isinstance(call.args[0], ast.Constant), (
            f"op.execute at line {call.lineno} must take one static SQL literal"
        )
        assert isinstance(call.args[0].value, str)


def test_upgrade_ddl_is_idempotent_by_construction() -> None:
    up = "\n".join(_sql_literals(_function(_tree(), "upgrade")))
    assert re.search(rf"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+{_SCHEMA}\.{_TABLE}", up)
    assert not re.search(r"CREATE\s+TRIGGER", up, re.I), "house convention: no triggers"


# ---------------------------------------------------------------------------
# live database
# ---------------------------------------------------------------------------


def _columns(
    engine: Engine, table: str
) -> dict[str, tuple[str, str, bool, str | None]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name, data_type, udt_name, is_nullable, column_default
                  FROM information_schema.columns
                 WHERE table_schema = :schema AND table_name = :table
                """
            ),
            {"schema": _SCHEMA, "table": table},
        ).all()
    return {r[0]: (r[1], r[2], r[3] == "YES", r[4]) for r in rows}


def _insert(engine: Engine, **overrides: object) -> None:
    params: dict[str, object] = {
        "repo": "qontinui/qontinui-dev-notes",
        "pr_number": 983,
        "source": "rebind",
    }
    params.update(overrides)
    cols = ", ".join(params)
    binds = ", ".join(f":{k}" for k in params)
    with engine.begin() as conn:
        conn.execute(
            text(f"INSERT INTO coord.displaced_pr_rows ({cols}) VALUES ({binds})"),
            params,
        )


def _row_count(engine: Engine) -> int:
    value = scalar(engine, "SELECT count(*) FROM coord.displaced_pr_rows")
    assert isinstance(value, int)
    return value


def _assert_carried_types_match(
    archive: dict[str, tuple[str, str, bool, str | None]],
    live: dict[str, tuple[str, str, bool, str | None]],
) -> None:
    """Each carried column has the same (data_type, udt_name) in both tables."""
    for name in _CARRIED_COLUMNS:
        assert name in live, f"coord.repo_branches has no {name} column"
        assert name in archive, f"coord.{_TABLE} is missing {name}"
        assert archive[name][:2] == live[name][:2], (
            f"{name}: archive type {archive[name][:2]} != "
            f"repo_branches type {live[name][:2]}; coord UNIONs the two"
        )


@_needs_pg
def test_table_shape_matches_repo_branches_and_the_contract() -> None:
    with ephemeral_database(admin_database_url(), "dpr01_shape") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        archive = _columns(engine, _TABLE)
        live = _columns(engine, "repo_branches")

        _assert_carried_types_match(archive, live)
        for name in _CARRIED_COLUMNS:
            assert archive[name][2] is True, f"{name} must be nullable"
            assert archive[name][3] is None, (
                f"{name} must have no default (NULL is NOT RECORDED), "
                f"got {archive[name][3]!r}"
            )

        for name, data_type, nullable, default in _OWN_COLUMNS:
            assert name in archive, f"coord.{_TABLE} is missing {name}"
            got_type, _udt, got_nullable, got_default = archive[name]
            assert got_type == data_type, f"{name}: {got_type} != {data_type}"
            assert got_nullable is nullable, f"{name}: nullable {got_nullable}"
            if default is None:
                assert got_default is None, f"{name}: unexpected default {got_default}"
            else:
                assert got_default is not None and default in got_default, (
                    f"{name}: default {got_default!r} lacks {default!r}"
                )

        expected = set(_CARRIED_COLUMNS) | {c[0] for c in _OWN_COLUMNS}
        assert set(archive) == expected, (
            f"unexpected column set: extra {set(archive) - expected}, "
            f"missing {expected - set(archive)}"
        )
        assert "tenant_id" not in live, (
            "coord.repo_branches gained tenant_id; revisit this archive's "
            "tenant-agnostic shape"
        )

        pk = scalar(
            engine,
            """
            SELECT string_agg(a.attname, ',' ORDER BY k.ord)
              FROM pg_constraint c
              CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute a
                ON a.attrelid = c.conrelid AND a.attnum = k.attnum
             WHERE c.conrelid = 'coord.displaced_pr_rows'::regclass
               AND c.contype = 'p'
            """,
        )
        assert pk == "repo,pr_number"


@_needs_pg
def test_key_source_check_and_defaults_behave() -> None:
    with ephemeral_database(admin_database_url(), "dpr01_rows") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        # One row per PR: the same branch may appear under two PR numbers.
        _insert(engine, pr_number=982, branch="plan/x", displaced_by_pr_number=991)
        _insert(engine, pr_number=983, branch="plan/x", source="first_observation")

        with pytest.raises(sqlalchemy.exc.IntegrityError):
            _insert(engine, pr_number=982, branch="plan/y")

        with pytest.raises(sqlalchemy.exc.IntegrityError):
            _insert(engine, pr_number=1, source="webhook")

        with pytest.raises(sqlalchemy.exc.IntegrityError):
            _insert(engine, pr_number=2, source=None)

        # Every carried column may be NULL: a first observation from a land
        # event alone has no head ref.
        _insert(engine, pr_number=3, source="first_observation")

        with engine.connect() as conn:
            row = conn.execute(
                text(
                    """
                    SELECT touched_files, pr_state, displaced_by_pr_number,
                           displaced_at IS NOT NULL, last_refreshed_at IS NOT NULL
                      FROM coord.displaced_pr_rows
                     WHERE pr_number = 3
                    """
                )
            ).one()
        assert row == (None, None, None, True, True)
        assert _row_count(engine) == 3
        with engine.connect() as conn:
            stored = {
                r[0]
                for r in conn.execute(
                    text("SELECT DISTINCT source FROM coord.displaced_pr_rows")
                )
            }
        assert stored == set(_SOURCES), f"stored sources {stored}"


@_needs_pg
def test_comments_land_as_the_source_writes_them() -> None:
    source = _revision_source()
    with ephemeral_database(admin_database_url(), "dpr01_cmt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        table_comment = scalar(
            engine, "SELECT obj_description('coord.displaced_pr_rows'::regclass)"
        )
        assert table_comment == comment_body_from_source(
            source, f"{_SCHEMA}.{_TABLE}", object_kind="TABLE"
        )
        for column in _COMMENTED_COLUMNS:
            assert column_comment(engine, _TABLE, column) == comment_body_from_source(
                source, f"{_SCHEMA}.{_TABLE}.{column}"
            ), f"comment on {column} differs from the revision source"


@_needs_pg
def test_upgrade_is_idempotent() -> None:
    with ephemeral_database(admin_database_url(), "dpr01_idem") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _insert(engine)

        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        assert table_exists(engine, _SCHEMA, _TABLE)
        assert _row_count(engine) == 1, "the re-run must not disturb existing rows"


@_needs_pg
def test_up_down_up_leaves_no_residue() -> None:
    with ephemeral_database(admin_database_url(), "dpr01_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _insert(engine)

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, _SCHEMA, _TABLE)
        assert table_exists(engine, _SCHEMA, "repo_branches"), (
            "downgrade touched the table this one archives"
        )

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
        assert _row_count(engine) == 0, "the table comes back empty, not restored"


@_needs_pg
def test_carried_types_still_match_repo_branches_at_heads() -> None:
    """Type parity after the WHOLE chain, not only up to this revision.

    The shape test stops at this revision, so a later revision that alters a
    carried column on coord.repo_branches (and not here) never runs in it. coord
    UNIONs the two tables, so that drift is a runtime type error in the
    realizations read. Walking to ``heads`` is what makes it visible here.
    """
    with ephemeral_database(admin_database_url(), "dpr01_heads") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", "heads")
        assert table_exists(engine, _SCHEMA, _TABLE), (
            "upgrade heads did not produce the table; the comparison below would "
            "be vacuous"
        )
        _assert_carried_types_match(
            _columns(engine, _TABLE), _columns(engine, "repo_branches")
        )
