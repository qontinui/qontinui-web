"""Structural and round-trip test for alembic ``wtcensus_split_01_latest_and_history``.

Plan ``2026-09-25-worktree-census-presence-history-split-and-device-relative-freshness``
Phase B, test T15.

``coord.worktree_census_latest`` and ``coord.worktree_census_history`` are a
contract coord's split census writer (Phase C) codes against. The properties
pinned here are the ones that would break that writer, or silently cost it its
design, while every migration gate stays green:

Without a database (always runs):

1. Chain wiring: the parent names one real sibling and the ``Revises:`` header
   agrees with ``down_revision``.
2. Every DDL object is ``coord.``-qualified, the only DROP is in
   ``downgrade()``, and the column-drop guard reads the upgrade path as dropping
   nothing.
3. Both directions are pure ``op.execute`` with static SQL, and each one bounds
   its lock wait first and restores ``lock_timeout`` to DEFAULT as its LAST
   statement (env.py runs a whole batch in one transaction, so an unrestored
   ``SET LOCAL`` would bound every later revision in the batch).

With a database (skipped when none is reachable; a skip proves nothing). Point
the tests at a live instance with ``QONTINUI_TEST_PG=host:port``:

4. ``worktree_census_latest`` carries EXACTLY the legacy census columns (minus
   ``id`` / ``observed_at``) with the same types, nullability and defaults, plus
   the three clocks; the history table carries the same census columns plus
   ``id`` / ``started_at`` / ``ended_at``. A census column added to the oplog
   later without its twin here reds this test.
5. ``worktree_census_latest`` has exactly ONE index, its primary key on
   ``(device_id, repo, path)``, and ``fillfactor=70``: every per-walk update must
   stay a HOT update (D2).
6. The history table has its three secondary indexes with the intended
   definitions, and the partial unique index rejects a second OPEN interval per
   key while admitting any number of closed ones.
7. The comments land as the source writes them.
8. ``upgrade()`` is idempotent, and up, down, up leaves no residue (the id
   sequence included).
"""

from __future__ import annotations

import ast
import re
import sys
import uuid
from datetime import UTC, datetime, timedelta
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

_REVISION_ID = "wtcensus_split_01_latest_and_history"
_REVISION_FILENAME = "wtcensus_split_01_latest_and_history.py"

# Pinned as a literal, not read back from the module, so a re-point of
# down_revision is a deliberate two-file change. Whoever re-points the revision
# onto a moved head updates this line, the assignment, and the Revises header.
_PARENT_REVISION_ID = "coord_wu_authored_at_02"

_SCHEMA = "coord"
_LATEST = "worktree_census_latest"
_HISTORY = "worktree_census_history"
_LEGACY = "worktree_census"
_TABLES = (_LATEST, _HISTORY)

# Legacy oplog columns that do NOT carry over: the surrogate key, and the
# per-row observation stamp the latest table replaces with last_observed_at.
_LEGACY_ONLY = {"id", "observed_at"}

# (name, information_schema data_type, nullable, default-substring or None)
_LATEST_CLOCKS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("first_observed_at", "timestamp with time zone", False, None),
    ("state_since", "timestamp with time zone", False, None),
    ("last_observed_at", "timestamp with time zone", False, None),
)
_HISTORY_EXTRA: tuple[tuple[str, str, bool, str | None], ...] = (
    ("id", "bigint", False, "nextval("),
    ("started_at", "timestamp with time zone", False, None),
    ("ended_at", "timestamp with time zone", True, None),
)

_COMMENTED = {
    _LATEST: ("last_observed_at", "first_observed_at", "state_since"),
    _HISTORY: ("started_at", "ended_at"),
}

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


def _executed_sql(fn: ast.FunctionDef) -> list[str]:
    """The SQL of each top-level ``op.execute(...)`` statement, in body order."""
    out: list[str] = []
    for stmt in fn.body:
        if (
            isinstance(stmt, ast.Expr)
            and isinstance(stmt.value, ast.Call)
            and isinstance(stmt.value.func, ast.Attribute)
            and stmt.value.func.attr == "execute"
            and stmt.value.args
            and isinstance(stmt.value.args[0], ast.Constant)
        ):
            out.append(" ".join(str(stmt.value.args[0].value).split()))
    return out


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
    source = _revision_source()
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_PARENT_REVISION_ID)}$", source, re.M)


# ---------------------------------------------------------------------------
# 2. coord-qualified, and the only DROP is in downgrade()
# ---------------------------------------------------------------------------


def test_every_ddl_object_is_coord_qualified() -> None:
    tree = _tree()
    allowed = tuple(f"{_SCHEMA}.{t}" for t in _TABLES)
    for fn_name in ("upgrade", "downgrade"):
        for sql in _sql_literals(_function(tree, fn_name)):
            for obj in re.findall(
                r"(?:CREATE\s+TABLE|DROP\s+TABLE|ALTER\s+TABLE|COMMENT\s+ON\s+TABLE"
                r"|COMMENT\s+ON\s+COLUMN|INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+\w+\s+ON)"
                r"(?:\s+IF\s+(?:NOT\s+)?EXISTS)?\s+([A-Za-z_.\"]+)",
                sql,
                re.I,
            ):
                assert obj.startswith(allowed), (
                    f"{fn_name}(): object {obj!r} is not one of {allowed}"
                )


def test_every_drop_is_inside_downgrade() -> None:
    tree = _tree()
    up = "\n".join(_sql_literals(_function(tree, "upgrade")))
    assert not re.search(r"\bDROP\b", up, re.I), "upgrade() must not DROP anything"
    down = "\n".join(_sql_literals(_function(tree, "downgrade")))
    for table in _TABLES:
        assert re.search(
            rf"DROP\s+TABLE\s+IF\s+EXISTS\s+{_SCHEMA}\.{table}\b", down, re.I
        ), f"downgrade() does not drop coord.{table}"


def test_the_drop_guard_reads_the_upgrade_path_as_dropping_nothing() -> None:
    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops, [(d.table, d.column) for d in scan.drops]
    assert not scan.unresolved, scan.unresolved
    assert not scan.violations, scan.violations


# ---------------------------------------------------------------------------
# 3. static SQL through op.execute only, and lock_timeout bounded + restored
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


@pytest.mark.parametrize("fn_name", ["upgrade", "downgrade"])
def test_lock_timeout_is_bounded_first_and_restored_last(fn_name: str) -> None:
    executed = _executed_sql(_function(_tree(), fn_name))
    assert executed, f"{fn_name}() executes nothing"
    assert executed[0] == "SET LOCAL lock_timeout = '3s'", (
        f"{fn_name}() must bound its lock wait before any DDL, got {executed[0]!r}"
    )
    assert executed[-1] == "SET LOCAL lock_timeout = DEFAULT", (
        f"{fn_name}() must restore lock_timeout as its LAST statement, "
        f"got {executed[-1]!r}"
    )
    sets = [s for s in executed if s.startswith("SET LOCAL lock_timeout")]
    assert sets == [executed[0], executed[-1]], (
        f"{fn_name}() sets lock_timeout more than once: {sets}"
    )


def test_upgrade_ddl_is_idempotent_by_construction() -> None:
    up = "\n".join(_sql_literals(_function(_tree(), "upgrade")))
    for table in _TABLES:
        assert re.search(
            rf"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+{_SCHEMA}\.{table}\b", up
        ), f"coord.{table} is not created IF NOT EXISTS"
    for create in re.findall(r"CREATE\s+(?:UNIQUE\s+)?INDEX\s+\S+", up):
        assert create.endswith("IF"), f"{create!r} is not IF NOT EXISTS"
    assert not re.search(r"CONCURRENTLY", up, re.I), (
        "the tables are new and empty; CONCURRENTLY would need an autocommit block"
    )
    assert not re.search(r"CREATE\s+TRIGGER", up, re.I), "house convention: no triggers"


# ---------------------------------------------------------------------------
# live database
# ---------------------------------------------------------------------------


_DEVICE = uuid.UUID("00000000-0000-4000-8000-0000000000d1")
_T0 = datetime(2026, 9, 25, 9, 0, tzinfo=UTC)


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


def _indexes(engine: Engine, table: str) -> dict[str, str]:
    """``{index name: pg_get_indexdef}`` for every index on ``coord.<table>``."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT i.relname, pg_get_indexdef(ix.indexrelid)
                  FROM pg_index ix
                  JOIN pg_class i ON i.oid = ix.indexrelid
                 WHERE ix.indrelid = to_regclass(:qualified)
                """
            ),
            {"qualified": f"{_SCHEMA}.{table}"},
        ).all()
    return {r[0]: r[1] for r in rows}


def _assert_census_columns_match_legacy(
    got: dict[str, tuple[str, bool, str | None]],
    legacy: dict[str, tuple[str, bool, str | None]],
    extra: tuple[tuple[str, str, bool, str | None], ...],
    table: str,
) -> None:
    census = {k: v for k, v in legacy.items() if k not in _LEGACY_ONLY}
    assert census, "the legacy coord.worktree_census has no columns at the parent"
    expected = set(census) | {c[0] for c in extra}
    assert set(got) == expected, (
        f"coord.{table}: missing {sorted(expected - set(got))}, "
        f"unexpected {sorted(set(got) - expected)}"
    )
    for name, shape in census.items():
        assert got[name] == shape, (
            f"coord.{table}.{name} is {got[name]}, the legacy column is {shape}"
        )
    for name, data_type, nullable, default in extra:
        got_type, got_nullable, got_default = got[name]
        assert got_type == data_type, f"{table}.{name}: {got_type} != {data_type}"
        assert got_nullable is nullable, f"{table}.{name}: nullable {got_nullable}"
        if default is None:
            assert got_default is None, f"{table}.{name}: default {got_default!r}"
        else:
            assert got_default is not None and default in got_default, (
                f"{table}.{name}: default {got_default!r} lacks {default!r}"
            )


def _insert_history(
    engine: Engine,
    *,
    path: str,
    started_at: datetime,
    ended_at: datetime | None,
    device_id: uuid.UUID = _DEVICE,
) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                f"""
                INSERT INTO coord.{_HISTORY}
                    (device_id, repo, path, started_at, ended_at)
                VALUES (:d, 'qontinui-coord', :p, :s, :e)
                """
            ),
            {"d": device_id, "p": path, "s": started_at, "e": ended_at},
        )


@_needs_pg
def test_column_sets_mirror_the_legacy_census() -> None:
    with ephemeral_database(admin_database_url(), "wtcs01_cols") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        legacy = _columns(engine, _LEGACY)
        _assert_census_columns_match_legacy(
            _columns(engine, _LATEST), legacy, _LATEST_CLOCKS, _LATEST
        )
        _assert_census_columns_match_legacy(
            _columns(engine, _HISTORY), legacy, _HISTORY_EXTRA, _HISTORY
        )


@_needs_pg
def test_latest_has_only_its_primary_key_and_fillfactor_70() -> None:
    with ephemeral_database(admin_database_url(), "wtcs01_hot") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        indexes = _indexes(engine, _LATEST)
        # ONE index. Any other index (above all one on last_observed_at) turns
        # every per-walk update into an index write and ends HOT updates.
        assert list(indexes) == [f"{_LATEST}_pkey"], indexes
        assert indexes[f"{_LATEST}_pkey"].endswith(
            "USING btree (device_id, repo, path)"
        ), indexes

        reloptions = scalar(
            engine,
            "SELECT reloptions FROM pg_class WHERE oid = to_regclass(:q)",
            q=f"{_SCHEMA}.{_LATEST}",
        )
        assert reloptions == ["fillfactor=70"], reloptions

        # The key is (device_id, repo, path): the same path on another device is
        # another row, and the same key twice is refused.
        with engine.begin() as conn:
            for device in (_DEVICE, uuid.uuid4()):
                conn.execute(
                    text(
                        f"""
                        INSERT INTO coord.{_LATEST}
                            (device_id, repo, path, first_observed_at,
                             state_since, last_observed_at)
                        VALUES (:d, 'qontinui-coord', '/wt/a', :t, :t, :t)
                        """
                    ),
                    {"d": device, "t": _T0},
                )
        with pytest.raises(sqlalchemy.exc.IntegrityError) as excinfo:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        f"""
                        INSERT INTO coord.{_LATEST}
                            (device_id, repo, path, first_observed_at,
                             state_since, last_observed_at)
                        VALUES (:d, 'qontinui-coord', '/wt/a', :t, :t, :t)
                        """
                    ),
                    {"d": _DEVICE, "t": _T0},
                )
        assert excinfo.value.orig.diag.constraint_name == f"{_LATEST}_pkey"  # type: ignore[union-attr]


@_needs_pg
def test_history_indexes_and_the_one_open_interval_rule() -> None:
    with ephemeral_database(admin_database_url(), "wtcs01_hist") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        indexes = _indexes(engine, _HISTORY)
        assert set(indexes) == {
            f"{_HISTORY}_pkey",
            "uq_worktree_census_history_open_key",
            "idx_worktree_census_history_key_started_at",
            "idx_worktree_census_history_ended_at",
        }, indexes
        assert indexes[f"{_HISTORY}_pkey"].endswith("USING btree (id)")
        assert indexes["uq_worktree_census_history_open_key"].endswith(
            "USING btree (device_id, repo, path) WHERE (ended_at IS NULL)"
        ), indexes
        assert indexes["uq_worktree_census_history_open_key"].startswith(
            "CREATE UNIQUE INDEX"
        )
        assert indexes["idx_worktree_census_history_key_started_at"].endswith(
            "USING btree (device_id, repo, path, started_at DESC)"
        ), indexes
        assert indexes["idx_worktree_census_history_ended_at"].endswith(
            "USING btree (ended_at) WHERE (ended_at IS NOT NULL)"
        ), indexes

        # Any number of CLOSED intervals per key, plus one open one.
        _insert_history(
            engine, path="/wt/a", started_at=_T0, ended_at=_T0 + timedelta(hours=1)
        )
        _insert_history(
            engine,
            path="/wt/a",
            started_at=_T0 + timedelta(hours=2),
            ended_at=_T0 + timedelta(hours=3),
        )
        _insert_history(
            engine, path="/wt/a", started_at=_T0 + timedelta(hours=4), ended_at=None
        )
        # Another key, and the same path on another device, each get their own.
        _insert_history(engine, path="/wt/b", started_at=_T0, ended_at=None)
        _insert_history(
            engine, path="/wt/a", started_at=_T0, ended_at=None, device_id=uuid.uuid4()
        )

        # A second OPEN interval for (device, repo, path) is refused: the
        # writer must close the old interval before it opens a new one.
        with pytest.raises(sqlalchemy.exc.IntegrityError) as excinfo:
            _insert_history(
                engine, path="/wt/a", started_at=_T0 + timedelta(hours=5), ended_at=None
            )
        orig = excinfo.value.orig
        assert getattr(orig, "pgcode", None) == "23505", (
            f"not a unique violation: {orig!r}"
        )
        assert orig.diag.constraint_name == "uq_worktree_census_history_open_key"  # type: ignore[union-attr]

        count = scalar(engine, f"SELECT count(*) FROM coord.{_HISTORY}")
        assert count == 5


@_needs_pg
def test_comments_land_as_the_source_writes_them() -> None:
    source = _revision_source()
    with ephemeral_database(admin_database_url(), "wtcs01_cmt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        for table, columns in _COMMENTED.items():
            table_comment = scalar(
                engine, f"SELECT obj_description('{_SCHEMA}.{table}'::regclass)"
            )
            assert table_comment == comment_body_from_source(
                source, f"{_SCHEMA}.{table}", object_kind="TABLE"
            ), f"table comment on coord.{table} differs from the revision source"
            for column in columns:
                assert column_comment(
                    engine, table, column
                ) == comment_body_from_source(source, f"{_SCHEMA}.{table}.{column}"), (
                    f"comment on {table}.{column} differs from the revision source"
                )


@_needs_pg
def test_upgrade_is_idempotent() -> None:
    with ephemeral_database(admin_database_url(), "wtcs01_idem") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _insert_history(engine, path="/wt/a", started_at=_T0, ended_at=None)

        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        for table in _TABLES:
            assert table_exists(engine, _SCHEMA, table)
        count = scalar(engine, f"SELECT count(*) FROM coord.{_HISTORY}")
        assert count == 1, "the re-run must not disturb existing rows"


@_needs_pg
def test_up_down_up_leaves_no_residue() -> None:
    with ephemeral_database(admin_database_url(), "wtcs01_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _insert_history(engine, path="/wt/a", started_at=_T0, ended_at=None)

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        for table in _TABLES:
            assert not table_exists(engine, _SCHEMA, table)
        seq = scalar(
            engine,
            "SELECT to_regclass(:q) IS NULL",
            q=f"{_SCHEMA}.{_HISTORY}_id_seq",
        )
        assert seq is True, "the history id sequence survived the downgrade"
        # The downgrade leaves the legacy oplog alone.
        assert table_exists(engine, _SCHEMA, _LEGACY)

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        for table in _TABLES:
            assert table_exists(engine, _SCHEMA, table)
        count = scalar(engine, f"SELECT count(*) FROM coord.{_HISTORY}")
        assert count == 0, "the table comes back empty, not restored"
