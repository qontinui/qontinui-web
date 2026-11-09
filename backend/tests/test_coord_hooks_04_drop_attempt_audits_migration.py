"""Tests for ``coord_hooks_04_drop_attempt_audits``.

Plan ``2026-11-06-verification-stores-nothing-writes-are-deleted-and-their-open-write-doors-close``
Phase 6. The upgrade drops ``coord.attempt_audits`` and its two indexes and
nothing else. The downgrade restores the table and both indexes in the shape
``coord_hooks_03_attempt_audits`` created, so a second upgrade drops them again.
"""

from __future__ import annotations

from pathlib import Path

import pytest

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

_REVISION_ID = "coord_hooks_04_drop_attempt_audits"
_PARENT_REVISION_ID = "fpl_02b"
_PATH: Path = backend_root() / "alembic" / "versions" / f"{_REVISION_ID}.py"
_INDEXES = ("idx_attempt_audits_unit", "idx_attempt_audits_tenant")
_COLUMNS = (
    "unit_id",
    "attempt_id",
    "gate",
    "reason",
    "all_passed",
    "results",
    "preflight",
    "preview",
    "created_at",
    "tenant_id",
)

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


def _assert_store_present(engine) -> None:  # type: ignore[no-untyped-def]
    assert table_exists(engine, "coord", "attempt_audits")
    for column in _COLUMNS:
        assert column_info(engine, "attempt_audits", column) is not None, column
    for index in _INDEXES:
        assert index_exists(engine, index), index


def _assert_store_absent(engine) -> None:  # type: ignore[no-untyped-def]
    assert not table_exists(engine, "coord", "attempt_audits")
    for index in _INDEXES:
        assert not index_exists(engine, index), index


@_DB_SKIP
def test_upgrade_drops_the_store_and_downgrade_restores_it() -> None:
    root = backend_root()
    with ephemeral_database(admin_database_url(), "coord_hooks_04_test") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        _assert_store_present(engine)
        tables_before = scalar(
            engine,
            "SELECT count(*) FROM information_schema.tables "
            "WHERE table_schema = 'coord'",
        )

        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_store_absent(engine)
        # Nothing but the one table went.
        tables_after = scalar(
            engine,
            "SELECT count(*) FROM information_schema.tables "
            "WHERE table_schema = 'coord'",
        )
        assert tables_after == tables_before - 1  # type: ignore[operator]

        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        _assert_store_present(engine)
        # The restored primary key and the attempt_id sentinel default hold.
        with engine.begin() as conn:
            conn.exec_driver_sql(
                "INSERT INTO coord.attempt_audits (unit_id, gate) "
                "VALUES (gen_random_uuid(), 'preview')"
            )
        assert (
            scalar(
                engine,
                "SELECT attempt_id::text FROM coord.attempt_audits LIMIT 1",
            )
            == "00000000-0000-0000-0000-000000000000"
        )
        with engine.begin() as conn:
            conn.exec_driver_sql("DELETE FROM coord.attempt_audits")

        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_store_absent(engine)
