"""Integration tests for the coord dossiers proxy (``/operations/coord/dossiers``).

Backs ``/admin/coord/dossiers``. The chain is
``frontend → /api/v1/operations/coord/dossiers → coord /coord/dossiers``, and
this proxy decides whether coord's eighteen accepted query keys
(``DOSSIER_QUERY_KEYS`` in ``findings/dossiers.rs``) actually reach the door.

Plan ``2026-10-03-dossier-query-door-filters-sort-cursor``, Phase 5. Same
harness as ``test_operations_findings_proxy.py``: a minimal FastAPI app and a
mocked ``httpx.AsyncClient``, so no live coord is needed.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

TEST_TENANT_ID = uuid4()

DOSSIERS_URL = "/api/v1/operations/coord/dossiers"


def _build_test_app(*, authenticated: bool = True) -> FastAPI:
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
        test_app.dependency_overrides[get_tenant_id] = lambda: TEST_TENANT_ID
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


def _client_returning(MockClient, response) -> MagicMock:
    mock_instance = MagicMock()
    if isinstance(response, BaseException):
        mock_instance.get = AsyncMock(side_effect=response)
    else:
        mock_instance.get = AsyncMock(return_value=response)
    mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
    mock_instance.__aexit__ = AsyncMock(return_value=False)
    MockClient.return_value = mock_instance
    return mock_instance


DOSSIER_ROW = {
    "finding_id": "fec41291-67ed-4cf8-b331-888ad1126b45",
    "slug": "worktree-sibling-build-dependency",
    "title": "DOSSIER worktree-sibling-build-dependency",
    "readiness": "ready_for_pvi",
    "recurrence_count": 27,
    "first_seen": "2026-06-01",
    "last_seen": "2026-10-20",
    "updated_at": "2026-10-20T09:00:00Z",
    "remediations": [
        {
            "plan": "2026-08-27-coord-allocate-provisions-sibling-build-dependencies",
            "ledger_status": "IN PROGRESS",
            "live_status": "shipped",
            "held": None,
        }
    ],
    "remediation_state": "shipped",
    "has_open_remediation": True,
    "scope": "tenant",
}

DOSSIERS_PAGE = {
    "available": True,
    "count": 1,
    "dossiers": [DOSSIER_ROW],
    "facets": {
        "readiness": {"ready_for_pvi": 1},
        "remediation_state": {
            "none": 0,
            "draft": 0,
            "vetted": 0,
            "in_progress": 0,
            "shipped": 1,
            "closed": 0,
            "unknown": 0,
        },
    },
    "facets_scope": "match_set_without_own_filter",
    "dedup": "newest_live_head_per_slug",
    "truncated": False,
    "bound_kind": "complete",
    "next_cursor": None,
    "total": 1,
    "shown": 1,
    "limit": 20,
    "filter_narrowed": None,
    "enumerate_via": None,
    "sort_applied": "last_seen",
    "order_applied": "desc",
}


def _assert_unknown_envelope(body: dict) -> None:
    """Every envelope key present and UNKNOWN — an absent ``truncated`` reads as
    "complete" to a careless client, and absent facets as "zero of each"."""
    assert body["available"] is False
    assert body["dossiers"] == []
    assert body["bound_kind"] == "unknown"
    assert body["shown"] == 0
    for key in (
        "count",
        "facets",
        "truncated",
        "next_cursor",
        "total",
        "limit",
        "filter_narrowed",
        "enumerate_via",
    ):
        assert key in body, key
        assert body[key] is None, (key, body[key])


class TestGetCoordDossiers:
    def test_returns_the_page_and_forwards_no_params_when_none_are_set(
        self, auth_client: TestClient
    ):
        with _patch_httpx() as MockClient:
            mock = _client_returning(MockClient, _mock_response(200, DOSSIERS_PAGE))
            resp = auth_client.get(DOSSIERS_URL)

        assert resp.status_code == 200
        assert resp.json() == DOSSIERS_PAGE
        assert mock.get.call_args.args[0].endswith("/coord/dossiers")
        assert mock.get.call_args.kwargs["params"] is None

    def test_forwards_every_accepted_key(self, auth_client: TestClient):
        """All eighteen keys in one request: dropping any one would serve the
        unfiltered (or unsorted) read for a filter the page asked for."""
        with _patch_httpx() as MockClient:
            mock = _client_returning(MockClient, _mock_response(200, DOSSIERS_PAGE))
            resp = auth_client.get(
                DOSSIERS_URL,
                params=[
                    ("readiness", "ready_for_pvi"),
                    ("readiness", "none"),
                    ("slug", "worktree-sibling-build-dependency"),
                    ("q", "sibling"),
                    ("recurrence_min", "2"),
                    ("recurrence_max", "50"),
                    ("last_seen_since", "2026-10-01"),
                    ("last_seen_until", "2026-10-24"),
                    ("first_seen_since", "2026-06-01"),
                    ("first_seen_until", "2026-07-01"),
                    ("updated_since", "2026-10-02"),
                    ("updated_until", "2026-10-23"),
                    ("has_open_remediation", "false"),
                    ("remediation_state", "none"),
                    ("remediation_state", "unknown"),
                    ("sort", "recurrence_count"),
                    ("order", "asc"),
                    ("limit", "100"),
                    ("cursor", "v1.opaque"),
                    ("include_body", "true"),
                ],
            )

        assert resp.status_code == 200
        params = mock.get.call_args.kwargs["params"]
        assert params == {
            # LISTS, so httpx re-encodes them as repeated keys.
            "readiness": ["ready_for_pvi", "none"],
            "slug": "worktree-sibling-build-dependency",
            "q": "sibling",
            "recurrence_min": 2,
            "recurrence_max": 50,
            "last_seen_since": "2026-10-01",
            "last_seen_until": "2026-10-24",
            "first_seen_since": "2026-06-01",
            "first_seen_until": "2026-07-01",
            "updated_since": "2026-10-02",
            "updated_until": "2026-10-23",
            # False, not swallowed as falsy.
            "has_open_remediation": False,
            "remediation_state": ["none", "unknown"],
            "sort": "recurrence_count",
            "order": "asc",
            "limit": 100,
            "cursor": "v1.opaque",
            "include_body": True,
        }

    def test_drops_a_key_coord_does_not_accept(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            mock = _client_returning(MockClient, _mock_response(200, DOSSIERS_PAGE))
            resp = auth_client.get(
                DOSSIERS_URL, params={"sort": "slug", "tenant_id": str(uuid4())}
            )

        assert resp.status_code == 200
        assert mock.get.call_args.kwargs["params"] == {"sort": "slug"}

    def test_requires_authentication(self):
        client = TestClient(_build_test_app(authenticated=False))
        resp = client.get(DOSSIERS_URL)
        assert resp.status_code in (401, 403)

    def test_coord_400_is_passed_through_verbatim(self, auth_client: TestClient):
        """coord owns the vocabulary; its typed refusal is the one refusal."""
        with _patch_httpx() as MockClient:
            _client_returning(
                MockClient,
                _mock_response(
                    400,
                    None,
                    text='{"error":"cursor_malformed","detail":"foreign cursor"}',
                ),
            )
            resp = auth_client.get(DOSSIERS_URL, params={"cursor": "garbage"})

        assert resp.status_code == 400
        assert "cursor_malformed" in resp.text


class TestCoordDossiersDegrade:
    def test_404_reads_as_not_deployed_rather_than_no_dossiers(
        self, auth_client: TestClient
    ):
        with _patch_httpx() as MockClient:
            _client_returning(MockClient, _mock_response(404, None, text="not found"))
            resp = auth_client.get(DOSSIERS_URL)

        assert resp.status_code == 200
        body = resp.json()
        assert body["unavailable_kind"] == "not_deployed"
        assert "not the same as there being none" in body["unavailable"]
        _assert_unknown_envelope(body)

    def test_503_reads_as_unreachable(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            _client_returning(MockClient, _mock_response(503, None, text="down"))
            resp = auth_client.get(DOSSIERS_URL)

        body = resp.json()
        assert body["unavailable_kind"] == "unreachable"
        assert "503" in body["unavailable"]
        _assert_unknown_envelope(body)

    def test_connect_error_degrades_rather_than_502ing(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            _client_returning(MockClient, httpx.ConnectError("no route"))
            resp = auth_client.get(DOSSIERS_URL)

        assert resp.status_code == 200
        assert resp.json()["unavailable_kind"] == "unreachable"
        _assert_unknown_envelope(resp.json())

    def test_coord_available_false_is_given_the_degrade_pair(
        self, auth_client: TestClient
    ):
        unprovisioned = {"available": False, "count": 0, "dossiers": []}
        with _patch_httpx() as MockClient:
            _client_returning(MockClient, _mock_response(200, unprovisioned))
            resp = auth_client.get(DOSSIERS_URL)

        body = resp.json()
        assert body["unavailable_kind"] == "unprovisioned"
        assert body["available"] is False

    def test_an_available_answer_carries_no_degrade(self, auth_client: TestClient):
        with _patch_httpx() as MockClient:
            _client_returning(MockClient, _mock_response(200, DOSSIERS_PAGE))
            resp = auth_client.get(DOSSIERS_URL)

        assert "unavailable" not in resp.json()
