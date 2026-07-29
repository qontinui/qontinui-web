"""Integration tests for the coord prompt-documents proxy endpoints.

These endpoints (under ``/api/v1/operations/coord/prompt-documents``) forward
coord's versioned prompt-document CRUD (coord ``src/prompt_documents.rs``) so the
``/admin/coord/prompt-documents`` editor renders without the browser hitting
coord cross-origin.

Plan ``2026-07-17-session-autonomy-fabric.md`` Phase 9.

Mirrors the testing pattern in ``test_operations_claims_proxy.py``: a minimal
FastAPI app + a mocked ``httpx.AsyncClient``, so no live coord is needed.

The behaviours that matter here, and why:

* the ``(kind, name)`` address and the ``?kind=`` list filter reach coord intact;
* ``updated_by`` on a PATCH is stamped from the SESSION, never from the body —
  the version history is an audit trail, so a browser must not be able to forge
  the editor tag;
* coord's 4xx bodies (unknown kind, not-found, the ``degraded`` store-absent 404
  of the D1 deploy-ordering window) pass through verbatim rather than becoming
  a 500 — the UI renders coord's honest state.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

# Fixed operator tenant + identity so tests can assert what the proxy forwards.
TEST_TENANT_ID = uuid4()
TEST_USER_ID = uuid4()
TEST_USER_EMAIL = "editor@example.com"

API_PREFIX = "/api/v1/operations"


def _build_test_app(*, user_email: str | None = TEST_USER_EMAIL) -> FastAPI:
    """Minimal FastAPI app exposing the operations router with the coord
    identity dependencies overridden (no real DB/coord for tenant resolution)."""
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import (
        get_tenant_id,
        require_coord_tenant_admin,
    )
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = TEST_USER_ID
    mock_user.email = user_email
    mock_user.is_active = True
    mock_user.is_verified = True
    mock_user.is_superuser = True
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    test_app.dependency_overrides[get_tenant_id] = lambda: TEST_TENANT_ID
    test_app.dependency_overrides[require_coord_tenant_admin] = lambda: TEST_TENANT_ID
    test_app.include_router(operations_router, prefix=API_PREFIX)
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


def _doc(**overrides):
    doc = {
        "id": "11111111-1111-1111-1111-111111111111",
        "tenant_id": str(TEST_TENANT_ID),
        "kind": "policy",
        "name": "engineering-priorities",
        "description": "Engineering Priorities",
        "body": "Prefer the stronger design.",
        "format": "markdown",
        "default_source": "prompt_doc/policy/engineering-priorities/v1",
        "current_version": 3,
        "updated_by": "editor@example.com",
        "updated_at": "2026-07-17T00:00:00Z",
    }
    doc.update(overrides)
    return doc


# ---------------------------------------------------------------------------
# GET /operations/coord/prompt-documents
# ---------------------------------------------------------------------------


class TestListPromptDocuments:
    def test_returns_documents(self, auth_client: TestClient):
        coord_payload = {"documents": [_doc()], "total": 1}
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=coord_payload)
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{API_PREFIX}/coord/prompt-documents")

        assert resp.status_code == 200
        assert resp.json() == coord_payload
        assert instance.get.call_args.args[0].endswith("/coord/prompt-documents")

    def test_kind_filter_forwarded(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                json_data={"documents": [], "total": 0}
            )
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(
                f"{API_PREFIX}/coord/prompt-documents?kind=agent_playbook"
            )

        assert resp.status_code == 200
        assert instance.get.call_args.kwargs.get("params") == {"kind": "agent_playbook"}

    def test_no_kind_filter_sends_no_params(self, auth_client: TestClient):
        """An unfiltered list must not send ``kind=None`` — coord would 400 it
        as an unknown kind."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                json_data={"documents": [], "total": 0}
            )
            _configure_mock_client(MockClient, instance)

            auth_client.get(f"{API_PREFIX}/coord/prompt-documents")

        assert instance.get.call_args.kwargs.get("params") is None

    def test_unknown_kind_400_passed_through(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                status_code=400, text='{"error":"unknown kind `bogus`"}'
            )
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{API_PREFIX}/coord/prompt-documents?kind=bogus")

        assert resp.status_code == 400
        assert "unknown kind" in resp.json()["detail"]

    def test_degraded_envelope_passes_through(self, auth_client: TestClient):
        """Coord returns an empty list + a ``degraded`` note while the store is
        not yet provisioned (D1 window). The proxy must forward that honesty
        rather than flattening it to a bare empty list."""
        coord_payload = {
            "documents": [],
            "total": 0,
            "degraded": "prompt-document store not provisioned in this database yet",
        }
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=coord_payload)
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{API_PREFIX}/coord/prompt-documents")

        assert resp.json() == coord_payload

    def test_coord_unreachable_returns_502(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.ConnectError("refused")
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{API_PREFIX}/coord/prompt-documents")

        assert resp.status_code == 502
        assert resp.json()["detail"] == "coord is not reachable"

    def test_coord_timeout_returns_504(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.TimeoutException("slow")
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{API_PREFIX}/coord/prompt-documents")

        assert resp.status_code == 504


# ---------------------------------------------------------------------------
# GET /operations/coord/prompt-documents/{kind}/{name}
# ---------------------------------------------------------------------------


class TestGetPromptDocument:
    def test_returns_document_with_body(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=_doc())
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(
                f"{API_PREFIX}/coord/prompt-documents/policy/engineering-priorities"
            )

        assert resp.status_code == 200
        assert resp.json()["body"] == "Prefer the stronger design."
        assert instance.get.call_args.args[0].endswith(
            "/coord/prompt-documents/policy/engineering-priorities"
        )

    def test_not_found_passed_through(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                status_code=404, text='{"error":"prompt document not found"}'
            )
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{API_PREFIX}/coord/prompt-documents/policy/nope")

        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# PATCH /operations/coord/prompt-documents/{kind}/{name}
# ---------------------------------------------------------------------------


class TestUpdatePromptDocument:
    def test_forwards_edit_and_stamps_session_identity(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.patch.return_value = _mock_response(
                json_data=_doc(body="new prose", current_version=4)
            )
            _configure_mock_client(MockClient, instance)

            resp = auth_client.patch(
                f"{API_PREFIX}/coord/prompt-documents/policy/engineering-priorities",
                json={"body": "new prose", "change_description": "sharpen wording"},
            )

        assert resp.status_code == 200
        assert resp.json()["current_version"] == 4
        sent = instance.patch.call_args.kwargs["json"]
        assert sent["body"] == "new prose"
        assert sent["change_description"] == "sharpen wording"
        # The editing user rides along so coord tags the version row.
        assert sent["updated_by"] == TEST_USER_EMAIL

    def test_body_supplied_updated_by_is_overridden(self, auth_client: TestClient):
        """The audit trail must record the authenticated editor — a browser
        claiming someone else's name is ignored, not honoured."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.patch.return_value = _mock_response(json_data=_doc())
            _configure_mock_client(MockClient, instance)

            auth_client.patch(
                f"{API_PREFIX}/coord/prompt-documents/policy/engineering-priorities",
                json={"body": "x", "updated_by": "somebody-else@evil.example"},
            )

        assert instance.patch.call_args.kwargs["json"]["updated_by"] == TEST_USER_EMAIL

    def test_identity_falls_back_to_user_id_without_email(self):
        client = TestClient(_build_test_app(user_email=None))
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.patch.return_value = _mock_response(json_data=_doc())
            _configure_mock_client(MockClient, instance)

            client.patch(
                f"{API_PREFIX}/coord/prompt-documents/policy/engineering-priorities",
                json={"body": "x"},
            )

        assert (
            instance.patch.call_args.kwargs["json"]["updated_by"]
            == f"user:{TEST_USER_ID}"
        )

    def test_attrs_only_patch_forwarded_with_identity(self, auth_client: TestClient):
        """An attrs-only edit (the category default-tier editor's payload) is a
        legal PATCH: the proxy is an untyped passthrough, so ``attrs`` reaches
        coord verbatim with ``updated_by`` stamped — never rejected locally for
        lacking ``description``/``body``."""
        attrs = {"default_tier": "ask-first"}
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.patch.return_value = _mock_response(json_data=_doc(attrs=attrs))
            _configure_mock_client(MockClient, instance)

            resp = auth_client.patch(
                f"{API_PREFIX}/coord/prompt-documents/policy/engineering-priorities",
                json={"attrs": attrs},
            )

        assert resp.status_code == 200
        assert resp.json()["attrs"] == attrs
        sent = instance.patch.call_args.kwargs["json"]
        assert sent["attrs"] == attrs
        assert sent["updated_by"] == TEST_USER_EMAIL
        # attrs-only means exactly that — the proxy invents no content fields.
        assert "description" not in sent
        assert "body" not in sent

    def test_coord_400_passed_through(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.patch.return_value = _mock_response(
                status_code=400, text='{"error":"body must be non-empty"}'
            )
            _configure_mock_client(MockClient, instance)

            resp = auth_client.patch(
                f"{API_PREFIX}/coord/prompt-documents/policy/engineering-priorities",
                json={"body": "  "},
            )

        assert resp.status_code == 400
        assert "body must be non-empty" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# Versions
# ---------------------------------------------------------------------------


class TestPromptDocumentVersions:
    def test_lists_versions(self, auth_client: TestClient):
        coord_payload = {
            "document_id": "11111111-1111-1111-1111-111111111111",
            "kind": "policy",
            "name": "engineering-priorities",
            "current_version": 2,
            "versions": [
                {
                    "id": "22222222-2222-2222-2222-222222222222",
                    "version_number": 2,
                    "description": "sharpen wording",
                    "edited_by": TEST_USER_EMAIL,
                    "created_at": "2026-07-17T00:00:00Z",
                },
            ],
            "total": 1,
        }
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=coord_payload)
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(
                f"{API_PREFIX}/coord/prompt-documents/policy/"
                "engineering-priorities/versions"
            )

        assert resp.status_code == 200
        assert resp.json() == coord_payload
        assert instance.get.call_args.args[0].endswith(
            "/coord/prompt-documents/policy/engineering-priorities/versions"
        )

    def test_gets_one_version_snapshot(self, auth_client: TestClient):
        snapshot = {
            "id": "22222222-2222-2222-2222-222222222222",
            "document_id": "11111111-1111-1111-1111-111111111111",
            "version_number": 1,
            "body": "the original prose",
            "description": None,
            "edited_by": "system",
            "created_at": "2026-07-16T00:00:00Z",
        }
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=snapshot)
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(
                f"{API_PREFIX}/coord/prompt-documents/policy/"
                "engineering-priorities/versions/1"
            )

        assert resp.status_code == 200
        assert resp.json()["body"] == "the original prose"
        assert instance.get.call_args.args[0].endswith(
            "/coord/prompt-documents/policy/engineering-priorities/versions/1"
        )

    def test_non_integer_version_is_422(self, auth_client: TestClient):
        """The version path segment is typed ``int`` — a junk segment is
        rejected at the web edge rather than proxied to coord."""
        resp = auth_client.get(
            f"{API_PREFIX}/coord/prompt-documents/policy/"
            "engineering-priorities/versions/latest"
        )
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# POST /operations/coord/prompt-documents/{kind}/{name}/restore-default
# ---------------------------------------------------------------------------


class TestRestorePromptDocumentDefault:
    def test_proxies_restore(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = _mock_response(
                json_data=_doc(body="the shipped default", current_version=5)
            )
            _configure_mock_client(MockClient, instance)

            resp = auth_client.post(
                f"{API_PREFIX}/coord/prompt-documents/policy/"
                "engineering-priorities/restore-default"
            )

        assert resp.status_code == 200
        assert resp.json()["body"] == "the shipped default"
        assert instance.post.call_args.args[0].endswith(
            "/coord/prompt-documents/policy/engineering-priorities/restore-default"
        )
        # Coord derives the default from the row's own default_source.
        assert instance.post.call_args.kwargs["json"] == {}

    def test_no_default_4xx_passed_through(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = _mock_response(
                status_code=404, text='{"error":"prompt document not found"}'
            )
            _configure_mock_client(MockClient, instance)

            resp = auth_client.post(
                f"{API_PREFIX}/coord/prompt-documents/policy/nope/restore-default"
            )

        assert resp.status_code == 404
