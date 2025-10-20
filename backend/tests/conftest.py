"""
Pytest configuration and shared fixtures for integration tests.
"""

import os
import tempfile
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient

# Set test environment
os.environ["TESTING"] = "1"
os.environ["ENVIRONMENT"] = "test"


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
