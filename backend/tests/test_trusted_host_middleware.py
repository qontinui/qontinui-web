"""Tests for TrustedHost middleware with health check exemption."""

import pytest
from app.middleware.trusted_host import TrustedHostMiddleware
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def app_with_middleware():
    """Create a test FastAPI app with TrustedHost middleware."""
    app = FastAPI()

    @app.get("/")
    def root():
        return {"message": "ok"}

    @app.get("/health")
    def health():
        return {"status": "healthy"}

    @app.get("/api/users")
    def users():
        return {"users": []}

    # Add middleware with restricted hosts
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=["testserver", "example.com", "*.example.com"],
        exempt_paths=["/health"],
    )

    return app


def test_allowed_host_passes(app_with_middleware):
    """Test that requests with allowed hosts pass through."""
    client = TestClient(app_with_middleware)

    # testserver is in allowed_hosts
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"message": "ok"}


def test_disallowed_host_blocked(app_with_middleware):
    """Test that requests with disallowed hosts are blocked."""
    client = TestClient(
        app_with_middleware,
        base_url="http://badhost.com",
    )

    response = client.get("/api/users")
    assert response.status_code == 400


def test_health_check_bypasses_host_validation(app_with_middleware):
    """Test that health check endpoint bypasses host validation."""
    client = TestClient(
        app_with_middleware,
        base_url="http://10.0.0.1",  # Internal IP, not in allowed_hosts
    )

    # Health check should pass even with disallowed host
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}


def test_wildcard_host_pattern(app_with_middleware):
    """Test that wildcard host patterns work."""
    client = TestClient(
        app_with_middleware,
        base_url="http://api.example.com",  # Matches *.example.com
    )

    response = client.get("/")
    assert response.status_code == 200


def test_no_allowed_hosts_allows_all():
    """Test that empty allowed_hosts list allows all hosts."""
    app = FastAPI()

    @app.get("/")
    def root():
        return {"message": "ok"}

    # No allowed_hosts configured - should allow all
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=[])

    client = TestClient(app, base_url="http://anyhost.com")
    response = client.get("/")
    assert response.status_code == 200
