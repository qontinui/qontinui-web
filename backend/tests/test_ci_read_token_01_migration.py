"""Structural and round-trip test for the ``ci_read_token_01`` revision —
Phase 4 of plan ``2026-10-10-repo-onboarding-is-agent-actionable-end-to-end``.

``coord.ci_repo_read_token_requests`` is the OIDC broker's replay ledger AND its
audit trail. The property that matters is that ``jti`` is UNIQUE: coord refuses
a replayed GitHub Actions OIDC token by hitting that key, across replicas. A
revision that made ``jti`` an ordinary column would leave every coord test green
and silently re-admit replays, so the key is asserted against the live catalog.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, migrated by the real alembic chain. Without a reachable Postgres the
DB-backed tests skip and the source-level ones still run.
"""

from __future__ import annotations

import ast
import uuid
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_info,
    ephemeral_database,
    index_exists,
    load_revision_module,
    run_alembic,
    scalar,
    table_exists,
)

_REVISION_ID = "ci_read_token_01"
_REVISION_FILENAME = "ci_read_token_01_ci_repo_read_token_requests.py"
_SCHEMA = "coord"
_TABLE = "ci_repo_read_token_requests"
_INDEXES = (
    "idx_ci_repo_read_token_requests_consumer",
    "idx_ci_repo_read_token_requests_target",
)

# (name, information_schema data_type, nullable, default-substring or None).
# Pinned as literals: coord's broker SQL names exactly these columns.
_EXPECTED_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("jti", "text", False, None),
    ("tenant_id", "uuid", True, None),
    ("consumer_repo", "text", False, None),
    ("target_repo", "text", False, None),
    ("run_id", "text", True, None),
    ("job_workflow_ref", "text", True, None),
    ("ref", "text", True, None),
    ("event_name", "text", True, None),
    ("outcome", "text", False, "'pending'"),
    ("installation_id", "bigint", True, None),
    ("token_expires_at", "timestamp with time zone", True, None),
    ("oidc_expires_at", "timestamp with time zone", False, None),
    ("created_at", "timestamp with time zone", False, "now()"),
    ("decided_at", "timestamp with time zone", True, None),
)

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason="test Postgres unreachable (set QONTINUI_TEST_PG=host:port)",
)


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _module():
    return load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")


def _upgrade_sql() -> list[str]:
    tree = ast.parse(_revision_path().read_text(encoding="utf-8"))
    fn = next(
        n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "upgrade"
    )
    out: list[str] = []
    for node in ast.walk(fn):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "execute"
        ):
            out.extend(
                a.value
                for a in node.args
                if isinstance(a, ast.Constant) and isinstance(a.value, str)
            )
    return out


def test_revision_is_wired_to_one_real_parent() -> None:
    module = _module()
    assert module.revision == _REVISION_ID
    parent = module.down_revision
    assert isinstance(parent, str) and parent
    doc = ast.get_docstring(ast.parse(_revision_path().read_text(encoding="utf-8")))
    assert f"Revision ID: {_REVISION_ID}" in (doc or "")
    assert f"Revises: {parent}" in (doc or "")
    assert module.branch_labels is None
    assert module.depends_on is None


def test_upgrade_drops_nothing_and_is_coord_qualified() -> None:
    sql = _upgrade_sql()
    assert sql, "upgrade() executes no SQL"
    for stmt in sql:
        assert "DROP" not in stmt.upper(), stmt
        if "CREATE TABLE" in stmt.upper():
            assert f"{_SCHEMA}.{_TABLE}" in stmt
            assert "jti              TEXT        PRIMARY KEY" in stmt
        if "CREATE INDEX" in stmt.upper():
            assert f"ON {_SCHEMA}.{_TABLE}" in stmt


@_needs_pg
def test_table_columns_and_indexes_land() -> None:
    with ephemeral_database(admin_database_url(), "cirt01_shape") as (engine, url):
        run_alembic(backend_root(), url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
        for name, data_type, nullable, default in _EXPECTED_COLUMNS:
            info = column_info(engine, _TABLE, name, schema=_SCHEMA)
            assert info is not None, f"{_SCHEMA}.{_TABLE}.{name} missing"
            assert info[0] == data_type, (name, info)
            assert info[1] == ("YES" if nullable else "NO"), (name, info)
            if default is not None:
                assert info[2] is not None and default in info[2], (name, info)
        for idx in _INDEXES:
            assert index_exists(engine, idx, schema=_SCHEMA), idx


@_needs_pg
def test_a_second_row_with_the_same_jti_is_refused() -> None:
    """The replay refusal coord relies on, measured on the catalog."""
    insert = text(
        f"""
        INSERT INTO {_SCHEMA}.{_TABLE}
            (jti, consumer_repo, target_repo, oidc_expires_at)
        VALUES (:jti, 'o/consumer', 'o/target', now() + interval '5 minutes')
        """
    )
    with ephemeral_database(admin_database_url(), "cirt01_jti") as (engine, url):
        run_alembic(backend_root(), url, "upgrade", _REVISION_ID)
        jti = str(uuid.uuid4())
        with engine.begin() as conn:
            conn.execute(insert, {"jti": jti})
        assert (
            scalar(
                engine,
                f"SELECT outcome FROM {_SCHEMA}.{_TABLE} WHERE jti = :j",
                j=jti,
            )
            == "pending"
        )
        with pytest.raises(IntegrityError):
            with engine.begin() as conn:
                conn.execute(insert, {"jti": jti})


@_needs_pg
def test_round_trip_down_and_up() -> None:
    with ephemeral_database(admin_database_url(), "cirt01_rt") as (engine, url):
        run_alembic(backend_root(), url, "upgrade", _REVISION_ID)
        parent = _module().down_revision
        assert isinstance(parent, str)
        run_alembic(backend_root(), url, "downgrade", parent)
        assert not table_exists(engine, _SCHEMA, _TABLE)
        run_alembic(backend_root(), url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
