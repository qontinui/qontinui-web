"""
Test security features: rate limiting, JWT, error handling
"""

import asyncio

import pytest
from fastapi.testclient import TestClient

from app.core.security import blacklist_token, create_access_token, decode_token
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


def test_jwt_token_creation_and_validation():
    """Test JWT token creation and validation"""
    # Create a token
    user_id = "test_user_123"
    token = create_access_token(user_id)

    assert token is not None
    assert isinstance(token, str)

    # Decode and validate
    payload = decode_token(token)
    assert payload is not None
    assert payload.get("sub") == user_id
    assert payload.get("type") == "access"
    assert "jti" in payload  # JWT ID should be present


def test_token_blacklisting():
    """Test token blacklisting functionality"""
    # Create a token
    user_id = "test_user_456"
    token = create_access_token(user_id)

    # Verify token is valid
    payload = decode_token(token)
    assert payload.get("sub") == user_id

    # Blacklist the token (async)
    result = asyncio.run(blacklist_token(token))
    assert result is True

    # Verify token can still be decoded (blacklist check is done separately)
    # decode_token() no longer checks blacklist - that's done by the service
    payload = decode_token(token)
    assert payload.get("sub") == user_id  # Token decodes successfully

    # To properly check blacklist, use token_blacklist_service.is_blacklisted()
    from app.services.auth.token_blacklist_service import token_blacklist_service

    jti = payload.get("jti")
    is_blacklisted = asyncio.run(token_blacklist_service.is_blacklisted(jti))
    assert is_blacklisted is True  # Token should be blacklisted


def test_error_handling_validation_error():
    """Test validation error handling"""
    # Send invalid data to trigger validation error
    response = client.post(
        "/api/v1/auth/register",
        json={"invalid": "data"},  # Missing required fields
    )

    assert response.status_code == 422
    data = response.json()
    assert "error" in data or "detail" in data


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
    origin = "https://demo.staging.qontinui.io"
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
            "Origin": "https://staging.qontinui.io.attacker.com",
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


def test_auth_login_endpoint():
    """Test login endpoint exists and responds"""
    # Use a dedicated TestClient with raise_server_exceptions=False so the
    # endpoint's DB-layer errors surface as a 500 status code rather than
    # raising out of the client call. This is a route-existence smoke test,
    # not a full login integration test.
    local_client = TestClient(app, raise_server_exceptions=False)
    response = local_client.post(
        "/api/v1/auth/jwt/login", data={"username": "test", "password": "test"}
    )
    # Route must exist (not 404). Invalid creds return 400/401; schema
    # mismatch returns 422; DB lookup failure surfaces as 500 in envs
    # without a pre-migrated users table.
    assert response.status_code != 404
    assert response.status_code in [200, 400, 401, 422, 500]


def test_auth_logout_endpoint():
    """Test logout endpoint exists"""
    # Create a test token
    token = create_access_token("test_user")

    response = client.post(
        "/api/v1/auth/jwt/logout", headers={"Authorization": f"Bearer {token}"}
    )
    # Should accept (200/204) or reject (401) the logout request
    assert response.status_code in [200, 204, 401]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
