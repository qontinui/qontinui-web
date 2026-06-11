"""Unit tests for the permanent GitHub-identity backfill job helpers.

Covers the two pure helpers in
``scripts/backfill_github_identities.py`` in isolation:

* ``_github_id_from_identities`` — pluck the GitHub federated ``user_id``
  out of a ``list_user_identities`` result (case-insensitive provider
  match; ignores non-GitHub providers and entries with no ``user_id``).
* ``_github_login_via_api`` — best-effort, fail-open login lookup.

The full ``backfill()`` orchestration touches the DB + Cognito and is
covered by the deploy-time run-task + the manual verification recipe in
``project_identity_contract_landing_checkpoint``; here we test the parsing
seam that decides what gets written.
"""

from __future__ import annotations

import httpx

from scripts import backfill_github_identities as backfill


def test_github_id_from_identities_picks_github_user_id():
    identities = [
        {"provider": "Cognito", "user_id": "josh@qontinui.io"},
        {"provider": "Google", "user_id": "104414170002036219141"},
        {"provider": "GitHub", "user_id": "32642391"},
    ]
    assert backfill._github_id_from_identities(identities) == "32642391"


def test_github_id_from_identities_case_insensitive_provider():
    identities = [{"provider": "github", "user_id": "999"}]
    assert backfill._github_id_from_identities(identities) == "999"


def test_github_id_from_identities_none_when_no_github():
    identities = [
        {"provider": "Cognito", "user_id": "u"},
        {"provider": "MicrosoftEntra", "user_id": "abc"},
    ]
    assert backfill._github_id_from_identities(identities) is None


def test_github_id_from_identities_skips_github_without_user_id():
    identities = [{"provider": "GitHub", "user_id": None}]
    assert backfill._github_id_from_identities(identities) is None


def test_github_id_from_identities_ignores_non_dict_entries():
    identities = ["nope", 42, {"provider": "GitHub", "user_id": "7"}]
    assert backfill._github_id_from_identities(identities) == "7"


def test_login_via_api_returns_login(monkeypatch):
    def _get(url, timeout=None, headers=None):  # noqa: ANN001
        assert url.endswith("/user/32642391")
        return httpx.Response(200, json={"login": "jspinak", "id": 32642391})

    monkeypatch.setattr(httpx, "get", _get, raising=True)
    assert backfill._github_login_via_api("32642391") == "jspinak"


def test_login_via_api_non_200_is_none(monkeypatch):
    monkeypatch.setattr(
        httpx,
        "get",
        lambda url, timeout=None, headers=None: httpx.Response(404, text="x"),
        raising=True,
    )
    assert backfill._github_login_via_api("32642391") is None


def test_login_via_api_fail_open_on_exception(monkeypatch):
    def _boom(url, timeout=None, headers=None):  # noqa: ANN001
        raise httpx.ConnectError("network down")

    monkeypatch.setattr(httpx, "get", _boom, raising=True)
    assert backfill._github_login_via_api("32642391") is None
