"""Tests for the unfinished-sessions proxy and the auto-resume tenant toggle
(`/api/v1/operations/unfinished-sessions*`, `/tenant-policy/resume-unfinished`).

Phase 7 of ``2026-10-06-closed-sessions-whose-work-is-unfinished-are-found-fleet-wide-and-resumed``.
Pinned because each is silent when wrong:

1. coord's ``state: "unknown"`` (sessions null) stays UNKNOWN -- never an empty list.
2. A malformed coord answer is UNKNOWN too.
3. Dismiss is coord's finish door with the fixed reason ``dismissed``.
4. Resume is coord's respawn door (``/sessions/:id/respawn``), status echoed.
5. ``resume_unfinished_enabled`` absent/non-boolean reads ``None`` (UNKNOWN), never ON.
6. The toggle PATCH body is closed.
"""

from contextlib import contextmanager
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests._ops_patch import patch_ops

API_PREFIX = "/api/v1/operations"
PATH = f"{API_PREFIX}/tenant-policy/transcript-sync"

HOME_TENANT = uuid4()
SWITCHED_TENANT = uuid4()

COORD_POLICY = {
    "claim_steal_visibility": "tenant",
    "session_coordination_enabled": True,
    "output_warm_quota_bytes": 1,
    "output_cold_quota_bytes": 2,
    "transcript_sync_enabled": True,
}


def _base_build_test_app(*, is_superuser: bool = False) -> FastAPI:
    from app.api.deps import get_current_active_user_async
    from app.api.v1.endpoints.operations import (
        get_tenant_id,
        require_coord_tenant_admin_target,
    )
    from app.api.v1.endpoints.operations import router as operations_router

    test_app = FastAPI()
    mock_user = MagicMock()
    mock_user.id = uuid4()
    mock_user.is_active = True
    mock_user.is_superuser = is_superuser
    test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user
    test_app.dependency_overrides[get_tenant_id] = lambda: HOME_TENANT
    test_app.dependency_overrides[require_coord_tenant_admin_target] = (
        lambda: SWITCHED_TENANT
    )
    test_app.include_router(operations_router, prefix=API_PREFIX)
    return test_app


def _mock_response(status_code: int = 200, json_data=None) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.text = str(json_data)
    resp.content = b"{}" if json_data is not None else b""
    return resp


@contextmanager
def _patch_identity(effective_tenant=SWITCHED_TENANT, effective_roles=("admin",)):
    with (
        patch_ops(
            "get_coord_identity",
            AsyncMock(return_value=MagicMock()),
        ),
        patch_ops(
            "_effective_tenant_id",
            MagicMock(return_value=effective_tenant),
        ),
        patch_ops(
            "_effective_tenant_roles",
            MagicMock(return_value=tuple(effective_roles)),
        ),
    ):
        yield


@contextmanager
def _patch_httpx(instance):
    instance.__aenter__ = AsyncMock(return_value=instance)
    instance.__aexit__ = AsyncMock(return_value=False)
    with patch("app.api.v1.endpoints.operations.httpx.AsyncClient") as MockClient:
        MockClient.return_value = instance
        yield


CLAUDE_ID = uuid4()
COORD_ID = uuid4()
DEVICE = uuid4()
ROW = {"claude_session_id": str(CLAUDE_ID), "coord_session_id": str(COORD_ID)}
LIST_PATH = f"{API_PREFIX}/unfinished-sessions"
TOGGLE_PATH = f"{API_PREFIX}/tenant-policy/resume-unfinished"


def _build_test_app() -> FastAPI:
    app = _base_build_test_app()
    from app.api.v1.endpoints.operations import require_coord_tenant_admin

    app.dependency_overrides[require_coord_tenant_admin] = lambda: SWITCHED_TENANT
    return app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(_build_test_app())


class TestList:
    def test_ok_rows_pass_through(self, client):
        inst = MagicMock()
        inst.get = AsyncMock(
            return_value=_mock_response(200, {"state": "ok", "sessions": [ROW]})
        )
        with _patch_httpx(inst):
            body = client.get(LIST_PATH).json()
        assert inst.get.call_args.args[0].endswith("/coord/sessions/unfinished")
        assert body["state"] == "ok"
        assert body["sessions"] == [ROW]

    def test_unknown_is_not_an_empty_list(self, client):
        inst = MagicMock()
        inst.get = AsyncMock(
            return_value=_mock_response(
                200,
                {"state": "unknown", "reason": "census_unreadable", "sessions": None},
            )
        )
        with _patch_httpx(inst):
            body = client.get(LIST_PATH).json()
        assert body["state"] == "unknown"
        assert body["sessions"] is None
        assert body["reason"] == "census_unreadable"

    @pytest.mark.parametrize(
        "payload",
        [[], "x", {"state": "ok"}, {"state": "ok", "sessions": "nope"}, {}],
    )
    def test_malformed_is_unknown(self, client, payload):
        inst = MagicMock()
        inst.get = AsyncMock(return_value=_mock_response(200, payload))
        with _patch_httpx(inst):
            body = client.get(LIST_PATH).json()
        assert body["state"] == "unknown"
        assert body["sessions"] is None


class TestDismissAndResume:
    def test_dismiss_posts_fixed_reason_to_the_finish_door(self, client):
        inst = MagicMock()
        inst.post = AsyncMock(return_value=_mock_response(200, {"ok": True}))
        with _patch_httpx(inst):
            resp = client.post(f"{LIST_PATH}/{CLAUDE_ID}/dismiss")
        assert resp.status_code == 200
        assert inst.post.call_args.args[0].endswith(
            f"/coord/sessions/unfinished/{CLAUDE_ID}/finish"
        )
        assert inst.post.call_args.kwargs["json"] == {"reason": "dismissed"}

    def test_dismiss_404_passes_through(self, client):
        inst = MagicMock()
        inst.post = AsyncMock(return_value=_mock_response(404, {"error": "nope"}))
        with _patch_httpx(inst):
            resp = client.post(f"{LIST_PATH}/{CLAUDE_ID}/dismiss")
        assert resp.status_code == 404

    def test_resume_hits_respawn_and_echoes_202(self, client):
        inst = MagicMock()
        inst.post = AsyncMock(return_value=_mock_response(202, {"event_id": 5}))
        with _patch_httpx(inst):
            resp = client.post(
                f"{LIST_PATH}/{COORD_ID}/resume",
                json={"target_device_id": str(DEVICE), "account": " .claude-x "},
            )
        assert resp.status_code == 202
        assert inst.post.call_args.args[0].endswith(f"/sessions/{COORD_ID}/respawn")
        assert inst.post.call_args.kwargs["json"] == {
            "target_device_id": str(DEVICE),
            "account": ".claude-x",
        }

    def test_resume_omits_blank_account_and_refuses_unknown_fields(self, client):
        inst = MagicMock()
        inst.post = AsyncMock(return_value=_mock_response(202, {}))
        with _patch_httpx(inst):
            client.post(
                f"{LIST_PATH}/{COORD_ID}/resume",
                json={"target_device_id": str(DEVICE), "account": "  "},
            )
            bad = client.post(
                f"{LIST_PATH}/{COORD_ID}/resume",
                json={"target_device_id": str(DEVICE), "tenant_id": "x"},
            )
        assert inst.post.call_args.kwargs["json"] == {"target_device_id": str(DEVICE)}
        assert bad.status_code == 422

    def test_resume_drained_409_passes_through(self, client):
        inst = MagicMock()
        inst.post = AsyncMock(return_value=_mock_response(409, {"error": "drained"}))
        with _patch_httpx(inst):
            resp = client.post(
                f"{LIST_PATH}/{COORD_ID}/resume",
                json={"target_device_id": str(DEVICE)},
            )
        assert resp.status_code == 409


class TestToggle:
    def test_reads_boolean(self, client):
        inst = MagicMock()
        inst.get = AsyncMock(
            return_value=_mock_response(200, {"resume_unfinished_enabled": False})
        )
        with _patch_httpx(inst), _patch_identity():
            body = client.get(TOGGLE_PATH).json()
        assert body == {"resume_unfinished_enabled": False, "can_edit": True}
        assert inst.get.call_args.kwargs["params"] == {
            "tenant_id": str(SWITCHED_TENANT)
        }

    @pytest.mark.parametrize("payload", [{}, {"resume_unfinished_enabled": "true"}, []])
    def test_absent_or_non_boolean_is_unknown_never_on(self, client, payload):
        inst = MagicMock()
        inst.get = AsyncMock(return_value=_mock_response(200, payload))
        with _patch_httpx(inst), _patch_identity():
            body = client.get(TOGGLE_PATH).json()
        assert body["resume_unfinished_enabled"] is None

    def test_patch_body_is_closed_and_readback_returned(self, client):
        inst = MagicMock()
        inst.patch = AsyncMock(
            return_value=_mock_response(200, {"resume_unfinished_enabled": True})
        )
        with _patch_httpx(inst):
            ok = client.patch(TOGGLE_PATH, json={"resume_unfinished_enabled": True})
            bad = client.patch(
                TOGGLE_PATH,
                json={"resume_unfinished_enabled": True, "tenant_id": "x"},
            )
        assert ok.json()["effective"]["resume_unfinished_enabled"] is True
        assert inst.patch.call_args.kwargs["json"] == {
            "resume_unfinished_enabled": True
        }
        assert bad.status_code == 422

    def test_write_without_readback_is_unknown(self, client):
        inst = MagicMock()
        inst.patch = AsyncMock(return_value=_mock_response(200, {}))
        with _patch_httpx(inst):
            body = client.patch(
                TOGGLE_PATH, json={"resume_unfinished_enabled": True}
            ).json()
        assert body["written"] is True
        assert body["effective"] is None
        assert body["readback_error"]
