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

# Set required configuration for tests - use PostgreSQL test database
os.environ["DATABASE_URL"] = (
    "postgresql://qontinui_user:qontinui_dev_password@localhost:5432/qontinui_test"
)
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
os.environ["BACKEND_CORS_ORIGIN_REGEX"] = (
    r"^https://([a-z0-9-]+\.)*staging\.qontinui\.io$"
)
os.environ["STORAGE_BACKEND"] = "local"
os.environ["REDIS_ENABLED"] = "false"  # Disable Redis for tests

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


@pytest.fixture(scope="session")
def test_client() -> Generator[TestClient, None, None]:
    """
    Create a test client for the FastAPI application.
    Session-scoped to reuse across all tests.
    """
    from app.main import app

    with TestClient(app) as client:
        yield client


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
    # In real implementation, would create actual test user and token
    # For now, return a mock token
    from app.core.security import create_access_token

    return create_access_token("test_user_id")


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

# PostgreSQL test database URL
TEST_DATABASE_URL = "postgresql+asyncpg://qontinui_user:qontinui_dev_password@localhost:5432/qontinui_test"

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

    # Create all tables at start of test session
    async with _test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

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
        hashed_password="hashed_password",
        is_active=True,
        is_verified=True,
    )
    async_db_session.add(user)
    await async_db_session.commit()
    await async_db_session.refresh(user)

    return user
