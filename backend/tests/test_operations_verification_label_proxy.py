"""Tests for the operator verdict-label proxies.

``GET /operations/coord/verification/label-sample`` (this week's verdicts to
label) and ``POST /operations/coord/verification/labels`` (the label itself).

Backs the "Did this hold up? Yes · No · Can't tell" control on
``/admin/coord/verification``. Plan
``2026-10-11-reverify-verdicts-are-source-bound-tree-checked-and-judge-agreement-is-measured``,
Phase 4 (web half).

The properties under test:

- the label is written as the OPERATOR — the operator's bearer is forwarded,
  and the body coord receives is exactly ``{label_source: "operator",
  verification_id, truth}`` (no tenant, no labeller, no other source);
- coord's status and body come back verbatim (201 / 409 / 403 / 404 / 422 on
  the label door; 200 / 404 / 503 on the sample door), because the page
  renders each one differently — a 404 or 503 from the sample door is
  "unavailable", never an empty "nothing to label";
- a coord ``401`` is a named ``502`` on both doors, never a ``401`` the
  frontend would read as its own session expiring.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

TEST_TENANT_ID = uuid4()
OPERATOR_BEARER = "operator-cognito-token"
LABELS_URL = "/api/v1/operations/coord/verification/labels"
SAMPLE_URL = "/api/v1/operations/coord/verification/label-sample"
VERIFICATION_ID = "5f0c2a8e-7d1b-4c3e-9a40-1b2c3d4e5f60"


def _build_test_app() -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints import operations
    from app.api.v1.endpoints.operations import get_tenant_id
    from app.api.v1.endpoints.operations import router as operations_router

    app = FastAPI()
    user = MagicMock()
    user.id = uuid4()
    user.is_active = True

    async def _operator_tenant() -> object:
        # What the real `get_tenant_id` does for an authenticated operator:
        # capture the caller's Cognito bearer for forwarding, resolve a tenant.
        operations._caller_bearer.set(OPERATOR_BEARER)
        return TEST_TENANT_ID

    app.dependency_overrides[get_current_active_user_async] = lambda: user
    app.dependency_overrides[get_tenant_id] = _operator_tenant
    app.include_router(operations_router, prefix="/api/v1/operations")
    return app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(_build_test_app())


def _response(status_code: int, json_data=None, text: str = "") -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    if json_data is None:
        resp.json.side_effect = ValueError("not json")
    else:
        resp.json.return_value = json_data
    resp.text = text
    resp.headers = httpx.Headers()
    return resp


def _mock_client(request: AsyncMock):
    patcher = patch("app.api.v1.endpoints.operations.httpx.AsyncClient")
    MockClient = patcher.start()
    instance = MagicMock()
    instance.request = request
    instance.__aenter__ = AsyncMock(return_value=instance)
    instance.__aexit__ = AsyncMock(return_value=False)
    MockClient.return_value = instance
    return patcher, instance


def _body(truth: str = "holds") -> dict:
    return {
        "label_source": "operator",
        "verification_id": VERIFICATION_ID,
        "truth": truth,
    }


RECORDED = {
    "id": "0d6a1f3e-1111-4c3e-9a40-1b2c3d4e5f60",
    "label_source": "operator",
    "verification_id": VERIFICATION_ID,
    "seed_class": None,
    "truth": "holds",
    "verifier_verdict": "refuted",
    "labelled_by": "operator:abc",
    "created_at": "2026-11-01T12:00:00Z",
}


class TestVerificationLabelProxy:
    def test_forwards_the_operator_label_with_the_operator_bearer(self, client):
        patcher, instance = _mock_client(
            AsyncMock(return_value=_response(201, RECORDED))
        )
        try:
            resp = client.post(LABELS_URL, json=_body("fails"))
        finally:
            patcher.stop()
        assert resp.status_code == 201
        assert resp.json() == RECORDED
        call = instance.request.call_args
        assert call.args[0] == "POST"
        assert call.args[1].endswith("/coord/verification/labels")
        assert call.kwargs["json"] == {
            "label_source": "operator",
            "verification_id": VERIFICATION_ID,
            "truth": "fails",
        }
        assert call.kwargs["headers"]["Authorization"] == f"Bearer {OPERATOR_BEARER}"

    @pytest.mark.parametrize(
        "status,code,extra",
        [
            (409, "duplicate_label", {"id": RECORDED["id"]}),
            (403, "operator_principal_required", {}),
            (404, "verification_not_found", {}),
            (422, "verifier_verdict_mismatch", {}),
            (503, "store_unavailable", {}),
        ],
    )
    def test_coord_status_and_body_pass_through(self, client, status, code, extra):
        coord_body = {"error": code, "message": "coord said so", **extra}
        patcher, _ = _mock_client(AsyncMock(return_value=_response(status, coord_body)))
        try:
            resp = client.post(LABELS_URL, json=_body())
        finally:
            patcher.stop()
        assert resp.status_code == status
        assert resp.json() == coord_body

    @pytest.mark.parametrize("source", ["seeded", "consequence"])
    def test_only_an_operator_label_is_accepted(self, client, source):
        patcher, instance = _mock_client(AsyncMock())
        try:
            resp = client.post(LABELS_URL, json={**_body(), "label_source": source})
        finally:
            patcher.stop()
        assert resp.status_code == 422
        instance.request.assert_not_called()

    @pytest.mark.parametrize(
        "extra",
        [
            {"seed_class": "absent_symbol"},
            {"verifier_verdict": "survived"},
            {"tenant_id": str(uuid4())},
            {"labelled_by": "someone-else"},
        ],
    )
    def test_no_other_field_reaches_coord(self, client, extra):
        patcher, instance = _mock_client(AsyncMock())
        try:
            resp = client.post(LABELS_URL, json={**_body(), **extra})
        finally:
            patcher.stop()
        assert resp.status_code == 422
        instance.request.assert_not_called()

    @pytest.mark.parametrize(
        "patch_",
        [{"truth": "yes"}, {"verification_id": "not-a-uuid"}],
    )
    def test_a_malformed_label_is_refused_before_coord(self, client, patch_):
        patcher, instance = _mock_client(AsyncMock())
        try:
            resp = client.post(LABELS_URL, json={**_body(), **patch_})
        finally:
            patcher.stop()
        assert resp.status_code == 422
        instance.request.assert_not_called()

    def test_coord_refusing_the_operator_bearer_is_a_named_502(self, client):
        """Not a 401 — that would send the frontend into its session-refresh branch."""
        patcher, _ = _mock_client(
            AsyncMock(
                return_value=_response(
                    401, {"error": "unauthorized", "message": "token_foreign_issuer"}
                )
            )
        )
        try:
            resp = client.post(LABELS_URL, json=_body())
        finally:
            patcher.stop()
        assert resp.status_code == 502
        detail = resp.json()["detail"]
        assert "refused the operator's credential" in detail
        assert "HTTP 401" in detail
        assert "token_foreign_issuer" in detail

    def test_a_connect_error_is_a_502(self, client):
        patcher, _ = _mock_client(AsyncMock(side_effect=httpx.ConnectError("refused")))
        try:
            resp = client.post(LABELS_URL, json=_body())
        finally:
            patcher.stop()
        assert resp.status_code == 502
        assert resp.json()["detail"] == "coord is not reachable"

    def test_a_timeout_is_a_504_that_may_have_landed(self, client):
        patcher, _ = _mock_client(AsyncMock(side_effect=httpx.ReadTimeout("slow")))
        try:
            resp = client.post(LABELS_URL, json=_body())
        finally:
            patcher.stop()
        assert resp.status_code == 504


SAMPLE = {
    "iso_week": "2026-W44",
    "population_cutoff": "2026-10-26T00:00:00Z",
    "verdicts": [
        {
            "verification_id": VERIFICATION_ID,
            "work_unit_slug": "2026-10-01-some-plan",
            "verdict": "survived",
            "recorded_at": "2026-10-20T09:00:00Z",
            "operator_label": None,
        },
        {
            "verification_id": RECORDED["id"],
            "work_unit_slug": None,
            "verdict": "refuted",
            "recorded_at": "2026-10-21T09:00:00Z",
            "operator_label": {
                "id": "0d6a1f3e-2222-4c3e-9a40-1b2c3d4e5f60",
                "truth": "fails",
                "created_at": "2026-10-28T09:00:00Z",
            },
        },
    ],
}


class TestVerificationLabelSampleProxy:
    def test_forwards_the_sample_read_with_the_operator_bearer(self, client):
        patcher, instance = _mock_client(AsyncMock(return_value=_response(200, SAMPLE)))
        try:
            resp = client.get(SAMPLE_URL)
        finally:
            patcher.stop()
        assert resp.status_code == 200
        assert resp.json() == SAMPLE
        call = instance.request.call_args
        assert call.args[0] == "GET"
        assert call.args[1].endswith("/coord/verification/label-sample")
        assert call.kwargs["headers"]["Authorization"] == f"Bearer {OPERATOR_BEARER}"

    @pytest.mark.parametrize(
        "status,coord_body",
        [
            (503, {"error": "label_sample_unreadable", "message": "store down"}),
            (404, {"error": "not_found", "message": "no such route"}),
        ],
    )
    def test_an_unavailable_sample_passes_through_with_its_status(
        self, client, status, coord_body
    ):
        patcher, _ = _mock_client(AsyncMock(return_value=_response(status, coord_body)))
        try:
            resp = client.get(SAMPLE_URL)
        finally:
            patcher.stop()
        assert resp.status_code == status
        assert resp.json() == coord_body

    def test_coord_refusing_the_operator_bearer_is_a_named_502(self, client):
        patcher, _ = _mock_client(
            AsyncMock(
                return_value=_response(
                    401, {"error": "unauthorized", "message": "token_foreign_issuer"}
                )
            )
        )
        try:
            resp = client.get(SAMPLE_URL)
        finally:
            patcher.stop()
        assert resp.status_code == 502
        detail = resp.json()["detail"]
        assert "/coord/verification/label-sample" in detail
        assert "HTTP 401" in detail

    def test_a_connect_error_is_a_502(self, client):
        patcher, _ = _mock_client(AsyncMock(side_effect=httpx.ConnectError("refused")))
        try:
            resp = client.get(SAMPLE_URL)
        finally:
            patcher.stop()
        assert resp.status_code == 502


class TestRefusalOrigin:
    """The web's own refusal carries ``X-Qontinui-Refusal-Origin: web``; a
    coord refusal passed through with the same envelope does not — so the
    client can tell "never reached coord" (final) from "coord said 502"."""

    @pytest.fixture()
    def handled_client(self) -> TestClient:
        from starlette.exceptions import HTTPException as StarletteHTTPException

        from app.middleware.error_handler import http_exception_handler

        app = _build_test_app()
        app.add_exception_handler(StarletteHTTPException, http_exception_handler)  # type: ignore[arg-type]
        return TestClient(app)

    def test_the_webs_own_connect_refusal_is_marked_web(self, handled_client):
        from app.core.refusal import REFUSAL_ORIGIN_HEADER

        patcher, _ = _mock_client(AsyncMock(side_effect=httpx.ConnectError("refused")))
        try:
            resp = handled_client.post(LABELS_URL, json=_body())
        finally:
            patcher.stop()
        assert resp.status_code == 502
        assert resp.headers[REFUSAL_ORIGIN_HEADER] == "web"
        assert resp.json()["refusal"]["discriminator"] == "coord_unreachable"

    def test_the_credential_refusal_is_marked_web(self, handled_client):
        from app.core.refusal import REFUSAL_ORIGIN_HEADER

        patcher, _ = _mock_client(
            AsyncMock(return_value=_response(401, {"error": "unauthorized"}))
        )
        try:
            resp = handled_client.get(SAMPLE_URL)
        finally:
            patcher.stop()
        assert resp.status_code == 502
        assert resp.headers[REFUSAL_ORIGIN_HEADER] == "web"
        assert (
            resp.json()["refusal"]["discriminator"]
            == "coord_verification_label_credential_refused"
        )

    def test_a_passed_through_coord_502_is_not_marked(self, handled_client):
        from app.core.refusal import REFUSAL_ORIGIN_HEADER

        coord_body = {
            "error": "upstream_unavailable",
            "message": "m",
            "refusal": {"discriminator": "coord_unreachable"},
        }
        upstream = _response(502, coord_body)
        upstream.headers = httpx.Headers({REFUSAL_ORIGIN_HEADER: "web"})
        patcher, _ = _mock_client(AsyncMock(return_value=upstream))
        try:
            resp = handled_client.post(LABELS_URL, json=_body())
        finally:
            patcher.stop()
        assert resp.status_code == 502
        assert resp.json() == coord_body
        assert REFUSAL_ORIGIN_HEADER not in resp.headers

    def test_the_header_is_published_to_cross_origin_readers(self):
        from app.core.refusal import REFUSAL_ORIGIN_HEADER
        from app.main import CORS_EXPOSE_HEADERS

        assert REFUSAL_ORIGIN_HEADER in CORS_EXPOSE_HEADERS
