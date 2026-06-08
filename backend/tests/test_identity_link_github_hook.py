"""Unit tests for the I1 link-hook GitHub-login extraction.

Covers ``_github_login_from_claims`` (claim precedence) and
``_github_login_via_api`` (best-effort fallback, fail-open). The full
``link_identity`` flow is exercised by the existing identities integration
tests; here we test the new extraction helpers in isolation.
"""

from __future__ import annotations

import httpx

from app.api.v1.endpoints.auth import identities


def test_login_from_claims_prefers_custom_github_login():
    claims = {
        "custom:github_login": "octocat",
        "nickname": "ignored",
        "preferred_username": "ignored2",
    }
    assert identities._github_login_from_claims(claims) == "octocat"


def test_login_from_claims_falls_back_to_nickname():
    claims = {"nickname": "monalisa", "preferred_username": "ignored"}
    assert identities._github_login_from_claims(claims) == "monalisa"


def test_login_from_claims_falls_back_to_preferred_username():
    assert (
        identities._github_login_from_claims({"preferred_username": "hubot"}) == "hubot"
    )


def test_login_from_claims_strips_whitespace():
    assert identities._github_login_from_claims({"nickname": "  spacey  "}) == "spacey"


def test_login_from_claims_none_when_absent():
    assert identities._github_login_from_claims({"email": "x@y.z"}) is None


def test_login_from_claims_ignores_blank():
    assert identities._github_login_from_claims({"nickname": "   "}) is None


def test_login_via_api_returns_login(monkeypatch):
    def _get(url, timeout=None, headers=None):  # noqa: ANN001
        assert url.endswith("/user/12345")
        return httpx.Response(200, json={"login": "ghuser", "id": 12345})

    monkeypatch.setattr(httpx, "get", _get, raising=True)
    assert identities._github_login_via_api("12345") == "ghuser"


def test_login_via_api_non_200_is_none(monkeypatch):
    monkeypatch.setattr(
        httpx,
        "get",
        lambda url, timeout=None, headers=None: httpx.Response(404, text="x"),
        raising=True,
    )
    assert identities._github_login_via_api("12345") is None


def test_login_via_api_fail_open_on_exception(monkeypatch):
    def _boom(url, timeout=None, headers=None):  # noqa: ANN001
        raise httpx.ConnectError("network down")

    monkeypatch.setattr(httpx, "get", _boom, raising=True)
    # Best-effort: any error -> None, never propagates.
    assert identities._github_login_via_api("12345") is None
