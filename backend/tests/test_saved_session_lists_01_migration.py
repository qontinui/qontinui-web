"""Behaviour test for the ``saved_session_lists_01`` revision.

Phase 2 of plan
``2026-11-08-save-per-tab-runner-session-lists-on-sessions-page-kept-14-days``.
The revision creates ``project.saved_session_lists`` and its two indexes.

Without a database (always runs):

1. **Chain wiring.** ``revision`` / ``down_revision`` match the pins below, the
   parent names exactly one real sibling, and the docstring's ``Revision ID:``
   / ``Revises:`` header agrees (a re-point is three coupled edits: the
   assignment, that header, and ``_PARENT_REVISION_ID`` here).
2. **Every op names ``schema="project"``**: the forbid-public-schema rule,
   read off the revision's own AST.

Against a real Postgres (skipped when none is reachable):

3. **Upgrade from the parent creates the declared shape**: every column's type
   and nullability, agreeing with the SQLAlchemy model the app (and the test
   suite's ``create_all``) uses; the single-column uuid key; the foreign key to
   ``auth.users`` with ``ON DELETE CASCADE``; both indexes by definition.
4. **Downgrade removes the table and its indexes, and a re-upgrade restores
   them.**

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path
from types import ModuleType

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.models.saved_session_list import SavedSessionList
from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_info,
    ephemeral_database,
    index_exists,
    load_revision_module,
    run_alembic,
    table_exists,
)

_REVISION_ID = "saved_session_lists_01"
_PARENT_REVISION_ID = "coord_ci_runs_head_sha_idx_01"
_REVISION_FILENAME = "saved_session_lists_01_table.py"

_SCHEMA = "project"
_TABLE = "saved_session_lists"

# (name, information_schema data_type, nullable)
_EXPECTED_COLUMNS: tuple[tuple[str, str, bool], ...] = (
    ("id", "uuid", False),
    ("device_id", "uuid", False),
    ("runner_instance", "text", True),
    ("runner_port", "integer", True),
    ("runner_build_id", "text", True),
    ("title", "text", True),
    ("created_by_user_id", "uuid", False),
    ("captured_at", "timestamp with time zone", False),
    ("expires_at", "timestamp with time zone", False),
    ("tab_count", "integer", False),
    ("session_count", "integer", False),
    ("layout", "jsonb", False),
)

_INDEXES: dict[str, str] = {
    "ix_saved_session_lists_device_id_expires_at": "(device_id, expires_at)",
    "ix_saved_session_lists_expires_at": "(expires_at)",
}

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason="Postgres not reachable at the conftest URL",
)


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _revision_module() -> ModuleType:
    return load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")


def _scalar(engine: Engine, sql: str, **params: object) -> object:
    with engine.connect() as conn:
        return conn.execute(text(sql), params).scalar()


# ---------------------------------------------------------------------------
# 1-2. no database
# ---------------------------------------------------------------------------


def test_revision_ids_are_wired_and_the_parent_is_a_real_sibling() -> None:
    module = _revision_module()
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID, (
        "a re-point moves down_revision, the docstring's `Revises:` line AND "
        "_PARENT_REVISION_ID in this test together"
    )
    pattern = re.compile(
        rf'^revision(?:: str)?\s*=\s*["\']{re.escape(_PARENT_REVISION_ID)}["\']', re.M
    )
    siblings = [
        f
        for f in (backend_root() / "alembic" / "versions").glob("*.py")
        if f.name != _REVISION_FILENAME
        and pattern.search(f.read_text(encoding="utf-8"))
    ]
    assert len(siblings) == 1, (
        f"down_revision {_PARENT_REVISION_ID!r} must name exactly one existing "
        f"revision (found {[f.name for f in siblings]})"
    )
    assert module.branch_labels is None
    assert module.depends_on is None


def test_docstring_header_matches_the_identifiers() -> None:
    source = _revision_source()
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_PARENT_REVISION_ID)}$", source, re.M)


def test_every_op_names_the_project_schema() -> None:
    tree = ast.parse(_revision_source())
    op_calls = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "op"
    ]
    assert len(op_calls) == 6, "3 creates in upgrade, 3 drops in downgrade"
    for call in op_calls:
        schemas = [
            kw.value.value
            for kw in call.keywords
            if kw.arg == "schema" and isinstance(kw.value, ast.Constant)
        ]
        assert schemas == [_SCHEMA], ast.unparse(call)


# ---------------------------------------------------------------------------
# 3-4. against Postgres
# ---------------------------------------------------------------------------


@_needs_pg
def test_upgrade_creates_the_shape_and_downgrade_removes_it() -> None:
    root = backend_root()
    with ephemeral_database(admin_database_url(), "ssl01") as (engine, url):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, _SCHEMA, _TABLE)

        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
        for name, expected_type, nullable in _EXPECTED_COLUMNS:
            info = column_info(engine, _TABLE, name, schema=_SCHEMA)
            assert info is not None, f"{name} is missing"
            data_type, is_nullable, _default = info
            assert data_type == expected_type, (name, info)
            assert (is_nullable == "YES") is nullable, (name, info)
        n_columns = _scalar(
            engine,
            "SELECT count(*) FROM information_schema.columns "
            "WHERE table_schema = :s AND table_name = :t",
            s=_SCHEMA,
            t=_TABLE,
        )
        assert n_columns == len(_EXPECTED_COLUMNS), "a column was added or dropped"
        # The migration and the model the app reads through agree.
        model_columns = {c.name: c.nullable for c in SavedSessionList.__table__.columns}
        assert model_columns == {
            name: nullable for name, _t, nullable in _EXPECTED_COLUMNS
        }

        assert (
            _scalar(
                engine,
                "SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c "
                "WHERE c.conrelid = 'project.saved_session_lists'::regclass "
                "AND c.contype = 'p'",
            )
            == "PRIMARY KEY (id)"
        )
        assert (
            _scalar(
                engine,
                "SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c "
                "WHERE c.conrelid = 'project.saved_session_lists'::regclass "
                "AND c.contype = 'f'",
            )
            == "FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id) "
            "ON DELETE CASCADE"
        )
        assert "gen_random_uuid()" in str(
            column_info(engine, _TABLE, "id", schema=_SCHEMA)
        )
        for name, columns in _INDEXES.items():
            definition = _scalar(
                engine,
                "SELECT indexdef FROM pg_indexes WHERE schemaname = :s AND indexname = :i",
                s=_SCHEMA,
                i=name,
            )
            assert definition == (
                f"CREATE INDEX {name} ON project.saved_session_lists "
                f"USING btree {columns}"
            ), definition

        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, _SCHEMA, _TABLE)
        for name in _INDEXES:
            assert not index_exists(engine, name, schema=_SCHEMA), name

        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
        for name in _INDEXES:
            assert index_exists(engine, name, schema=_SCHEMA), name
