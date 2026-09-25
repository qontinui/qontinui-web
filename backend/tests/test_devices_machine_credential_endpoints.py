"""Tests for the device machine key (``dmk_``) mint + exchange endpoints.

Phase 3 of plan ``2026-07-02-runner-device-machine-key-cold-start.md`` (4b):

* ``POST /api/v1/devices/{id}/machine-credential/mint`` — **user bearer**,
  must own the device (403 otherwise); returns the plaintext ``dmk_`` once.
* ``POST /api/v1/devices/{id}/machine-credential/exchange`` — authed by the
  ``X-Device-Machine-Key`` header; asserts the credential's device matches the
  path (403 on mismatch); rides web's trusted service token to coord's
  service-mint and returns the device JWT. 503 when coord is disabled.
* ``get_authenticated_device_credential`` — the ``dmk_`` header auth dep:
  malformed/unknown => 401, revoked/expired => 403.

Unit posture (``tests/conftest.py``): TestClient with dependency overrides +
patched coord/CoordServiceAccountClient calls; the auth dep is exercised directly.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI, HTTPException, status
from fastapi.testclient import TestClient

from app.crud import device_machine_credential_crud as dmk_crud
from app.models.devenv import DeviceMachineCredential
from app.services import coord_device
from app.services.coord_service_account import coord_service_account

API_PREFIX = "/api/v1/devices"
_USER_ID = uuid4()
_DEVICE_ID = uuid4()


# ---------------------------------------------------------------------------
# Test app / fixtures
# ---------------------------------------------------------------------------


def _fake_db() -> MagicMock:
    db = MagicMock()
    db.commit = AsyncMock()
    return db


def _mock_user() -> MagicMock:
    user = MagicMock()
    user.id = _USER_ID
    user.is_active = True
    return user


def _patch_enabled(*, enabled: bool = True):
    return patch.object(
        coord_service_account,
        "_admin_secret",
        "test-secret" if enabled else None,
    )


# ---------------------------------------------------------------------------
# get_authenticated_device_credential — the dmk_ header auth dependency
# ---------------------------------------------------------------------------


class TestAuthDependency:
    @pytest.mark.asyncio
    async def test_malformed_prefix_is_401(self) -> None:
        from app.api.v1.endpoints.devices import (
            get_authenticated_device_credential,
        )

        with pytest.raises(HTTPException) as exc:
            await get_authenticated_device_credential(
                x_device_machine_key="notdmk_abc", db=_fake_db()
            )
        assert exc.value.status_code == status.HTTP_401_UNAUTHORIZED

    @pytest.mark.asyncio
    async def test_unknown_key_is_401(self) -> None:
        from app.api.v1.endpoints.devices import (
            get_authenticated_device_credential,
        )

        with patch.object(dmk_crud, "get_by_key", AsyncMock(return_value=None)):
            with pytest.raises(HTTPException) as exc:
                await get_authenticated_device_credential(
                    x_device_machine_key="dmk_whatever", db=_fake_db()
                )
        assert exc.value.status_code == status.HTTP_401_UNAUTHORIZED

    @pytest.mark.asyncio
    async def test_revoked_key_is_403(self) -> None:
        from app.api.v1.endpoints.devices import (
            get_authenticated_device_credential,
        )

        cred = DeviceMachineCredential(
            device_id=_DEVICE_ID,
            dmk_hash="x",
            dmk_prefix="dmk_x",
            expires_at=datetime.now(UTC) + timedelta(days=1),
            revoked_at=datetime.now(UTC),
        )
        with patch.object(dmk_crud, "get_by_key", AsyncMock(return_value=cred)):
            with pytest.raises(HTTPException) as exc:
                await get_authenticated_device_credential(
                    x_device_machine_key="dmk_whatever", db=_fake_db()
                )
        assert exc.value.status_code == status.HTTP_403_FORBIDDEN

    @pytest.mark.asyncio
    async def test_expired_key_is_403(self) -> None:
        from app.api.v1.endpoints.devices import (
            get_authenticated_device_credential,
        )

        cred = DeviceMachineCredential(
            device_id=_DEVICE_ID,
            dmk_hash="x",
            dmk_prefix="dmk_x",
            expires_at=datetime.now(UTC) - timedelta(seconds=1),
        )
        with patch.object(dmk_crud, "get_by_key", AsyncMock(return_value=cred)):
            with pytest.raises(HTTPException) as exc:
                await get_authenticated_device_credential(
                    x_device_machine_key="dmk_whatever", db=_fake_db()
                )
        assert exc.value.status_code == status.HTTP_403_FORBIDDEN

    @pytest.mark.asyncio
    async def test_valid_key_returns_credential(self) -> None:
        from app.api.v1.endpoints.devices import (
            get_authenticated_device_credential,
        )

        cred = DeviceMachineCredential(
            device_id=_DEVICE_ID,
            dmk_hash="x",
            dmk_prefix="dmk_x",
            expires_at=datetime.now(UTC) + timedelta(days=1),
        )
        with patch.object(dmk_crud, "get_by_key", AsyncMock(return_value=cred)):
            got = await get_authenticated_device_credential(
                x_device_machine_key="dmk_whatever", db=_fake_db()
            )
        assert got is cred


# ---------------------------------------------------------------------------
# POST /{id}/machine-credential/mint — user bearer, must own the device
# ---------------------------------------------------------------------------


class TestMintEndpoint:
    def _app(self) -> FastAPI:
        from app.api.deps import get_async_db, get_current_active_user_async
        from app.api.v1.endpoints.devices import router

        app = FastAPI()
        app.dependency_overrides[get_current_active_user_async] = _mock_user
        app.dependency_overrides[get_async_db] = _fake_db
        app.include_router(router, prefix=API_PREFIX)
        return app

    def test_owner_gets_plaintext_once(self) -> None:
        client = TestClient(self._app())
        tenant_id = uuid4()
        cred = MagicMock()
        cred.dmk_prefix = "dmk_abcdef1234"
        cred.expires_at = datetime.now(UTC) + timedelta(days=60)

        with (
            patch.object(
                coord_device,
                "get_owned_device",
                AsyncMock(return_value={"tenant_id": str(tenant_id)}),
            ),
            patch.object(
                dmk_crud,
                "mint",
                AsyncMock(return_value=("dmk_the-plaintext-secret", cred)),
            ) as mock_mint,
        ):
            resp = client.post(f"{API_PREFIX}/{_DEVICE_ID}/machine-credential/mint")

        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["device_machine_key"] == "dmk_the-plaintext-secret"
        assert body["prefix"] == "dmk_abcdef1234"
        # tenant resolved server-side from the owned coord row, owner from JWT.
        kwargs = mock_mint.call_args.kwargs
        assert kwargs["owner_user_id"] == _USER_ID
        assert kwargs["tenant_id"] == tenant_id

    def test_non_owner_gets_403(self) -> None:
        client = TestClient(self._app())
        with (
            patch.object(
                coord_device,
                "get_owned_device",
                AsyncMock(
                    side_effect=HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND, detail="nope"
                    )
                ),
            ),
            patch.object(dmk_crud, "mint", AsyncMock()) as mock_mint,
        ):
            resp = client.post(f"{API_PREFIX}/{_DEVICE_ID}/machine-credential/mint")
        assert resp.status_code == 403
        mock_mint.assert_not_called()


# ---------------------------------------------------------------------------
# POST /{id}/machine-credential/exchange — dmk_ auth -> coord service-mint
# ---------------------------------------------------------------------------


class TestExchangeEndpoint:
    def _app(self, cred: DeviceMachineCredential) -> FastAPI:
        from app.api.deps import get_async_db
        from app.api.v1.endpoints.devices import (
            get_authenticated_device_credential,
            router,
        )

        app = FastAPI()
        app.dependency_overrides[get_authenticated_device_credential] = lambda: cred
        app.dependency_overrides[get_async_db] = _fake_db
        app.include_router(router, prefix=API_PREFIX)
        return app

    def _cred(self, device_id=_DEVICE_ID) -> DeviceMachineCredential:
        return DeviceMachineCredential(
            device_id=device_id,
            owner_user_id=_USER_ID,
            dmk_hash="x",
            dmk_prefix="dmk_x",
            expires_at=datetime.now(UTC) + timedelta(days=60),
        )

    def test_valid_exchange_returns_token(self) -> None:
        client = TestClient(self._app(self._cred()))
        with (
            _patch_enabled(),
            patch.object(dmk_crud, "bump_last_used", AsyncMock()) as mock_bump,
            patch.object(
                coord_service_account,
                "mint_device_token",
                AsyncMock(return_value=(200, {"token": "device-jwt-xyz"})),
            ) as mock_mint,
        ):
            resp = client.post(f"{API_PREFIX}/{_DEVICE_ID}/machine-credential/exchange")

        assert resp.status_code == 200, resp.text
        assert resp.json()["token"] == "device-jwt-xyz"
        mock_bump.assert_awaited_once()
        # web calls coord service-mint acting-for the credential owner.
        args = mock_mint.call_args.args
        assert args[0] == str(_USER_ID)
        assert args[1] == str(_DEVICE_ID)

    def test_device_mismatch_returns_403(self) -> None:
        # Credential is for a DIFFERENT device than the path => anti-forgery.
        other_device = uuid4()
        client = TestClient(self._app(self._cred(device_id=other_device)))
        with (
            _patch_enabled(),
            patch.object(dmk_crud, "bump_last_used", AsyncMock()) as mock_bump,
            patch.object(
                coord_service_account, "mint_device_token", AsyncMock()
            ) as mock_mint,
        ):
            resp = client.post(f"{API_PREFIX}/{_DEVICE_ID}/machine-credential/exchange")
        assert resp.status_code == 403
        mock_bump.assert_not_called()
        mock_mint.assert_not_called()

    def test_coord_disabled_returns_503(self) -> None:
        client = TestClient(self._app(self._cred()))
        with (
            _patch_enabled(enabled=False),
            patch.object(dmk_crud, "bump_last_used", AsyncMock()),
            patch.object(
                coord_service_account, "mint_device_token", AsyncMock()
            ) as mock_mint,
        ):
            resp = client.post(f"{API_PREFIX}/{_DEVICE_ID}/machine-credential/exchange")
        assert resp.status_code == 503
        mock_mint.assert_not_called()

    def test_coord_4xx_propagates_as_client_error(self) -> None:
        client = TestClient(self._app(self._cred()))
        with (
            _patch_enabled(),
            patch.object(dmk_crud, "bump_last_used", AsyncMock()),
            patch.object(
                coord_service_account,
                "mint_device_token",
                AsyncMock(return_value=(400, {"error": "bad device"})),
            ),
        ):
            resp = client.post(f"{API_PREFIX}/{_DEVICE_ID}/machine-credential/exchange")
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# pair_cli auto-mint — every paired runner receives a dmk_ out-of-box
# ---------------------------------------------------------------------------


def _mock_httpx_response(status_code: int = 201, json_data=None) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.text = str(json_data) if json_data else ""
    return resp


class TestPairCliAutoMint:
    def _app(self) -> FastAPI:
        from app.api.deps import get_async_db, get_current_active_user_async
        from app.api.v1.endpoints.devices import router

        app = FastAPI()
        app.dependency_overrides[get_current_active_user_async] = _mock_user
        app.dependency_overrides[get_async_db] = _fake_db
        app.include_router(router, prefix=API_PREFIX)
        return app

    def _configure_client(self, MockClient) -> AsyncMock:
        instance = AsyncMock()
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)
        MockClient.return_value = instance
        return instance

    _BODY = {"device_id": str(_DEVICE_ID), "hostname": "spaceship"}

    def test_pairing_returns_auto_minted_dmk(self) -> None:
        client = TestClient(self._app())
        cred = MagicMock()
        cred.dmk_prefix = "dmk_abcdef1234"
        with (
            _patch_enabled(),
            patch("app.services.coord_proxy.httpx.AsyncClient") as MockClient,
            patch.object(
                dmk_crud,
                "mint",
                AsyncMock(return_value=("dmk_auto-minted-secret", cred)),
            ) as mock_mint,
        ):
            instance = self._configure_client(MockClient)
            instance.post.return_value = _mock_httpx_response(
                json_data={"device_id": str(_DEVICE_ID), "token": "device-jwt"}
            )
            resp = client.post(
                f"{API_PREFIX}/pair-cli",
                json=self._BODY,
                headers={"Authorization": "Bearer cognito-tok"},
            )

        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["token"] == "device-jwt"
        assert body["device_machine_key"] == "dmk_auto-minted-secret"
        assert mock_mint.call_args.kwargs["owner_user_id"] == _USER_ID

    def test_mint_failure_does_not_break_pairing(self) -> None:
        client = TestClient(self._app())
        with (
            _patch_enabled(),
            patch("app.services.coord_proxy.httpx.AsyncClient") as MockClient,
            patch.object(
                dmk_crud,
                "mint",
                AsyncMock(side_effect=RuntimeError("db down")),
            ),
        ):
            instance = self._configure_client(MockClient)
            instance.post.return_value = _mock_httpx_response(
                json_data={"device_id": str(_DEVICE_ID), "token": "device-jwt"}
            )
            resp = client.post(
                f"{API_PREFIX}/pair-cli",
                json=self._BODY,
                headers={"Authorization": "Bearer cognito-tok"},
            )

        # Pairing still succeeds; the dmk_ is simply absent.
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["token"] == "device-jwt"
        assert body["device_machine_key"] is None


# ---------------------------------------------------------------------------
# POST /{id}/machine-credential/self-mint — live PAIRED device JWT, own device
#
# Plan ``2026-09-24-runner-coord-credential-stranded-after-outage`` Phase 3.
# The auth dep (``deps.get_paired_device``) runs for real; only the JWKS
# verification (``deps._verify_device_jwt`` / ``coord_jwks_client``) and the
# DB reads are stubbed.
# ---------------------------------------------------------------------------


_TENANT_ID = uuid4()


def _device_claims(**overrides):
    claims = {
        "sub": f"device:{_DEVICE_ID}",
        "sub_type": "device",
        "device_id": str(_DEVICE_ID),
        "user_id": str(_USER_ID),
        "tenant_id": str(uuid4()),  # a slot tenant — must NOT be used
        "mint_provenance": "paired",
    }
    claims.update(overrides)
    return {k: v for k, v in claims.items() if v is not None}


class TestSelfMintEndpoint:
    _URL = f"{API_PREFIX}/{_DEVICE_ID}/machine-credential/self-mint"
    _AUTH = {"Authorization": "Bearer device-jwt"}

    def _app(self) -> FastAPI:
        from app.api.deps import get_async_db
        from app.api.v1.endpoints.devices import router

        app = FastAPI()
        app.dependency_overrides[get_async_db] = _fake_db
        app.include_router(router, prefix=API_PREFIX)
        return app

    def _verify(self, claims):
        return patch(
            "app.api.deps._verify_device_jwt",
            AsyncMock(return_value=(claims, _mock_user())),
        )

    def _device_row(self, user_id=_USER_ID, tenant_id=_TENANT_ID):
        from app.crud import device_crud

        return patch.object(
            device_crud,
            "get_device_owner_and_tenant",
            AsyncMock(return_value=(user_id, tenant_id)),
        )

    def _mint(self):
        cred = MagicMock()
        cred.dmk_prefix = "dmk_selfmint12"
        cred.expires_at = datetime.now(UTC) + timedelta(days=60)
        return patch.object(
            dmk_crud,
            "mint",
            AsyncMock(return_value=("dmk_self-minted-secret", cred)),
        )

    def _existing(self, cred=None):
        return patch.object(dmk_crud, "get_by_device", AsyncMock(return_value=cred))

    def test_matching_live_device_jwt_mints(self) -> None:
        client = TestClient(self._app())
        with (
            self._verify(_device_claims()),
            self._device_row(),
            self._existing(),
            self._mint() as mock_mint,
        ):
            resp = client.post(self._URL, headers=self._AUTH)

        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["device_id"] == str(_DEVICE_ID)
        assert body["device_machine_key"] == "dmk_self-minted-secret"
        assert body["prefix"] == "dmk_selfmint12"
        assert body["expires_at"] is not None
        kwargs = mock_mint.call_args.kwargs
        assert kwargs["device_id"] == _DEVICE_ID
        assert kwargs["owner_user_id"] == _USER_ID
        # Home tenant from coord.devices, never the token's slot claim.
        assert kwargs["tenant_id"] == _TENANT_ID
        # Normal TTL: the helper does not override the crud default.
        assert "ttl_days" not in kwargs

    def test_existing_unexpired_key_is_rotated(self) -> None:
        client = TestClient(self._app())
        live = DeviceMachineCredential(
            device_id=_DEVICE_ID,
            dmk_hash="x",
            dmk_prefix="dmk_x",
            expires_at=datetime.now(UTC) + timedelta(days=50),
        )
        with (
            self._verify(_device_claims()),
            self._device_row(),
            self._existing(live),
            self._mint() as mock_mint,
        ):
            resp = client.post(self._URL, headers=self._AUTH)
        assert resp.status_code == 201, resp.text
        mock_mint.assert_awaited_once()

    def test_expired_device_jwt_is_401(self) -> None:
        from app.services.coord_jwks import CoordTokenExpiredError, coord_jwks_client

        client = TestClient(self._app())
        with (
            patch.object(
                coord_jwks_client,
                "verify_token",
                AsyncMock(side_effect=CoordTokenExpiredError("token expired")),
            ),
            self._mint() as mock_mint,
        ):
            resp = client.post(self._URL, headers=self._AUTH)
        assert resp.status_code == 401, resp.text
        mock_mint.assert_not_called()

    def test_no_auth_is_401(self) -> None:
        client = TestClient(self._app())
        with self._mint() as mock_mint:
            resp = client.post(self._URL)
        assert resp.status_code == 401, resp.text
        mock_mint.assert_not_called()

    def test_foreign_device_id_is_403(self) -> None:
        client = TestClient(self._app())
        other = uuid4()
        with (
            self._verify(_device_claims(device_id=str(other), sub=f"device:{other}")),
            self._device_row(),
            self._existing(),
            self._mint() as mock_mint,
        ):
            resp = client.post(self._URL, headers=self._AUTH)
        assert resp.status_code == 403, resp.text
        assert resp.json()["detail"]["code"] == "device_mismatch"
        mock_mint.assert_not_called()

    @pytest.mark.parametrize("provenance", ["bootstrap", "unknown", None])
    def test_non_paired_provenance_is_403(self, provenance) -> None:
        client = TestClient(self._app())
        with (
            self._verify(_device_claims(mint_provenance=provenance)),
            self._device_row(),
            self._existing(),
            self._mint() as mock_mint,
        ):
            resp = client.post(self._URL, headers=self._AUTH)
        assert resp.status_code == 403, resp.text
        assert resp.json()["detail"]["code"] == "device_token_provenance_refused"
        mock_mint.assert_not_called()

    @pytest.mark.parametrize("sub_type", ["agent", "attach_grant", "create_grant"])
    def test_non_device_principal_is_403(self, sub_type) -> None:
        # The anonymous /agents/credential mint names the device in ``sub``
        # but is an ``agent``; grants carry their SOURCE device_id.
        client = TestClient(self._app())
        with (
            self._verify(_device_claims(sub_type=sub_type)),
            self._device_row(),
            self._existing(),
            self._mint() as mock_mint,
        ):
            resp = client.post(self._URL, headers=self._AUTH)
        assert resp.status_code == 403, resp.text
        assert resp.json()["detail"]["code"] == "not_a_device_principal"
        mock_mint.assert_not_called()

    def test_device_owned_by_another_user_is_403(self) -> None:
        client = TestClient(self._app())
        with (
            self._verify(_device_claims()),
            self._device_row(user_id=uuid4()),
            self._existing(),
            self._mint() as mock_mint,
        ):
            resp = client.post(self._URL, headers=self._AUTH)
        assert resp.status_code == 403, resp.text
        assert resp.json()["detail"]["code"] == "device_not_owned"
        mock_mint.assert_not_called()

    def test_unknown_device_is_403(self) -> None:
        from app.crud import device_crud

        client = TestClient(self._app())
        with (
            self._verify(_device_claims()),
            patch.object(
                device_crud,
                "get_device_owner_and_tenant",
                AsyncMock(return_value=None),
            ),
            self._existing(),
            self._mint() as mock_mint,
        ):
            resp = client.post(self._URL, headers=self._AUTH)
        assert resp.status_code == 403, resp.text
        mock_mint.assert_not_called()

    def test_revoked_key_is_not_reminted(self) -> None:
        client = TestClient(self._app())
        revoked = DeviceMachineCredential(
            device_id=_DEVICE_ID,
            dmk_hash="x",
            dmk_prefix="dmk_x",
            expires_at=datetime.now(UTC) + timedelta(days=10),
            revoked_at=datetime.now(UTC),
        )
        with (
            self._verify(_device_claims()),
            self._device_row(),
            self._existing(revoked),
            self._mint() as mock_mint,
        ):
            resp = client.post(self._URL, headers=self._AUTH)
        assert resp.status_code == 403, resp.text
        assert resp.json()["detail"]["code"] == "device_machine_key_revoked"
        mock_mint.assert_not_called()
