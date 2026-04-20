"""asyncpg pool for the qontinui-runner PostgreSQL database.

The runner persists process logs to its own PG database (which may be the same
PostgreSQL instance as the qontinui-web backend, or a separate one). This module
provides a lazily-initialized asyncpg pool used by the runner-logs proxy
endpoints.

Configuration:
- RUNNER_DATABASE_URL: full PG connection string for the runner DB.
  Falls back to DATABASE_URL if not set (assumes shared instance).

The runner sets `search_path = runner, public` per-connection. We mirror that
here so that unqualified `process_sessions` / `process_session_output` table
references resolve correctly regardless of which schema the runner created them
in.
"""

from __future__ import annotations

import os

import asyncpg
import structlog

from app.core.config import settings

logger = structlog.get_logger(__name__)

_pool: asyncpg.Pool | None = None


def _runner_dsn() -> str:
    """Return a libpq-style DSN for the runner DB.

    asyncpg accepts plain `postgresql://` URLs but not the SQLAlchemy
    `postgresql+asyncpg://` variant, so strip the driver suffix if present.
    """
    url = os.getenv("RUNNER_DATABASE_URL") or str(settings.DATABASE_URL)
    if url.startswith("postgresql+asyncpg://"):
        url = url.replace("postgresql+asyncpg://", "postgresql://", 1)
    # asyncpg also doesn't accept sslmode in the URL on some versions; leave as-is
    # for local dev (no SSL) — production users should set RUNNER_DATABASE_URL
    # without sslmode and configure SSL via env if needed.
    return url


async def _init_connection(conn: asyncpg.Connection) -> None:
    """Per-connection setup: match the runner's search_path.

    NOTE: asyncpg's `init` hook only runs once when the connection is first
    added to the pool; session state (including `search_path`) is reset
    between acquisitions via `RESET ALL`. We use the `setup` hook instead
    (via get_runner_pool) which runs on every acquire.
    """
    await conn.execute("SET search_path TO runner, public")


async def _setup_connection(conn: asyncpg.Connection) -> None:
    """Per-acquire setup: re-apply search_path after RESET ALL."""
    await conn.execute("SET search_path TO runner, public")


async def get_runner_pool() -> asyncpg.Pool:
    """Return the lazily-initialized runner DB pool."""
    global _pool
    if _pool is None:
        dsn = _runner_dsn()
        logger.info(
            "runner_db_pool_initializing",
            dsn_host=dsn.split("@")[-1].split("/")[0] if "@" in dsn else "local",
        )
        _pool = await asyncpg.create_pool(
            dsn=dsn,
            min_size=1,
            max_size=int(os.getenv("RUNNER_DB_POOL_SIZE", "5")),
            init=_init_connection,
            setup=_setup_connection,
        )
    return _pool


async def close_runner_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
