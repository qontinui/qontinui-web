"""Tests for the verification metrics proxy (``/operations/coord/verification/metrics``).

Backs the overview's "Can I trust 'done'?" tile and ``/admin/coord/verification``.
Plan ``2026-09-20-trust-calibration-and-independent-verification-coverage-are-measured-continuously``,
Phase 5 (web half).

The property under test is honesty about "could not look": coord's degraded
body is forwarded verbatim, and every upstream failure stays an ERROR — a proxy
that converted one into an empty or zeroed ``200`` would let the tile render a
stale green. Same minimal-app + mocked ``httpx.AsyncClient`` pattern as
``test_operations_findings_proxy.py``.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

TEST_TENANT_ID = uuid4()
METRICS_URL = "/api/v1/operations/coord/verification/metrics"


def _build_test_app() -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import get_tenant_id
    from app.api.v1.endpoints.operations import router as operations_router

    app = FastAPI()
    user = MagicMock()
    user.id = uuid4()
    user.is_active = True
    app.dependency_overrides[get_current_active_user_async] = lambda: user
    app.dependency_overrides[get_tenant_id] = lambda: TEST_TENANT_ID
    app.include_router(operations_router, prefix="/api/v1/operations")
    return app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(_build_test_app())


def _response(status_code: int, json_data=None, text: str = "") -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.text = text or (str(json_data) if json_data is not None else "")
    return resp


def _mock_client(get: AsyncMock):
    patcher = patch("app.api.v1.endpoints.operations.httpx.AsyncClient")
    MockClient = patcher.start()
    instance = MagicMock()
    instance.get = get
    instance.__aenter__ = AsyncMock(return_value=instance)
    instance.__aexit__ = AsyncMock(return_value=False)
    MockClient.return_value = instance
    return patcher, instance


POPULATED = {
    "degraded": False,
    "generated_at": "2026-09-30T12:00:00+00:00",
    "window": {
        "days": 28,
        "from": "2026-09-02T12:00:00+00:00",
        "to": "2026-09-30T12:00:00+00:00",
    },
    "population_query_id": "work_unit_verification::SHIPPED_POPULATION_SQL",
    "population": 52,
    "trust_calibration": {
        "value": 0.9,
        "ci95_low": 0.84,
        "ci95_high": 0.95,
        "survived": 18,
        "refuted": 2,
        "n": 20,
        "population": 52,
        "method": "wilson+fpc",
        "reason": None,
    },
}

DEGRADED = {
    "degraded": True,
    "reason": "coord.work_unit_verifications is absent",
    "generated_at": "2026-09-30T12:00:00+00:00",
    "population": None,
    "trust_calibration": None,
    "independent_verification_coverage": None,
    "unknowns": None,
    "series": None,
}


class TestVerificationMetricsProxy:
    def test_forwards_the_window_and_returns_the_body_verbatim(self, client):
        patcher, instance = _mock_client(
            AsyncMock(return_value=_response(200, POPULATED))
        )
        try:
            resp = client.get(f"{METRICS_URL}?window=28d")
        finally:
            patcher.stop()
        assert resp.status_code == 200
        assert resp.json() == POPULATED
        call = instance.get.call_args
        assert call.args[0].endswith("/coord/verification/metrics")
        assert call.kwargs["params"] == {"window": "28d"}

    def test_no_window_sends_no_query_string(self, client):
        patcher, instance = _mock_client(
            AsyncMock(return_value=_response(200, POPULATED))
        )
        try:
            client.get(METRICS_URL)
        finally:
            patcher.stop()
        assert instance.get.call_args.kwargs["params"] is None

    def test_a_client_tenant_id_never_reaches_coord(self, client):
        patcher, instance = _mock_client(
            AsyncMock(return_value=_response(200, POPULATED))
        )
        try:
            client.get(f"{METRICS_URL}?tenant_id={uuid4()}")
        finally:
            patcher.stop()
        assert instance.get.call_args.kwargs["params"] is None

    def test_the_degraded_body_passes_through_with_its_nulls(self, client):
        """coord's "could not look" is a 200 of its own — forwarded, not rewritten."""
        patcher, _ = _mock_client(AsyncMock(return_value=_response(200, DEGRADED)))
        try:
            resp = client.get(METRICS_URL)
        finally:
            patcher.stop()
        assert resp.status_code == 200
        body = resp.json()
        assert body["degraded"] is True
        assert body["reason"] == DEGRADED["reason"]
        assert body["trust_calibration"] is None
        assert body["series"] is None

    @pytest.mark.parametrize("status", [404, 422, 500, 503])
    def test_an_upstream_error_stays_an_error(self, client, status):
        text = f'{{"error":"e{status}","message":"coord said no"}}'
        patcher, _ = _mock_client(AsyncMock(return_value=_response(status, None, text)))
        try:
            resp = client.get(METRICS_URL)
        finally:
            patcher.stop()
        assert resp.status_code == status
        assert "coord said no" in resp.json()["detail"]

    def test_a_connect_error_is_a_502_not_an_empty_200(self, client):
        patcher, _ = _mock_client(AsyncMock(side_effect=httpx.ConnectError("refused")))
        try:
            resp = client.get(METRICS_URL)
        finally:
            patcher.stop()
        assert resp.status_code == 502
        assert resp.json()["detail"] == "coord is not reachable"

    def test_a_timeout_is_a_504(self, client):
        patcher, _ = _mock_client(AsyncMock(side_effect=httpx.ReadTimeout("slow")))
        try:
            resp = client.get(METRICS_URL)
        finally:
            patcher.stop()
        assert resp.status_code == 504

    @pytest.mark.parametrize("status", [401, 403])
    def test_coord_refusing_the_operator_bearer_is_a_named_502(self, client, status):
        """Not a 401 — that would send the frontend into its session-refresh branch."""
        text = '{"error":"unauthorized","message":"token_foreign_issuer"}'
        patcher, _ = _mock_client(AsyncMock(return_value=_response(status, None, text)))
        try:
            resp = client.get(METRICS_URL)
        finally:
            patcher.stop()
        assert resp.status_code == 502
        detail = resp.json()["detail"]
        assert "refused the operator's credential" in detail
        assert f"HTTP {status}" in detail
        assert "token_foreign_issuer" in detail
