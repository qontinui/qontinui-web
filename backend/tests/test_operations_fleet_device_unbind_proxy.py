"""The fleet device-unbind proxy — its body, its per-id outcomes and its abort.

Plan ``2026-11-15-stale-ci-hosts-and-devices-are-removable-from-the-web-console``
Phase 1. ``POST /api/v1/operations/fleet/devices/unbind`` calls coord's
``DELETE /coord/devices/{id}/tenant-binding`` once per id. Same harness as
``test_operations_fleet_dispatch_role_proxy.py``: a minimal FastAPI app and a
mocked ``httpx.AsyncClient``, so no live coord is ever called.

The properties pinned here:

1. **The body is CLOSED**: 1 to 64 ids, unique UUIDs, no other key — anything
   else is a 422 before any coord call.
2. **Each id gets exactly one outcome**: coord 2xx → ``unbound``; 404
   ``binding_not_found`` → ``already_absent``; any other refusal → ``failed``
   with coord's structured body. A batch reports partial success as partial.
3. **A 401/403 aborts the batch** with coord's status, carrying a result for
   every id: those recorded before it, the refused id as ``failed``, and the
   rest as ``not_attempted``.
4. **``still_member_via_pointer`` is never defaulted**: coord's boolean passes
   through, and its absence (an older coord) is ``null``, never ``false``.
5. **The operator bearer and the active-tenant selection are forwarded** on
   every per-id coord call, and the REAL ``require_coord_tenant_admin`` refuses
   a non-admin of the effective tenant before any coord call.
6. **A lost answer is ``unknown``, never ``failed``**: a read timeout, a
   transport error after sending, a gateway 504 or an undocumented 2xx body may
   hide an applied unbind; only a request never sent (connect error or connect
   timeout) is ``failed``.
7. **The batch has a 45 s wall budget**: ids it does not reach are
   ``not_attempted`` and the answer is still a 200, and each call's timeout is
   bounded by what is left of the budget.
"""

import asyncio
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

TEST_TENANT_ID = UUID("7d1e5b8a-3c2f-4a6e-9b0d-1f2e3a4b5c6d")
TEST_BEARER = "test-cognito-access-token"

# Synthetic ids only — never a real fleet device.
DEVICE_A = "11111111-1111-4111-8111-111111111111"
DEVICE_B = "22222222-2222-4222-8222-222222222222"
DEVICE_C = "33333333-3333-4333-8333-333333333333"
DEVICE_D = "44444444-4444-4444-8444-444444444444"


def _build_test_app() -> FastAPI:
    from app.api.deps import get_current_active_user_async

    # The production router, not the module's own: mounted exactly as main.py
    # mounts it, so the test enters where an operator's request does.
    from app.api.v1.api import api_router
    from app.api.v1.endpoints import operations as operations_module
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
    test_app.include_router(api_router, prefix="/api/v1")
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


class _Hang:
    """A queued answer for a coord call that does not return for ``seconds``."""

    def __init__(self, seconds: float) -> None:
        self.seconds = seconds


class _CoordStub:
    """A mocked ``httpx.AsyncClient`` answering ``delete`` by URL, in order.

    A queued ``BaseException`` instance is raised instead of returned, which is
    how a transport failure is simulated.
    """

    def __init__(self, answers: dict[str, list[Any]]) -> None:
        self.answers = answers
        self.calls: list[tuple[str, dict[str, str] | None]] = []
        self.timeouts: list[httpx.Timeout | None] = []

    async def delete(
        self, url: str, params=None, headers=None, timeout=None
    ) -> MagicMock:
        self.calls.append((url, headers))
        self.timeouts.append(timeout)
        for device_id, queue in self.answers.items():
            if url.endswith(f"/coord/devices/{device_id}/tenant-binding"):
                answer = queue.pop(0)
                if isinstance(answer, _Hang):
                    await asyncio.sleep(answer.seconds)
                    raise AssertionError("the call outlived its budget")
                if isinstance(answer, BaseException):
                    raise answer
                return answer
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
        return client.post("/api/v1/operations/fleet/devices/unbind", json=body)
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
            "unknown": 0,
            "failed": 0,
            "not_attempted": 0,
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
            "unknown": 0,
            "failed": 0,
            "not_attempted": 0,
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
            "unknown": 0,
            "failed": 1,
            "not_attempted": 0,
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
            "unknown": 0,
            "failed": 1,
            "not_attempted": 0,
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


def _expected_not_attempted(device_id: str, reason: str) -> dict[str, Any]:
    return {
        "device_id": device_id,
        "outcome": "not_attempted",
        "status": None,
        "error": {"error": "not_attempted", "detail": reason},
        "still_member_via_pointer": None,
    }


_ABORTED = "the batch was aborted by a caller refusal"
_OUT_OF_BUDGET = "the batch's wall-clock budget ran out first"


class TestCallerRefusalAborts:
    def test_401_on_first_id_aborts_and_reports_every_id(self, auth_client: TestClient):
        coord_body = {"error": "unauthorized"}
        stub = _CoordStub(
            {
                DEVICE_A: [_mock_response(401, coord_body)],
                DEVICE_B: [_bound(DEVICE_B)],
            }
        )
        resp = _post(auth_client, stub, {"device_ids": [DEVICE_A, DEVICE_B]})
        # Never 401: the web client would refresh the token and replay the POST.
        assert resp.status_code == 403
        assert resp.json() == {
            "detail": {
                "error": "coord_refused_caller",
                "coord_status": 401,
                "coord_error": coord_body,
                "refused_device_id": DEVICE_A,
                "results": [
                    {
                        "device_id": DEVICE_A,
                        "outcome": "failed",
                        "status": 401,
                        "error": coord_body,
                        "still_member_via_pointer": None,
                    },
                    _expected_not_attempted(DEVICE_B, _ABORTED),
                ],
                "unbound": 0,
                "already_absent": 0,
                "unknown": 0,
                "failed": 1,
                "not_attempted": 1,
            }
        }
        # DEVICE_B was never sent to coord.
        assert len(stub.calls) == 1

    def test_an_aborted_batch_still_logs_its_earlier_lost_row(
        self, auth_client: TestClient
    ):
        import structlog

        stub = _CoordStub(
            {
                DEVICE_A: [
                    _mock_response(503, None, "<html>" + "x" * 2000 + "</html>")
                ],
                DEVICE_B: [_mock_response(403, {"error": "operator_role_required"})],
            }
        )
        with structlog.testing.capture_logs() as logs:
            resp = _post(auth_client, stub, {"device_ids": [DEVICE_A, DEVICE_B]})
        assert resp.status_code == 403
        rows = [e for e in logs if e["event"] == "fleet_devices_unbind_row"]
        assert [r["device_id"] for r in rows] == [DEVICE_A, DEVICE_B]
        assert rows[0]["outcome"] == "unknown"
        assert len(rows[0]["error"]["upstream"]) == 501
        aborted = [e for e in logs if e["event"] == "fleet_devices_unbind_aborted"]
        assert len(aborted) == 1
        assert aborted[0]["unknown"] == 1
        assert aborted[0]["failed"] == 1

    def test_the_production_error_envelope_carries_the_abort_at_top_level(self):
        from starlette.exceptions import HTTPException as StarletteHTTPException

        from app.middleware.error_handler import http_exception_handler

        app = _build_test_app()
        app.add_exception_handler(StarletteHTTPException, http_exception_handler)
        stub = _CoordStub(
            {
                DEVICE_A: [_bound(DEVICE_A)],
                DEVICE_B: [_mock_response(401, {"error": "sso_required"})],
            }
        )
        resp = _post(
            TestClient(app), stub, {"device_ids": [DEVICE_A, DEVICE_B, DEVICE_C]}
        )
        assert resp.status_code == 403
        body = resp.json()
        assert "detail" not in body
        assert body["error"] == "coord_refused_caller"
        assert body["coord_status"] == 401
        assert body["refused_device_id"] == DEVICE_B
        assert [r["outcome"] for r in body["results"]] == [
            "unbound",
            "failed",
            "not_attempted",
        ]
        assert (body["unbound"], body["failed"], body["not_attempted"]) == (1, 1, 1)

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
                "coord_status": 403,
                "coord_error": coord_body,
                "refused_device_id": DEVICE_C,
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
                    {
                        "device_id": DEVICE_C,
                        "outcome": "failed",
                        "status": 403,
                        "error": coord_body,
                        "still_member_via_pointer": None,
                    },
                    _expected_not_attempted(DEVICE_D, _ABORTED),
                ],
                "unbound": 1,
                "already_absent": 1,
                "unknown": 0,
                "failed": 1,
                "not_attempted": 1,
            }
        }
        assert len(stub.calls) == 3


# ---------------------------------------------------------------------------
# Transport failures: never sent -> failed; sent, answer lost -> unknown
# ---------------------------------------------------------------------------


def _request_for(device_id: str) -> httpx.Request:
    return httpx.Request(
        "DELETE", f"http://coord.test/coord/devices/{device_id}/tenant-binding"
    )


class TestTransportFailures:
    @pytest.mark.parametrize("exc_type", ["UnsupportedProtocol", "ProxyError"])
    def test_a_misconfigured_transport_is_failed_nothing_sent(
        self, auth_client: TestClient, exc_type: str
    ):
        exc = getattr(httpx, exc_type)("bad url", request=_request_for(DEVICE_A))
        stub = _CoordStub({DEVICE_A: [exc]})
        resp = _post(auth_client, stub, {"device_ids": [DEVICE_A]})
        row = resp.json()["results"][0]
        assert row["outcome"] == "failed"
        assert row["status"] == 502
        assert row["error"]["error"] == "coord_unreachable"

    def test_connect_error_is_failed_502_nothing_sent(self, auth_client: TestClient):
        stub = _CoordStub(
            {DEVICE_A: [httpx.ConnectError("refused", request=_request_for(DEVICE_A))]}
        )
        resp = _post(auth_client, stub, {"device_ids": [DEVICE_A]})
        assert resp.status_code == 200
        assert resp.json() == {
            "results": [
                {
                    "device_id": DEVICE_A,
                    "outcome": "failed",
                    "status": 502,
                    "error": {
                        "error": "coord_unreachable",
                        "detail": "coord was not reached (ConnectError)",
                    },
                    "still_member_via_pointer": None,
                }
            ],
            "unbound": 0,
            "already_absent": 0,
            "unknown": 0,
            "failed": 1,
            "not_attempted": 0,
        }

    def test_connect_timeout_is_failed_504_nothing_sent(self, auth_client: TestClient):
        stub = _CoordStub(
            {DEVICE_A: [httpx.ConnectTimeout("slow", request=_request_for(DEVICE_A))]}
        )
        resp = _post(auth_client, stub, {"device_ids": [DEVICE_A]})
        assert resp.json()["results"][0] == {
            "device_id": DEVICE_A,
            "outcome": "failed",
            "status": 504,
            "error": {
                "error": "coord_unreachable",
                "detail": "coord was not reached (ConnectTimeout)",
            },
            "still_member_via_pointer": None,
        }

    def test_pool_timeout_is_failed_504_nothing_sent(self, auth_client: TestClient):
        stub = _CoordStub(
            {DEVICE_A: [httpx.PoolTimeout("no slot", request=_request_for(DEVICE_A))]}
        )
        resp = _post(auth_client, stub, {"device_ids": [DEVICE_A]})
        assert resp.status_code == 200
        assert resp.json()["results"] == [
            {
                "device_id": DEVICE_A,
                "outcome": "failed",
                "status": 504,
                "error": {
                    "error": "coord_unreachable",
                    "detail": "coord was not reached (PoolTimeout)",
                },
                "still_member_via_pointer": None,
            }
        ]
        assert resp.json()["failed"] == 1

    @pytest.mark.parametrize("status", [502, 503])
    def test_gateway_502_503_without_a_coord_body_is_unknown(
        self, auth_client: TestClient, status: int
    ):
        stub = _CoordStub({DEVICE_A: [_mock_response(status, None, "Bad Gateway")]})
        resp = _post(auth_client, stub, {"device_ids": [DEVICE_A]})
        assert resp.status_code == 200
        assert resp.json()["results"] == [
            {
                "device_id": DEVICE_A,
                "outcome": "unknown",
                "status": status,
                "error": {
                    "error": "coord_answer_lost",
                    "detail": f"a gateway in front of coord answered {status} "
                    "with no coord body; coord may have acted",
                    "upstream": "Bad Gateway",
                },
                "still_member_via_pointer": None,
            }
        ]
        assert resp.json()["unknown"] == 1

    def test_gateway_503_with_its_own_json_body_is_unknown(
        self, auth_client: TestClient
    ):
        gateway_body = {"message": "Service Unavailable"}
        stub = _CoordStub({DEVICE_A: [_mock_response(503, gateway_body)]})
        resp = _post(auth_client, stub, {"device_ids": [DEVICE_A]})
        assert resp.status_code == 200
        row = resp.json()["results"][0]
        assert row["outcome"] == "unknown"
        assert row["status"] == 503
        assert row["error"]["error"] == "coord_answer_lost"
        assert resp.json()["unknown"] == 1
        assert resp.json()["failed"] == 0

    def test_coords_own_structured_502_stays_failed(self, auth_client: TestClient):
        coord_body = {"error": "github_unreachable"}
        stub = _CoordStub({DEVICE_A: [_mock_response(502, coord_body)]})
        resp = _post(auth_client, stub, {"device_ids": [DEVICE_A]})
        assert resp.json()["results"][0]["outcome"] == "failed"
        assert resp.json()["results"][0]["error"] == coord_body

    def test_read_timeout_is_unknown_never_failed(self, auth_client: TestClient):
        stub = _CoordStub(
            {
                DEVICE_A: [httpx.ReadTimeout("slow", request=_request_for(DEVICE_A))],
                DEVICE_B: [_bound(DEVICE_B)],
            }
        )
        resp = _post(auth_client, stub, {"device_ids": [DEVICE_A, DEVICE_B]})
        assert resp.status_code == 200
        assert resp.json() == {
            "results": [
                {
                    "device_id": DEVICE_A,
                    "outcome": "unknown",
                    "status": 504,
                    "error": {
                        "error": "coord_answer_lost",
                        "detail": "coord did not answer in time (ReadTimeout); "
                        "it may have acted",
                    },
                    "still_member_via_pointer": None,
                },
                {
                    "device_id": DEVICE_B,
                    "outcome": "unbound",
                    "status": 200,
                    "error": None,
                    "still_member_via_pointer": None,
                },
            ],
            "unbound": 1,
            "already_absent": 0,
            "unknown": 1,
            "failed": 0,
            "not_attempted": 0,
        }

    @pytest.mark.parametrize(
        "exc_type", [httpx.ReadError, httpx.RemoteProtocolError, httpx.WriteError]
    )
    def test_answer_lost_in_transit_is_unknown(
        self, auth_client: TestClient, exc_type: type[httpx.TransportError]
    ):
        stub = _CoordStub(
            {DEVICE_A: [exc_type("gone", request=_request_for(DEVICE_A))]}
        )
        resp = _post(auth_client, stub, {"device_ids": [DEVICE_A]})
        assert resp.status_code == 200
        assert resp.json()["results"] == [
            {
                "device_id": DEVICE_A,
                "outcome": "unknown",
                "status": 502,
                "error": {
                    "error": "coord_answer_lost",
                    "detail": "coord's answer was lost in transit "
                    f"({exc_type.__name__}); it may have acted",
                },
                "still_member_via_pointer": None,
            }
        ]
        assert resp.json()["unknown"] == 1

    def test_non_json_2xx_is_unknown(self, auth_client: TestClient):
        stub = _CoordStub({DEVICE_A: [_mock_response(200, None, "<html>ok</html>")]})
        resp = _post(auth_client, stub, {"device_ids": [DEVICE_A]})
        assert resp.status_code == 200
        assert resp.json()["results"] == [
            {
                "device_id": DEVICE_A,
                "outcome": "unknown",
                "status": 200,
                "error": {
                    "error": "coord_answer_lost",
                    "detail": "coord answered 200 with a non-JSON body",
                },
                "still_member_via_pointer": None,
            }
        ]
        assert resp.json()["unknown"] == 1

    def test_2xx_without_binding_deleted_is_unknown(self, auth_client: TestClient):
        stub = _CoordStub({DEVICE_A: [_mock_response(200, {"status": "ok"})]})
        resp = _post(auth_client, stub, {"device_ids": [DEVICE_A]})
        assert resp.json()["results"][0]["outcome"] == "unknown"
        assert resp.json()["results"][0]["error"] == {
            "error": "coord_answer_lost",
            "detail": "coord answered 200 without its documented binding_deleted: true",
        }

    def test_gateway_504_response_is_unknown(self, auth_client: TestClient):
        stub = _CoordStub({DEVICE_A: [_mock_response(504, None, "Gateway Timeout")]})
        resp = _post(auth_client, stub, {"device_ids": [DEVICE_A]})
        assert resp.json()["results"] == [
            {
                "device_id": DEVICE_A,
                "outcome": "unknown",
                "status": 504,
                "error": {
                    "error": "coord_answer_lost",
                    "detail": "a gateway in front of coord timed out; "
                    "coord may have acted",
                    "upstream": "Gateway Timeout",
                },
                "still_member_via_pointer": None,
            }
        ]


# ---------------------------------------------------------------------------
# The batch's wall-clock budget
# ---------------------------------------------------------------------------


class _Clock:
    """A monotonic clock that returns the queued readings, in order."""

    def __init__(self, readings: list[float]) -> None:
        self.readings = readings

    def __call__(self) -> float:
        return self.readings.pop(0)


class TestDeadline:
    def test_ids_past_the_budget_are_not_attempted_and_the_answer_is_200(
        self, auth_client: TestClient, monkeypatch: pytest.MonkeyPatch
    ):
        from app.api.v1.endpoints import fleet_device_bindings

        # Start at 0 (deadline 45); A is sent at 0, B is checked at 46.
        monkeypatch.setattr(
            fleet_device_bindings, "_monotonic", _Clock([0.0, 0.0, 46.0])
        )
        stub = _CoordStub({DEVICE_A: [_bound(DEVICE_A)]})
        resp = _post(auth_client, stub, {"device_ids": [DEVICE_A, DEVICE_B, DEVICE_C]})
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
                _expected_not_attempted(DEVICE_B, _OUT_OF_BUDGET),
                _expected_not_attempted(DEVICE_C, _OUT_OF_BUDGET),
            ],
            "unbound": 1,
            "already_absent": 0,
            "unknown": 0,
            "failed": 0,
            "not_attempted": 2,
        }
        assert len(stub.calls) == 1

    def test_each_call_is_bounded_by_the_remaining_budget(
        self, auth_client: TestClient, monkeypatch: pytest.MonkeyPatch
    ):
        from app.api.v1.endpoints import fleet_device_bindings

        # A is sent with 45 s left (the 5 s coord timeout binds), B with 2 s,
        # whose httpx timeout keeps a 0.1 s margin under the wait_for budget.
        monkeypatch.setattr(
            fleet_device_bindings, "_monotonic", _Clock([0.0, 0.0, 43.0])
        )
        stub = _CoordStub({DEVICE_A: [_bound(DEVICE_A)], DEVICE_B: [_bound(DEVICE_B)]})
        resp = _post(auth_client, stub, {"device_ids": [DEVICE_A, DEVICE_B]})
        assert resp.json()["unbound"] == 2
        assert [t.read if t is not None else None for t in stub.timeouts] == [
            5.0,
            1.9,
        ]

    def test_a_call_still_waiting_when_the_budget_ends_is_unknown(
        self, auth_client: TestClient, monkeypatch: pytest.MonkeyPatch
    ):
        from app.api.v1.endpoints import fleet_device_bindings

        # 0.6 s of budget left when A is sent; coord would take 5 s.
        monkeypatch.setattr(
            fleet_device_bindings, "_monotonic", _Clock([0.0, 44.4, 46.0])
        )
        stub = _CoordStub({DEVICE_A: [_Hang(5.0)]})
        resp = _post(auth_client, stub, {"device_ids": [DEVICE_A, DEVICE_B]})
        assert resp.status_code == 200
        assert resp.json() == {
            "results": [
                {
                    "device_id": DEVICE_A,
                    "outcome": "unknown",
                    "status": 504,
                    "error": {
                        "error": "coord_answer_lost",
                        "detail": "the batch's wall-clock budget ran out while "
                        "waiting for coord; it may have acted",
                    },
                    "still_member_via_pointer": None,
                },
                _expected_not_attempted(DEVICE_B, _OUT_OF_BUDGET),
            ],
            "unbound": 0,
            "already_absent": 0,
            "unknown": 1,
            "failed": 0,
            "not_attempted": 1,
        }

    def test_a_sliver_of_budget_is_not_attempted_rather_than_sent(
        self, auth_client: TestClient, monkeypatch: pytest.MonkeyPatch
    ):
        from app.api.v1.endpoints import fleet_device_bindings

        # 0.3 s left when A would be sent: under the 0.5 s floor.
        monkeypatch.setattr(
            fleet_device_bindings, "_monotonic", _Clock([0.0, 44.7, 44.8])
        )
        stub = _CoordStub({})
        resp = _post(auth_client, stub, {"device_ids": [DEVICE_A, DEVICE_B]})
        assert resp.status_code == 200
        assert [r["outcome"] for r in resp.json()["results"]] == [
            "not_attempted",
            "not_attempted",
        ]
        assert stub.calls == []

    def test_a_long_raw_error_body_is_truncated_in_the_log(
        self, auth_client: TestClient
    ):
        import structlog

        stub = _CoordStub(
            {DEVICE_A: [_mock_response(404, None, "<html>" + "y" * 3000 + "</html>")]}
        )
        with structlog.testing.capture_logs() as logs:
            resp = _post(auth_client, stub, {"device_ids": [DEVICE_A]})
        assert resp.json()["results"][0]["outcome"] == "failed"
        rows = [e for e in logs if e["event"] == "fleet_devices_unbind_row"]
        assert len(rows) == 1
        assert len(rows[0]["error"]) == 501

    def test_the_budget_is_45_seconds(self):
        from app.api.v1.endpoints import fleet_device_bindings

        assert fleet_device_bindings.BATCH_DEADLINE_SECONDS == 45.0


# ---------------------------------------------------------------------------
# The real operator gate, and what it forwards to coord
# ---------------------------------------------------------------------------

_HOME_TENANT = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
_OTHER_TENANT = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")


def _identity(home_roles: tuple[str, ...], other_roles: tuple[str, ...]) -> Any:
    from app.services.coord_identity import CoordIdentity, CoordTenant

    return CoordIdentity(
        operator_id=uuid4(),
        home_tenant_id=_HOME_TENANT,
        email="operator@example.com",
        roles=("admin",),
        tenants=(
            CoordTenant(tenant_id=_HOME_TENANT, slug="home", roles=home_roles),
            CoordTenant(tenant_id=_OTHER_TENANT, slug="other", roles=other_roles),
        ),
        # A union across tenants — the gate must not trust it.
        is_admin=True,
    )


def _real_gate_client() -> TestClient:
    """The production router with ONLY the gate's inputs faked: the signed-in
    user (not a superuser) and coord's ``/me`` identity. The real
    ``require_coord_tenant_admin`` runs."""
    from app.api.deps import get_current_active_user_async
    from app.api.v1.api import api_router

    app = FastAPI()
    user = MagicMock()
    user.id = uuid4()
    user.is_active = True
    user.is_superuser = False
    app.dependency_overrides[get_current_active_user_async] = lambda: user
    app.include_router(api_router, prefix="/api/v1")
    return TestClient(app)


def _post_as_operator(
    stub: _CoordStub, identity: Any, active_tenant: UUID
) -> httpx.Response:
    from tests._ops_patch import patch_ops

    patcher = _patched(stub)
    try:
        with patch_ops("get_coord_identity", new=AsyncMock(return_value=identity)):
            return _real_gate_client().post(
                "/api/v1/operations/fleet/devices/unbind",
                json={"device_ids": [DEVICE_A]},
                headers={
                    "Authorization": f"Bearer {TEST_BEARER}",
                    "X-Qontinui-Active-Tenant": str(active_tenant),
                },
            )
    finally:
        patcher.stop()


class TestOperatorGate:
    def test_non_admin_in_the_effective_tenant_is_refused_before_any_coord_call(
        self,
    ):
        # Admin at home, only developer in the selected tenant: refused there.
        identity = _identity(home_roles=("admin",), other_roles=("developer",))
        stub = _CoordStub({})
        resp = _post_as_operator(stub, identity, _OTHER_TENANT)
        assert resp.status_code == 403
        assert resp.json() == {"detail": "not_coord_tenant_admin"}
        assert stub.calls == []

    def test_admin_selection_and_bearer_are_forwarded_to_coord(self):
        identity = _identity(home_roles=("developer",), other_roles=("admin",))
        stub = _CoordStub({DEVICE_A: [_bound(DEVICE_A)]})
        resp = _post_as_operator(stub, identity, _OTHER_TENANT)
        assert resp.status_code == 200
        assert resp.json()["unbound"] == 1
        assert len(stub.calls) == 1
        url, headers = stub.calls[0]
        assert url.endswith(f"/coord/devices/{DEVICE_A}/tenant-binding")
        assert headers == {
            "Authorization": f"Bearer {TEST_BEARER}",
            "X-Qontinui-Active-Tenant": str(_OTHER_TENANT),
        }
