"""Integration tests for the coord findings proxy (``/operations/coord/findings``).

Backs ``/admin/coord/findings`` — the reader the landed-write feed's
``finding_only`` reasoning reference links into. The frontend never calls coord
directly, so the chain is
``frontend → /api/v1/operations/coord/findings → coord /coord/findings`` and
this proxy is what decides whether coord's SIX accepted query keys
(``finding_id``, ``resource_keys``, ``topic``, ``kind``, ``limit``,
``triaged``) actually reach the store.

Plan ``2026-09-15-the-console-names-a-finding-it-cannot-open``, Phase 2.

Mirrors the testing pattern in ``test_operations_claims_proxy.py``: minimal
FastAPI app + mocked ``httpx.AsyncClient`` so no live coord is needed. The
cross-tenant isolation test is the binding lesson from prior coord read-auth
work: the tenant is derived server-side from the authenticated operator (coord
resolves it from the forwarded bearer), and a client-supplied
``?tenant_id=<other>`` must NEVER influence the upstream coord call.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

TEST_TENANT_ID = uuid4()

API_PREFIX = "/api/v1/operations"
FINDINGS_URL = f"{API_PREFIX}/coord/findings"


def _build_test_app(*, server_tenant=None, authenticated: bool = True) -> FastAPI:
    """Build a minimal FastAPI app exposing the operations router."""
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import get_tenant_id
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    if authenticated:
        mock_user = MagicMock()
        mock_user.id = uuid4()
        mock_user.email = "testuser@example.com"
        mock_user.is_active = True
        mock_user.is_verified = True
        test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
        resolved = server_tenant if server_tenant is not None else TEST_TENANT_ID
        test_app.dependency_overrides[get_tenant_id] = lambda: resolved
    test_app.include_router(operations_router, prefix="/api/v1/operations")
    return test_app


@pytest.fixture()
def auth_client() -> TestClient:
    return TestClient(_build_test_app(authenticated=True))


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


FINDING_ROW = {
    "artifact_refs": {"dossier_slug": "worktree-sibling-build-dependency"},
    "author_session": "session:9f1e",
    "body": "The console printed the uuid and nothing could open it.",
    "created_at": "2026-09-15T09:00:00Z",
    "expires_at": "2026-09-29T09:00:00Z",
    "finding_id": "fec41291-67ed-4cf8-b331-888ad1126b45",
    "kind": "observation",
    "resource_keys": ["repo:qontinui-web"],
    "scope": "tenant",
    "supersedes": None,
    "tenant_id": str(TEST_TENANT_ID),
    "title": "A created document sends no notice",
    "topic": "prompt-documents",
    "triaged_at": None,
    "triaged_by": None,
}

FINDINGS_PAGE = {
    "available": True,
    "count": 1,
    "findings": [FINDING_ROW],
    "finding_id_applied": None,
    "kind_applied": None,
    "limit": 50,
    # coord's shapes: a COUNT of applied resource keys, and the triage filter's
    # wire spelling ("any" | "false" | "true").
    "resource_keys_applied": 0,
    "resource_keys_truncated": False,
    "triaged_applied": "any",
}


class TestGetCoordFindings:
    """``GET /operations/coord/findings`` — the verbatim forward."""

    def test_returns_the_page_and_forwards_no_params_when_none_are_set(
        self, auth_client: TestClient
    ):
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(
                return_value=_mock_response(200, FINDINGS_PAGE)
            )
            _configure_mock_client(MockClient, mock_instance)

            resp = auth_client.get(FINDINGS_URL)

        assert resp.status_code == 200
        assert resp.json() == FINDINGS_PAGE
        call = mock_instance.get.call_args
        assert call.args[0].endswith("/coord/findings")
        # No key set ⇒ no query string at all. A proxy that sent
        # `{"limit": None}` would make coord clamp against a null.
        assert call.kwargs["params"] is None

    def test_forwards_every_one_of_the_six_accepted_keys(self, auth_client: TestClient):
        """All six, in one request — the property the plan is about.

        Dropping any single one re-creates, one layer up, the ignored-filter
        defect this proxy exists to avoid: the page would ask for a narrowed
        read and silently be served the unfiltered one.
        """
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(
                return_value=_mock_response(200, FINDINGS_PAGE)
            )
            _configure_mock_client(MockClient, mock_instance)

            resp = auth_client.get(
                FINDINGS_URL,
                params=[
                    ("finding_id", "fec41291-67ed-4cf8-b331-888ad1126b45"),
                    ("resource_keys", "repo:qontinui-web"),
                    ("resource_keys", "repo:qontinui-coord"),
                    ("topic", "prompt-documents"),
                    ("kind", "observation"),
                    ("limit", "25"),
                    ("triaged", "false"),
                ],
            )

        assert resp.status_code == 200
        params = mock_instance.get.call_args.kwargs["params"]
        assert params["finding_id"] == "fec41291-67ed-4cf8-b331-888ad1126b45"
        # A LIST, so httpx re-encodes it as a repeated key rather than as the
        # literal `['a', 'b']` a pre-stringified value would send.
        assert params["resource_keys"] == [
            "repo:qontinui-web",
            "repo:qontinui-coord",
        ]
        assert params["topic"] == "prompt-documents"
        assert params["kind"] == "observation"
        assert params["limit"] == 25
        assert params["triaged"] is False
        assert set(params) == {
            "finding_id",
            "resource_keys",
            "topic",
            "kind",
            "limit",
            "triaged",
        }

    def test_forwards_only_the_keys_the_caller_set(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(
                return_value=_mock_response(200, FINDINGS_PAGE)
            )
            _configure_mock_client(MockClient, mock_instance)

            resp = auth_client.get(FINDINGS_URL, params={"topic": "coord"})

        assert resp.status_code == 200
        assert mock_instance.get.call_args.kwargs["params"] == {"topic": "coord"}

    def test_triaged_false_is_forwarded_and_not_swallowed_as_falsy(
        self, auth_client: TestClient
    ):
        """``triaged=false`` is the narrowing filter, so a falsy-check drops it.

        `if triaged:` would forward only `true` and silently serve the
        unfiltered feed for the filter the operator actually reaches for.
        """
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(
                return_value=_mock_response(200, FINDINGS_PAGE)
            )
            _configure_mock_client(MockClient, mock_instance)

            resp = auth_client.get(FINDINGS_URL, params={"triaged": "false"})

        assert resp.status_code == 200
        assert mock_instance.get.call_args.kwargs["params"] == {"triaged": False}

    def test_drops_a_key_coord_does_not_accept(self, auth_client: TestClient):
        """An undeclared key never reaches coord.

        FastAPI ignores query keys the signature does not declare, so the
        vocabulary this hop forwards is exactly the six. Coord still owns the
        typed `unknown_query_parameter` refusal for anything that reaches it by
        another door — this proxy adds no second validator.
        """
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(
                return_value=_mock_response(200, FINDINGS_PAGE)
            )
            _configure_mock_client(MockClient, mock_instance)

            resp = auth_client.get(
                FINDINGS_URL,
                params={"topic": "coord", "expired": "true", "cursor": "abc"},
            )

        assert resp.status_code == 200
        assert mock_instance.get.call_args.kwargs["params"] == {"topic": "coord"}

    def test_a_client_supplied_tenant_id_never_reaches_coord(
        self, auth_client: TestClient
    ):
        """Cross-tenant isolation: the tenant is server-resolved, never asked for."""
        other_tenant = uuid4()
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(
                return_value=_mock_response(200, FINDINGS_PAGE)
            )
            _configure_mock_client(MockClient, mock_instance)

            resp = auth_client.get(
                FINDINGS_URL, params={"tenant_id": str(other_tenant)}
            )

        assert resp.status_code == 200
        params = mock_instance.get.call_args.kwargs["params"]
        assert params is None or "tenant_id" not in params
        headers = mock_instance.get.call_args.kwargs.get("headers") or {}
        assert str(other_tenant) not in str(headers)

    def test_requires_authentication(self):
        client = TestClient(_build_test_app(authenticated=False))
        resp = client.get(FINDINGS_URL)
        assert resp.status_code in (401, 403)


class TestCoordFindingsDegrade:
    """The absent-surface arms — a degrade, never an empty store."""

    def test_404_reads_as_not_deployed_rather_than_no_findings(
        self, auth_client: TestClient
    ):
        """Coord's `/coord/findings` twin lands in a separate PR.

        A 404 in that window must not render as "there are no findings" —
        that is `silent-empty-is-unknown` made in an HTTP status.
        """
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(
                return_value=_mock_response(404, None, text="not found")
            )
            _configure_mock_client(MockClient, mock_instance)

            resp = auth_client.get(FINDINGS_URL)

        assert resp.status_code == 200
        body = resp.json()
        assert body["available"] is False
        assert body["findings"] == []
        assert body["count"] == 0
        assert body["unavailable_kind"] == "not_deployed"
        assert "not the same as there being none" in body["unavailable"]

    def test_503_reads_as_unreachable(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(
                return_value=_mock_response(503, None, text="unavailable")
            )
            _configure_mock_client(MockClient, mock_instance)

            resp = auth_client.get(FINDINGS_URL)

        assert resp.status_code == 200
        body = resp.json()
        assert body["unavailable_kind"] == "unreachable"
        assert "503" in body["unavailable"]

    def test_connect_error_degrades_rather_than_502ing(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(side_effect=httpx.ConnectError("no route"))
            _configure_mock_client(MockClient, mock_instance)

            resp = auth_client.get(FINDINGS_URL)

        assert resp.status_code == 200
        assert resp.json()["unavailable_kind"] == "unreachable"

    def test_coord_400_is_passed_through_verbatim(self, auth_client: TestClient):
        """Coord's typed refusal is the SINGLE refusal — this hop re-raises it.

        A 400 is not an absent surface, so it must not be dressed as a degrade:
        `unknown_query_parameter` names the key and the accepted set, and that
        message is the whole value of letting coord own the vocabulary.
        """
        with _patch_httpx() as MockClient:
            mock_instance = MagicMock()
            mock_instance.get = AsyncMock(
                return_value=_mock_response(
                    400,
                    None,
                    text=(
                        '{"error":"invalid_query_parameter","invalid":["finding_id"]}'
                    ),
                )
            )
            _configure_mock_client(MockClient, mock_instance)

            resp = auth_client.get(FINDINGS_URL, params={"finding_id": "not-a-uuid"})

        assert resp.status_code == 400
        assert "invalid_query_parameter" in resp.text
