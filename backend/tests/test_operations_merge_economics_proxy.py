"""The merge-economics proxy pins coord's REAL path.

``GET /operations/pr-merge/merge-economics`` proxies coord's
``GET /pr-merge/economics`` (qontinui-coord ``crates/coord/src/routes.rs:4287``).
For the whole life of the feature it asked coord for
``/pr-merge/merge-economics`` instead — a path coord has never served. coord
answered 401/404, the handler's graceful fallback turned that into ``{}``, and
the Pipeline page's ``economicsByRepo`` was an empty map on every render while
every existing test stayed green: they all mocked the transport and asserted
the fallback, and none of them ever looked at the path (plan
2026-07-27-coord-green-candidates-discarded-always-zero, F3).

So this file asserts the PATH, not the fallback. The mock is one level up from
the ``httpx.AsyncClient`` mocks its siblings use: ``_proxy_coord_get`` itself
is patched, so the assertion is on exactly the string the handler hands coord.
Mirrors ``test_operations_pr_list_proxy.py`` for the app scaffold.
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.api.v1.endpoints import operations as operations_mod


def _build_test_app() -> FastAPI:
    """Minimal FastAPI app with the operations router + auth overridden."""
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import get_tenant_id
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.email = "dev@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    test_app.dependency_overrides[get_tenant_id] = lambda: uuid4()
    test_app.include_router(operations_router, prefix="/api/v1/operations")
    return test_app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(_build_test_app())


API_PREFIX = "/api/v1/operations"
WEB_ROUTE = f"{API_PREFIX}/pr-merge/merge-economics"

# The live shape coord served on 2026-09-04 for `qontinui/qontinui-coord`,
# minus the timing fields this file does not care about. Counts are
# `Option<u64>` on coord: `null` is "not measurable", never 0.
_COORD_ROWS: list[dict[str, Any]] = [
    {
        "repo": "qontinui/qontinui-coord",
        "green_candidates_discarded": 15,
        "in_progress_candidates_discarded": 0,
        "base_mismatch_discards": 13,
        "candidate_ci_minutes_per_land": 47.4,
        "lands_in_window": 31,
        "green_candidates_discarded_basis": "candidates that reached green and were discarded in the 24h window",
        "base_mismatch_discards_basis": "discards whose base moved under them",
        "coverage_note": "24h window",
    },
    {
        "repo": "qontinui/qontinui-web",
        "green_candidates_discarded": None,
        "in_progress_candidates_discarded": None,
        "base_mismatch_discards": None,
        "candidate_ci_minutes_per_land": None,
        "lands_in_window": None,
        "green_candidates_discarded_basis": None,
        "base_mismatch_discards_basis": None,
        "coverage_note": "no candidate CI observed in window",
    },
]


def _patch_proxy() -> Any:
    return patch.object(operations_mod, "_proxy_coord_get", new_callable=AsyncMock)


class TestMergeEconomicsProxyPath:
    def test_constant_is_coords_real_route(self) -> None:
        """The one-line constant IS the contract; pin it by value."""
        assert operations_mod._COORD_MERGE_ECONOMICS_PATH == "/pr-merge/economics"

    def test_handler_asks_coord_for_pr_merge_economics(
        self, client: TestClient
    ) -> None:
        """The handler must hand `_proxy_coord_get` exactly `/pr-merge/economics`.

        This is the assertion the fallback hid: with the transport mocked, a
        wrong path still produced a 200 `{}`.
        """
        with _patch_proxy() as proxy:
            proxy.return_value = _COORD_ROWS
            resp = client.get(WEB_ROUTE)

        assert resp.status_code == 200
        proxy.assert_awaited_once()
        (path,) = proxy.await_args.args
        assert path == "/pr-merge/economics"
        # The retired spelling must never reach coord again.
        assert path != "/pr-merge/merge-economics"
        # Bearer forwarding is still requested (fleet-wide read, operator auth).
        assert proxy.await_args.kwargs.get("tenant_id") is not None

    def test_web_route_spelling_is_unchanged(self, client: TestClient) -> None:
        """The PUBLIC route keeps `/pr-merge/merge-economics`.

        Only the coord-side path was wrong; the frontend fetch and the OpenAPI
        snapshot bind this spelling.
        """
        app = client.app
        assert isinstance(app, FastAPI)
        paths = {getattr(r, "path", None) for r in app.routes}
        assert WEB_ROUTE in paths
        assert f"{API_PREFIX}/pr-merge/economics" not in paths

    def test_null_counts_pass_through_as_null(self, client: TestClient) -> None:
        """`null` is UNKNOWN on the wire and stays `null` through the proxy.

        The frontend's null-is-never-0 rule depends on the proxy not coercing.
        """
        with _patch_proxy() as proxy:
            proxy.return_value = _COORD_ROWS
            body = client.get(WEB_ROUTE).json()

        assert body == _COORD_ROWS
        by_repo = {row["repo"]: row for row in body}
        assert by_repo["qontinui/qontinui-coord"]["green_candidates_discarded"] == 15
        assert by_repo["qontinui/qontinui-web"]["green_candidates_discarded"] is None
        assert by_repo["qontinui/qontinui-web"]["base_mismatch_discards"] is None

    @pytest.mark.parametrize("status", [404, 502, 503, 504])
    def test_graceful_fallback_still_degrades_to_empty(
        self, client: TestClient, status: int
    ) -> None:
        """The `{}` fallback stays — it is correct for an outage. It was only
        ever wrong as a MASK for the path, which the tests above now pin."""
        with _patch_proxy() as proxy:
            proxy.side_effect = HTTPException(status_code=status, detail="down")
            resp = client.get(WEB_ROUTE)

        assert resp.status_code == 200
        assert resp.json() == {}

    def test_other_coord_errors_are_not_swallowed(self, client: TestClient) -> None:
        with _patch_proxy() as proxy:
            proxy.side_effect = HTTPException(status_code=401, detail="unauthorized")
            resp = client.get(WEB_ROUTE)

        assert resp.status_code == 401
