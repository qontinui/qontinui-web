"""Shared substrate for tests that run the real alembic chain.

Both migration tests need the same three things: a URL for the test Postgres,
a throwaway database inside it, and a way to invoke alembic against that
database. Before this module each test carried its own copy — ~60 duplicated
lines, and the copies had already drifted (one disposed its engine only on the
success path; both claimed a ``None`` return that no code path produced).

Why a throwaway database rather than the shared ``qontinui_test`` one
====================================================================

``conftest.py``'s ``test_engine`` fixture calls ``Base.metadata.create_all`` —
it does NOT run alembic, so that database's shape matches the SQLAlchemy models
rather than the revision chain. Running ``alembic upgrade`` on top of it would
either no-op (no version table) or collide with existing tables. A fresh
database is the only clean substrate, and it also lets a test walk
upgrade → downgrade → upgrade with no prior state, which is the only way to
catch a malformed ``down_revision`` or a downgrade that leaves residue.

CI provisions a Postgres service container at localhost:5432 (see
``.github/workflows/backend-ci.yml`` and ``tests/conftest.py``); locally these
tests skip unless one is reachable. Point them at a different instance with
``QONTINUI_TEST_PG=host:port`` — the same override ``conftest.py`` honours.
"""

from __future__ import annotations

import contextlib
import os
import subprocess
import uuid
from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine


def admin_database_url() -> str:
    """An admin URL to the test Postgres, matching ``conftest.py``'s credentials.

    Always returns a URL — reachability is a separate question, answered by
    [`can_connect`]. Async driver markers are stripped because alembic runs
    synchronously through psycopg2.
    """
    url = os.environ.get(
        "DATABASE_URL",
        "postgresql://qontinui_user:qontinui_dev_password@localhost:5432/qontinui_test",
    )
    return url.replace("postgresql+asyncpg://", "postgresql://")


def can_connect(admin_url: str) -> bool:
    """True when the test Postgres accepts a connection — the skip predicate."""
    try:
        engine = create_engine(admin_url, isolation_level="AUTOCOMMIT")
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        engine.dispose()
        return True
    except Exception:
        return False


def backend_root() -> Path:
    """Resolve the backend root (where ``alembic.ini`` lives) from this file."""
    return Path(__file__).resolve().parent.parent


def run_alembic(cwd: Path, db_url: str, *args: str) -> subprocess.CompletedProcess[str]:
    """Run alembic against ``db_url`` and return the completed process.

    Deliberately NOT ``check=True``: with ``capture_output=True`` a
    ``CalledProcessError`` reports only the exit status, stranding alembic's
    traceback in the captured streams. A migration test that fails only in CI is
    exactly where that traceback is needed, so the failure is raised as an
    assertion carrying both streams instead.

    The URL is passed both ways (``-x db_url=`` and ``DATABASE_URL``) so the
    call does not depend on which side ``alembic/env.py`` reads.
    """
    env = os.environ.copy()
    env["DATABASE_URL"] = db_url
    proc = subprocess.run(
        ["python", "-m", "alembic", "-x", f"db_url={db_url}", *args],
        cwd=str(cwd),
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, (
        f"alembic {' '.join(args)} failed with exit {proc.returncode}\n"
        f"--- stdout ---\n{proc.stdout}\n--- stderr ---\n{proc.stderr}"
    )
    return proc


@contextlib.contextmanager
def ephemeral_database(
    admin_url: str, name_prefix: str
) -> Iterator[tuple[Engine, str]]:
    """Create a throwaway database, yield ``(engine, url)``, then drop it.

    Teardown runs whatever the body did: the engine is disposed first (so its
    pooled connections do not block the drop), lingering backends are
    terminated, then the database is dropped. Cleanup failures are suppressed
    rather than allowed to replace the body's own exception — a masked
    assertion error is far more expensive to debug than a leaked temp database.
    """
    db_name = f"{name_prefix}_{uuid.uuid4().hex[:12]}"
    base, _, _ = admin_url.rpartition("/")
    db_url = f"{base}/{db_name}"

    admin_engine = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    target_engine: Engine | None = None
    try:
        with admin_engine.connect() as conn:
            conn.execute(text(f'CREATE DATABASE "{db_name}"'))
        target_engine = create_engine(db_url)
        yield target_engine, db_url
    finally:
        if target_engine is not None:
            with contextlib.suppress(Exception):
                target_engine.dispose()
        with contextlib.suppress(Exception):
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
                    {"name": db_name},
                )
                conn.execute(text(f'DROP DATABASE IF EXISTS "{db_name}"'))
        with contextlib.suppress(Exception):
            admin_engine.dispose()


def table_exists(engine: Engine, schema: str, table: str) -> bool:
    """True when ``schema.table`` is present in ``information_schema``."""
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


def index_exists(engine: Engine, index_name: str, schema: str = "coord") -> bool:
    """True when ``index_name`` exists in ``schema`` (``pg_indexes`` has no prefix)."""
    sql = text(
        """
        SELECT EXISTS(
            SELECT 1 FROM pg_indexes
            WHERE schemaname = :schema AND indexname = :idx
        )
        """
    )
    with engine.connect() as conn:
        return bool(conn.execute(sql, {"schema": schema, "idx": index_name}).scalar())
