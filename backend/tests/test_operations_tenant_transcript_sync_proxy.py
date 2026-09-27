"""Tests for the tenant transcript-sync proxy
(`/api/v1/operations/tenant-policy/transcript-sync`).

Phase 3 of ``2026-09-22-transcript-sync-default-on-with-tenant-and-user-controls``.
What this file pins, because each is silent rather than loud when wrong:

1. **The GET names the EFFECTIVE tenant.** Coord 403s ``GET /tenant-policy``
   unless ``?tenant_id=`` equals the principal's tenant AFTER the active-tenant
   override. Sending the HOME tenant would 403 every operator who switched
   project.
2. **Only the transcript-sync slice is exposed.** ``session_coordination_enabled``
   rides the same coord body and has no HTTP write door; it must not surface.
3. **An absent field is UNKNOWN, not "on"** — and a fail-closed stand-in
   (``transcript_sync_column_missing``) is reported as such.
4. **The PATCH body is closed**: coord's struct is ``deny_unknown_fields`` and
   carries no ``tenant_id``.
5. **A write whose read-back coord did not return is UNKNOWN**, not applied.

Mirrors ``test_operations_fleet_policy_proxy.py``: a minimal FastAPI app plus a
mocked ``httpx.AsyncClient``, so no live coord is needed.
"""

from contextlib import contextmanager
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

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


def _build_test_app(*, is_superuser: bool = False) -> FastAPI:
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


@pytest.fixture()
def client() -> TestClient:
    return TestClient(_build_test_app())


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
        patch(
            "app.api.v1.endpoints.operations.get_coord_identity",
            AsyncMock(return_value=MagicMock()),
        ),
        patch(
            "app.api.v1.endpoints.operations._effective_tenant_id",
            MagicMock(return_value=effective_tenant),
        ),
        patch(
            "app.api.v1.endpoints.operations._effective_tenant_roles",
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


class TestGetTranscriptSync:
    def test_asks_coord_about_the_effective_tenant_not_home(self, client):
        instance = MagicMock()
        instance.get = AsyncMock(return_value=_mock_response(200, COORD_POLICY))
        with _patch_httpx(instance), _patch_identity():
            resp = client.get(PATH)

        assert resp.status_code == 200
        _, kwargs = instance.get.call_args
        assert instance.get.call_args.args[0].endswith("/tenant-policy")
        assert kwargs["params"] == {"tenant_id": str(SWITCHED_TENANT)}

    def test_falls_back_to_home_when_no_effective_tenant_resolves(self, client):
        instance = MagicMock()
        instance.get = AsyncMock(return_value=_mock_response(200, COORD_POLICY))
        with _patch_httpx(instance), _patch_identity(effective_tenant=None):
            client.get(PATH)

        assert instance.get.call_args.kwargs["params"] == {
            "tenant_id": str(HOME_TENANT)
        }

    def test_exposes_only_the_transcript_sync_slice(self, client):
        instance = MagicMock()
        instance.get = AsyncMock(return_value=_mock_response(200, COORD_POLICY))
        with _patch_httpx(instance), _patch_identity():
            body = client.get(PATH).json()

        assert body == {
            "transcript_sync_enabled": True,
            "column_missing": False,
            "can_edit": True,
        }
        assert "session_coordination_enabled" not in body

    def test_fail_closed_stand_in_is_reported_as_column_missing(self, client):
        payload = dict(
            COORD_POLICY,
            transcript_sync_enabled=False,
            transcript_sync_column_missing=True,
        )
        instance = MagicMock()
        instance.get = AsyncMock(return_value=_mock_response(200, payload))
        with _patch_httpx(instance), _patch_identity():
            body = client.get(PATH).json()

        assert body["transcript_sync_enabled"] is False
        assert body["column_missing"] is True

    def test_a_coord_that_omits_the_field_reads_unknown_not_on(self, client):
        payload = {
            k: v for k, v in COORD_POLICY.items() if k != "transcript_sync_enabled"
        }
        instance = MagicMock()
        instance.get = AsyncMock(return_value=_mock_response(200, payload))
        with _patch_httpx(instance), _patch_identity():
            body = client.get(PATH).json()

        assert body["transcript_sync_enabled"] is None

    def test_can_edit_follows_effective_tenant_roles(self, client):
        instance = MagicMock()
        instance.get = AsyncMock(return_value=_mock_response(200, COORD_POLICY))
        with _patch_httpx(instance), _patch_identity(effective_roles=("developer",)):
            body = client.get(PATH).json()

        assert body["can_edit"] is False

    def test_superuser_without_the_admin_role_cannot_edit(self):
        """Coord's PATCH has no staff bypass (`rbac::is_tenant_admin` only)."""
        client = TestClient(_build_test_app(is_superuser=True))
        instance = MagicMock()
        instance.get = AsyncMock(return_value=_mock_response(200, COORD_POLICY))
        with _patch_httpx(instance), _patch_identity(effective_roles=()):
            body = client.get(PATH).json()

        assert body["can_edit"] is False

    def test_coord_403_passes_through(self, client):
        instance = MagicMock()
        instance.get = AsyncMock(
            return_value=_mock_response(
                403, {"error": "tenant_id does not match principal"}
            )
        )
        with _patch_httpx(instance), _patch_identity():
            resp = client.get(PATH)

        assert resp.status_code == 403


class TestPatchTranscriptSync:
    def test_forwards_a_closed_body_with_no_tenant(self, client):
        instance = MagicMock()
        instance.patch = AsyncMock(
            return_value=_mock_response(
                200, dict(COORD_POLICY, transcript_sync_enabled=False)
            )
        )
        with _patch_httpx(instance):
            resp = client.patch(PATH, json={"transcript_sync_enabled": False})

        assert resp.status_code == 200
        assert instance.patch.call_args.args[0].endswith("/tenant-policy")
        assert instance.patch.call_args.kwargs["json"] == {
            "transcript_sync_enabled": False
        }
        body = resp.json()
        assert body["written"] is True
        assert body["readback_error"] is None
        assert body["effective"] == {
            "transcript_sync_enabled": False,
            "column_missing": False,
            "can_edit": True,
        }

    @pytest.mark.parametrize(
        "extra",
        [
            {"tenant_id": str(uuid4())},
            {"session_coordination_enabled": True},
        ],
    )
    def test_refuses_any_other_key_before_reaching_coord(self, client, extra):
        instance = MagicMock()
        instance.patch = AsyncMock()
        with _patch_httpx(instance):
            resp = client.patch(PATH, json={"transcript_sync_enabled": True, **extra})

        assert resp.status_code == 422
        instance.patch.assert_not_called()

    def test_missing_readback_is_unknown_not_applied(self, client):
        instance = MagicMock()
        instance.patch = AsyncMock(return_value=_mock_response(200, {"ok": True}))
        with _patch_httpx(instance):
            body = client.patch(PATH, json={"transcript_sync_enabled": True}).json()

        assert body["written"] is True
        assert body["effective"] is None
        assert "did not return" in body["readback_error"]

    @pytest.mark.parametrize(
        ("status", "error"),
        [(403, "admin_required"), (503, "column_not_present")],
    )
    def test_coord_refusals_pass_through(self, client, status, error):
        instance = MagicMock()
        instance.patch = AsyncMock(
            return_value=_mock_response(status, {"error": error})
        )
        with _patch_httpx(instance):
            resp = client.patch(PATH, json={"transcript_sync_enabled": False})

        assert resp.status_code == status
        assert error in resp.text
