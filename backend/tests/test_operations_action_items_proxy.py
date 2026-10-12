"""Tests for the ``/api/v1/operations/action-items*`` coord proxy.

Plan ``2026-10-12-operator-action-items-pushed-to-the-phone`` Phase 3, modelled
on ``test_operations_notifications_proxy.py``:

* ``GET /action-items`` forwards ``status`` / ``limit`` / ``cursor`` /
  ``item_id`` verbatim and only when set; coord owns defaults and clamps.
* ``POST /action-items/resolve`` is typed and ``extra="forbid"``: a status
  outside ``done|dismissed``, a non-UUID id, an over-long note or an unknown
  field never reaches coord.

Coord is mocked throughout — no live coord, no DB.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from tests._ops_patch import patch_ops

PROXY_GET = "_proxy_coord_get"
PROXY_POST = "_proxy_coord_post"

TENANT = UUID("11111111-2222-3333-4444-555555555555")
LIST = "/api/v1/operations/action-items"
RESOLVE = "/api/v1/operations/action-items/resolve"


def _member_user() -> MagicMock:
    u = MagicMock()
    u.id = uuid4()
    u.email = "dev@example.com"
    u.is_active = True
    u.is_verified = True
    u.is_superuser = False
    return u


def _build_app() -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import get_tenant_id, router

    test_app = FastAPI()
    test_app.dependency_overrides[get_current_active_user_async] = _member_user
    test_app.dependency_overrides[get_tenant_id] = lambda: TENANT
    test_app.include_router(router, prefix="/api/v1/operations")
    return test_app


class TestListProxy:
    def test_forwards_every_param_verbatim(self):
        item = str(uuid4())
        with patch_ops(PROXY_GET, new=AsyncMock(return_value={})) as mock_get:
            TestClient(_build_app()).get(
                f"{LIST}?status=all&limit=7&cursor=opaque&item_id={item}"
            )
        assert mock_get.call_args[0][0] == "/coord/operator-action-items"
        assert mock_get.call_args[1]["params"] == {
            "status": "all",
            "limit": 7,
            "cursor": "opaque",
            "item_id": item,
        }
        assert mock_get.call_args[1]["tenant_id"] == TENANT
        # Coord's typed refusal must reach the page as a code, not as text.
        assert mock_get.call_args[1]["structured_errors"] is True

    def test_sends_no_params_when_none_set(self):
        with patch_ops(PROXY_GET, new=AsyncMock(return_value={})) as mock_get:
            TestClient(_build_app()).get(LIST)
        assert mock_get.call_args[1]["params"] is None

    def test_limit_and_status_are_not_validated_here(self):
        # Coord owns the vocabulary and the clamp — one place.
        with patch_ops(PROXY_GET, new=AsyncMock(return_value={})) as mock_get:
            TestClient(_build_app()).get(f"{LIST}?status=bogus&limit=100000")
        assert mock_get.call_args[1]["params"] == {"status": "bogus", "limit": 100000}

    def test_passes_the_envelope_through_untouched(self):
        envelope = {
            "items": [{"item_id": str(uuid4()), "push": {"state": "accepted"}}],
            "next_cursor": None,
            "counts": {"open": 3, "done": 10, "dismissed": 1},
        }
        with patch_ops(PROXY_GET, new=AsyncMock(return_value=envelope)):
            resp = TestClient(_build_app()).get(LIST)
        assert resp.status_code == 200
        assert resp.json() == envelope

    def test_migration_pending_503_passes_through(self):
        err = HTTPException(
            status_code=503, detail='{"error":"schema_migration_pending"}'
        )
        with patch_ops(PROXY_GET, new=AsyncMock(side_effect=err)):
            resp = TestClient(_build_app()).get(LIST)
        assert resp.status_code == 503
        assert "schema_migration_pending" in resp.text


class TestResolveProxy:
    @pytest.mark.parametrize("status", ["done", "dismissed"])
    def test_forwards_a_typed_body(self, status):
        item = uuid4()
        with patch_ops(
            PROXY_POST, new=AsyncMock(return_value={"item": {"status": status}})
        ) as mock_post:
            resp = TestClient(_build_app()).post(
                RESOLVE, json={"item_id": str(item), "status": status, "note": "ok"}
            )
        assert resp.status_code == 200
        args, kwargs = mock_post.call_args[0], mock_post.call_args[1]
        assert args[0] == "/coord/operator-action-items/resolve"
        assert args[1] == {"item_id": str(item), "status": status, "note": "ok"}
        assert kwargs["tenant_id"] == TENANT
        assert kwargs["structured_errors"] is True

    def test_absent_note_never_reaches_the_wire(self):
        item = uuid4()
        with patch_ops(PROXY_POST, new=AsyncMock(return_value={})) as mock_post:
            TestClient(_build_app()).post(
                RESOLVE, json={"item_id": str(item), "status": "done"}
            )
        assert mock_post.call_args[0][1] == {"item_id": str(item), "status": "done"}

    @pytest.mark.parametrize(
        "body",
        [
            {"item_id": "not-a-uuid", "status": "done"},
            {"item_id": "UUID", "status": "open"},
            {"item_id": "UUID", "status": "done", "note": "x" * 1001},
            {"item_id": "UUID", "status": "done", "resolved_by": "someone"},
            {"itemId": "UUID", "status": "done"},
            {"item_id": "UUID"},
            {},
        ],
    )
    def test_rejects_without_calling_coord(self, body):
        body = {k: (str(uuid4()) if v == "UUID" else v) for k, v in body.items()}
        with patch_ops(PROXY_POST, new=AsyncMock()) as mock_post:
            resp = TestClient(_build_app()).post(RESOLVE, json=body)
        assert resp.status_code == 422, body
        mock_post.assert_not_called()

    def test_coord_409_passes_through(self):
        err = HTTPException(status_code=409, detail='{"error":"already_resolved"}')
        with patch_ops(PROXY_POST, new=AsyncMock(side_effect=err)):
            resp = TestClient(_build_app()).post(
                RESOLVE, json={"item_id": str(uuid4()), "status": "dismissed"}
            )
        assert resp.status_code == 409
