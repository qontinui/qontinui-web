"""Integration tests for the coord work-unit ("Plans") list proxy.

``GET /api/v1/operations/plans`` proxies coord ``GET /coord/work-units`` so the
``/admin/coord/plans`` console renders without the browser hitting coord
cross-origin.

Plan
``D:/qontinui-root/plans/2026-08-20-coord-work-unit-lifecycle-timestamps-and-slug-exclusion.md``
Phase 3.

What these tests are actually protecting
========================================

The proxy used to forward ``status`` and ``limit`` and drop everything else,
while coord's ``ListQuery`` had accepted ``slug_prefix`` and ``offset`` all
along. The console could therefore neither page past the first window nor ask
for a slug subset — and it needs both: measured against production on
2026-08-20 the corpus is 1105 work units, of which 454 are auto-generated
``shepherd-*`` merge-escalation records that all share one ``updated_at``. With
coord ordering ``updated_at DESC`` and the page capped at 500, a *client-side*
split would let the shepherds crowd real plans out of the window entirely. The
filter has to reach coord's ``WHERE``, which means it has to survive this
proxy.

A dropped parameter fails silently — coord returns a valid, larger page and the
console renders it — so each parameter is asserted individually rather than in
one omnibus request that a single surviving parameter could green.

Mirrors the testing pattern in ``test_operations_claims_proxy.py``: minimal
FastAPI app + mocked ``httpx.AsyncClient``, so no live coord is needed.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

TEST_TENANT_ID = uuid4()
API_PREFIX = "/api/v1/operations"


def _build_test_app() -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import get_tenant_id
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
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
    return TestClient(_build_test_app())


def _mock_response(status_code: int = 200, json_data=None) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.text = str(json_data) if json_data else ""
    return resp


def _patch_httpx():
    return patch("app.api.v1.endpoints.operations.httpx.AsyncClient")


def _configure_mock_client(MockClient, mock_instance):
    mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
    mock_instance.__aexit__ = AsyncMock(return_value=False)
    MockClient.return_value = mock_instance


_EMPTY = {"work_units": [], "limit": 100, "offset": 0}


def _call(auth_client: TestClient, query: str, payload=None):
    """Issue the proxied GET; return ``(response, coord_url, coord_params)``."""
    with _patch_httpx() as MockClient:
        instance = AsyncMock()
        instance.get.return_value = _mock_response(json_data=payload or _EMPTY)
        _configure_mock_client(MockClient, instance)
        resp = auth_client.get(f"{API_PREFIX}/plans{query}")
    called_url = instance.get.call_args.args[0]
    called_params = instance.get.call_args.kwargs.get("params") or {}
    return resp, called_url, called_params


class TestListCoordPlans:
    def test_proxies_to_the_work_units_route(self, auth_client: TestClient):
        payload = {
            "work_units": [
                {
                    "slug": "2026-08-20-something",
                    "status": "in_progress",
                    "created_at": "2026-08-01T00:00:00Z",
                    "updated_at": "2026-08-20T00:00:00Z",
                }
            ],
            "limit": 100,
            "offset": 0,
        }
        resp, url, _ = _call(auth_client, "", payload)

        assert resp.status_code == 200
        assert resp.json() == payload
        assert url.endswith("/coord/work-units")

    def test_no_filters_sends_no_params(self, auth_client: TestClient):
        """An unfiltered call must not invent defaults.

        coord's own defaults (limit 100, offset 0) are the contract; sending
        our own would silently pin the page size if coord's ever changed.
        """
        _, _, params = _call(auth_client, "")
        assert params == {}

    @pytest.mark.parametrize(
        ("query", "key", "expected"),
        [
            ("?status=shipped", "status", "shipped"),
            ("?slug_prefix=shepherd-", "slug_prefix", "shepherd-"),
            ("?exclude_slug_prefix=shepherd-", "exclude_slug_prefix", "shepherd-"),
            ("?limit=500", "limit", 500),
            ("?offset=500", "offset", 500),
            # offset=0 is the one that survives only because the proxy tests
            # `is not None` rather than truthiness. A tidy-up to `if offset:`
            # would drop it silently and every OTHER case here stays green, so
            # this row is what pins the idiom.
            ("?offset=0", "offset", 0),
        ],
    )
    def test_each_filter_is_forwarded(
        self, auth_client: TestClient, query: str, key: str, expected
    ):
        """Each parameter individually — a dropped one fails SILENTLY.

        Asserted one at a time on purpose: an omnibus request would go green on
        a single surviving parameter while the rest were quietly discarded,
        which is exactly the defect this phase fixes.
        """
        _, _, params = _call(auth_client, query)
        assert params.get(key) == expected

    def test_all_filters_ride_together(self, auth_client: TestClient):
        """Every filter at once, asserted as an EXACT dict.

        Equality rather than per-key membership: this is the case that would
        catch the proxy inventing a parameter nobody asked for.
        """
        _, _, params = _call(
            auth_client,
            "?status=in_progress&slug_prefix=2026-"
            "&exclude_slug_prefix=shepherd-&limit=500&offset=1000",
        )
        assert params == {
            "status": "in_progress",
            "slug_prefix": "2026-",
            "exclude_slug_prefix": "shepherd-",
            "limit": 500,
            "offset": 1000,
        }

    @pytest.mark.parametrize("param", ["slug_prefix", "exclude_slug_prefix"])
    def test_empty_prefix_is_rejected_not_forwarded(
        self, auth_client: TestClient, param: str
    ):
        """An EMPTY prefix must never reach coord.

        `exclude_slug_prefix=` would become `slug NOT LIKE '' || '%'` there —
        `NOT LIKE '%'` — which excludes every row. A console forwarding an
        empty input box would render a blank Plans list, and this endpoint's
        own docstring tells the operator to read an unexpected page as "coord
        has not caught up yet". `min_length=1` makes it a loud 422 instead.
        """
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=_EMPTY)
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/plans?{param}=")
        assert resp.status_code == 422
        instance.get.assert_not_called()

    def test_offset_rejects_negative(self, auth_client: TestClient):
        """``ge=0`` is enforced here rather than deferred to coord."""
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=_EMPTY)
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/plans?offset=-1")
        assert resp.status_code == 422

    def test_limit_ceiling_matches_coords_clamp(self, auth_client: TestClient):
        """``le=500`` mirrors coord's server-side clamp.

        coord clamps to ``[1, 500]`` itself, so a larger value would not be
        dangerous — but it would be a LIE: the caller would believe it had
        asked for more than one page's worth and silently receive 500.
        """
        with _patch_httpx() as MockClient:
            instance = AsyncMock()
            instance.get.return_value = _mock_response(json_data=_EMPTY)
            _configure_mock_client(MockClient, instance)
            resp = auth_client.get(f"{API_PREFIX}/plans?limit=501")
        assert resp.status_code == 422
