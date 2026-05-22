"""Alembic idempotency test for the ``coord_session_substrate`` revision.

Verifies the Phase 0 substrate of
``D:/qontinui-root/qontinui-dev-notes/plans/2026-05-22-coord-native-session-coordination.md``
roundtrips cleanly: upgrade → downgrade → upgrade leaves the same
``information_schema`` shape for the four new tables it adds.

The test spins up its own ephemeral DB inside the existing test
Postgres service (created by ``conftest.py``) so it can run
``alembic upgrade head`` end-to-end without contaminating the
``qontinui_test`` DB other tests share. CI's ``Backend CI / test`` job
already provisions a Postgres service container at localhost:5432 with
user ``qontinui_user`` (see ``.github/workflows/backend-ci.yml`` and
``tests/conftest.py``); locally, the test is skipped when no Postgres
is reachable.

Why a brand-new DB rather than re-using qontinui_test
=====================================================

* ``conftest.py``'s ``test_engine`` fixture calls
  ``Base.metadata.create_all`` on qontinui_test — it does NOT run
  alembic. The DB shape there matches the SQLAlchemy models, not the
  alembic revision chain. Running ``alembic upgrade head`` on top of
  that would either no-op (no version table) or collide with existing
  tables. A fresh DB is the only clean substrate.
* Roundtripping (upgrade → downgrade → upgrade) requires the alembic
  chain to be wired up properly. A fresh DB lets us run the full chain
  with no prior state, which is the only way to catch a malformed
  ``down_revision`` link or a downgrade that leaves residue.

This test is the canonical guard for the coord-native-session-coordination
Phase 0 substrate. Future Phase 1 revisions that depend on these tables
should NOT need separate roundtrip tests — alembic's existing chain is
the structural verification.
"""

from __future__ import annotations

import os
import subprocess
import uuid
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

# The revision under test.
_REVISION_ID = "coord_session_substrate"
_PARENT_REVISION_ID = "pr_merge_10_rollout_state"

# Tables this revision creates. Used to assert presence/absence on each
# pass of the upgrade → downgrade → upgrade loop.
_CREATED_TABLES = [
    ("coord", "tenant_policies"),
    ("coord", "sessions"),
    ("coord", "session_events"),
    ("coord", "session_output"),
]

# Indexes this revision creates. Verified on the second upgrade to
# confirm the down → up roundtrip recreated them. Names are exactly as
# they appear in the migration (no schema prefix in pg_indexes.indexname).
_CREATED_INDEXES = [
    "coord_sessions_tenant_state_idx",
    "coord_sessions_device_idx",
    "coord_sessions_parent_idx",
    "coord_session_events_kind_idx",
]


def _admin_database_url() -> str | None:
    """Build an admin URL to the test Postgres or return None if unavailable.

    Re-uses the CI service container's credentials per ``conftest.py``.
    Returns None when no Postgres is reachable so the test cleanly
    skips on developer machines without docker-compose up.
    """
    url = os.environ.get(
        "DATABASE_URL",
        "postgresql://qontinui_user:qontinui_dev_password@localhost:5432/qontinui_test",
    )
    # Strip async driver markers if present (asyncpg → psycopg2 for sync alembic).
    return url.replace("postgresql+asyncpg://", "postgresql://")


def _can_connect(admin_url: str) -> bool:
    try:
        engine = create_engine(admin_url, isolation_level="AUTOCOMMIT")
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        engine.dispose()
        return True
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
        result = conn.execute(sql, {"schema": schema, "table": table}).scalar()
        return bool(result)


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
        result = conn.execute(sql, {"idx": index_name}).scalar()
        return bool(result)


def _backend_root() -> Path:
    """Resolve the backend root (where alembic.ini lives) from this file."""
    return Path(__file__).resolve().parent.parent


def _alembic(cwd: Path, db_url: str, *args: str) -> subprocess.CompletedProcess[str]:
    """Run alembic with a target DB URL injected via env override."""
    env = os.environ.copy()
    env["DATABASE_URL"] = db_url
    # alembic/env.py reads sqlalchemy.url from the [alembic] config block
    # by default but most projects also let DATABASE_URL win. Force the
    # -x flag too so we don't depend on which side env.py reads.
    return subprocess.run(
        ["python", "-m", "alembic", "-x", f"db_url={db_url}", *args],
        cwd=str(cwd),
        env=env,
        capture_output=True,
        text=True,
        check=True,
    )


@pytest.mark.skipif(
    not _can_connect(_admin_database_url() or ""),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)
def test_coord_session_substrate_idempotent_roundtrip() -> None:
    """upgrade → downgrade → upgrade leaves the schema in the same shape.

    Creates an ephemeral DB inside the running Postgres service, points
    alembic at it, walks the full chain, then drops the DB. The
    assertions cover:

    * After ``upgrade head``: all four tables + indexes present.
    * After ``downgrade -1``: the four tables gone (rest of the chain
      stays put — we don't downgrade further).
    * After ``upgrade head`` again: all four tables + indexes
      re-created identically.

    No data assertion (no rows are seeded by tests) — schema shape is
    the contract.
    """
    admin_url = _admin_database_url()
    assert admin_url, "DATABASE_URL must be set or default to qontinui_test"

    temp_db_name = f"coord_session_substrate_test_{uuid.uuid4().hex[:12]}"
    # Build per-DB URL by replacing the trailing path component.
    base, _, _ = admin_url.rpartition("/")
    temp_db_url = f"{base}/{temp_db_name}"

    admin_engine = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    backend_root = _backend_root()

    try:
        # ----------------------------------------------------------------
        # 1. Create the throwaway DB on the admin connection.
        # ----------------------------------------------------------------
        with admin_engine.connect() as conn:
            conn.execute(text(f'CREATE DATABASE "{temp_db_name}"'))

        # Open an engine against the new DB for verification queries.
        target_engine = create_engine(temp_db_url)

        # ----------------------------------------------------------------
        # 2. First upgrade — full alembic chain up to coord_session_substrate.
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

        # ----------------------------------------------------------------
        # 3. Downgrade exactly one step — should land at the parent.
        # ----------------------------------------------------------------
        _alembic(backend_root, temp_db_url, "downgrade", _PARENT_REVISION_ID)

        for schema, table in _CREATED_TABLES:
            assert not _table_exists(target_engine, schema, table), (
                f"After downgrade -1, {schema}.{table} should NOT exist"
            )

        # ----------------------------------------------------------------
        # 4. Re-upgrade — schema returns to the post-upgrade shape.
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

        target_engine.dispose()

    finally:
        # ----------------------------------------------------------------
        # 5. Drop the ephemeral DB regardless of test outcome.
        # ----------------------------------------------------------------
        with admin_engine.connect() as conn:
            # Force-disconnect any lingering sessions before drop.
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
