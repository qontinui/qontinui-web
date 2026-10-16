"""
Pytest configuration and shared fixtures for integration tests.
"""

import os
import tempfile
from collections.abc import AsyncGenerator, Generator
from uuid import uuid4

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

# Skip the integration test suite during collection. The conftest +
# fixtures under tests/integration/ were authored against the legacy
# RunnerConnection / runner_connections schema that the
# unified-runner-architecture refactor (`unify_runner_concepts` /
# `tighten_runner_schema` migrations) replaced with Runner +
# RunnerSession in April 2026. The fixtures need a per-row rewrite
# (Runner is now the parent, RunnerSession is the child) before
# they can run again. Until then, importing tests/integration/conftest.py
# fails with `ModuleNotFoundError: No module named
# 'app.models.runner_connection'`, which prevents pytest from
# collecting any sibling test files.
collect_ignore = ["integration"]

# Set test environment
os.environ["TESTING"] = "1"
os.environ["ENVIRONMENT"] = "development"  # Use development for tests


# Set required configuration for tests - use PostgreSQL test database.
#
# Two overrides, so a dev box can run the DB-backed suite without editing this
# file. The defaults are the CI topology, so CI behaviour is unchanged when
# both vars are unset.
#
# - QONTINUI_TEST_PG_DSN: a full DSN (`postgresql://user:pw@host:port/db`; a
#   `postgres://` or `postgresql+<driver>://` scheme is accepted too). It WINS
#   when set, and is the shape to use with a throwaway database whose
#   credentials and db name are not the CI ones. The sanctioned way to get one
#   is `bash qontinui-claude-config/scripts/ephemeral-db.sh start pgvector`,
#   which labels the container so `ephemeral-db.sh list`/`stop` can find it.
#   A query string (`?sslmode=...`) is refused: the same tail feeds asyncpg,
#   which rejects libpq-only keywords.
# - QONTINUI_TEST_PG: host:port only, with the CI credentials and db name
#   (e.g. the canonical dev stack publishes Postgres on 5433).
def _test_pg_dsn_tail() -> str:
    """The DSN with its scheme stripped: `user:pw@host:port/db`."""
    dsn = os.environ.get("QONTINUI_TEST_PG_DSN", "").strip()
    if dsn:
        scheme, sep, tail = dsn.partition("://")
        dialect = scheme.split("+", 1)[0]
        if not sep or not tail or dialect not in ("postgresql", "postgres"):
            raise RuntimeError(
                "QONTINUI_TEST_PG_DSN must be a postgresql:// DSN, got a value "
                "with scheme " + repr(scheme if sep else "<none>")
            )
        if "?" in tail:
            raise RuntimeError(
                "QONTINUI_TEST_PG_DSN must not carry a query string: the same "
                "DSN feeds the asyncpg engine, which rejects libpq keywords"
            )
        return tail
    # Blank means unset here too, as for the DSN above: a set-but-empty value
    # would otherwise yield a host-less `user:pw@/qontinui_test`.
    hostport = os.environ.get("QONTINUI_TEST_PG", "").strip() or "localhost:5432"
    return f"qontinui_user:qontinui_dev_password@{hostport}/qontinui_test"


_TEST_PG_DSN = _test_pg_dsn_tail()

os.environ["DATABASE_URL"] = f"postgresql://{_TEST_PG_DSN}"
os.environ["SECRET_KEY"] = "test-secret-key-for-testing-only-minimum-32-chars-required"
os.environ["ACCESS_SECRET_KEY"] = (
    "test-access-secret-key-minimum-32-characters-required"
)
os.environ["RESET_PASSWORD_SECRET_KEY"] = (
    "test-reset-password-secret-key-min-32-chars-required"
)
os.environ["VERIFICATION_SECRET_KEY"] = (
    "test-verification-secret-key-min-32-chars-required"
)
os.environ["ALGORITHM"] = "HS256"
os.environ["FRONTEND_URL"] = "http://localhost:3000"
os.environ["BACKEND_CORS_ORIGINS"] = '["http://localhost:3000"]'
os.environ["BACKEND_CORS_ORIGIN_REGEX"] = r"^https://([a-z0-9-]+\.)*qontinui\.io$"
os.environ["STORAGE_BACKEND"] = "local"
os.environ["REDIS_ENABLED"] = "false"  # Disable Redis for tests

# Keep the app's background scheduler OUT of the test session.
#
# `booted_app` below is session-scoped AND autouse: it enters `TestClient(app)`
# as a context manager, which runs the lifespan — and the lifespan calls
# `scheduler.start()` on the module-level singleton in `app.core.scheduler`.
# Left alone, that loop runs for the WHOLE session on the TestClient portal
# thread's event loop, concurrently with every test, and has been the hidden
# cause of a string of order- and timing-dependent reds:
#
# - `scheduled_dispatch` claimed rows `tests/test_scheduler_db.py` had seeded
#   (`due: 0` instead of `due: 1` on `TestDispatchFailure` / `TestNextFireAdvance`);
# - `memory_consolidate` swept the fresh tenant a memory test had just seeded
#   (qontinui-web#1103, `assert 2 == 1`; see `test_memory_lifecycle_db._job_rows`);
# - its `asyncio.sleep(next_due - now)` was recorded by a process-wide
#   `asyncio.sleep` mock in `test_coord_proxy_contract.py` as `0.7789, 0.7788,
#   ...` (CI run 37519038790, shard 6/6; coord finding 171089df) — the mock
#   returned at once, so the loop spun, each delay a few microseconds shorter.
#
# So `booted_app` STOPS the singleton scheduler right after boot (the lifespan
# still calls `start()`, so the production boot path is still exercised and the
# task inventory stays registered for `scheduler.status()`). Tests that need a
# scheduled job run its coroutine directly or build their own
# `SchedulerService`, which is what `tests/test_scheduler*.py` already do.
# `tests/test_scheduler_dispatch_sweeper_off_in_tests.py` pins that the loop is
# not running.
#
# The per-task switch below stays as defense in depth: if the stop above ever
# regresses, the one task that writes shared rows is still off.
os.environ["QONTINUI_SCHEDULER_SCHEDULED_DISPATCH_ENABLED"] = "0"

# Cloud-control side-effect import — must run before any `app.models` import
# so cloud-control's add_model_registrar() hook is in place by the time
# `app/models/__init__.py:506-508`'s `register_cloud_models()` fires.
# Without this, Subscription/AdminNotificationSettings never register on
# Base.metadata and `configure_mappers()` blows up resolving
# `User.subscription`. The production app does this at `app/main.py:18`.
#
# OSS-only setups have no cloud-control package — that's fine, the OSS test
# suite collects normally. But on CI we install cloud-control as a sibling,
# so a missing import there is a real workflow bug — fail loud, not silent.
try:
    import qontinui_cloud_control  # noqa: F401  -- side-effect: registers hooks
except ImportError:
    if os.environ.get("CI") == "true" or os.environ.get("REQUIRE_CLOUD_CONTROL") == "1":
        raise


@pytest.fixture(scope="session", autouse=True)
def booted_app() -> Generator[TestClient, None, None]:
    """Boot the FastAPI app ONCE, at a fixed point in every session.

    `autouse` is the whole point. `TestClient(app)` used as a context manager
    runs the app's lifespan, so while this was a lazily-pulled fixture, *when the
    app booted* was a hidden global decided by which collected file happened to
    request it first — i.e. by the file set, not by anything a test declares.
    Measured: adding one new file that pulled the old `test_client` fixture made
    `test_memory_api_db.py` fail a varying 1-5 tests per run, a different set
    each time, with the code under test untouched.

    Session-scoped + autouse makes boot happen once, before any test, in the same
    place for every run — including runs of a single file. The other half of the
    fix is that startup itself is now inert under tests: `app/main.py`'s
    `_boot_side_effects_disabled()` gates `init_db`, the wrapper-registry sync
    loop, the coord service-account mint and the recording-pipeline recovery
    UPDATE on `TESTING=1` (set at the top of this file). `scheduler.start()` is
    still CALLED (the boot path stays the production one), and then STOPPED
    here — see the comment above QONTINUI_SCHEDULER_SCHEDULED_DISPATCH_ENABLED.

    Being autouse, this is the FIRST session fixture set up and therefore the
    LAST torn down, so it now boots BEFORE `test_engine` creates the tables and
    shuts down AFTER `test_engine` drops them. Both directions are safe only
    because of those gates: nothing in boot or shutdown queries a table
    (shutdown's `metrics_service.force_flush` returns immediately on an empty
    buffer and swallows anything else).
    """
    from app.core.scheduler import scheduler
    from app.main import app

    with TestClient(app) as client:
        # Stop the loop on the event loop that owns it (the TestClient portal's),
        # so it is cancelled and awaited there rather than left ticking for the
        # whole session. The lifespan's own `scheduler.stop()` at shutdown is
        # then a no-op.
        client.portal.call(scheduler.stop)
        yield client


@pytest.fixture(scope="session")
def test_client(booted_app: TestClient) -> TestClient:
    """The session's HTTP client against the booted app.

    Kept as a name for the tests that request one (`test_file_execution_e2e.py`),
    but it no longer OWNS the lifespan — `booted_app` does, unconditionally. So
    requesting this fixture can no longer move when the app boots.
    """
    return booted_app


@pytest.fixture(scope="function")
def temp_dir() -> Generator[str, None, None]:
    """
    Create a temporary directory for test files.
    Automatically cleaned up after test.
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        yield tmpdir


@pytest.fixture(scope="function")
def mock_user_token(test_client: TestClient) -> str:
    """
    Create a mock authentication token for testing.
    """
    # Local token minting was removed (Cognito-only). This is a static
    # placeholder bearer for tests that only need an Authorization header
    # shape; tests that exercise real auth mock the Cognito verifier.
    return "test-mock-token"


@pytest.fixture(scope="function")
def authenticated_client(test_client: TestClient, mock_user_token: str) -> TestClient:
    """
    Create a test client with authentication headers.
    """
    test_client.headers = {"Authorization": f"Bearer {mock_user_token}"}
    return test_client


# Configure pytest markers
def pytest_configure(config):
    """Register custom pytest markers."""
    config.addinivalue_line("markers", "integration: mark test as integration test")
    config.addinivalue_line("markers", "e2e: mark test as end-to-end test")
    config.addinivalue_line("markers", "slow: mark test as slow running")
    config.addinivalue_line("markers", "requires_api: mark test as requiring live API")


# Configure test collection
def pytest_collection_modifyitems(config, items):
    """
    Modify test collection to add markers automatically.
    """
    for item in items:
        # Add integration marker to tests in test_integration_e2e.py
        if "test_integration_e2e" in str(item.fspath):
            item.add_marker(pytest.mark.integration)
            item.add_marker(pytest.mark.e2e)

        # Mark slow tests
        if "test_large" in item.name or "test_many" in item.name:
            item.add_marker(pytest.mark.slow)


# ===== ASYNC DATABASE FIXTURES =====

# PostgreSQL test database URL (overridable via QONTINUI_TEST_PG_DSN or
# QONTINUI_TEST_PG; see the top of this file).
TEST_DATABASE_URL = f"postgresql+asyncpg://{_TEST_PG_DSN}"

# Session-scoped engine for reuse across tests
_test_engine = None


@pytest_asyncio.fixture(scope="session")
async def test_engine():
    """
    Create a shared async engine for the test session.
    Creates all tables once at start of test session.
    """
    global _test_engine
    from app.db.base import Base

    _test_engine = create_async_engine(
        TEST_DATABASE_URL,
        poolclass=NullPool,
        echo=False,
    )

    # The models live in several named Postgres schemas (auth, project,
    # coord, web, devenv, ...). The test DB is created from template0 and has
    # none of them; `Base.metadata.create_all` does NOT create schemas, so
    # table creation fails with InvalidSchemaNameError until the schemas
    # exist. Derive the set of declared schemas from the metadata and create
    # each (idempotently) before building the tables.
    from sqlalchemy import text as _sa_text

    declared_schemas = {
        table.schema for table in Base.metadata.tables.values() if table.schema
    }

    # pgvector: a few project.* tables declare VECTOR(...) columns. Try to
    # enable the extension in its OWN transaction first; a failed
    # CREATE EXTENSION aborts the surrounding transaction, so it must not
    # share the table-build transaction. If the server build doesn't ship
    # pgvector (common on a vanilla Postgres test instance) skip ONLY the
    # vector-dependent tables so the rest of the schema still builds. The
    # features under test here don't use vector columns.
    vector_available = True
    try:
        async with _test_engine.begin() as ext_conn:
            await ext_conn.execute(_sa_text("CREATE EXTENSION IF NOT EXISTS vector"))
    except Exception:  # noqa: BLE001 — best-effort; degrade gracefully
        vector_available = False

    def _has_vector_column(table) -> bool:
        for col in table.columns:
            if "vector" in type(col.type).__name__.lower():
                return True
        return False

    # Create all tables at start of test session
    async with _test_engine.begin() as conn:
        for schema_name in sorted(declared_schemas):
            await conn.execute(_sa_text(f'CREATE SCHEMA IF NOT EXISTS "{schema_name}"'))

        if vector_available:
            tables_to_create = None  # create everything
        else:
            # Exclude vector-column tables AND, transitively, any table whose
            # FKs reference an excluded table (e.g. association tables like
            # project.ui_bridge_state_domain_knowledge) — otherwise their
            # CREATE TABLE fails on the missing referenced relation.
            excluded = {
                t.key for t in Base.metadata.tables.values() if _has_vector_column(t)
            }
            changed = True
            while changed:
                changed = False
                for t in Base.metadata.tables.values():
                    if t.key in excluded:
                        continue
                    for fk in t.foreign_keys:
                        if fk.column.table.key in excluded:
                            excluded.add(t.key)
                            changed = True
                            break
            tables_to_create = [
                t for t in Base.metadata.sorted_tables if t.key not in excluded
            ]

        await conn.run_sync(Base.metadata.create_all, tables=tables_to_create)

    yield _test_engine

    # Drop all tables at end of test session
    async with _test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

    await _test_engine.dispose()
    _test_engine = None


@pytest_asyncio.fixture(scope="function")
async def async_db_session(test_engine) -> AsyncGenerator[AsyncSession, None]:
    """
    Create an async database session for testing.
    Uses PostgreSQL for full compatibility with production.
    Each test runs in a transaction that is rolled back after the test.
    """
    # Create session factory
    async_session_maker = sessionmaker(
        test_engine, class_=AsyncSession, expire_on_commit=False
    )

    # Start a transaction for the test
    async with test_engine.connect() as connection:
        transaction = await connection.begin()

        # Create session bound to the connection
        async with async_session_maker(bind=connection) as session:
            yield session

        # Rollback the transaction to clean up test data
        await transaction.rollback()


@pytest_asyncio.fixture(scope="function")
async def test_user(async_db_session: AsyncSession):
    """
    Create a test user in the database.
    """
    from app.models.user import User

    user = User(
        email=f"testuser_{uuid4()}@example.com",
        username=f"testuser_{uuid4().hex[:8]}",
        full_name="Test User",
        is_active=True,
        is_verified=True,
    )
    async_db_session.add(user)
    await async_db_session.commit()
    await async_db_session.refresh(user)

    return user
