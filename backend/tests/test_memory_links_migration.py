"""Alembic idempotency test for the ``coord_memory_links`` revision.

Librarian Phase 4
(``D:/qontinui-root/plans/2026-07-17-librarian-structured-knowledge-library.md``).

Mirrors ``test_coord_session_substrate_migration.py``: an ephemeral DB
inside the running test Postgres, ``upgrade → downgrade → upgrade``,
asserting the revision's whole surface both ways:

* ``coord.memory_links`` table + its three indexes exist after upgrade,
  are gone after downgrade, and are re-created identically on
  re-upgrade.
* the ``memory_records_kind_check`` CHECK admits ``'library'`` after
  upgrade and reverts to the pre-Phase-4 kind set after downgrade.

The parent revision is parsed from the migration source at runtime (not
hardcoded) because coord re-points ``down_revision`` at land time —
a hardcoded parent would silently rot.

Requires pgvector in the target Postgres (the chain's
``coord_memory_records`` revision hard-requires it); skips cleanly when
Postgres or the extension is unavailable, same as the sibling test.
"""

from __future__ import annotations

import os
import re
import subprocess
import uuid
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

# The revision under test.
_REVISION_ID = "coord_memory_links"

# Tables / indexes this revision creates.
_CREATED_TABLES = [("coord", "memory_links")]
_CREATED_INDEXES = [
    "uq_memory_links_edge",
    "idx_memory_links_tenant_source",
    "idx_memory_links_tenant_target",
]


def _backend_root() -> Path:
    """Resolve the backend root (where alembic.ini lives) from this file."""
    return Path(__file__).resolve().parent.parent


def _parent_revision_id() -> str:
    """Parse ``down_revision`` from the migration source at runtime."""
    source = (
        _backend_root() / "alembic" / "versions" / "coord_memory_links.py"
    ).read_text(encoding="utf-8")
    match = re.search(r'^down_revision:.*=\s*"([^"]+)"', source, re.MULTILINE)
    assert match, "coord_memory_links.py must declare a down_revision"
    return match.group(1)


def _admin_database_url() -> str | None:
    """Admin URL to the test Postgres (None when unreachable → skip)."""
    url = os.environ.get(
        "DATABASE_URL",
        "postgresql://qontinui_user:qontinui_dev_password@localhost:5432/qontinui_test",
    )
    return url.replace("postgresql+asyncpg://", "postgresql://")


def _can_connect_with_pgvector(admin_url: str) -> bool:
    try:
        engine = create_engine(admin_url, isolation_level="AUTOCOMMIT")
        with engine.connect() as conn:
            available = conn.execute(
                text(
                    "SELECT EXISTS(SELECT 1 FROM pg_available_extensions "
                    "WHERE name = 'vector')"
                )
            ).scalar()
        engine.dispose()
        return bool(available)
    except Exception:
        return False


def _table_exists(engine: Engine, schema: str, table: str) -> bool:
    sql = text(
        """
        SELECT EXISTS(
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = :schema AND table_name = :table
        )
        """
    )
    with engine.connect() as conn:
        return bool(conn.execute(sql, {"schema": schema, "table": table}).scalar())


def _index_exists(engine: Engine, index_name: str) -> bool:
    sql = text(
        """
        SELECT EXISTS(
            SELECT 1 FROM pg_indexes
            WHERE schemaname = 'coord' AND indexname = :idx
        )
        """
    )
    with engine.connect() as conn:
        return bool(conn.execute(sql, {"idx": index_name}).scalar())


def _kind_check_def(engine: Engine) -> str:
    """The current ``memory_records_kind_check`` definition text."""
    sql = text(
        """
        SELECT pg_get_constraintdef(c.oid)
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'coord'
          AND t.relname = 'memory_records'
          AND c.conname = 'memory_records_kind_check'
        """
    )
    with engine.connect() as conn:
        row = conn.execute(sql).scalar()
    assert row, "memory_records_kind_check should exist"
    return str(row)


def _alembic(cwd: Path, db_url: str, *args: str) -> subprocess.CompletedProcess[str]:
    """Run alembic with a target DB URL injected via env override."""
    env = os.environ.copy()
    env["DATABASE_URL"] = db_url
    return subprocess.run(
        ["python", "-m", "alembic", "-x", f"db_url={db_url}", *args],
        cwd=str(cwd),
        env=env,
        capture_output=True,
        text=True,
        check=True,
    )


@pytest.mark.skipif(
    not _can_connect_with_pgvector(_admin_database_url() or ""),
    reason=(
        "Postgres (with the pgvector extension available) not reachable at "
        "the conftest URL. CI provisions a pgvector/pgvector:pg16 service; "
        "locally, bring up a pgvector-enabled Postgres before running this."
    ),
)
def test_coord_memory_links_idempotent_roundtrip() -> None:
    """upgrade → downgrade → upgrade leaves the schema in the same shape."""
    admin_url = _admin_database_url()
    assert admin_url, "DATABASE_URL must be set or default to qontinui_test"
    parent_revision = _parent_revision_id()

    temp_db_name = f"coord_memory_links_test_{uuid.uuid4().hex[:12]}"
    base, _, _ = admin_url.rpartition("/")
    temp_db_url = f"{base}/{temp_db_name}"

    admin_engine = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    backend_root = _backend_root()

    try:
        with admin_engine.connect() as conn:
            conn.execute(text(f'CREATE DATABASE "{temp_db_name}"'))
        target_engine = create_engine(temp_db_url)

        # ----------------------------------------------------------------
        # 1. First upgrade — full chain up to coord_memory_links.
        # ----------------------------------------------------------------
        _alembic(backend_root, temp_db_url, "upgrade", _REVISION_ID)

        for schema, table in _CREATED_TABLES:
            assert _table_exists(target_engine, schema, table), (
                f"After first upgrade, {schema}.{table} should exist"
            )
        for idx in _CREATED_INDEXES:
            assert _index_exists(target_engine, idx), (
                f"After first upgrade, index coord.{idx} should exist"
            )
        assert "'library'" in _kind_check_def(target_engine), (
            "After upgrade, the kind CHECK should admit 'library'"
        )

        # ----------------------------------------------------------------
        # 2. Downgrade one step — back to the parent.
        # ----------------------------------------------------------------
        _alembic(backend_root, temp_db_url, "downgrade", parent_revision)

        for schema, table in _CREATED_TABLES:
            assert not _table_exists(target_engine, schema, table), (
                f"After downgrade, {schema}.{table} should NOT exist"
            )
        assert "'library'" not in _kind_check_def(target_engine), (
            "After downgrade, the kind CHECK should no longer admit 'library'"
        )

        # ----------------------------------------------------------------
        # 3. Re-upgrade — schema returns to the post-upgrade shape.
        # ----------------------------------------------------------------
        _alembic(backend_root, temp_db_url, "upgrade", _REVISION_ID)

        for schema, table in _CREATED_TABLES:
            assert _table_exists(target_engine, schema, table), (
                f"After second upgrade, {schema}.{table} should exist"
            )
        for idx in _CREATED_INDEXES:
            assert _index_exists(target_engine, idx), (
                f"After second upgrade, index coord.{idx} should exist again"
            )
        assert "'library'" in _kind_check_def(target_engine), (
            "After second upgrade, the kind CHECK should admit 'library' again"
        )

        target_engine.dispose()

    finally:
        with admin_engine.connect() as conn:
            conn.execute(
                text(
                    """
                    SELECT pg_terminate_backend(pid)
                      FROM pg_stat_activity
                     WHERE datname = :name
                       AND pid <> pg_backend_pid()
                    """
                ),
                {"name": temp_db_name},
            )
            conn.execute(text(f'DROP DATABASE IF EXISTS "{temp_db_name}"'))
        admin_engine.dispose()
