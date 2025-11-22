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

# Set test environment
os.environ["TESTING"] = "1"
os.environ["ENVIRONMENT"] = "development"  # Use development for tests

# Set required configuration for tests
os.environ["DATABASE_URL"] = (
    "postgresql://test_user:test_password@localhost:5432/test_db"
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
os.environ["STORAGE_BACKEND"] = "local"
os.environ["REDIS_ENABLED"] = "false"  # Disable Redis for tests


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


@pytest_asyncio.fixture(scope="function")
async def async_db_session() -> AsyncGenerator[AsyncSession, None]:
    """
    Create an async database session for testing.
    Uses in-memory SQLite for fast, isolated tests.
    """
    from app.db.base import Base

    # Create async engine with in-memory SQLite
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=NullPool,
        echo=False,
    )

    # Create tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Create session factory
    async_session_maker = sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )

    # Yield session
    async with async_session_maker() as session:
        yield session

    # Cleanup
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

    await engine.dispose()


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
