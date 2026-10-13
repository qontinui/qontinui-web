"""Structural and round-trip test for the ``ci_read_token_02`` revision —
Phase 3 of plan
``2026-10-13-local-lane-ci-reads-a-private-sibling-through-a-dispatch-scoped-door``.

``coord.ci_dispatch_read_tokens`` is the dispatch-scoped sibling-read door's
audit trail AND the substrate of its mint cap (at most 4 ``pending``/``minted``
rows per ``(dispatch_id, target_repo)``, checked and inserted in one
statement). The columns coord's SQL names are pinned against the live catalog,
and the cap statement's shape is exercised on it, so a revision that renamed a
column or dropped the ``id`` default fails here rather than as a coord 500.

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

_REVISION_ID = "ci_read_token_02"
_REVISION_FILENAME = "ci_read_token_02_ci_dispatch_read_tokens.py"
_SCHEMA = "coord"
_TABLE = "ci_dispatch_read_tokens"
_INDEXES = (
    # The mint cap counts rows per (dispatch_id, target_repo).
    "idx_ci_dispatch_read_tokens_dispatch_target",
    # coord's 90-day retention sweep walks ``created_at < cutoff``.
    "idx_ci_dispatch_read_tokens_created_at",
)

# (name, information_schema data_type, nullable, default-substring or None).
# Pinned as literals: coord's door SQL names exactly these columns.
_EXPECTED_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("id", "uuid", False, "gen_random_uuid()"),
    ("dispatch_id", "uuid", False, None),
    ("tenant_id", "uuid", False, None),
    ("device_id", "uuid", False, None),
    ("consumer_repo", "text", False, None),
    ("target_repo", "text", False, None),
    ("outcome", "text", False, "'pending'"),
    ("installation_id", "bigint", True, None),
    ("token_expires_at", "timestamp with time zone", True, None),
    ("created_at", "timestamp with time zone", False, "now()"),
)

# The plan's D4 cap statement, in the shape coord issues it: check and insert
# are ONE statement, so zero rows inserted means ``mint_cap_reached``.
_CAP_INSERT = text(
    f"""
    INSERT INTO {_SCHEMA}.{_TABLE}
        (dispatch_id, tenant_id, device_id, consumer_repo, target_repo, outcome)
    SELECT :d, :t, :dev, 'o/consumer', 'o/target', 'pending'
    WHERE (
        SELECT count(*) FROM {_SCHEMA}.{_TABLE}
        WHERE dispatch_id = :d AND target_repo = 'o/target'
          AND outcome IN ('pending', 'minted')
    ) < 4
    """
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
            # No CHECK on ``outcome``: coord's refusal vocabulary grows.
            assert "CHECK" not in stmt.upper(), stmt
        if "CREATE INDEX" in stmt.upper():
            assert f"ON {_SCHEMA}.{_TABLE}" in stmt


@_needs_pg
def test_table_columns_and_indexes_land() -> None:
    with ephemeral_database(admin_database_url(), "cirt02_shape") as (engine, url):
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
def test_cap_statement_admits_four_and_ignores_refusals() -> None:
    """The D4 single-statement cap, measured on the catalog."""
    with ephemeral_database(admin_database_url(), "cirt02_cap") as (engine, url):
        run_alembic(backend_root(), url, "upgrade", _REVISION_ID)
        params = {"d": uuid.uuid4(), "t": uuid.uuid4(), "dev": uuid.uuid4()}
        # A refused row never consumes the cap.
        with engine.begin() as conn:
            conn.execute(
                text(
                    f"""
                    INSERT INTO {_SCHEMA}.{_TABLE}
                        (dispatch_id, tenant_id, device_id, consumer_repo,
                         target_repo, outcome)
                    VALUES (:d, :t, :dev, 'o/consumer', 'o/target',
                            'dispatch_not_live')
                    """
                ),
                params,
            )
        inserted = []
        for _ in range(5):
            with engine.begin() as conn:
                inserted.append(conn.execute(_CAP_INSERT, params).rowcount)
        assert inserted == [1, 1, 1, 1, 0]
        assert (
            scalar(
                engine,
                f"SELECT count(*) FROM {_SCHEMA}.{_TABLE} "
                "WHERE dispatch_id = :d AND id IS NOT NULL",
                d=params["d"],
            )
            == 5
        )


@_needs_pg
def test_round_trip_down_and_up() -> None:
    with ephemeral_database(admin_database_url(), "cirt02_rt") as (engine, url):
        run_alembic(backend_root(), url, "upgrade", _REVISION_ID)
        parent = _module().down_revision
        assert isinstance(parent, str)
        run_alembic(backend_root(), url, "downgrade", parent)
        assert not table_exists(engine, _SCHEMA, _TABLE)
        run_alembic(backend_root(), url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
