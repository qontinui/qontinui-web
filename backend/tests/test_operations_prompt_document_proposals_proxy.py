"""Integration tests for the policy-edit proposal + landed-write proxy endpoints.

Plan ``2026-07-28-migrate-claude-md-into-qontinui.md`` Phase 5. These endpoints
(under ``/api/v1/operations/coord/prompt-document-proposals`` and
``…/coord/prompt-document-writes``) back the ``/admin/coord/prompt-document-proposals``
operator review feed.

Mirrors ``test_operations_prompt_documents_proxy.py``: a minimal FastAPI app +
a mocked ``httpx.AsyncClient``, so no live coord is needed.

The behaviours that matter here, and why:

* ``decided_by`` is stamped from the SESSION and the client body is reduced to
  ``decision_note`` alone — a browser must not be able to choose who a decision
  is attributed to, nor smuggle ``status``/``tenant_id`` past the proxy;
* the LIST route degrades to an explicit ``unavailable`` note while coord's
  Phase 5 half is undeployed (its route 404s), because an unreadable queue
  rendered as an empty one is the exact failure the review feed exists to
  prevent;
* approve/reject deliberately do NOT degrade — a decision that silently no-ops
  is worse than an error;
* the landed-write feed aggregates the EXISTING per-document versions route,
  orders newest-first across documents, and reports partial results rather than
  failing wholesale when one document's history is unreadable.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

TEST_TENANT_ID = uuid4()
TEST_USER_ID = uuid4()
TEST_USER_EMAIL = "operator@example.com"

API_PREFIX = "/api/v1/operations"
PROPOSALS = f"{API_PREFIX}/coord/prompt-document-proposals"
WRITES = f"{API_PREFIX}/coord/prompt-document-writes"


def _build_test_app() -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import (
        get_tenant_id,
        require_coord_tenant_admin,
    )
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = TEST_USER_ID
    mock_user.email = TEST_USER_EMAIL
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


def _proposal(**overrides):
    row = {
        "id": "22222222-2222-2222-2222-222222222222",
        "doc_kind": "policy",
        "doc_name": "production-and-cost",
        "clause_id": "agent-spawn-authorization",
        "proposed_content": "Agents may spawn fan-outs without asking.",
        "direction": "loosening",
        "from_tier": "ask-first",
        "to_tier": "proceed",
        "rationale": "The ask-first round trip dominates wall-clock.",
        "proposed_by": "agent:merge-shepherd",
        "base_version": 4,
        "status": "pending",
        "created_at": "2026-07-28T10:00:00Z",
    }
    row.update(overrides)
    return row


# ---------------------------------------------------------------------------
# GET /operations/coord/prompt-document-proposals
# ---------------------------------------------------------------------------


class TestListProposals:
    def test_returns_proposals_and_forwards_status_filter(
        self, auth_client: TestClient
    ):
        coord_payload = {"proposals": [_proposal()], "total": 1}
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=coord_payload)
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{PROPOSALS}?status=approved")

        assert resp.status_code == 200
        assert resp.json() == coord_payload
        assert instance.get.call_args.args[0].endswith(
            "/coord/prompt-document-proposals"
        )
        assert instance.get.call_args.kwargs["params"] == {"status": "approved"}

    def test_defaults_to_pending(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(
                json_data={"proposals": [], "total": 0}
            )
            _configure_mock_client(MockClient, instance)

            auth_client.get(PROPOSALS)

        assert instance.get.call_args.kwargs["params"] == {"status": "pending"}

    def test_coord_404_degrades_to_unavailable_not_empty_queue(
        self, auth_client: TestClient
    ):
        """Before coord's Phase 5 deploy the route 404s. The page must be able to
        say "cannot see" rather than "nothing pending"."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(404, text="not found")
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(PROPOSALS)

        assert resp.status_code == 200
        body = resp.json()
        assert body["proposals"] == []
        assert "unavailable" in body and body["unavailable"]

    def test_coord_unreachable_degrades(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = httpx.ConnectError("no route")
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(PROPOSALS)

        assert resp.status_code == 200
        assert "unavailable" in resp.json()

    def test_coord_400_still_surfaces(self, auth_client: TestClient):
        """Only absence degrades. A real coord rejection stays an error."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(400, text="unknown status")
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{PROPOSALS}?status=bogus")

        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# POST …/{id}/approve  |  …/{id}/reject
# ---------------------------------------------------------------------------


class TestDecideProposal:
    @pytest.mark.parametrize("action", ["approve", "reject"])
    def test_decided_by_is_session_identity_and_body_is_reduced(
        self, auth_client: TestClient, action: str
    ):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = _mock_response(
                json_data={"current_version": 5}
            )
            _configure_mock_client(MockClient, instance)

            resp = auth_client.post(
                f"{PROPOSALS}/{_proposal()['id']}/{action}",
                json={
                    "decision_note": "Agreed after review.",
                    # Everything below is a forgery attempt and must be dropped.
                    "decided_by": "someone-else@example.com",
                    "status": "approved",
                    "tenant_id": str(uuid4()),
                },
            )

        assert resp.status_code == 200
        forwarded = instance.post.call_args.kwargs["json"]
        assert forwarded == {
            "decision_note": "Agreed after review.",
            "decided_by": TEST_USER_EMAIL,
        }
        assert instance.post.call_args.args[0].endswith(f"/{action}")

    def test_missing_body_is_allowed(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = _mock_response(json_data={})
            _configure_mock_client(MockClient, instance)

            resp = auth_client.post(f"{PROPOSALS}/{_proposal()['id']}/reject")

        assert resp.status_code == 200
        assert instance.post.call_args.kwargs["json"] == {
            "decision_note": None,
            "decided_by": TEST_USER_EMAIL,
        }

    def test_coord_404_does_not_degrade(self, auth_client: TestClient):
        """A decision that silently no-ops would be worse than an error."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.post.return_value = _mock_response(404, text="no such proposal")
            _configure_mock_client(MockClient, instance)

            resp = auth_client.post(f"{PROPOSALS}/{_proposal()['id']}/approve")

        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# GET /operations/coord/prompt-document-writes
# ---------------------------------------------------------------------------


def _versions_payload(current_version: int, versions: list[dict]) -> dict:
    return {"current_version": current_version, "versions": versions}


class TestListWrites:
    def test_merges_and_orders_newest_first(self, auth_client: TestClient):
        documents = {
            "documents": [
                {
                    "kind": "policy",
                    "name": "alpha",
                    "description": "Alpha",
                    "updated_at": "2026-07-28T12:00:00Z",
                },
                {
                    "kind": "policy",
                    "name": "beta",
                    "description": None,
                    "updated_at": "2026-07-27T12:00:00Z",
                },
            ],
            "total": 2,
        }
        alpha = _versions_payload(
            2,
            [
                {
                    "version_number": 2,
                    "description": "agent append",
                    "edited_by": "agent:x",
                    "created_at": "2026-07-28T12:00:00Z",
                }
            ],
        )
        beta = _versions_payload(
            1,
            [
                {
                    "version_number": 1,
                    "description": None,
                    "edited_by": "operator@example.com",
                    "created_at": "2026-07-29T12:00:00Z",
                }
            ],
        )

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = [
                _mock_response(json_data=documents),
                _mock_response(json_data=alpha),
                _mock_response(json_data=beta),
            ]
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(WRITES)

        assert resp.status_code == 200
        body = resp.json()
        assert [w["name"] for w in body["writes"]] == ["beta", "alpha"]
        # Label falls back to the slug when the document has no description.
        assert body["writes"][0]["label"] == "beta"
        assert body["writes"][1]["label"] == "Alpha"
        assert body["writes"][1]["current_version"] == 2
        assert "partial" not in body

    def test_one_bad_document_reports_partial_rather_than_failing(
        self, auth_client: TestClient
    ):
        documents = {
            "documents": [
                {
                    "kind": "policy",
                    "name": "alpha",
                    "description": "Alpha",
                    "updated_at": "2026-07-28T12:00:00Z",
                },
                {
                    "kind": "policy",
                    "name": "beta",
                    "description": "Beta",
                    "updated_at": "2026-07-27T12:00:00Z",
                },
            ],
            "total": 2,
        }
        ok = _versions_payload(
            1,
            [
                {
                    "version_number": 1,
                    "description": None,
                    "edited_by": None,
                    "created_at": "2026-07-28T12:00:00Z",
                }
            ],
        )

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = [
                _mock_response(json_data=documents),
                _mock_response(json_data=ok),
                _mock_response(500, text="boom"),
            ]
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(WRITES)

        assert resp.status_code == 200
        body = resp.json()
        assert len(body["writes"]) == 1
        assert "partial" in body

    def test_ceiling_is_reported_not_applied_silently(self, auth_client: TestClient):
        """Crossing the fan-out ceiling drops documents, so it must be SAID.

        The tempting "newest ``updated_at`` first, then cap" shortcut is unsound
        — coord's attrs-only PATCH bumps ``updated_at`` without inserting a
        version — so a dropped document really can own a newer write. The one
        thing that must never happen is dropping it quietly.
        """
        documents = {
            "documents": [
                {
                    "kind": "policy",
                    "name": f"doc-{i}",
                    "description": None,
                    "updated_at": f"2026-07-2{i}T12:00:00Z",
                }
                for i in range(2)
            ],
            "total": 2,
        }
        one = _versions_payload(
            1,
            [
                {
                    "version_number": 1,
                    "description": None,
                    "edited_by": None,
                    "created_at": "2026-07-28T12:00:00Z",
                }
            ],
        )

        with (
            patch(
                "app.api.v1.endpoints.operations._WRITE_FEED_DOCUMENT_CEILING",
                1,
            ),
            _patch_httpx() as MockClient,
        ):
            instance = AsyncMock()
            instance.get.side_effect = [
                _mock_response(json_data=documents),
                _mock_response(json_data=one),
            ]
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(WRITES)

        assert resp.status_code == 200
        body = resp.json()
        assert len(body["writes"]) == 1
        assert "truncated" in body and "1 documents" in body["truncated"]

    def test_document_list_404_degrades(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(404, text="not found")
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(WRITES)

        assert resp.status_code == 200
        body = resp.json()
        assert body["writes"] == []
        assert "unavailable" in body

    def test_limit_truncates_after_ordering(self, auth_client: TestClient):
        documents = {
            "documents": [
                {
                    "kind": "policy",
                    "name": "alpha",
                    "description": "Alpha",
                    "updated_at": "2026-07-28T12:00:00Z",
                }
            ],
            "total": 1,
        }
        alpha = _versions_payload(
            3,
            [
                {
                    "version_number": 3,
                    "description": None,
                    "edited_by": None,
                    "created_at": "2026-07-28T12:00:00Z",
                },
                {
                    "version_number": 2,
                    "description": None,
                    "edited_by": None,
                    "created_at": "2026-07-27T12:00:00Z",
                },
            ],
        )

        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.side_effect = [
                _mock_response(json_data=documents),
                _mock_response(json_data=alpha),
            ]
            _configure_mock_client(MockClient, instance)

            resp = auth_client.get(f"{WRITES}?limit=1")

        body = resp.json()
        assert len(body["writes"]) == 1
        assert body["writes"][0]["version_number"] == 3
        # `total` reports what was collected, not what was returned.
        assert body["total"] == 2
