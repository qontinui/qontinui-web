"""Tests for ``POST /api/v1/operations/ci-status/notify-when-green``.

The endpoint proxies coord's ``POST /coord/gates/register``, hand-building
the ``RegisterGateRequest`` body. Plan
``2026-08-03-gate-class-producers-and-clearance-rules-inert`` Phase 3 adds
``gate_class`` to that body: coord accepts it as a freeform classification
string and its per-tenant ``gate_clearance`` policy matrix keys off it to
decide WHO MAY CLEAR the registered gate. Before P3, ``gate_class`` was not
declared on ``NotifyWhenGreenRequest`` and Pydantic's default (``extra="ignore"``)
dropped it silently — no 400, no log line — so a caller asking for a
``security-surface`` gate quietly got an unclassified one.

These tests pin both halves of the fix:

* the value reaches coord in the forwarded register body (and is OMITTED,
  not sent as an explicit ``null``, when unset);
* an unknown field is now a typed 422 rather than another silent swallow.

Mirrors the mocked-``httpx.AsyncClient`` pattern of
``test_operations_gates_proxy.py`` — no live coord needed.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

API_PREFIX = "/api/v1/operations"
NOTIFY_PATH = f"{API_PREFIX}/ci-status/notify-when-green"
GATE_ID = "77777777-7777-7777-7777-777777777777"


def _build_test_app() -> FastAPI:
    """Minimal FastAPI app exposing the operations router with auth stubbed."""
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
    resolved = uuid4()
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    test_app.dependency_overrides[get_tenant_id] = lambda: resolved
    test_app.dependency_overrides[require_coord_tenant_admin] = lambda: resolved
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


def _post(auth_client: TestClient, payload: dict):
    """POST ``payload`` with coord mocked; returns ``(response, mock_instance)``."""
    mock_resp = _mock_response(json_data={"gate_id": GATE_ID})
    with _patch_httpx() as MockClient:
        instance = AsyncMock()
        instance.post.return_value = mock_resp
        _configure_mock_client(MockClient, instance)
        resp = auth_client.post(NOTIFY_PATH, json=payload)
    return resp, instance


class TestNotifyWhenGreenGateClass:
    def test_gate_class_forwarded_to_coord(self, auth_client: TestClient):
        """A supplied ``gate_class`` reaches coord's register body verbatim."""
        resp, instance = _post(
            auth_client,
            {
                "repo": "qontinui/qontinui-web",
                "head_sha": "abc123",
                "gate_class": "security-surface",
            },
        )
        assert resp.status_code == 200
        assert resp.json() == {"gate_id": GATE_ID, "warnings": []}

        called_url = instance.post.call_args.args[0]
        assert called_url.endswith("/coord/gates/register")

        called_body = instance.post.call_args.kwargs.get("json") or {}
        assert called_body["gate_class"] == "security-surface"
        # The rest of the register body is unchanged by P3.
        assert called_body["claim_kind"] == "ci_notify"
        assert called_body["resource_key"] == "ci-notify:qontinui/qontinui-web"
        assert called_body["predicate"] == {
            "kind": "ci_green",
            "repo": "qontinui/qontinui-web",
            "head_sha": "abc123",
        }

    def test_gate_class_omitted_when_absent(self, auth_client: TestClient):
        """Unset ``gate_class`` is omitted, not sent as an explicit null.

        Coord treats omitted and null the same, but a clean body matches the
        ``continuation_spawn`` convention right above it in the handler.
        """
        resp, instance = _post(
            auth_client,
            {"repo": "qontinui/coord", "head_sha": "def456"},
        )
        assert resp.status_code == 200
        called_body = instance.post.call_args.kwargs.get("json") or {}
        assert "gate_class" not in called_body
        assert "continuation_spawn" not in called_body

    def test_gate_class_forwarded_alongside_continuation_prompt(
        self, auth_client: TestClient
    ):
        """``gate_class`` and ``continuation_spawn`` coexist in one body."""
        resp, instance = _post(
            auth_client,
            {
                "repo": "qontinui/coord",
                "head_sha": "feed01",
                "continuation_prompt": "resume the land watch",
                "gate_class": "routine-review",
            },
        )
        assert resp.status_code == 200
        called_body = instance.post.call_args.kwargs.get("json") or {}
        assert called_body["gate_class"] == "routine-review"
        assert called_body["continuation_spawn"] == {
            "initial_prompt": "resume the land watch",
        }


class TestNotifyWhenGreenRejectsBlankGateClass:
    """A blank class must not reach coord.

    Coord's ``normalize_gate_class`` trims + empty-filters, so ``""`` and
    ``"   "`` would register an UNCLASSIFIED gate under the default
    clearance authority with no 4xx and no warning — the same silent
    authorization downgrade P3 exists to close, moved one layer down.
    """

    @pytest.mark.parametrize("blank", ["", "   ", "\t\n"])
    def test_blank_gate_class_is_422_and_never_reaches_coord(
        self, auth_client: TestClient, blank: str
    ):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = _mock_response(json_data={"gate_id": GATE_ID})
            _configure_mock_client(MockClient, instance)
            resp = auth_client.post(
                NOTIFY_PATH,
                json={
                    "repo": "qontinui/qontinui-web",
                    "head_sha": "abc123",
                    "gate_class": blank,
                },
            )
        assert resp.status_code == 422
        instance.post.assert_not_called()

    def test_surrounding_whitespace_is_stripped_not_rejected(
        self, auth_client: TestClient
    ):
        """A padded but non-blank class is normalized, not refused."""
        resp, instance = _post(
            auth_client,
            {
                "repo": "qontinui/qontinui-web",
                "head_sha": "abc123",
                "gate_class": "  security-surface  ",
            },
        )
        assert resp.status_code == 200
        called_body = instance.post.call_args.kwargs.get("json") or {}
        assert called_body["gate_class"] == "security-surface"


class TestNotifyWhenGreenWarningsPassthrough:
    def test_coord_warnings_are_surfaced_to_the_caller(self, auth_client: TestClient):
        """coord's RegisterGateOutcome.warnings must not be filtered away.

        This endpoint is the fleet's only caller-supplied ``gate_class``
        producer, so it is the only transport that can tell a caller its
        requested class was not stored.
        """
        mock_resp = _mock_response(
            json_data={
                "gate_id": GATE_ID,
                "warnings": ["gate_class was not stored (column missing)"],
            }
        )
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = mock_resp
            _configure_mock_client(MockClient, instance)
            resp = auth_client.post(
                NOTIFY_PATH,
                json={
                    "repo": "qontinui/qontinui-web",
                    "head_sha": "abc123",
                    "gate_class": "security-surface",
                },
            )
        assert resp.status_code == 200
        assert resp.json()["warnings"] == ["gate_class was not stored (column missing)"]

    def test_warnings_defaults_to_empty_when_coord_omits_them(
        self, auth_client: TestClient
    ):
        resp, _instance = _post(
            auth_client,
            {"repo": "qontinui/qontinui-web", "head_sha": "abc123"},
        )
        assert resp.status_code == 200
        assert resp.json()["warnings"] == []


class TestNotifyWhenGreenRejectsUnknownFields:
    def test_unknown_field_is_422(self, auth_client: TestClient):
        """An unknown key is a typed 422, not a silent drop.

        This is the regression guard for the P3 defect class: the request
        model must never again swallow a field that changes an authorization
        outcome upstream.
        """
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = _mock_response(json_data={"gate_id": GATE_ID})
            _configure_mock_client(MockClient, instance)
            resp = auth_client.post(
                NOTIFY_PATH,
                json={
                    "repo": "qontinui/qontinui-web",
                    "head_sha": "abc123",
                    "gate_klass": "security-surface",  # typo'd key
                },
            )
        assert resp.status_code == 422
        # The request is rejected BEFORE any coord call is made.
        instance.post.assert_not_called()
        assert "gate_klass" in resp.text

    def test_valid_body_still_accepted(self, auth_client: TestClient):
        """``extra="forbid"`` does not break the in-tree caller's payload.

        ``CiStatusPanel.tsx`` sends exactly ``repo`` + ``head_sha``.
        """
        resp, _instance = _post(
            auth_client,
            {"repo": "qontinui/qontinui-web", "head_sha": "abc123"},
        )
        assert resp.status_code == 200
