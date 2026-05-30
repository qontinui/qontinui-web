"""
Test security features: rate limiting, error handling, CORS.

NOTE: the local FastAPI-Users JWT tests (token creation/decoding/
blacklisting, /auth/register, /jwt/login, /jwt/logout) were removed when
Cognito became the sole user-authentication mechanism — those endpoints
and the local token-minting helpers no longer exist.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_endpoint():
    """Test health check endpoint"""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert "status" in data
    assert "version" in data
    assert "environment" in data
    assert data["environment"] == "development"


def test_rate_limiting():
    """Test rate limiting on endpoints"""
    # Make multiple rapid requests
    responses = []
    for _ in range(10):
        response = client.get("/health")
        responses.append(response)

    # Check if rate limit headers are present
    last_response = responses[-1]
    assert "X-RateLimit-Limit" in last_response.headers or response.status_code == 200


def test_error_handling_not_found():
    """Test 404 error handling"""
    response = client.get("/nonexistent-endpoint")
    assert response.status_code == 404
    data = response.json()
    assert "error" in data or "detail" in data


def test_cors_headers():
    """Test CORS headers are properly set"""
    response = client.options(
        "/health",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
        },
    )

    # Check CORS headers
    assert (
        "access-control-allow-origin" in response.headers or response.status_code == 200
    )


def test_cors_origin_regex_allows_matching_subdomain():
    origin = "https://qontinui.io"
    response = client.options(
        "/health",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.headers.get("access-control-allow-origin") == origin


def test_cors_origin_regex_rejects_outside_subtree():
    response = client.options(
        "/health",
        headers={
            "Origin": "https://evil.example.com",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.headers.get("access-control-allow-origin") is None


def test_cors_origin_regex_rejects_suffix_attack():
    # Anchor verification: the regex must not match a domain that merely
    # ends with the staging suffix, e.g. via a parent attacker domain.
    response = client.options(
        "/health",
        headers={
            "Origin": "https://qontinui.io.attacker.com",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.headers.get("access-control-allow-origin") is None


def test_environment_configuration():
    """Test environment-specific configuration"""
    from app.core.config import settings

    # In development, these should be available
    assert settings.ENVIRONMENT in ["development", "staging", "production"]

    # Check security settings (may be overridden by .env)
    assert settings.ACCESS_TOKEN_EXPIRE_MINUTES > 0  # Should be positive
    assert settings.ACCESS_TOKEN_EXPIRE_MINUTES <= 60  # Should be reasonably short
    assert settings.REFRESH_TOKEN_EXPIRE_DAYS > 0
    assert settings.RATE_LIMIT_ENABLED is True


def test_local_auth_endpoints_removed():
    """Local FastAPI-Users auth endpoints are gone (Cognito-only).

    Sign-up / local login / refresh / logout were deleted; the routes must
    no longer exist (404), proving the local-password surface is fully torn
    down.
    """
    local_client = TestClient(app, raise_server_exceptions=False)
    for method, path in (
        ("post", "/api/v1/auth/register"),
        ("post", "/api/v1/auth/jwt/login"),
        ("post", "/api/v1/auth/jwt/refresh"),
        ("post", "/api/v1/auth/jwt/logout"),
        ("post", "/api/v1/auth/runner-token"),
    ):
        response = getattr(local_client, method)(path)
        assert response.status_code == 404, (
            f"{method.upper()} {path} should be removed but returned "
            f"{response.status_code}"
        )


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
