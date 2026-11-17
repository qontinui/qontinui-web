"""Pins for alembic revision ``coord_agent_sessions_identity_01``.

Plan ``2026-10-19-session-lookup-by-name-shows-claude-account-in-web`` Phase 1
(qontinui-web half): five nullable columns on ``coord.agent_sessions`` --
``account``, ``config_dir``, ``account_observed_at``, ``registry_name`` and
``tag_name`` -- written by coord's session-identity stamp door and read by
coord's agent-sessions list and card. What is pinned:

1. the chain is wired: ``down_revision`` names a parent defined in exactly one
   file, and the docstring's ``Revises:`` line agrees with it (a land-time
   re-point that moves one but not the other fails here);
2. ``upgrade()`` adds exactly those five columns (no default, no backfill)
   plus one comment per column, idempotently; ``downgrade()`` drops exactly
   those columns in reverse order. ``NULL`` is the UNKNOWN arm the console
   renders ("not yet reported"), so a default would forge an account onto
   every session -- the literal-shape assertions refuse one;
3. no index and no backfill: only ``op.execute`` is called (the plan resolves
   name search onto the existing ``search_text`` full-text index);
4. both directions bound the DDL's lock wait and restore the default
   (belt-and-braces: env.py's ``_reset_revision_settings`` already RESETs
   lock_timeout after each applied step);
5. every SQL string is one static literal with no ``:word`` bind-parameter
   sequence (``op.execute`` wraps a string in SQLAlchemy ``text()``, which
   would read ``:device_id`` inside a comment as a parameter and fail the
   upgrade);
6. live: each column exists, is NULLABLE, has no default and carries the
   comment the source authors; the table gains exactly these five columns and
   no index; a row inserted without them reads five NULLs; and
   up/down/up leaves no residue.

Structural tests always run; the live one self-skips without a test Postgres
(``QONTINUI_TEST_PG=host:port``) and REPORTS the skip.
"""

from __future__ import annotations

import ast
import re
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_comment,
    column_info,
    comment_body_from_source,
    declared_parent_revision_id,
    ephemeral_database,
    load_revision_module,
    run_alembic,
)

_REVISION_ID = "coord_agent_sessions_identity_01"
_REVISION_FILENAME = f"{_REVISION_ID}.py"

_SCHEMA = "coord"
_TABLE = "agent_sessions"
# (column, SQL type in the DDL, information_schema data_type) -- in DDL order.
_COLUMNS = (
    ("account", "TEXT", "text"),
    ("config_dir", "TEXT", "text"),
    ("account_observed_at", "TIMESTAMPTZ", "timestamp with time zone"),
    ("registry_name", "TEXT", "text"),
    ("tag_name", "TEXT", "text"),
)
_COLUMN_NAMES = frozenset(col for col, _, _ in _COLUMNS)
_PLAN_STEM = "2026-10-19-session-lookup-by-name-shows-claude-account-in-web"

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "test Postgres unreachable via DATABASE_URL (under pytest, conftest.py "
        "derives DATABASE_URL from QONTINUI_TEST_PG=host:port, so set that)"
    ),
)


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _parent_revision_id() -> str:
    """Parse this revision's own ``down_revision`` at runtime.

    Never hardcode the parent: coord re-points ``down_revision`` at land when a
    peer revision lands first, and a pinned constant would then walk back to a
    revision that is no longer this one's parent.
    """
    return declared_parent_revision_id(_revision_source(), _REVISION_FILENAME)


def _function(name: str) -> ast.FunctionDef:
    tree = ast.parse(_revision_source(), filename=str(_revision_path()))
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError(f"{_REVISION_FILENAME} has no top-level def {name}()")


_LOCK_TIMEOUT_SET = "SET LOCAL lock_timeout = '3s'"
_LOCK_TIMEOUT_RESTORE = "SET LOCAL lock_timeout = DEFAULT"


def _execute_literals(fn: ast.FunctionDef) -> list[str]:
    """The SQL of every ``op.execute`` call in ``fn``; each must be one literal."""
    literals: list[str] = []
    for node in ast.walk(fn):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "execute"
        ):
            assert len(node.args) == 1 and isinstance(node.args[0], ast.Constant), (
                f"op.execute at line {node.lineno} must take one static SQL literal"
            )
            assert isinstance(node.args[0].value, str)
            literals.append(node.args[0].value)
    return literals


def _op_attrs_used(fn: ast.FunctionDef) -> set[str]:
    """Every ``op.<attr>(...)`` called directly in ``fn``'s own body."""
    return {
        node.func.attr
        for node in ast.walk(fn)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "op"
    }


def _ddl_literals(fn: ast.FunctionDef) -> list[str]:
    """``_execute_literals`` minus the lock-wait bracket."""
    return [
        sql
        for sql in _execute_literals(fn)
        if sql not in (_LOCK_TIMEOUT_SET, _LOCK_TIMEOUT_RESTORE)
    ]


# ---------------------------------------------------------------------------
# structural (always run)
# ---------------------------------------------------------------------------


def test_revision_ids_are_wired_and_the_parent_is_defined_exactly_once() -> None:
    parent = _parent_revision_id()
    module = load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")
    assert module.revision == _REVISION_ID
    assert module.down_revision == parent
    pattern = re.compile(
        rf'^revision(?:: str)?\s*=\s*["\']{re.escape(parent)}["\']',
        re.M,
    )
    versions_dir = backend_root() / "alembic" / "versions"
    parent_definitions = [
        f
        for f in versions_dir.glob("*.py")
        if f.name != _REVISION_FILENAME
        and pattern.search(f.read_text(encoding="utf-8"))
    ]
    assert len(parent_definitions) == 1, [f.name for f in parent_definitions]
    assert module.branch_labels is None
    assert module.depends_on is None
    src = _revision_source()
    assert f"Revision ID: {_REVISION_ID}" in src
    assert f"Revises: {parent}" in src, (
        "the docstring's Revises: line disagrees with down_revision -- a "
        "re-point must move both"
    )


def test_upgrade_adds_exactly_the_columns_and_their_comments() -> None:
    literals = _ddl_literals(_function("upgrade"))
    assert len(literals) == 1 + len(_COLUMNS), literals
    add, *comments = literals
    adds = r",\s*".join(
        rf"ADD COLUMN IF NOT EXISTS {col} {sql_type}" for col, sql_type, _ in _COLUMNS
    )
    assert re.fullmatch(rf"\s*ALTER TABLE {_SCHEMA}\.{_TABLE}\s+{adds}\s*", add), add
    for comment, (col, _, _) in zip(comments, _COLUMNS, strict=True):
        assert re.match(
            rf"\s*COMMENT ON COLUMN {_SCHEMA}\.{_TABLE}\.{col} IS\s", comment
        ), comment


def test_downgrade_drops_exactly_the_columns_in_reverse_order() -> None:
    literals = _ddl_literals(_function("downgrade"))
    assert len(literals) == 1, literals
    drops = r",\s*".join(
        rf"DROP COLUMN IF EXISTS {col}" for col, _, _ in reversed(_COLUMNS)
    )
    assert re.fullmatch(
        rf"\s*ALTER TABLE {_SCHEMA}\.{_TABLE}\s+{drops}\s*", literals[0]
    ), literals[0]


def test_neither_direction_reaches_past_op_execute() -> None:
    """No ``op.add_column`` / ``op.create_index`` / ``op.bulk_insert``.

    The plan resolves name search onto the existing ``search_text`` full-text
    index and session-id search onto the primary key, so an index here would
    be pure write amplification on a table coord writes every heartbeat; a
    backfill would forge an account no runner reported.
    """
    for name in ("upgrade", "downgrade"):
        assert _op_attrs_used(_function(name)) == {"execute"}, name


def test_both_directions_bound_the_lock_wait_and_restore_it() -> None:
    """``SET LOCAL lock_timeout`` first, ``DEFAULT`` last, in both directions.

    coord writes ``coord.agent_sessions`` on every session heartbeat, so an
    unbounded ACCESS EXCLUSIVE wait queues in front of it. The restore is
    belt-and-braces: env.py's ``_reset_revision_settings`` already RESETs
    lock_timeout after each applied step.
    """
    for name in ("upgrade", "downgrade"):
        literals = _execute_literals(_function(name))
        assert literals[0] == _LOCK_TIMEOUT_SET, (name, literals[0])
        assert literals[-1] == _LOCK_TIMEOUT_RESTORE, (name, literals[-1])
        assert literals.count(_LOCK_TIMEOUT_SET) == 1, (name, literals)
        assert literals.count(_LOCK_TIMEOUT_RESTORE) == 1, (name, literals)


def test_no_literal_carries_a_bind_parameter() -> None:
    """SQLAlchemy's own parser finds no ``:word`` parameter in any literal.

    ``op.execute(str)`` runs the string through ``text()``. A comment body
    naming the route as ``.../:device_id`` would compile to a bind parameter
    with no value and fail the upgrade in production, not here.
    """
    for name in ("upgrade", "downgrade"):
        for sql in _execute_literals(_function(name)):
            assert text(sql).compile().params == {}, (name, sql)


def test_comments_name_the_writer_the_reader_and_the_unknown_arm() -> None:
    src = _revision_source()
    for col, _, _ in _COLUMNS:
        body = comment_body_from_source(src, f"{_SCHEMA}.{_TABLE}.{col}")
        assert "POST /coord/session-identity/<device_id>" in body, col
        assert "session_identity_stamp.rs" in body, col
        assert "runner session-identity reporter" in body, col
        assert "/sessions console" in body, col
        assert _PLAN_STEM in body, col
        assert "NULL = no runner has reported this session; read as UNKNOWN" in (
            body
        ), col
        # No doubled apostrophe: the comment bodies stay plain literals.
        assert "'" not in body, col


# ---------------------------------------------------------------------------
# live (self-skip without a test Postgres)
# ---------------------------------------------------------------------------


def _table_columns(engine: Engine) -> set[str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name FROM information_schema.columns
                 WHERE table_schema = :schema AND table_name = :table
                """
            ),
            {"schema": _SCHEMA, "table": _TABLE},
        ).all()
    return {row[0] for row in rows}


def _table_indexes(engine: Engine) -> set[tuple[str, str]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT indexname, indexdef FROM pg_indexes
                 WHERE schemaname = :schema AND tablename = :table
                """
            ),
            {"schema": _SCHEMA, "table": _TABLE},
        ).all()
    return {(name, indexdef) for name, indexdef in rows}


def _assert_columns_present_and_nullable(engine: Engine) -> None:
    for col, _, data_type in _COLUMNS:
        info = column_info(engine, _TABLE, col)
        assert info is not None, f"coord.{_TABLE}.{col} is missing"
        assert info == (data_type, "YES", None), (
            f"coord.{_TABLE}.{col} must be a NULLABLE {data_type} with no "
            f"default (NULL is the UNKNOWN arm), got {info}"
        )


_STAMP_SELECT = text(
    """
    SELECT account, config_dir, account_observed_at, registry_name, tag_name
      FROM coord.agent_sessions WHERE id = :id
    """
)


@_needs_pg
def test_live_shape_nullability_no_index_and_up_down_up() -> None:
    root = backend_root()
    parent = _parent_revision_id()
    with ephemeral_database(admin_database_url(), "asident01") as (engine, db_url):
        # 1. Parent revision: the table exists, none of the five columns do.
        run_alembic(root, db_url, "upgrade", parent)
        baseline_columns = _table_columns(engine)
        assert "id" in baseline_columns, "coord.agent_sessions missing at parent"
        assert not (baseline_columns & _COLUMN_NAMES), baseline_columns & _COLUMN_NAMES
        baseline_indexes = _table_indexes(engine)

        # 2. Apply: exactly the five columns, each nullable with no default and
        #    the comment the source authors; no index added.
        run_alembic(root, db_url, "upgrade", _REVISION_ID)
        _assert_columns_present_and_nullable(engine)
        assert _table_columns(engine) == baseline_columns | _COLUMN_NAMES
        for col, _, _ in _COLUMNS:
            assert column_comment(engine, _TABLE, col) == comment_body_from_source(
                _revision_source(), f"{_SCHEMA}.{_TABLE}.{col}"
            ), col
        assert _table_indexes(engine) == baseline_indexes, (
            "this revision must add no index on coord.agent_sessions"
        )

        # 3. A row written without the stamp reads five NULLs (the UNKNOWN
        #    arm), and a full stamp round-trips.
        bare = uuid.uuid4()
        stamped = uuid.uuid4()
        observed = datetime(2026, 10, 19, 8, 30, tzinfo=UTC)
        with engine.begin() as conn:
            conn.execute(
                text("INSERT INTO coord.agent_sessions (id) VALUES (:id)"),
                {"id": bare},
            )
            conn.execute(
                text(
                    """
                    INSERT INTO coord.agent_sessions
                        (id, account, config_dir, account_observed_at,
                         registry_name, tag_name)
                    VALUES (:id, :account, :config_dir, :observed,
                            :registry_name, :tag_name)
                    """
                ),
                {
                    "id": stamped,
                    "account": "qontinui",
                    "config_dir": "/home/op/.claude-qontinui",
                    "observed": observed,
                    "registry_name": "spaceship-latency",
                    "tag_name": "spaceship-latency",
                },
            )
        with engine.connect() as conn:
            assert tuple(conn.execute(_STAMP_SELECT, {"id": bare}).one()) == (
                None,
                None,
                None,
                None,
                None,
            )
            assert tuple(conn.execute(_STAMP_SELECT, {"id": stamped}).one()) == (
                "qontinui",
                "/home/op/.claude-qontinui",
                observed,
                "spaceship-latency",
                "spaceship-latency",
            )

        # 4. Downgrade: the five columns are gone and nothing else moved.
        run_alembic(root, db_url, "downgrade", parent)
        for col, _, _ in _COLUMNS:
            assert column_info(engine, _TABLE, col) is None, col
        assert _table_columns(engine) == baseline_columns
        assert _table_indexes(engine) == baseline_indexes

        # 5. Re-upgrade applies cleanly, and IF NOT EXISTS is exercised for
        #    real by re-running the module's upgrade DDL on top of it.
        run_alembic(root, db_url, "upgrade", _REVISION_ID)
        _assert_columns_present_and_nullable(engine)
        for sql in _ddl_literals(_function("upgrade")):
            with engine.begin() as conn:
                conn.execute(text(sql))
        _assert_columns_present_and_nullable(engine)
        assert _table_columns(engine) == baseline_columns | _COLUMN_NAMES
