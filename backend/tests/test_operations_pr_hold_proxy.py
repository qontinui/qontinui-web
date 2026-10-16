"""The PR hold proxy forwards exactly coord's ``HoldBody`` contract.

Plan ``2026-10-04-coord-pr-hold-without-github-drafts``, Phase 4. The proxy
``POST /api/v1/operations/prs/{owner}/{repo}/{number}/hold`` replaced the
``/draft-state`` proxy. coord's ``HoldBody`` is ``deny_unknown_fields``, so the
proxy forwards only ``held`` / ``reason`` / ``kind`` / ``gate_id``.

Pinned here:

* the coord path and the forwarded body (place and release);
* a non-boolean or missing ``held`` is a 400 and nothing reaches coord;
* a non-string optional field is a 400 and nothing reaches coord;
* unknown client keys are dropped rather than forwarded;
* the route is gated on ``require_coord_tenant_admin`` (route-table fixture
  pins the dependency list; here we assert the gate's tenant is forwarded);
* the ``/draft-state`` proxy is gone.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests._ops_patch import patch_ops

API_PREFIX = "/api/v1/operations"
TENANT = UUID("11111111-1111-1111-1111-111111111111")
HOLD = f"{API_PREFIX}/prs/qontinui/qontinui-coord/42/hold"


def _build_test_app() -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import require_coord_tenant_admin
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.is_active = True
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    test_app.dependency_overrides[require_coord_tenant_admin] = lambda: TENANT
    test_app.include_router(operations_router, prefix=API_PREFIX)
    return test_app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(_build_test_app())


def test_place_forwards_held_and_reason_to_the_coord_route(client: TestClient):
    with patch_ops("_proxy_coord_post", new_callable=AsyncMock) as proxy:
        proxy.return_value = {"status": "held"}
        resp = client.post(HOLD, json={"held": True, "reason": "waiting on web"})

    assert resp.status_code == 200
    assert resp.json() == {"status": "held"}
    path, body = proxy.call_args.args
    assert path == "/coord/repos/qontinui/qontinui-coord/pull-requests/42/hold"
    assert body == {"held": True, "reason": "waiting on web"}
    assert proxy.call_args.kwargs["tenant_id"] == TENANT


def test_release_forwards_only_held(client: TestClient):
    with patch_ops("_proxy_coord_post", new_callable=AsyncMock) as proxy:
        proxy.return_value = {"status": "released"}
        resp = client.post(HOLD, json={"held": False})

    assert resp.status_code == 200
    assert proxy.call_args.args[1] == {"held": False}


def test_optional_fields_pass_and_unknown_keys_are_dropped(client: TestClient):
    with patch_ops("_proxy_coord_post", new_callable=AsyncMock) as proxy:
        proxy.return_value = {}
        client.post(
            HOLD,
            json={
                "held": True,
                "reason": "r",
                "kind": "migration_order",
                "gate_id": "00000000-0000-0000-0000-000000000001",
                "draft": True,
                "tenant_id": "x",
            },
        )

    assert proxy.call_args.args[1] == {
        "held": True,
        "reason": "r",
        "kind": "migration_order",
        "gate_id": "00000000-0000-0000-0000-000000000001",
    }


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"held": "true"},
        {"held": 1},
        {"draft": True},
        {"held": True, "reason": 5},
        {"held": True, "reason": "r", "kind": ["manual"]},
    ],
)
def test_malformed_body_is_400_and_reaches_no_coord(client: TestClient, body):
    with patch_ops("_proxy_coord_post", new_callable=AsyncMock) as proxy:
        resp = client.post(HOLD, json=body)

    assert resp.status_code == 400
    proxy.assert_not_called()


def test_draft_state_proxy_is_gone(client: TestClient):
    resp = client.post(
        f"{API_PREFIX}/prs/qontinui/qontinui-coord/42/draft-state",
        json={"draft": True},
    )
    assert resp.status_code in (404, 405)
