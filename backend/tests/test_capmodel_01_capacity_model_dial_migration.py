"""Schema test for the ``capmodel_01`` revision (capacity-model dial + bounds).

Source-level guards never skip. The live walk uses ``_alembic_harness`` and
skips without a reachable test Postgres; a skip proves nothing. Point it at a
live instance with ``QONTINUI_TEST_PG=host:port`` or a full
``QONTINUI_TEST_PG_DSN`` (``conftest.py`` derives ``DATABASE_URL`` from them at
import time, so setting ``DATABASE_URL`` itself has no effect under pytest).
"""

from __future__ import annotations

import ast
import uuid
from pathlib import Path
from types import ModuleType

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_comment,
    column_info,
    ephemeral_database,
    load_revision_module,
    run_alembic,
)

_REVISION_ID = "capmodel_01"
# MUST equal the revision's own down_revision (first test enforces it).
_PARENT_REVISION_ID = "pr_events_mergeability_head_idx_01"
_REVISION_FILENAME = "capmodel_01_capacity_model_dial_and_operator_bounds.py"

_TABLES = ("fleet_runtime_policy", "fleet_runtime_policy_versions")

# (column, information_schema.data_type). A TEXT[] reads back as ARRAY.
_EXPECTED = (
    ("capacity_model_mode", "text"),
    ("capacity_model_off_consumers", "ARRAY"),
    ("min_session_target", "integer"),
    ("max_session_target", "integer"),
    ("offload_enabled", "boolean"),
)

_MODE_CHECK = "CHECK (capacity_model_mode IN ('off', 'enforce'))"
# SQLSTATE check_violation. The violated constraint is named the way Postgres
# names an unnamed column CHECK: <table>_<column>_check.
_CHECK_VIOLATION = "23514"


def _path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _module() -> ModuleType:
    return load_revision_module(_path(), f"_rev_{_REVISION_ID}")


def _recorded(monkeypatch: pytest.MonkeyPatch, step: str) -> list[str]:
    module = _module()
    out: list[str] = []

    class _Op:
        @staticmethod
        def execute(sql: object) -> None:
            out.append(str(sql))

    monkeypatch.setattr(module, "op", _Op)
    getattr(module, step)()
    return out


def test_pinned_parent_matches_down_revision() -> None:
    module = _module()
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID


def test_column_list_is_the_interface() -> None:
    # The paired Phase 3 coord PR's `fleet_policy::CAPACITY_CONTROL_COLS`
    # names exactly these, in this order; a rename here is a rename there.
    module = _module()
    assert tuple(module._COLUMNS) == (
        ("capacity_model_mode", "TEXT"),
        ("capacity_model_off_consumers", "TEXT[]"),
        ("min_session_target", "INTEGER"),
        ("max_session_target", "INTEGER"),
        ("offload_enabled", "BOOLEAN"),
    )
    assert tuple(module._POLICY_TABLES) == (
        "coord.fleet_runtime_policy",
        "coord.fleet_runtime_policy_versions",
    )


def test_upgrade_adds_every_column_to_both_tables_and_downgrade_drops_them(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    up = _recorded(monkeypatch, "upgrade")
    down = _recorded(monkeypatch, "downgrade")
    module = _module()
    for table in module._POLICY_TABLES:
        # One ALTER per table carries the whole set, so neither table can be
        # widened by a subset (the versions-table rule).
        (alter,) = [s for s in up if f"ALTER TABLE {table}\n" in s]
        (drop,) = [s for s in down if f"ALTER TABLE {table}\n" in s]
        # The mode CHECK sits on THIS table's ALTER, not merely somewhere.
        assert alter.count(_MODE_CHECK) == 1, table
        for column, ddl in module._COLUMNS:
            assert f"ADD COLUMN IF NOT EXISTS {column} {ddl} NULL" in alter
            assert f"DROP COLUMN IF EXISTS {column}" in drop
            assert f"COMMENT ON COLUMN {table}.{column} IS" in " ".join(
                " ".join(s.split()) for s in up
            ), f"{table}.{column} has no COMMENT"
    joined_up = "\n".join(up)
    joined_down = "\n".join(down)
    width = 2 * len(module._COLUMNS)
    # Each direction names exactly the five columns per table: no stray
    # column is added that the downgrade would leave behind, and nothing is
    # dropped that this revision did not add.
    assert joined_up.count("ADD COLUMN") == width
    assert joined_up.count("ADD COLUMN IF NOT EXISTS") == width
    assert joined_down.count("DROP COLUMN") == width
    assert joined_down.count("DROP COLUMN IF EXISTS") == width
    # The mode is the one fixed vocabulary: a CHECK on each table, and no other
    # constraint anywhere (the consumer list and the bounds are validated by
    # coord at the door).
    assert joined_up.count("CHECK (") == 2
    assert "ADD CONSTRAINT" not in joined_up
    # Existing rows keep NULL: no column carries a DEFAULT.
    assert "DEFAULT" not in joined_up


def test_every_op_execute_takes_a_static_string_literal() -> None:
    tree = ast.parse(_path().read_text(encoding="utf-8"))
    calls = [
        n
        for n in ast.walk(tree)
        if isinstance(n, ast.Call)
        and isinstance(n.func, ast.Attribute)
        and n.func.attr == "execute"
        and isinstance(n.func.value, ast.Name)
        and n.func.value.id == "op"
    ]
    assert calls
    for call in calls:
        assert len(call.args) == 1 and not call.keywords
        assert isinstance(call.args[0], ast.Constant)
        assert isinstance(call.args[0].value, str)


def _admin_url_or_skip() -> str:
    url = admin_database_url()
    if not can_connect(url):
        pytest.skip(
            f"no reachable test Postgres at {url}; set QONTINUI_TEST_PG=host:port "
            "or QONTINUI_TEST_PG_DSN (conftest.py derives DATABASE_URL from them)"
        )
    return url


def _insert_policy_row(engine: Engine, tenant_id: str) -> int:
    """A pre-existing controls row, as a live database would carry one."""
    with engine.begin() as conn:
        return int(
            conn.execute(
                text(
                    """
                    INSERT INTO coord.fleet_runtime_policy
                        (tenant_id, domain, scope_band, scope_key, level,
                         master_enabled, updated_by)
                    VALUES (CAST(:t AS uuid), 'fleet_resources', 'tenant', NULL,
                            'controls', true, 'seed@example.com')
                    RETURNING id
                    """
                ),
                {"t": tenant_id},
            ).scalar_one()
        )


def _catalog_shape(
    engine: Engine, table: str
) -> tuple[list[tuple[str, str]], list[str]]:
    """Every column (name, type) in order, and every constraint name, of a table."""
    with engine.connect() as conn:
        columns = [
            (str(name), str(data_type))
            for name, data_type in conn.execute(
                text(
                    "SELECT column_name::text, data_type::text "
                    "FROM information_schema.columns "
                    "WHERE table_schema = 'coord' AND table_name = :t "
                    "ORDER BY ordinal_position"
                ),
                {"t": table},
            ).all()
        ]
        constraints = [
            str(name)
            for name in conn.execute(
                text(
                    "SELECT c.conname::text FROM pg_constraint c "
                    "JOIN pg_class r ON r.oid = c.conrelid "
                    "JOIN pg_namespace n ON n.oid = r.relnamespace "
                    "WHERE n.nspname = 'coord' AND r.relname = :t "
                    "ORDER BY c.conname"
                ),
                {"t": table},
            ).scalars()
        ]
    return columns, constraints


def _assert_check_violation(
    exc: pytest.ExceptionInfo[IntegrityError], table: str
) -> None:
    orig = exc.value.orig
    assert getattr(orig, "pgcode", None) == _CHECK_VIOLATION, orig
    diag = getattr(orig, "diag", None)
    assert getattr(diag, "constraint_name", None) == (
        f"{table}_capacity_model_mode_check"
    ), orig


def test_live_walk_null_defaults_check_and_up_down_up() -> None:
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "capmodel01") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        before = {table: _catalog_shape(engine, table) for table in _TABLES}
        tenant_id = str(uuid.uuid4())
        policy_id = _insert_policy_row(engine, tenant_id)

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        for table in _TABLES:
            for name, pg_type in _EXPECTED:
                info = column_info(engine, table, name)
                assert info is not None, f"{table}.{name} missing"
                assert info[0] == pg_type, (table, name, info)
                assert info[1] == "YES" and info[2] is None, (table, name, info)
                assert column_comment(engine, table, name), f"{table}.{name}"
            # The mode CHECK is on each table, under Postgres's own name.
            _, constraints = _catalog_shape(engine, table)
            assert f"{table}_capacity_model_mode_check" in constraints, table

        # A row that predates the revision reads NULL for every new column:
        # the dial reads enforce, no consumer is off, no bound is set.
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT capacity_model_mode, capacity_model_off_consumers, "
                    "min_session_target, max_session_target, offload_enabled "
                    "FROM coord.fleet_runtime_policy WHERE id = :id"
                ),
                {"id": policy_id},
            ).one()
        assert tuple(row) == (None, None, None, None, None)

        # Both vocabulary values store, on the parent and in a snapshot.
        with engine.begin() as conn:
            for version, mode in ((1, "off"), (2, "enforce")):
                conn.execute(
                    text(
                        "UPDATE coord.fleet_runtime_policy SET "
                        "capacity_model_mode = :m, "
                        "capacity_model_off_consumers = "
                        "ARRAY['merge_train', 'local_builds'], "
                        "min_session_target = 1, max_session_target = 8, "
                        "offload_enabled = false WHERE id = :id"
                    ),
                    {"m": mode, "id": policy_id},
                )
                conn.execute(
                    text(
                        "INSERT INTO coord.fleet_runtime_policy_versions "
                        "(policy_id, version, level, master_enabled, change_note, "
                        "updated_by, capacity_model_mode, "
                        "capacity_model_off_consumers, min_session_target, "
                        "max_session_target, offload_enabled) "
                        "VALUES (:id, :v, 'controls', true, 'capmodel_01 test', "
                        "'seed@example.com', :m, ARRAY['merge_train'], 1, 8, true)"
                    ),
                    {"id": policy_id, "v": version, "m": mode},
                )
        with engine.connect() as conn:
            stored = conn.execute(
                text(
                    "SELECT capacity_model_off_consumers FROM "
                    "coord.fleet_runtime_policy WHERE id = :id"
                ),
                {"id": policy_id},
            ).scalar_one()
        assert stored == ["merge_train", "local_builds"]

        # Anything outside the vocabulary is refused, on both tables, by that
        # table's own CHECK.
        for bad in ("shadow", "ENFORCE", ""):
            with pytest.raises(IntegrityError) as parent_exc:
                with engine.begin() as conn:
                    conn.execute(
                        text(
                            "UPDATE coord.fleet_runtime_policy "
                            "SET capacity_model_mode = :m WHERE id = :id"
                        ),
                        {"m": bad, "id": policy_id},
                    )
            _assert_check_violation(parent_exc, "fleet_runtime_policy")
            with pytest.raises(IntegrityError) as versions_exc:
                with engine.begin() as conn:
                    conn.execute(
                        text(
                            "INSERT INTO coord.fleet_runtime_policy_versions "
                            "(policy_id, version, level, master_enabled, "
                            "change_note, updated_by, capacity_model_mode) "
                            "VALUES (:id, 99, 'controls', true, 'bad', "
                            "'seed@example.com', :m)"
                        ),
                        {"m": bad, "id": policy_id},
                    )
            _assert_check_violation(versions_exc, "fleet_runtime_policy_versions")

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        # No residue: each table is column-for-column and constraint-for-
        # constraint what it was at the parent revision.
        for table in _TABLES:
            assert _catalog_shape(engine, table) == before[table], table
        # The seeded row and its snapshots survive the walk.
        with engine.connect() as conn:
            versions = conn.execute(
                text(
                    "SELECT count(*) FROM coord.fleet_runtime_policy_versions "
                    "WHERE policy_id = :id"
                ),
                {"id": policy_id},
            ).scalar_one()
        assert versions == 2

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        for table in _TABLES:
            for name, _ in _EXPECTED:
                assert column_info(engine, table, name) is not None, (table, name)
