"""Tests for ``coord_hooks_04_drop_attempt_audits``.

Plan ``2026-11-06-verification-stores-nothing-writes-are-deleted-and-their-open-write-doors-close``
Phase 6. The upgrade drops ``coord.attempt_audits`` and its two indexes and
nothing else. The downgrade restores the table exactly as
``coord_hooks_03_attempt_audits`` created it. The oracle is the shape captured
at the parent revision: every column, every index definition and the primary
key. A second upgrade then drops it again.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    load_revision_module,
    run_alembic,
    scalar,
    table_exists,
)

_REVISION_ID = "coord_hooks_04_drop_attempt_audits"
_PARENT_REVISION_ID = "fpl_02b"
_PATH: Path = backend_root() / "alembic" / "versions" / f"{_REVISION_ID}.py"
_INDEXES = {"idx_attempt_audits_unit", "idx_attempt_audits_tenant"}

_DB_SKIP = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a postgres "
        "service; locally, set DATABASE_URL to a reachable test Postgres."
    ),
)


def test_revision_chain() -> None:
    module = load_revision_module(_PATH, "coord_hooks_04_under_test")
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID
    assert module.branch_labels is None
    assert module.depends_on is None


def test_docstring_header_matches_the_identifiers() -> None:
    source = _PATH.read_text(encoding="utf-8")
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_PARENT_REVISION_ID)}$", source, re.M)


def _shape(engine: Engine) -> dict[str, object]:
    """The table's full shape: columns, index definitions and constraints."""
    with engine.connect() as conn:
        columns = conn.execute(
            text(
                "SELECT column_name, ordinal_position, data_type, is_nullable, "
                "column_default FROM information_schema.columns "
                "WHERE table_schema = 'coord' AND table_name = 'attempt_audits' "
                "ORDER BY ordinal_position"
            )
        ).all()
        indexes = conn.execute(
            text(
                "SELECT indexname, indexdef FROM pg_indexes "
                "WHERE schemaname = 'coord' AND tablename = 'attempt_audits' "
                "ORDER BY indexname"
            )
        ).all()
        constraints = conn.execute(
            text(
                "SELECT con.contype, pg_get_constraintdef(con.oid) "
                "FROM pg_constraint con "
                "JOIN pg_class rel ON rel.oid = con.conrelid "
                "JOIN pg_namespace ns ON ns.oid = rel.relnamespace "
                "WHERE ns.nspname = 'coord' AND rel.relname = 'attempt_audits' "
                "ORDER BY 1, 2"
            )
        ).all()
    return {
        "columns": [tuple(r) for r in columns],
        "indexes": [tuple(r) for r in indexes],
        "constraints": [tuple(r) for r in constraints],
    }


def _coord_table_count(engine: Engine) -> int:
    count = scalar(
        engine,
        "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'coord'",
    )
    assert isinstance(count, int)
    return count


def _assert_store_absent(engine: Engine) -> None:
    assert not table_exists(engine, "coord", "attempt_audits")
    leftover = scalar(
        engine,
        "SELECT count(*) FROM pg_indexes WHERE schemaname = 'coord' "
        "AND indexname IN ('idx_attempt_audits_unit', 'idx_attempt_audits_tenant')",
    )
    assert leftover == 0


@_DB_SKIP
def test_upgrade_drops_the_store_and_downgrade_restores_its_exact_shape() -> None:
    root = backend_root()
    with ephemeral_database(admin_database_url(), "coord_hooks_04_test") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        original = _shape(engine)
        # The oracle is non-trivial: ten columns, the PK index plus both
        # secondary indexes, and the primary key constraint.
        assert len(original["columns"]) == 10  # type: ignore[arg-type]
        index_names = {name for name, _ in original["indexes"]}  # type: ignore[attr-defined]
        assert _INDEXES <= index_names
        assert [kind for kind, _ in original["constraints"]] == ["p"]  # type: ignore[attr-defined]
        tables_before = _coord_table_count(engine)

        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_store_absent(engine)
        # Nothing but the one table went.
        assert _coord_table_count(engine) == tables_before - 1

        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert _shape(engine) == original

        # The restored default fills the sentinel, and the restored primary
        # key refuses a duplicate (unit_id, attempt_id).
        insert = (
            "INSERT INTO coord.attempt_audits (unit_id, gate) "
            "VALUES ('11111111-1111-1111-1111-111111111111', 'preview')"
        )
        with engine.begin() as conn:
            conn.exec_driver_sql(insert)
        assert (
            scalar(engine, "SELECT attempt_id::text FROM coord.attempt_audits")
            == "00000000-0000-0000-0000-000000000000"
        )
        with pytest.raises(IntegrityError), engine.begin() as conn:
            conn.exec_driver_sql(insert)
        with engine.begin() as conn:
            conn.exec_driver_sql("DELETE FROM coord.attempt_audits")

        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_store_absent(engine)
