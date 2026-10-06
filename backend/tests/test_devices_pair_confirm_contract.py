"""``POST /api/v1/devices/pair-confirm`` — what web sends coord (arm B).

Coord's ``POST /coord/devices/pair-complete`` mints a device JWT only for a
caller it verified (qontinui-coord ``pairing_auth``, plan
``2026-09-04-pair-complete-mints-a-device-jwt-for-any-caller``). The browser
flow's credential is coord's **arm B**: the web service token
(``sub = service:qontinui-web-strategy``, ``strategy_admin``) in
``Authorization`` plus the signed-in user in ``X-Qontinui-User-Id``. Coord
reads the user from that header and proves its tenant membership itself, so
the body carries NO identity — exactly ``{state, device_id}``.

These tests pin the wire shape web sends: the two headers coord verifies are
present and correct, the body is the two-field contract, and the two former
unverified fields (``web_session_token`` sentinel, ``user_id``) are gone.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.services.coord_service_account import coord_service_account

_USER_ID = uuid4()
_SERVICE_TOKEN = "coord-service-jwt-for-qontinui-web-strategy"
_DEVICE_ID = "00000000-0000-0000-0000-deadbeefcafe"
_STATE = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0"
API_PREFIX = "/api/v1/devices"


def _build_test_app() -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.devices import router as devices_router
    from app.middleware.error_handler import http_exception_handler

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = _USER_ID
    mock_user.email = "operator@example.com"
    mock_user.is_active = True
    mock_user.is_verified = True
    mock_user.is_superuser = False
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    # The production handler, so these tests pin the shape a client actually
    # receives: it rewrites a dict detail rather than nesting it.
    test_app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    test_app.include_router(devices_router, prefix=API_PREFIX)
    return test_app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(_build_test_app())


def _mock_response(status_code: int = 200, json_data=None, text: str = "") -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.text = text or (str(json_data) if json_data else "")
    return resp


def _configure_mock_client(MockClient, mock_instance):
    mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
    mock_instance.__aexit__ = AsyncMock(return_value=False)
    MockClient.return_value = mock_instance


def _patches():
    """Enable the coord integration, make the linked-operator gate pass, hand
    out a deterministic service header pair, and capture the outbound POST
    (which lives in the shared ``coord_proxy`` helper)."""
    return (
        patch.object(coord_service_account, "_admin_secret", "test-secret"),
        patch(
            "app.api.v1.endpoints.devices.get_coord_identity",
            new=AsyncMock(return_value=MagicMock()),
        ),
        patch.object(
            coord_service_account,
            "_ensure_token",
            new=AsyncMock(return_value=_SERVICE_TOKEN),
        ),
        patch("app.services.coord_proxy.httpx.AsyncClient"),
    )


_COORD_OK = {
    "token": "device-token-jwt",
    "device_id": _DEVICE_ID,
    "user_id": str(_USER_ID),
    "jti": str(uuid4()),
    "exp": 1234567890,
}


class TestPairConfirmSendsCoordArmB:
    def test_body_is_state_and_device_id_only_identity_rides_the_headers(
        self, client: TestClient
    ) -> None:
        enabled, gate, token, httpx_client = _patches()
        with enabled, gate, token, httpx_client as MockClient:
            instance = AsyncMock()
            instance.post.return_value = _mock_response(json_data=_COORD_OK)
            _configure_mock_client(MockClient, instance)

            resp = client.post(
                f"{API_PREFIX}/pair-confirm",
                json={"state": _STATE, "device_id": _DEVICE_ID},
            )

        assert resp.status_code == 201, resp.text
        assert resp.json()["device_id"] == _DEVICE_ID
        assert resp.json()["token"] == "device-token-jwt"
        assert resp.json()["state"] == _STATE

        called_url = instance.post.call_args.args[0]
        assert called_url.endswith("/coord/devices/pair-complete")

        # Arm B: the web SERVICE token (not the user's bearer) + the user.
        headers = instance.post.call_args.kwargs["headers"]
        assert headers["Authorization"] == f"Bearer {_SERVICE_TOKEN}"
        assert headers["X-Qontinui-User-Id"] == str(_USER_ID)

        # The body carries no identity: coord's contract is {state, device_id}.
        body = instance.post.call_args.kwargs["json"]
        assert body == {"state": _STATE, "device_id": _DEVICE_ID}
        assert "web_session_token" not in body
        assert "user_id" not in body

    def test_coord_membership_refusal_surfaces_as_502_with_coord_body(
        self, client: TestClient
    ) -> None:
        """Coord's 403 ``tenant_membership_required`` (the user's operator is
        not a member of the flow's tenant) is relayed, not masked."""
        refusal = {
            "error": "the verified identity is not a member of the requested tenant",
            "code": "tenant_membership_required",
            "hint": "restart pairing",
        }
        enabled, gate, token, httpx_client = _patches()
        with enabled, gate, token, httpx_client as MockClient:
            instance = AsyncMock()
            instance.post.return_value = _mock_response(
                status_code=403, json_data=refusal, text=str(refusal)
            )
            _configure_mock_client(MockClient, instance)

            resp = client.post(
                f"{API_PREFIX}/pair-confirm",
                json={"state": _STATE, "device_id": _DEVICE_ID},
            )

        assert resp.status_code == 502, resp.text
        detail = resp.json()
        assert detail["coord_status"] == 403
        assert "tenant_membership_required" in detail["coord_body"]
        assert detail["coord_code"] == "tenant_membership_required"
        assert detail["coord_hint"] == "restart pairing"
        # The handler keeps the fields at the top level and a readable message.
        assert detail["error"] == "BAD_GATEWAY"
        assert detail["message"] == (
            "Coord refused pairing (HTTP 403: tenant_membership_required)."
        )
        assert "detail" not in detail

    def test_refusal_code_is_parsed_from_the_full_body_not_the_truncated_one(
        self, client: TestClient
    ) -> None:
        """A collect-mode batch refusal carries per-tenant ``results`` and
        routinely runs past ``coord_body``'s 500 chars; ``coord_code`` must
        still be relayed so the page can tell a retryable coord failure from
        a membership refusal."""
        refusal = {
            "error": "no requested tenant could be paired",
            "results": [
                {
                    "tenant_id": str(uuid4()),
                    "status": "skipped",
                    "skipped_reason": "probe_failed",
                }
                for _ in range(8)
            ],
            "code": "probe_failed",
            "hint": "restart pairing",
        }
        enabled, gate, token, httpx_client = _patches()
        with enabled, gate, token, httpx_client as MockClient:
            instance = AsyncMock()
            instance.post.return_value = _mock_response(
                status_code=403, json_data=refusal, text=str(refusal)
            )
            _configure_mock_client(MockClient, instance)

            resp = client.post(
                f"{API_PREFIX}/pair-confirm",
                json={"state": _STATE, "device_id": _DEVICE_ID},
            )

        assert resp.status_code == 502, resp.text
        detail = resp.json()
        assert len(detail["coord_body"]) == 500
        assert detail["coord_code"] == "probe_failed"
        assert detail["coord_hint"] == "restart pairing"
        assert detail["coord_skip_reasons"] == ["probe_failed"]

    def test_batch_refusal_relays_distinct_skip_reasons_only(
        self, client: TestClient
    ) -> None:
        tenant = str(uuid4())
        refusal = {
            "error": "no requested tenant could be paired",
            "code": "no_tenant_authorized",
            "hint": "restart pairing",
            "results": [
                {
                    "tenant_id": tenant,
                    "status": "skipped",
                    "skipped_reason": "not_a_member",
                },
                {
                    "tenant_id": str(uuid4()),
                    "status": "skipped",
                    "skipped_reason": "user_not_provisioned",
                },
                {
                    "tenant_id": str(uuid4()),
                    "status": "skipped",
                    "skipped_reason": "not_a_member",
                },
                "not-an-object",
                {"tenant_id": str(uuid4()), "status": "skipped", "skipped_reason": 7},
            ],
        }
        enabled, gate, token, httpx_client = _patches()
        with enabled, gate, token, httpx_client as MockClient:
            instance = AsyncMock()
            instance.post.return_value = _mock_response(
                status_code=403, json_data=refusal, text="x" * 600
            )
            _configure_mock_client(MockClient, instance)

            resp = client.post(
                f"{API_PREFIX}/pair-confirm",
                json={"state": _STATE, "device_id": _DEVICE_ID},
            )

        assert resp.status_code == 502, resp.text
        detail = resp.json()
        assert detail["coord_code"] == "no_tenant_authorized"
        assert detail["coord_skip_reasons"] == ["not_a_member", "user_not_provisioned"]
        assert tenant not in str(
            {k: v for k, v in detail.items() if k not in ("coord_body", "timestamp")}
        )

    def test_non_json_refusal_relays_no_code(self, client: TestClient) -> None:
        enabled, gate, token, httpx_client = _patches()
        with enabled, gate, token, httpx_client as MockClient:
            instance = AsyncMock()
            bad = _mock_response(status_code=500, text="upstream exploded")
            bad.json.side_effect = ValueError("not json")
            instance.post.return_value = bad
            _configure_mock_client(MockClient, instance)

            resp = client.post(
                f"{API_PREFIX}/pair-confirm",
                json={"state": _STATE, "device_id": _DEVICE_ID},
            )

        assert resp.status_code == 502, resp.text
        detail = resp.json()
        assert detail["coord_status"] == 500
        assert detail["coord_body"] == "upstream exploded"
        assert detail["message"] == "Coord refused pairing (HTTP 500)."
        assert not any(
            k in detail for k in ("coord_code", "coord_hint", "coord_skip_reasons")
        )

    def test_unlinked_operator_is_refused_before_any_outbound_call(
        self, client: TestClient
    ) -> None:
        from fastapi import HTTPException

        enabled, _gate, token, httpx_client = _patches()
        gate = patch(
            "app.api.v1.endpoints.devices.get_coord_identity",
            new=AsyncMock(
                side_effect=HTTPException(status_code=403, detail="tenant_not_resolved")
            ),
        )
        with enabled, gate, token, httpx_client as MockClient:
            instance = AsyncMock()
            _configure_mock_client(MockClient, instance)

            resp = client.post(
                f"{API_PREFIX}/pair-confirm",
                json={"state": _STATE, "device_id": _DEVICE_ID},
            )

        assert resp.status_code == 403
        instance.post.assert_not_called()


_TENANT_A = str(uuid4())
_TENANT_B = str(uuid4())


class TestPairConfirmCollectMode:
    """Multi-tenant (collect-mode) flow: coord answers ``collect: true`` plus
    per-tenant ``results``; the runner fetches the tokens itself over
    pair-collect, so web relays the outcomes and never a per-tenant token."""

    def _post(self, client: TestClient, coord_body: dict) -> tuple:
        enabled, gate, token, httpx_client = _patches()
        with enabled, gate, token, httpx_client as MockClient:
            instance = AsyncMock()
            instance.post.return_value = _mock_response(json_data=coord_body)
            _configure_mock_client(MockClient, instance)
            resp = client.post(
                f"{API_PREFIX}/pair-confirm",
                json={"state": _STATE, "device_id": _DEVICE_ID},
            )
        return resp, instance

    def test_legacy_shape_reports_collect_false_and_no_results(
        self, client: TestClient
    ) -> None:
        resp, _ = self._post(client, _COORD_OK)
        assert resp.status_code == 201, resp.text
        assert resp.json()["collect"] is False
        assert resp.json()["results"] is None
        assert resp.json()["token"] == "device-token-jwt"

    def test_collect_mode_passes_results_through_without_tokens(
        self, client: TestClient
    ) -> None:
        coord_body = {
            **_COORD_OK,
            "collect": True,
            "results": [
                # A token smuggled into an entry must NOT reach the browser.
                {"tenant_id": _TENANT_A, "status": "minted", "token": "leak"},
                {
                    "tenant_id": _TENANT_B,
                    "status": "skipped",
                    "skipped_reason": "not_a_member",
                },
            ],
        }
        resp, instance = self._post(client, coord_body)

        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["collect"] is True
        assert data["results"] == [
            {"tenant_id": _TENANT_A, "status": "minted", "skipped_reason": None},
            {
                "tenant_id": _TENANT_B,
                "status": "skipped",
                "skipped_reason": "not_a_member",
            },
        ]
        assert "leak" not in resp.text
        # The first tenant's token coord still returns (for an un-upgraded web)
        # is withheld from the browser in collect mode.
        assert data["token"] is None
        assert "device-token-jwt" not in resp.text
        # The request body to coord is unchanged in collect mode.
        assert instance.post.call_args.kwargs["json"] == {
            "state": _STATE,
            "device_id": _DEVICE_ID,
        }

    def test_collect_mode_does_not_require_a_token(self, client: TestClient) -> None:
        coord_body = {
            "device_id": _DEVICE_ID,
            "collect": True,
            "results": [{"tenant_id": _TENANT_A, "status": "minted"}],
        }
        resp, _ = self._post(client, coord_body)
        assert resp.status_code == 201, resp.text
        assert resp.json()["token"] is None
        assert resp.json()["collect"] is True

    def test_legacy_mode_still_requires_a_token(self, client: TestClient) -> None:
        resp, _ = self._post(client, {"device_id": _DEVICE_ID})
        assert resp.status_code == 502
        assert "missing device_id/token" in resp.text

    @pytest.mark.parametrize(
        "results",
        [
            [{"status": "minted", "token": "leak"}],  # entry missing tenant_id
            {"tenant_id": "x", "token": "leak"},  # not a list
            ["leak"],  # entry is not an object
            [],  # empty
            None,  # missing
        ],
    )
    def test_malformed_results_are_a_502(
        self, client: TestClient, results: object
    ) -> None:
        body: dict = {"device_id": _DEVICE_ID, "token": "leak", "collect": True}
        if results is not None:
            body["results"] = results
        resp, _ = self._post(client, body)
        assert resp.status_code == 502
        assert "malformed results" in resp.text
        assert "leak" not in resp.text

    def test_null_collect_flag_is_the_legacy_flow(self, client: TestClient) -> None:
        resp, _ = self._post(client, {**_COORD_OK, "collect": None})
        assert resp.status_code == 201, resp.text
        assert resp.json()["collect"] is False
        assert resp.json()["token"] == "device-token-jwt"

    @pytest.mark.parametrize("flag", ["true", 1, "1"])
    def test_non_boolean_collect_flag_is_a_502(
        self, client: TestClient, flag: object
    ) -> None:
        resp, _ = self._post(client, {**_COORD_OK, "collect": flag})
        assert resp.status_code == 502
        assert "collect flag" in resp.text
        assert "device-token-jwt" not in resp.text
