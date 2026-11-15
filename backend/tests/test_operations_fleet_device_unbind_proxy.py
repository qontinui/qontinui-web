"""The fleet device-unbind proxy — its body, its per-id outcomes and its abort.

Plan ``2026-11-15-stale-ci-hosts-and-devices-are-removable-from-the-web-console``
Phase 1. ``POST /api/v1/operations/fleet/devices/unbind`` calls coord's
``DELETE /coord/devices/{id}/tenant-binding`` once per id. Same harness as
``test_operations_fleet_dispatch_role_proxy.py``: a minimal FastAPI app and a
mocked ``httpx.AsyncClient``, so no live coord is ever called.

The properties pinned here:

1. **The body is CLOSED**: 1 to 64 ids, unique UUIDs, no other key — anything
   else is a 422 before any coord call.
2. **Each id gets its own outcome**: coord 2xx → ``unbound``; 404
   ``binding_not_found`` → ``already_absent``; any other refusal → ``failed``
   with coord's structured body. A batch reports partial success as partial.
3. **A 401/403 aborts the batch** with coord's status, carrying every result
   recorded before it and the ids not attempted.
4. **``still_member_via_pointer`` is never defaulted**: coord's boolean passes
   through, and its absence (an older coord) is ``null``, never ``false``.
5. **The operator bearer is forwarded** on every per-id coord call.
"""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

TEST_TENANT_ID = UUID("7d1e5b8a-3c2f-4a6e-9b0d-1f2e3a4b5c6d")
ROUTE = "/api/v1/operations/fleet/devices/unbind"
TEST_BEARER = "test-cognito-access-token"

# Synthetic ids only — never a real fleet device.
DEVICE_A = "11111111-1111-4111-8111-111111111111"
DEVICE_B = "22222222-2222-4222-8222-222222222222"
DEVICE_C = "33333333-3333-4333-8333-333333333333"
DEVICE_D = "44444444-4444-4444-8444-444444444444"


def _build_test_app() -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints import operations as operations_module
    from app.api.v1.endpoints.fleet_device_bindings import router
    from app.api.v1.endpoints.operations import require_coord_tenant_admin

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.is_active = True
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user

    async def _tenant_override() -> UUID:
        # `async def` is load-bearing: `_tenant_headers` reads the bearer out
        # of a ContextVar a sync dependency's worker thread would not reach.
        operations_module._caller_bearer.set(TEST_BEARER)
        return TEST_TENANT_ID

    test_app.dependency_overrides[require_coord_tenant_admin] = _tenant_override
    test_app.include_router(router, prefix="/api/v1/operations")
    return test_app


@pytest.fixture()
def auth_client() -> TestClient:
    return TestClient(_build_test_app())


def _mock_response(
    status_code: int, json_data: Any = None, text: str = ""
) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    if json_data is None:
        resp.json.side_effect = ValueError("no json")
    else:
        resp.json.return_value = json_data
    resp.text = text or (str(json_data) if json_data is not None else "")
    resp.content = resp.text.encode()
    return resp


def _bound(device_id: str, **extra: Any) -> MagicMock:
    return _mock_response(
        200,
        {
            "device_id": device_id,
            "tenant_id": str(TEST_TENANT_ID),
            "binding_deleted": True,
            **extra,
        },
    )


def _not_found(device_id: str) -> MagicMock:
    return _mock_response(
        404,
        {
            "error": "binding_not_found",
            "device_id": device_id,
            "tenant_id": str(TEST_TENANT_ID),
        },
    )


class _CoordStub:
    """A mocked ``httpx.AsyncClient`` answering ``delete`` by URL, in order."""

    def __init__(self, answers: dict[str, list[MagicMock]]) -> None:
        self.answers = answers
        self.calls: list[tuple[str, dict[str, str] | None]] = []

    async def delete(self, url: str, params=None, headers=None) -> MagicMock:
        self.calls.append((url, headers))
        for device_id, queue in self.answers.items():
            if url.endswith(f"/coord/devices/{device_id}/tenant-binding"):
                return queue.pop(0)
        raise AssertionError(f"unexpected coord call: {url}")


def _patched(stub: _CoordStub):
    patcher = patch("app.api.v1.endpoints.operations.httpx.AsyncClient")
    MockClient = patcher.start()
    instance = MagicMock()
    instance.__aenter__ = AsyncMock(return_value=instance)
    instance.__aexit__ = AsyncMock(return_value=False)
    instance.delete = stub.delete
    MockClient.return_value = instance
    return patcher


def _post(client: TestClient, stub: _CoordStub, body: Any) -> httpx.Response:
    patcher = _patched(stub)
    try:
        return client.post(ROUTE, json=body)
    finally:
        patcher.stop()


# ---------------------------------------------------------------------------
# The closed body
# ---------------------------------------------------------------------------


class TestBodyValidation:
    def test_zero_ids_is_422_and_never_reaches_coord(self, auth_client: TestClient):
        stub = _CoordStub({})
        resp = _post(auth_client, stub, {"device_ids": []})
        assert resp.status_code == 422
        assert stub.calls == []

    def test_duplicate_ids_is_422(self, auth_client: TestClient):
        stub = _CoordStub({})
        resp = _post(auth_client, stub, {"device_ids": [DEVICE_A, DEVICE_A]})
        assert resp.status_code == 422
        assert "device_ids must not contain duplicates" in resp.text
        assert stub.calls == []

    def test_more_than_64_ids_is_422(self, auth_client: TestClient):
        stub = _CoordStub({})
        ids = [str(uuid4()) for _ in range(65)]
        resp = _post(auth_client, stub, {"device_ids": ids})
        assert resp.status_code == 422
        assert stub.calls == []

    def test_exactly_64_ids_is_accepted(self, auth_client: TestClient):
        ids = [str(uuid4()) for _ in range(64)]
        stub = _CoordStub({i: [_bound(i)] for i in ids})
        resp = _post(auth_client, stub, {"device_ids": ids})
        assert resp.status_code == 200
        assert resp.json()["unbound"] == 64
        assert len(stub.calls) == 64

    def test_non_uuid_id_is_422(self, auth_client: TestClient):
        stub = _CoordStub({})
        resp = _post(auth_client, stub, {"device_ids": ["not-a-uuid"]})
        assert resp.status_code == 422
        assert stub.calls == []

    def test_extra_key_is_422(self, auth_client: TestClient):
        stub = _CoordStub({})
        resp = _post(
            auth_client, stub, {"device_ids": [DEVICE_A], "tenant_id": DEVICE_B}
        )
        assert resp.status_code == 422
        assert stub.calls == []


# ---------------------------------------------------------------------------
# Per-id outcomes
# ---------------------------------------------------------------------------


class TestOutcomes:
    def test_one_id_unbound_forwards_bearer_to_coords_route(
        self, auth_client: TestClient
    ):
        stub = _CoordStub({DEVICE_A: [_bound(DEVICE_A)]})
        resp = _post(auth_client, stub, {"device_ids": [DEVICE_A]})
        assert resp.status_code == 200
        assert resp.json() == {
            "results": [
                {
                    "device_id": DEVICE_A,
                    "outcome": "unbound",
                    "status": 200,
                    "error": None,
                    "still_member_via_pointer": None,
                }
            ],
            "unbound": 1,
            "already_absent": 0,
            "failed": 0,
        }
        assert len(stub.calls) == 1
        url, headers = stub.calls[0]
        assert url.endswith(f"/coord/devices/{DEVICE_A}/tenant-binding")
        assert headers == {"Authorization": f"Bearer {TEST_BEARER}"}

    def test_binding_not_found_is_already_absent(self, auth_client: TestClient):
        stub = _CoordStub({DEVICE_A: [_not_found(DEVICE_A)]})
        resp = _post(auth_client, stub, {"device_ids": [DEVICE_A]})
        assert resp.status_code == 200
        assert resp.json() == {
            "results": [
                {
                    "device_id": DEVICE_A,
                    "outcome": "already_absent",
                    "status": 404,
                    "error": {
                        "error": "binding_not_found",
                        "device_id": DEVICE_A,
                        "tenant_id": str(TEST_TENANT_ID),
                    },
                    "still_member_via_pointer": None,
                }
            ],
            "unbound": 0,
            "already_absent": 1,
            "failed": 0,
        }

    def test_bare_404_without_binding_not_found_is_failed(
        self, auth_client: TestClient
    ):
        # A coord predating the route answers an empty 404 — that says nothing
        # about the binding, so it must not read as "already absent".
        stub = _CoordStub({DEVICE_A: [_mock_response(404, None, "")]})
        resp = _post(auth_client, stub, {"device_ids": [DEVICE_A]})
        assert resp.status_code == 200
        assert resp.json()["results"] == [
            {
                "device_id": DEVICE_A,
                "outcome": "failed",
                "status": 404,
                "error": "",
                "still_member_via_pointer": None,
            }
        ]
        assert resp.json()["failed"] == 1

    def test_tenant_devices_absent_503_is_failed_with_coords_body(
        self, auth_client: TestClient
    ):
        coord_body = {
            "error": "tenant_devices_absent",
            "detail": "coord.tenant_devices is not provisioned in this database, "
            "so whether the device is bound is UNKNOWN",
        }
        stub = _CoordStub({DEVICE_A: [_mock_response(503, coord_body)]})
        resp = _post(auth_client, stub, {"device_ids": [DEVICE_A]})
        assert resp.status_code == 200
        assert resp.json() == {
            "results": [
                {
                    "device_id": DEVICE_A,
                    "outcome": "failed",
                    "status": 503,
                    "error": coord_body,
                    "still_member_via_pointer": None,
                }
            ],
            "unbound": 0,
            "already_absent": 0,
            "failed": 1,
        }

    def test_500_is_failed_with_coords_body(self, auth_client: TestClient):
        coord_body = {"error": "tenant_device_binding_delete_failed"}
        stub = _CoordStub({DEVICE_A: [_mock_response(500, coord_body)]})
        resp = _post(auth_client, stub, {"device_ids": [DEVICE_A]})
        assert resp.status_code == 200
        assert resp.json()["results"] == [
            {
                "device_id": DEVICE_A,
                "outcome": "failed",
                "status": 500,
                "error": coord_body,
                "still_member_via_pointer": None,
            }
        ]

    def test_many_ids_mixed_outcomes_are_reported_per_id(self, auth_client: TestClient):
        stub = _CoordStub(
            {
                DEVICE_A: [_bound(DEVICE_A)],
                DEVICE_B: [_not_found(DEVICE_B)],
                DEVICE_C: [_mock_response(500, {"error": "db_error"})],
                DEVICE_D: [_bound(DEVICE_D, still_member_via_pointer=False)],
            }
        )
        resp = _post(
            auth_client,
            stub,
            {"device_ids": [DEVICE_A, DEVICE_B, DEVICE_C, DEVICE_D]},
        )
        assert resp.status_code == 200
        assert resp.json() == {
            "results": [
                {
                    "device_id": DEVICE_A,
                    "outcome": "unbound",
                    "status": 200,
                    "error": None,
                    "still_member_via_pointer": None,
                },
                {
                    "device_id": DEVICE_B,
                    "outcome": "already_absent",
                    "status": 404,
                    "error": {
                        "error": "binding_not_found",
                        "device_id": DEVICE_B,
                        "tenant_id": str(TEST_TENANT_ID),
                    },
                    "still_member_via_pointer": None,
                },
                {
                    "device_id": DEVICE_C,
                    "outcome": "failed",
                    "status": 500,
                    "error": {"error": "db_error"},
                    "still_member_via_pointer": None,
                },
                {
                    "device_id": DEVICE_D,
                    "outcome": "unbound",
                    "status": 200,
                    "error": None,
                    "still_member_via_pointer": False,
                },
            ],
            "unbound": 2,
            "already_absent": 1,
            "failed": 1,
        }
        # Called in request order, once per id.
        assert [url.rsplit("/", 2)[-2] for url, _ in stub.calls] == [
            DEVICE_A,
            DEVICE_B,
            DEVICE_C,
            DEVICE_D,
        ]

    def test_same_id_twice_across_calls_is_unbound_then_already_absent(
        self, auth_client: TestClient
    ):
        stub = _CoordStub({DEVICE_A: [_bound(DEVICE_A), _not_found(DEVICE_A)]})
        first = _post(auth_client, stub, {"device_ids": [DEVICE_A]})
        second = _post(auth_client, stub, {"device_ids": [DEVICE_A]})
        assert first.json()["results"][0]["outcome"] == "unbound"
        assert first.json()["unbound"] == 1
        assert second.json()["results"][0]["outcome"] == "already_absent"
        assert second.json()["already_absent"] == 1
        assert second.json()["unbound"] == 0


class TestStillMemberViaPointer:
    def test_true_passes_through(self, auth_client: TestClient):
        stub = _CoordStub({DEVICE_A: [_bound(DEVICE_A, still_member_via_pointer=True)]})
        resp = _post(auth_client, stub, {"device_ids": [DEVICE_A]})
        assert resp.json()["results"][0]["still_member_via_pointer"] is True

    def test_false_passes_through(self, auth_client: TestClient):
        stub = _CoordStub(
            {DEVICE_A: [_bound(DEVICE_A, still_member_via_pointer=False)]}
        )
        resp = _post(auth_client, stub, {"device_ids": [DEVICE_A]})
        assert resp.json()["results"][0]["still_member_via_pointer"] is False

    def test_absent_is_null_never_false(self, auth_client: TestClient):
        stub = _CoordStub({DEVICE_A: [_bound(DEVICE_A)]})
        resp = _post(auth_client, stub, {"device_ids": [DEVICE_A]})
        assert resp.json()["results"][0]["still_member_via_pointer"] is None

    def test_non_boolean_is_null(self, auth_client: TestClient):
        stub = _CoordStub(
            {DEVICE_A: [_bound(DEVICE_A, still_member_via_pointer="yes")]}
        )
        resp = _post(auth_client, stub, {"device_ids": [DEVICE_A]})
        assert resp.json()["results"][0]["still_member_via_pointer"] is None


# ---------------------------------------------------------------------------
# Caller refusals abort the batch
# ---------------------------------------------------------------------------


class TestCallerRefusalAborts:
    def test_401_on_first_id_aborts_with_nothing_recorded(
        self, auth_client: TestClient
    ):
        coord_body = {"error": "unauthorized"}
        stub = _CoordStub(
            {
                DEVICE_A: [_mock_response(401, coord_body)],
                DEVICE_B: [_bound(DEVICE_B)],
            }
        )
        resp = _post(auth_client, stub, {"device_ids": [DEVICE_A, DEVICE_B]})
        assert resp.status_code == 401
        assert resp.json() == {
            "detail": {
                "error": "coord_refused_caller",
                "coord_error": coord_body,
                "refused_device_id": DEVICE_A,
                "not_attempted": [DEVICE_B],
                "results": [],
                "unbound": 0,
                "already_absent": 0,
                "failed": 0,
            }
        }
        # DEVICE_B was never sent to coord.
        assert len(stub.calls) == 1

    def test_403_on_later_id_aborts_keeping_recorded_results(
        self, auth_client: TestClient
    ):
        coord_body = {"error": "admin_required"}
        stub = _CoordStub(
            {
                DEVICE_A: [_bound(DEVICE_A, still_member_via_pointer=True)],
                DEVICE_B: [_not_found(DEVICE_B)],
                DEVICE_C: [_mock_response(403, coord_body)],
                DEVICE_D: [_bound(DEVICE_D)],
            }
        )
        resp = _post(
            auth_client,
            stub,
            {"device_ids": [DEVICE_A, DEVICE_B, DEVICE_C, DEVICE_D]},
        )
        assert resp.status_code == 403
        assert resp.json() == {
            "detail": {
                "error": "coord_refused_caller",
                "coord_error": coord_body,
                "refused_device_id": DEVICE_C,
                "not_attempted": [DEVICE_D],
                "results": [
                    {
                        "device_id": DEVICE_A,
                        "outcome": "unbound",
                        "status": 200,
                        "error": None,
                        "still_member_via_pointer": True,
                    },
                    {
                        "device_id": DEVICE_B,
                        "outcome": "already_absent",
                        "status": 404,
                        "error": {
                            "error": "binding_not_found",
                            "device_id": DEVICE_B,
                            "tenant_id": str(TEST_TENANT_ID),
                        },
                        "still_member_via_pointer": None,
                    },
                ],
                "unbound": 1,
                "already_absent": 1,
                "failed": 0,
            }
        }
        assert len(stub.calls) == 3


class TestOperatorGate:
    def test_non_admin_is_refused_before_any_coord_call(self):
        from fastapi import HTTPException

        from app.api.v1.endpoints.fleet_device_bindings import router
        from app.api.v1.endpoints.operations import require_coord_tenant_admin

        app = FastAPI()

        async def _deny() -> UUID:
            raise HTTPException(status_code=403, detail="not_coord_tenant_admin")

        app.dependency_overrides[require_coord_tenant_admin] = _deny
        app.include_router(router, prefix="/api/v1/operations")
        stub = _CoordStub({})
        resp = _post(TestClient(app), stub, {"device_ids": [DEVICE_A]})
        assert resp.status_code == 403
        assert resp.json() == {"detail": "not_coord_tenant_admin"}
        assert stub.calls == []
