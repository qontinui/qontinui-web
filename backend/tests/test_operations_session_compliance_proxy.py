"""Integration tests for the session-compliance + version-restore proxies.

Plan ``2026-07-30-session-compliance-report-enforcement.md`` Part B. These
endpoints forward coord's enforcement config, its per-session verdicts, its
outstanding-work ledger, and the new prompt-document version restore so the
admin console never hits coord cross-origin.

Two behaviours here are load-bearing rather than incidental, and both have
their own test:

* **``updated_by`` is never forwarded from the browser** on either write. Coord
  takes the editor from its own authenticated operator context; a client-asserted
  editor would be unverifiable provenance on a behaviour-changing setting. The
  config PUT enforces this with an allowlist (so no future field leaks either),
  and the restore forwards only ``change_note``.
* **Coord's status codes pass through**, including the 404 the compliance
  routes answer with until coord's half of this plan ships — the UI renders
  that as "not deployed yet", which it can only do if the status survives the
  proxy.

Mirrors ``test_operations_priority_sets_proxy.py``: a minimal FastAPI app +
mocked ``httpx.AsyncClient``, with both the admin gate and the member gate
overridden so no live coord is needed.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


def _build_test_app() -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import (
        get_tenant_id,
        require_coord_tenant_admin,
    )
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.email = "testuser@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    # Reads gate on membership (``get_tenant_id``); the config PUT and the
    # version restore gate on ``require_coord_tenant_admin``. Override both so
    # the proxy path doesn't hit a real coord ``/admin/coord/me``.
    test_app.dependency_overrides[require_coord_tenant_admin] = lambda: uuid4()
    test_app.dependency_overrides[get_tenant_id] = lambda: uuid4()
    test_app.include_router(operations_router, prefix="/api/v1/operations")
    return test_app


@pytest.fixture()
def auth_client() -> TestClient:
    return TestClient(_build_test_app())


def _mock_response(status_code: int = 200, json_data=None, text: str = "") -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.text = text or (str(json_data) if json_data else "")
    return resp


def _patch_httpx():
    return patch("app.api.v1.endpoints.operations.httpx.AsyncClient")


def _configure_mock_client(MockClient, mock_instance):
    mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
    mock_instance.__aexit__ = AsyncMock(return_value=False)
    MockClient.return_value = mock_instance


API_PREFIX = "/api/v1/operations"
COMPLIANCE = f"{API_PREFIX}/coord/session-compliance"

_CONFIG_BODY = {
    "enabled": True,
    "mode": "nudge",
    "max_attempts": 1,
    "enforced_clause_ref": "policy/planning-and-scope#finish-to-zero",
    "applicable": True,
    "applicability_reason": "applicable",
    "clause_resolved_via": "registry",
    "prompt_document_version": 7,
    "current_version": 3,
}


class TestGetConfig:
    def test_returns_config(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=_CONFIG_BODY)
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{COMPLIANCE}/config")

        assert resp.status_code == 200
        assert resp.json() == _CONFIG_BODY
        assert instance.get.call_args.args[0].endswith(
            "/coord/session-compliance/config"
        )

    def test_route_absent_on_coord_passes_404_through(self, auth_client: TestClient):
        """Until coord's half ships, these routes 404 — and the UI depends on
        seeing that status to say "not deployed yet" instead of "nothing here"."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(status_code=404, text="no route")
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{COMPLIANCE}/config")

        assert resp.status_code == 404

    def test_coord_unreachable_returns_502(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.ConnectError("refused")
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{COMPLIANCE}/config")

        assert resp.status_code == 502


class TestPutConfig:
    def test_forwards_allowlisted_fields(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.put.return_value = _mock_response(json_data=_CONFIG_BODY)
            _configure_mock_client(MockClient, instance)

            resp = auth_client.put(
                f"{COMPLIANCE}/config",
                json={
                    "enabled": False,
                    "mode": "reopen",
                    "enforced_clause_ref": "policy/planning-and-scope#finish-to-zero",
                    "max_attempts": 2,
                    "change_note": "soak window over",
                },
            )

        assert resp.status_code == 200
        sent = instance.put.call_args.kwargs["json"]
        assert sent == {
            "enabled": False,
            "mode": "reopen",
            "enforced_clause_ref": "policy/planning-and-scope#finish-to-zero",
            "max_attempts": 2,
            "change_note": "soak window over",
        }

    def test_client_supplied_updated_by_is_dropped(self, auth_client: TestClient):
        """The browser never gets to say who made the change.

        Coord stamps the editor from its authenticated operator context. Plan
        ``2026-07-27-prompt-document-writes-operator-gated`` exists to remove
        the client-asserted-``updated_by`` sites that already exist; this must
        not add another.
        """
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.put.return_value = _mock_response(json_data=_CONFIG_BODY)
            _configure_mock_client(MockClient, instance)

            auth_client.put(
                f"{COMPLIANCE}/config",
                json={
                    "enabled": True,
                    "updated_by": "attacker@example.com",
                    "tenant_id": str(uuid4()),
                },
            )

        sent = instance.put.call_args.kwargs["json"]
        assert sent == {"enabled": True}
        assert "updated_by" not in sent
        assert "tenant_id" not in sent

    def test_derived_applicability_is_not_writable(self, auth_client: TestClient):
        """``applicable`` is derived from the clause, so accepting it would let
        the stored value drift from the truth it summarises."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.put.return_value = _mock_response(json_data=_CONFIG_BODY)
            _configure_mock_client(MockClient, instance)

            auth_client.put(
                f"{COMPLIANCE}/config",
                json={
                    "enabled": True,
                    "applicable": True,
                    "applicability_reason": "applicable",
                },
            )

        sent = instance.put.call_args.kwargs["json"]
        assert sent == {"enabled": True}


class TestConfigVersions:
    def test_returns_versions(self, auth_client: TestClient):
        payload = {
            "versions": [
                {
                    "version_number": 3,
                    "enabled": True,
                    "mode": "nudge",
                    "max_attempts": 1,
                    "enforced_clause_ref": "policy/planning-and-scope#finish-to-zero",
                    "change_note": "turned on",
                    "edited_by": "operator@example.com",
                    "created_at": "2026-07-30T10:00:00Z",
                }
            ],
            "current_version": 3,
        }
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=payload)
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{COMPLIANCE}/config/versions")

        assert resp.status_code == 200
        assert resp.json() == payload
        assert instance.get.call_args.args[0].endswith(
            "/coord/session-compliance/config/versions"
        )


class TestSessions:
    def test_forwards_filters(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data={"sessions": []})
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(
                f"{COMPLIANCE}/sessions",
                params={"limit": 25, "verdict": "unverified", "cursor": "abc"},
            )

        assert resp.status_code == 200
        params = instance.get.call_args.kwargs["params"]
        assert params == {"limit": 25, "verdict": "unverified", "cursor": "abc"}

    def test_omits_unset_filters(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data={"sessions": []})
            _configure_mock_client(MockClient, instance)

            auth_client.get(f"{COMPLIANCE}/sessions")

        assert instance.get.call_args.kwargs["params"] is None

    def test_unknown_verdict_is_rejected(self, auth_client: TestClient):
        """There is no fourth verdict, so a fourth filter value is a 422 here
        rather than a query coord has to reject."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data={"sessions": []})
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(
                f"{COMPLIANCE}/sessions", params={"verdict": "no_report"}
            )

        assert resp.status_code == 422
        instance.get.assert_not_called()

    def test_returns_rows(self, auth_client: TestClient):
        payload = {
            "sessions": [
                {
                    "id": "sc-1",
                    "claude_session_id": "2301dbed-fa73-480b-b7f2-3ff1ace4af84",
                    "verdict": "unverified",
                    "reason": "absent",
                    "report": None,
                    "reconciliation": {"reason": "absent"},
                    "prompt_document_version": 7,
                    "checked_at": "2026-07-30T12:00:00Z",
                }
            ],
            "next_cursor": None,
        }
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=payload)
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{COMPLIANCE}/sessions")

        assert resp.json() == payload


class TestOutstanding:
    def test_returns_ledger(self, auth_client: TestClient):
        payload = {
            "items": [
                {
                    "claude_session_id": "sess-1",
                    "checked_at": "2026-07-30T12:00:00Z",
                    "ref": "A3 session-scoped gates",
                    "state": "gated",
                    "gate_id": "gate-123",
                    "gate_status": "open",
                    "attribution": "heuristic",
                }
            ]
        }
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=payload)
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{COMPLIANCE}/outstanding")

        assert resp.status_code == 200
        assert resp.json() == payload
        assert instance.get.call_args.args[0].endswith(
            "/coord/session-compliance/outstanding"
        )


class TestRestoreVersion:
    _PATH = f"{API_PREFIX}/coord/prompt-documents/policy/session-protocol/versions/4/restore"

    def test_forwards_change_note_only(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = _mock_response(
                json_data={"current_version": 9}
            )
            _configure_mock_client(MockClient, instance)

            resp = auth_client.post(
                self._PATH,
                json={
                    "change_note": "Restored from version 4",
                    "updated_by": "attacker@example.com",
                },
            )

        assert resp.status_code == 200
        called_url = instance.post.call_args.args[0]
        assert called_url.endswith(
            "/coord/prompt-documents/policy/session-protocol/versions/4/restore"
        )
        # Only the note rides along — coord derives the editor itself.
        assert instance.post.call_args.kwargs["json"] == {
            "change_note": "Restored from version 4"
        }

    def test_empty_body_is_accepted(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = _mock_response(
                json_data={"current_version": 9}
            )
            _configure_mock_client(MockClient, instance)

            resp = auth_client.post(self._PATH, json={})

        assert resp.status_code == 200
        assert instance.post.call_args.kwargs["json"] == {}

    def test_unknown_version_404_passes_through(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = _mock_response(
                status_code=404, text="unknown version"
            )
            _configure_mock_client(MockClient, instance)

            resp = auth_client.post(self._PATH, json={"change_note": "x"})

        assert resp.status_code == 404
