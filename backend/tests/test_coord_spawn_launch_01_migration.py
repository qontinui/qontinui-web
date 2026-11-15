"""Pins for alembic revision ``coord_spawn_launch_01_settings_and_session_effort``.

Plan ``2026-11-15-operator-sets-spawn-model-and-effort-per-spawn-type`` Phase 1
(D2 as corrected by V2): ``coord.spawn_launch_settings`` plus nullable
``model`` / ``effort`` on ``coord.agent_sessions``. What is pinned:

1. the chain is wired (``down_revision`` names a parent defined in exactly one
   file);
2. the CHECK vocabularies are exactly the plan contract's model families and
   effort levels, and ``spawn_type`` carries no CHECK (the vocabulary is the
   schemas contract's, validated at coord's write door);
3. both directions bound the DDL's lock wait and restore the default, because
   env.py runs the batch in one transaction;
4. every SQL string is one static literal (offline ``--sql`` mode renders it),
   and neither direction reaches past ``op.execute``;
5. live: the table and columns have the contract's shape, every CHECK (the
   two on the settings table and the one on ``agent_sessions.effort``) refuses
   an out-of-vocabulary write and accepts NULL, the settings table carries no
   foreign key, ``agent_sessions.model`` takes any raw id, the session columns carry no
   default and the comments the source authors, and up/down/up leaves no
   residue.

Structural tests always run; the live ones self-skip without a test Postgres
(``QONTINUI_TEST_PG=host:port``) and REPORT the skip.
"""

from __future__ import annotations

import ast
import re
import uuid
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_comment,
    column_info,
    comment_body_from_source,
    ephemeral_database,
    load_revision_module,
    run_alembic,
    table_exists,
)

_REVISION_ID = "coord_spawn_launch_01_settings_and_session_effort"
_REVISION_FILENAME = f"{_REVISION_ID}.py"
# The single head of origin/main when this revision was authored. If coord's
# land-time re-point moves down_revision, update this literal with it.
_PARENT_REVISION_ID = "cfo_01_continuation_deferred_device"

_SCHEMA = "coord"
_SETTINGS = "spawn_launch_settings"
_SESSIONS = "agent_sessions"

# The plan's shared contract -- every phase must match these exactly.
_MODEL_FAMILIES = ("fable", "opus", "sonnet", "haiku")
_EFFORT_LEVELS = ("low", "medium", "high", "xhigh", "max")

# (column, information_schema data_type, is_nullable, has_default)
_SETTINGS_COLUMNS = (
    ("tenant_id", "uuid", "NO", False),
    ("spawn_type", "text", "NO", False),
    ("model_family", "text", "YES", False),
    ("effort", "text", "YES", False),
    ("updated_by", "text", "YES", False),
    ("updated_at", "timestamp with time zone", "NO", True),
)
_SESSION_COLUMNS = ("model", "effort")

_PLAN_STEM = "2026-11-15-operator-sets-spawn-model-and-effort-per-spawn-type"

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


def _in_list(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{v}'" for v in values)


# ---------------------------------------------------------------------------
# structural (always run)
# ---------------------------------------------------------------------------


def test_revision_ids_are_wired_and_the_parent_is_defined_exactly_once() -> None:
    module = load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID
    pattern = re.compile(
        rf'^revision(?:: str)?\s*=\s*["\']{re.escape(_PARENT_REVISION_ID)}["\']',
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
    assert f"Revises: {_PARENT_REVISION_ID}" in src


def test_check_vocabularies_are_exactly_the_plan_contract() -> None:
    """Both CHECKs on the settings table and the one on agent_sessions.effort
    spell exactly the contract's lists, in contract order. spawn_type has none.
    """
    upgrade_sql = "\n".join(_execute_literals(_function("upgrade")))
    families = _in_list(_MODEL_FAMILIES)
    levels = _in_list(_EFFORT_LEVELS)
    assert upgrade_sql.count(f"CHECK (model_family IN ({families}))") == 1
    # once on the settings table, once on agent_sessions
    assert upgrade_sql.count(f"CHECK (effort IN ({levels}))") == 2
    assert upgrade_sql.count("CHECK (") == 3, "no other CHECK (spawn_type has none)"
    assert "spawn_type IN" not in upgrade_sql


def test_neither_direction_reaches_past_op_execute() -> None:
    for name in ("upgrade", "downgrade"):
        assert _op_attrs_used(_function(name)) == {"execute"}, name


def test_both_directions_bound_the_lock_wait_and_restore_it() -> None:
    for name in ("upgrade", "downgrade"):
        literals = _execute_literals(_function(name))
        assert literals[0] == _LOCK_TIMEOUT_SET, (name, literals[0])
        assert literals[-1] == _LOCK_TIMEOUT_RESTORE, (name, literals[-1])
        assert literals.count(_LOCK_TIMEOUT_SET) == 1, (name, literals)
        assert literals.count(_LOCK_TIMEOUT_RESTORE) == 1, (name, literals)


def test_session_columns_are_added_nullable_with_no_default() -> None:
    """A default would forge a reading the hook never made onto every session."""
    literals = _execute_literals(_function("upgrade"))
    adds = [s for s in literals if "ADD COLUMN" in s]
    assert len(adds) == 1, adds
    assert re.fullmatch(
        rf"\s*ALTER TABLE {_SCHEMA}\.{_SESSIONS}\s+"
        r"ADD COLUMN IF NOT EXISTS model TEXT,\s*"
        r"ADD COLUMN IF NOT EXISTS effort TEXT\s*",
        adds[0],
    ), adds[0]


def test_comments_name_the_writer_the_reader_and_the_unknown_arm() -> None:
    src = _revision_source()
    for col in _SESSION_COLUMNS:
        body = comment_body_from_source(src, f"{_SCHEMA}.{_SESSIONS}.{col}")
        assert "session-context-report.sh" in body, col
        assert "coord session-context route" in body, col
        assert "originating_session" in body, col
        assert _PLAN_STEM in body, col
        assert "NULL = the hook never reported; read as UNKNOWN" in body, col
        assert "'" not in body, col
    table_body = comment_body_from_source(
        src, f"{_SCHEMA}.{_SETTINGS}", object_kind="TABLE"
    )
    assert "dispatch_settable" in table_body
    assert _PLAN_STEM in table_body
    assert "'" not in table_body


# ---------------------------------------------------------------------------
# live (self-skip without a test Postgres)
# ---------------------------------------------------------------------------


@_needs_pg
def test_shape_after_upgrade() -> None:
    with ephemeral_database(admin_database_url(), "spawnl01_shape") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _SETTINGS)
        for col, data_type, nullable, has_default in _SETTINGS_COLUMNS:
            info = column_info(engine, _SETTINGS, col)
            assert info is not None, col
            assert info[:2] == (data_type, nullable), (col, info)
            assert (info[2] is not None) == has_default, (col, info)
        with engine.connect() as conn:
            pk = conn.execute(
                text(
                    """
                    SELECT array_agg(a.attname ORDER BY k.ord)
                      FROM pg_constraint c
                      CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
                      JOIN pg_attribute a
                        ON a.attrelid = c.conrelid AND a.attnum = k.attnum
                     WHERE c.conrelid = 'coord.spawn_launch_settings'::regclass
                       AND c.contype = 'p'
                    """
                )
            ).scalar_one()
        assert list(pk) == ["tenant_id", "spawn_type"]
        for col in _SESSION_COLUMNS:
            assert column_info(engine, _SESSIONS, col) == ("text", "YES", None), col
            assert column_comment(engine, _SESSIONS, col) == comment_body_from_source(
                _revision_source(), f"{_SCHEMA}.{_SESSIONS}.{col}"
            ), col


@_needs_pg
def test_checks_refuse_out_of_vocabulary_values_and_accept_null() -> None:
    with ephemeral_database(admin_database_url(), "spawnl01_chk") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        # No FK to coord.tenants (agent_registry precedent), so any uuid serves.
        tenant = uuid.uuid4()
        insert = text(
            "INSERT INTO coord.spawn_launch_settings "
            "(tenant_id, spawn_type, model_family, effort) "
            "VALUES (:t, :s, :m, :e)"
        )
        # Every contract value, and NULL in both, is accepted.
        with engine.begin() as conn:
            for i, fam in enumerate(_MODEL_FAMILIES):
                conn.execute(
                    insert, {"t": tenant, "s": f"fam_{i}", "m": fam, "e": None}
                )
            for i, lvl in enumerate(_EFFORT_LEVELS):
                conn.execute(
                    insert, {"t": tenant, "s": f"lvl_{i}", "m": None, "e": lvl}
                )
            conn.execute(insert, {"t": tenant, "s": "cleared", "m": None, "e": None})
        for bad in (
            {"m": "claude-opus-4-5", "e": None},
            {"m": "Opus", "e": None},
            {"m": None, "e": "ultra"},
            {"m": None, "e": "HIGH"},
        ):
            with pytest.raises(IntegrityError), engine.begin() as conn:
                conn.execute(insert, {"t": tenant, "s": "bad", **bad})
        # Primary key: one row per (tenant, spawn_type).
        with pytest.raises(IntegrityError), engine.begin() as conn:
            conn.execute(insert, {"t": tenant, "s": "cleared", "m": "opus", "e": None})
        # No FK: the settings table references nothing.
        with engine.connect() as conn:
            fks = conn.execute(
                text(
                    "SELECT count(*) FROM pg_constraint "
                    "WHERE conrelid = 'coord.spawn_launch_settings'::regclass "
                    "AND contype = 'f'"
                )
            ).scalar_one()
        assert fks == 0


@_needs_pg
def test_session_effort_check_is_enforced_on_write_and_model_is_free() -> None:
    """agent_sessions.effort refuses a non-level and accepts every level and
    NULL; agent_sessions.model takes any raw model id (no CHECK)."""
    with ephemeral_database(admin_database_url(), "spawnl01_sess") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        sid = uuid.uuid4()
        with engine.begin() as conn:
            conn.execute(
                text("INSERT INTO coord.agent_sessions (id) VALUES (:id)"), {"id": sid}
            )
        set_effort = text("UPDATE coord.agent_sessions SET effort = :e WHERE id = :id")
        for bad in ("ultra", "HIGH", ""):
            with pytest.raises(IntegrityError), engine.begin() as conn:
                conn.execute(set_effort, {"e": bad, "id": sid})
        for ok in (*_EFFORT_LEVELS, None):
            with engine.begin() as conn:
                conn.execute(set_effort, {"e": ok, "id": sid})
        with engine.begin() as conn:
            conn.execute(
                text("UPDATE coord.agent_sessions SET model = :m WHERE id = :id"),
                {"m": "claude-opus-4-5-20251101", "id": sid},
            )
            row = conn.execute(
                text("SELECT model, effort FROM coord.agent_sessions WHERE id = :id"),
                {"id": sid},
            ).one()
        assert tuple(row) == ("claude-opus-4-5-20251101", None)


@_needs_pg
def test_up_down_up_leaves_no_residue() -> None:
    with ephemeral_database(admin_database_url(), "spawnl01_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, _SCHEMA, _SETTINGS)
        for col in _SESSION_COLUMNS:
            assert column_info(engine, _SESSIONS, col) is None, col
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _SETTINGS)
        for col in _SESSION_COLUMNS:
            assert column_info(engine, _SESSIONS, col) is not None, col
        # Idempotence exercised for real: re-run the module's upgrade DDL.
        for sql in _execute_literals(_function("upgrade")):
            with engine.begin() as conn:
                conn.execute(text(sql))
        with engine.connect() as conn:
            n = conn.execute(
                text(
                    "SELECT count(*) FROM pg_constraint "
                    "WHERE conrelid = 'coord.agent_sessions'::regclass "
                    "AND conname = 'agent_sessions_effort_chk'"
                )
            ).scalar_one()
        assert n == 1
