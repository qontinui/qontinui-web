"""Round-trip test for ``sessresume_01`` (unfinished-resume Phase 0 schema).

Plan ``2026-10-06-closed-sessions-whose-work-is-unfinished-are-found-fleet-wide-and-resumed``.

coord already reads and writes these columns, and degrades while they are
absent: ``GET /tenant-policy`` serves ``resume_unfinished_enabled: null``
(UNKNOWN) and ``PATCH`` answers 503. What would bite only in production is a
``resume_unfinished_enabled`` that lands NULLABLE or without its ``true``
default on a tenant row that already existed — coord would then read UNKNOWN
for that tenant forever and the sweep would never run. So the test seeds a
policy row at the PARENT revision, upgrades, and reads the default back off
that row; then head → downgrade to the parent BY NAME → head must leave no
residue.

Substrate is ``tests/_alembic_harness``. ⚠️ A skip proves nothing — point it at
a live instance with ``QONTINUI_TEST_PG=localhost:<port>``.
"""

from __future__ import annotations

import re
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_info,
    declared_parent_revision_id,
    ephemeral_database,
    run_alembic,
    scalar,
)

_REVISION_ID = "sessresume_01"
_PARENT_REVISION_ID = "leader_worker_runs_01"
_REVISION_FILENAME = "sessresume_01_session_unfinished_resume_columns.py"

# (table, column, data_type, is_nullable)
_SESSION_COLUMNS = (
    ("sessions", "finish_reason", "text", "YES"),
    ("sessions", "account_label", "text", "YES"),
    ("sessions", "config_dir", "text", "YES"),
    ("sessions", "last_resume_attempt_at", "timestamp with time zone", "YES"),
    ("sessions", "resume_verdict", "text", "YES"),
)
_TOGGLE = ("tenant_policies", "resume_unfinished_enabled", "boolean", "NO")
_EXPECTED = (*_SESSION_COLUMNS, _TOGGLE)


def _revision_source() -> str:
    return (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )


def test_down_revision_pins_the_parent() -> None:
    assert declared_parent_revision_id(_revision_source(), _REVISION_FILENAME) == (
        _PARENT_REVISION_ID
    )


def test_the_revision_id_is_unique_in_the_chain() -> None:
    versions = backend_root() / "alembic" / "versions"
    same_id = [
        path.name
        for path in versions.glob("*.py")
        if re.search(
            rf'^revision[^=]*=\s*["\']{re.escape(_REVISION_ID)}["\']',
            path.read_text(encoding="utf-8"),
            re.MULTILINE,
        )
    ]
    assert same_id == [_REVISION_FILENAME]


_PG_SKIP = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, set QONTINUI_TEST_PG=localhost:<port> "
        "before running this test."
    ),
)


def _assert_present(engine: Engine) -> None:
    for table, column, data_type, nullable in _EXPECTED:
        info = column_info(engine, table, column)
        assert info is not None, f"coord.{table}.{column} missing after upgrade"
        assert (info[0], info[1]) == (data_type, nullable), (
            f"coord.{table}.{column}: {info!r}"
        )
    toggle_default = column_info(engine, _TOGGLE[0], _TOGGLE[1])
    assert toggle_default is not None and toggle_default[2] == "true"


def _assert_absent(engine: Engine) -> None:
    for table, column, *_ in _EXPECTED:
        assert column_info(engine, table, column) is None, (
            f"coord.{table}.{column} survived downgrade()"
        )


def _seed_tenant_policy(engine: Engine) -> uuid.UUID:
    tenant_id = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO coord.tenants (tenant_id, slug, display_name) "
                "VALUES (:t, :slug, 'sessresume_01 fixture')"
            ),
            {"t": str(tenant_id), "slug": f"sessresume-{tenant_id.hex[:12]}"},
        )
        conn.execute(
            text("INSERT INTO coord.tenant_policies (tenant_id) VALUES (:t)"),
            {"t": str(tenant_id)},
        )
    return tenant_id


@_PG_SKIP
def test_upgrade_downgrade_upgrade_round_trip() -> None:
    admin_url = admin_database_url()
    root = backend_root()

    with ephemeral_database(admin_url, "sessresume_01") as (engine, db_url):
        run_alembic(root, db_url, "upgrade", _PARENT_REVISION_ID)
        _assert_absent(engine)
        tenant_id = _seed_tenant_policy(engine)

        run_alembic(root, db_url, "upgrade", "head")
        _assert_present(engine)
        # A row that predates the column reads the default, never NULL.
        assert (
            scalar(
                engine,
                "SELECT resume_unfinished_enabled FROM coord.tenant_policies "
                "WHERE tenant_id = :t",
                t=str(tenant_id),
            )
            is True
        )

        run_alembic(root, db_url, "downgrade", _PARENT_REVISION_ID)
        _assert_absent(engine)

        run_alembic(root, db_url, "upgrade", "head")
        _assert_present(engine)
