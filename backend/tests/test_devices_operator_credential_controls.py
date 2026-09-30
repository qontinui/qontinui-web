"""Operator-authorized headless redeem + fail-closed device credential revoke.

Plan ``2026-09-26-authenticate-and-perpetually-renew-a-specific-runner-from-
qontinui-web`` Phases 2-4 (web backend half):

* ``POST /api/v1/devices/{id}/authorize-redeem`` — operator SSO only, device
  from the PATH in the caller's tenant; mints a pair code BOUND to the device,
  clears the device deny, deletes a revoked machine key; never returns the code.
* ``GET  /api/v1/devices/{id}/pending-redeem`` — the device's own coord-signed
  device JWT, expiry tolerated for 30 days; hands the code out AT MOST ONCE.
* ``POST /api/v1/devices/pair-codes/{code}/redeem`` — a bound code refuses any
  other device.
* ``POST /api/v1/devices/{id}/machine-credential/revoke`` — revokes the key,
  sets ``coord.devices.credential_revoked_at``; ``/mint``, ``/self-mint``,
  ``/exchange`` then refuse until an ``authorize-redeem``.
* ``POST /api/v1/devices/pair-cli`` — no longer rotates a still-usable key
  (coord finding ``414676cf``).

Two layers: route-contract tests on a mock session (TestClient, crud patched),
and DB-backed tests (real Postgres via ``async_db_session``; they skip-fail the
same way the rest of the DB suite does when no test Postgres is reachable).
"""

from __future__ import annotations

import base64
import time
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import httpx
import jwt as pyjwt
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud import device_crud, pair_code_crud
from app.crud import device_machine_credential_crud as dmk_crud
from app.models.devenv import DeviceMachineCredential
from app.models.device import Device
from app.models.pair_code import PairCode
from app.services import coord_device
from app.services.coord_identity import CoordIdentity, CoordTenant
from app.services.coord_jwks import CoordJWKSClient
from app.services.coord_service_account import coord_service_account

API_PREFIX = "/api/v1/devices"
_DEVICES_MODULE = "app.api.v1.endpoints.devices"
_DAY_S = 86400


# ---------------------------------------------------------------------------
# Coord-signed device JWTs (a real Ed25519 key behind a baked JWKS)
# ---------------------------------------------------------------------------


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


class _BakedJWKSClient(CoordJWKSClient):
    """The real verifier with the JWKS fetch replaced by a pre-baked set."""

    def __init__(self, jwks: dict[str, Any]) -> None:
        super().__init__(coord_url="http://test")
        self._baked = jwks

    async def _fetch_jwks(self) -> dict[str, Any]:
        return self._baked


class _Coord:
    """One coord signing key: mints device JWTs and verifies them."""

    KID = "coord-ed25519-test"

    def __init__(self) -> None:
        self.private = Ed25519PrivateKey.generate()
        jwk = {
            "kty": "OKP",
            "crv": "Ed25519",
            "use": "sig",
            "alg": "EdDSA",
            "kid": self.KID,
            "x": _b64url(self.private.public_key().public_bytes_raw()),
        }
        self.client = _BakedJWKSClient({"keys": [jwk]})

    def token(
        self,
        device_id: UUID,
        *,
        expired_ago_s: int = -3600,
        **overrides: Any,
    ) -> str:
        """A device JWT; ``expired_ago_s`` < 0 means it is still live."""
        now = int(time.time())
        exp = now - expired_ago_s
        claims: dict[str, Any] = {
            "iss": "qontinui-coord",
            "sub": f"device:{device_id}",
            "sub_type": "device",
            "device_id": str(device_id),
            "user_id": str(uuid4()),
            "tenant_id": str(uuid4()),
            "mint_provenance": "paired",
            "iat": exp - 14400,
            "exp": exp,
            "jti": str(uuid4()),
        }
        claims.update(overrides)
        claims = {k: v for k, v in claims.items() if v is not None}
        return pyjwt.encode(
            claims, self.private, algorithm="EdDSA", headers={"kid": self.KID}
        )

    @contextmanager
    def installed(self) -> Iterator[None]:
        with patch(f"{_DEVICES_MODULE}.coord_jwks_client", self.client):
            yield


# ---------------------------------------------------------------------------
# Operator identity / coord device reads
# ---------------------------------------------------------------------------


def _identity(*tenants: UUID) -> CoordIdentity:
    return CoordIdentity(
        operator_id=uuid4(),
        home_tenant_id=tenants[0] if tenants else None,
        email="operator@example.com",
        roles=("admin",),
        tenants=tuple(
            CoordTenant(tenant_id=t, slug=f"t{i}", roles=("admin",))
            for i, t in enumerate(tenants)
        ),
        is_admin=False,
    )


@contextmanager
def _operator(
    *,
    tenants: tuple[UUID, ...],
    owned_rows: dict[UUID, dict[str, Any]],
    by_user: list[dict[str, Any]] | None = None,
) -> Iterator[tuple[AsyncMock, AsyncMock]]:
    """Patch coord's ``/admin/coord/me`` and ``/coord/devices/...`` reads."""

    async def _owned(_request: Any, device_id: Any, _user_id: str) -> dict[str, Any]:
        row = owned_rows.get(UUID(str(device_id)))
        if row is None:
            raise HTTPException(status_code=404, detail="not owned")
        return row

    identity = AsyncMock(return_value=_identity(*tenants))
    owned = AsyncMock(side_effect=_owned)
    with (
        patch(f"{_DEVICES_MODULE}.get_coord_identity", identity),
        patch.object(coord_device, "get_owned_device", owned),
        patch.object(
            coord_device,
            "list_devices_for_user",
            AsyncMock(return_value=list(by_user or [])),
        ),
    ):
        yield identity, owned


def _row(device_id: UUID, tenant_id: UUID, **extra: Any) -> dict[str, Any]:
    return {
        "device_id": str(device_id),
        "tenant_id": str(tenant_id),
        "hostname": "merytshost",
        **extra,
    }


# ---------------------------------------------------------------------------
# Mock-session app
# ---------------------------------------------------------------------------


_USER_ID = uuid4()


def _fake_db() -> MagicMock:
    db = MagicMock()
    db.commit = AsyncMock()
    db.rollback = AsyncMock()
    return db


def _mock_user() -> MagicMock:
    user = MagicMock()
    user.id = _USER_ID
    user.is_active = True
    return user


def _app(*, sso_user: bool = True) -> FastAPI:
    from app.api.deps import get_async_db, get_current_active_user_async
    from app.api.v1.endpoints.devices import router

    app = FastAPI()
    if sso_user:
        app.dependency_overrides[get_current_active_user_async] = _mock_user
    app.dependency_overrides[get_async_db] = _fake_db
    app.include_router(router, prefix=API_PREFIX)
    return app


@pytest.fixture(autouse=True)
def _device_row_exists(request: pytest.FixtureRequest) -> Iterator[None]:
    """Mock-session classes: the operator controls' row lock finds the row.
    The DB-backed class exercises the real ``SELECT ... FOR UPDATE``."""
    if request.cls is not None and request.cls.__name__ == "TestDatabaseBacked":
        yield
        return
    with patch.object(device_crud, "lock_device_row", AsyncMock(return_value=True)):
        yield


def _code_row(device_id: UUID, *, code: str = "ABCDEF") -> PairCode:
    now = datetime.now(UTC)
    return PairCode(
        code=code,
        tenant_id=uuid4(),
        issued_by_user_id=_USER_ID,
        created_at=now,
        expires_at=now + pair_code_crud.BOUND_PAIR_CODE_TTL,
        bound_device_id=device_id,
    )


# ---------------------------------------------------------------------------
# authorize-redeem
# ---------------------------------------------------------------------------


class TestAuthorizeRedeem:
    def _url(self, device_id: UUID) -> str:
        return f"{API_PREFIX}/{device_id}/authorize-redeem"

    @contextmanager
    def _writes(self, device_id: UUID) -> Iterator[dict[str, AsyncMock]]:
        mocks = {
            "mint": AsyncMock(return_value=_code_row(device_id)),
            "cancel": AsyncMock(return_value=1),
            "clear": AsyncMock(return_value=True),
            "delete_revoked": AsyncMock(return_value=True),
        }
        with (
            patch.object(pair_code_crud, "mint_pair_code", mocks["mint"]),
            patch.object(pair_code_crud, "cancel_pending_for_device", mocks["cancel"]),
            patch.object(device_crud, "set_credential_revoked_at", mocks["clear"]),
            patch.object(dmk_crud, "delete_if_revoked", mocks["delete_revoked"]),
        ):
            yield mocks

    def test_no_bearer_is_401(self) -> None:
        """No SSO identity at all → the Cognito dependency refuses."""
        device_id = uuid4()
        client = TestClient(_app(sso_user=False))
        with self._writes(device_id) as writes:
            resp = client.post(self._url(device_id))
        assert resp.status_code == 401, resp.text
        writes["mint"].assert_not_called()

    def test_device_jwt_caller_is_401(self) -> None:
        """A coord device JWT is not an operator SSO identity: the Cognito
        verifier rejects it, so nothing is authorized — and a device can
        never authorize itself."""
        from app.auth import cognito_user

        device_id = uuid4()
        coord = _Coord()
        client = TestClient(_app(sso_user=False))
        with (
            patch.object(
                cognito_user,
                "verify_cognito_token_and_resolve_user",
                AsyncMock(side_effect=cognito_user.CognitoAuthError("not cognito")),
            ),
            _operator(tenants=(uuid4(),), owned_rows={}) as (identity, _owned),
            self._writes(device_id) as writes,
        ):
            resp = client.post(
                self._url(device_id),
                headers={"Authorization": f"Bearer {coord.token(device_id)}"},
            )
        assert resp.status_code == 401, resp.text
        identity.assert_not_called()
        writes["mint"].assert_not_called()

    def test_unlinked_operator_is_refused(self) -> None:
        device_id = uuid4()
        client = TestClient(_app())
        with (
            patch(
                f"{_DEVICES_MODULE}.get_coord_identity",
                AsyncMock(side_effect=HTTPException(403, "tenant_not_resolved")),
            ),
            self._writes(device_id) as writes,
        ):
            resp = client.post(self._url(device_id))
        assert resp.status_code == 403, resp.text
        writes["mint"].assert_not_called()

    def test_device_outside_callers_tenant_is_403(self) -> None:
        device_id = uuid4()
        mine, theirs = uuid4(), uuid4()
        client = TestClient(_app())
        with (
            _operator(tenants=(mine,), owned_rows={device_id: _row(device_id, theirs)}),
            self._writes(device_id) as writes,
        ):
            resp = client.post(self._url(device_id))
        assert resp.status_code == 403, resp.text
        assert resp.json()["detail"]["code"] == "device_not_in_tenant"
        for mock in writes.values():
            mock.assert_not_called()

    def test_device_not_among_callers_is_404(self) -> None:
        device_id = uuid4()
        client = TestClient(_app())
        with (
            _operator(tenants=(uuid4(),), owned_rows={}),
            self._writes(device_id) as writes,
        ):
            resp = client.post(self._url(device_id))
        assert resp.status_code == 404, resp.text
        assert resp.json()["detail"]["code"] == "device_not_found"
        writes["mint"].assert_not_called()

    def test_body_device_id_is_ignored(self) -> None:
        """The target is the PATH; a body naming another device changes
        nothing — every write addresses the path device."""
        path_device, body_device = uuid4(), uuid4()
        tenant = uuid4()
        client = TestClient(_app())
        with (
            _operator(
                tenants=(tenant,),
                owned_rows={
                    path_device: _row(path_device, tenant),
                    body_device: _row(body_device, tenant),
                },
            ) as (_identity_mock, owned),
            self._writes(path_device) as writes,
        ):
            resp = client.post(
                self._url(path_device),
                json={
                    "device_id": str(body_device),
                    "bound_device_id": str(body_device),
                },
            )
        assert resp.status_code == 202, resp.text
        assert resp.json()["device_id"] == str(path_device)
        assert UUID(str(owned.call_args.args[1])) == path_device
        assert writes["mint"].call_args.kwargs["bound_device_id"] == path_device
        assert writes["cancel"].call_args.args[1] == path_device
        assert writes["clear"].call_args.args[1:] == (path_device, None)
        assert writes["delete_revoked"].call_args.args[1] == path_device

    def test_authorize_mints_a_bound_code_and_never_returns_it(self) -> None:
        device_id, tenant = uuid4(), uuid4()
        client = TestClient(_app())
        with (
            _operator(
                tenants=(uuid4(), tenant),
                owned_rows={device_id: _row(device_id, tenant)},
            ),
            self._writes(device_id) as writes,
        ):
            resp = client.post(self._url(device_id))

        assert resp.status_code == 202, resp.text
        body = resp.json()
        assert set(body) == {"device_id", "expires_at"}
        assert "ABCDEF" not in resp.text
        mint_kwargs = writes["mint"].call_args.kwargs
        assert mint_kwargs["tenant_id"] == tenant  # the DEVICE's tenant
        assert mint_kwargs["issued_by_user_id"] == _USER_ID
        assert mint_kwargs["ttl"] == timedelta(minutes=30)
        # The new code survives the supersede sweep of older ones.
        assert writes["cancel"].call_args.kwargs["except_code"] == "ABCDEF"


# ---------------------------------------------------------------------------
# pending-redeem
# ---------------------------------------------------------------------------


class TestPendingRedeem:
    def _url(self, device_id: UUID) -> str:
        return f"{API_PREFIX}/{device_id}/pending-redeem"

    @contextmanager
    def _state(
        self,
        *,
        revoked_at: datetime | None = None,
        revoked_error: Exception | None = None,
        pending: PairCode | None = None,
    ) -> Iterator[AsyncMock]:
        revoked = (
            AsyncMock(side_effect=revoked_error)
            if revoked_error is not None
            else AsyncMock(return_value=revoked_at)
        )
        claim = AsyncMock(return_value=pending)
        with (
            patch.object(device_crud, "get_credential_revoked_at", revoked),
            patch.object(pair_code_crud, "claim_undelivered_for_device", claim),
        ):
            yield claim

    def _get(self, device_id: UUID, token: str | None) -> httpx.Response:
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        return TestClient(_app(sso_user=False)).get(
            self._url(device_id), headers=headers
        )

    def test_no_token_is_401(self) -> None:
        device_id = uuid4()
        with _Coord().installed(), self._state(pending=_code_row(device_id)) as claim:
            resp = self._get(device_id, None)
        assert resp.status_code == 401, resp.text
        assert resp.json()["detail"]["code"] == "device_token_missing"
        claim.assert_not_called()

    def test_token_for_another_device_is_403(self) -> None:
        device_id, other = uuid4(), uuid4()
        coord = _Coord()
        with coord.installed(), self._state(pending=_code_row(device_id)) as claim:
            resp = self._get(device_id, coord.token(other, expired_ago_s=_DAY_S))
        assert resp.status_code == 403, resp.text
        assert resp.json()["detail"]["code"] == "device_mismatch"
        claim.assert_not_called()

    def test_token_past_the_30_day_grace_is_401(self) -> None:
        device_id = uuid4()
        coord = _Coord()
        with coord.installed(), self._state(pending=_code_row(device_id)) as claim:
            resp = self._get(
                device_id, coord.token(device_id, expired_ago_s=31 * _DAY_S)
            )
        assert resp.status_code == 401, resp.text
        assert resp.json()["detail"]["code"] == "device_token_expired_beyond_grace"
        claim.assert_not_called()

    def test_token_signed_by_another_key_is_401(self) -> None:
        device_id = uuid4()
        with _Coord().installed(), self._state(pending=_code_row(device_id)) as claim:
            resp = self._get(device_id, _Coord().token(device_id, expired_ago_s=_DAY_S))
        assert resp.status_code == 401, resp.text
        assert resp.json()["detail"]["code"] == "device_token_invalid"
        claim.assert_not_called()

    @pytest.mark.parametrize(
        ("overrides", "code"),
        [
            ({"sub_type": "agent"}, "not_a_device_principal"),
            ({"sub_type": "service"}, "not_a_device_principal"),
            ({"sub_type": None}, "not_a_device_principal"),
            ({"mint_provenance": "bootstrap"}, "device_token_provenance_refused"),
        ],
    )
    def test_non_device_principal_is_403(
        self, overrides: dict[str, Any], code: str
    ) -> None:
        device_id = uuid4()
        coord = _Coord()
        with coord.installed(), self._state(pending=_code_row(device_id)) as claim:
            resp = self._get(device_id, coord.token(device_id, **overrides))
        assert resp.status_code == 403, resp.text
        assert resp.json()["detail"]["code"] == code
        claim.assert_not_called()

    @pytest.mark.parametrize(
        ("overrides", "code"),
        [
            # A pre-provenance push token: device-typed, but sub is a push
            # session and there is no user. Not "bootstrap", still refused.
            (
                {"sub": "push:session-123", "user_id": None, "mint_provenance": None},
                "device_token_shape_refused",
            ),
            ({"user_id": None}, "device_token_shape_refused"),
            ({"user_id": None, "mint_provenance": None}, "device_token_shape_refused"),
            ({"sub": "device:someone-else"}, "device_token_shape_refused"),
            ({"mint_provenance": "agent_allocate"}, "device_token_provenance_refused"),
            ({"mint_provenance": "unknown"}, "device_token_provenance_refused"),
        ],
    )
    def test_token_not_shaped_like_a_paired_device_is_403(
        self, overrides: dict[str, Any], code: str
    ) -> None:
        device_id = uuid4()
        coord = _Coord()
        with coord.installed(), self._state(pending=_code_row(device_id)) as claim:
            resp = self._get(
                device_id, coord.token(device_id, expired_ago_s=_DAY_S, **overrides)
            )
        assert resp.status_code == 403, resp.text
        assert resp.json()["detail"]["code"] == code
        claim.assert_not_called()

    def test_pre_provenance_paired_shape_is_admitted(self) -> None:
        """A token minted before ``mint_provenance`` existed, in the exact
        ``issue_device`` shape, may still collect (inside the grace)."""
        device_id = uuid4()
        coord = _Coord()
        with coord.installed(), self._state(pending=_code_row(device_id)):
            resp = self._get(
                device_id,
                coord.token(device_id, expired_ago_s=_DAY_S, mint_provenance=None),
            )
        assert resp.status_code == 200, resp.text

    def test_delivered_code_is_never_cached(self) -> None:
        device_id = uuid4()
        coord = _Coord()
        with coord.installed(), self._state(pending=_code_row(device_id)):
            resp = self._get(device_id, coord.token(device_id))
        assert resp.status_code == 200, resp.text
        assert resp.headers["cache-control"] == "no-store"

    def test_revoked_device_is_403(self) -> None:
        device_id = uuid4()
        coord = _Coord()
        with (
            coord.installed(),
            self._state(
                revoked_at=datetime.now(UTC), pending=_code_row(device_id)
            ) as claim,
        ):
            resp = self._get(device_id, coord.token(device_id, expired_ago_s=_DAY_S))
        assert resp.status_code == 403, resp.text
        assert resp.json()["detail"]["code"] == "device_credential_revoked"
        claim.assert_not_called()

    def test_unreadable_revocation_state_refuses(self) -> None:
        device_id = uuid4()
        coord = _Coord()
        with (
            coord.installed(),
            self._state(
                revoked_error=RuntimeError("db down"), pending=_code_row(device_id)
            ) as claim,
        ):
            resp = self._get(device_id, coord.token(device_id, expired_ago_s=_DAY_S))
        assert resp.status_code == 503, resp.text
        assert resp.json()["detail"]["code"] == "device_credential_state_unavailable"
        claim.assert_not_called()

    def test_valid_token_with_nothing_pending_is_204(self) -> None:
        device_id = uuid4()
        coord = _Coord()
        with coord.installed(), self._state(pending=None) as claim:
            resp = self._get(device_id, coord.token(device_id, expired_ago_s=_DAY_S))
        assert resp.status_code == 204, resp.text
        assert resp.content == b""
        claim.assert_awaited_once()

    def test_expired_token_inside_grace_collects_the_code(self) -> None:
        device_id = uuid4()
        coord = _Coord()
        with coord.installed(), self._state(pending=_code_row(device_id)):
            resp = self._get(
                device_id, coord.token(device_id, expired_ago_s=10 * _DAY_S)
            )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["code"] == "ABCDEF"
        assert body["expires_at"]

    def test_live_token_also_collects(self) -> None:
        device_id = uuid4()
        coord = _Coord()
        with coord.installed(), self._state(pending=_code_row(device_id)):
            resp = self._get(device_id, coord.token(device_id))
        assert resp.status_code == 200, resp.text


# ---------------------------------------------------------------------------
# revoke + the refusals it arms
# ---------------------------------------------------------------------------


class TestRevoke:
    def _url(self, device_id: UUID) -> str:
        return f"{API_PREFIX}/{device_id}/machine-credential/revoke"

    def test_revoke_revokes_key_sets_deny_and_cancels_codes(self) -> None:
        device_id, tenant = uuid4(), uuid4()
        client = TestClient(_app())
        with (
            _operator(
                tenants=(tenant,), owned_rows={device_id: _row(device_id, tenant)}
            ),
            patch.object(dmk_crud, "revoke", AsyncMock(return_value=None)) as revoke,
            patch.object(
                device_crud, "set_credential_revoked_at", AsyncMock(return_value=True)
            ) as set_deny,
            patch.object(
                pair_code_crud, "cancel_pending_for_device", AsyncMock(return_value=1)
            ) as cancel,
        ):
            resp = client.post(self._url(device_id))

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["device_id"] == str(device_id)
        assert body["revoked_at"]
        assert revoke.call_args.args[1] == device_id
        stamped = set_deny.call_args.args[2]
        assert isinstance(stamped, datetime) and stamped.tzinfo is not None
        assert cancel.call_args.args[1] == device_id

    def test_revoke_outside_tenant_is_403(self) -> None:
        device_id = uuid4()
        client = TestClient(_app())
        with (
            _operator(
                tenants=(uuid4(),), owned_rows={device_id: _row(device_id, uuid4())}
            ),
            patch.object(dmk_crud, "revoke", AsyncMock()) as revoke,
        ):
            resp = client.post(self._url(device_id))
        assert resp.status_code == 403, resp.text
        revoke.assert_not_called()

    def test_revoke_with_no_device_row_commits_nothing(self) -> None:
        device_id, tenant = uuid4(), uuid4()
        db = _fake_db()
        from app.api.deps import get_async_db

        app = _app()
        app.dependency_overrides[get_async_db] = lambda: db
        with (
            _operator(
                tenants=(tenant,), owned_rows={device_id: _row(device_id, tenant)}
            ),
            patch.object(dmk_crud, "revoke", AsyncMock(return_value=None)),
            patch.object(
                device_crud, "set_credential_revoked_at", AsyncMock(return_value=False)
            ),
        ):
            resp = TestClient(app).post(self._url(device_id))
        assert resp.status_code == 404, resp.text
        db.commit.assert_not_called()
        db.rollback.assert_awaited_once()


def _usable_cred(device_id: UUID) -> DeviceMachineCredential:
    return DeviceMachineCredential(
        device_id=device_id,
        owner_user_id=_USER_ID,
        dmk_hash="x",
        dmk_prefix="dmk_x",
        expires_at=datetime.now(UTC) + timedelta(days=60),
    )


class TestRevokedDeviceRefusesEveryCredentialDoor:
    """While ``credential_revoked_at`` is set, ``/mint``, ``/self-mint`` and
    ``/exchange`` refuse with 403 ``device_credential_revoked``, before any
    key is minted or any coord call is made."""

    @contextmanager
    def _revoked(self) -> Iterator[None]:
        with patch.object(
            device_crud,
            "get_credential_revoked_at",
            AsyncMock(return_value=datetime.now(UTC)),
        ):
            yield

    def test_user_bearer_mint_refuses(self) -> None:
        device_id, tenant = uuid4(), uuid4()
        client = TestClient(_app())
        with (
            self._revoked(),
            _operator(
                tenants=(tenant,), owned_rows={device_id: _row(device_id, tenant)}
            ),
            patch.object(dmk_crud, "mint", AsyncMock()) as mint,
        ):
            resp = client.post(f"{API_PREFIX}/{device_id}/machine-credential/mint")
        assert resp.status_code == 403, resp.text
        assert resp.json()["detail"]["code"] == "device_credential_revoked"
        mint.assert_not_called()

    def test_self_mint_refuses(self) -> None:
        device_id = uuid4()
        claims = {
            "sub_type": "device",
            "device_id": str(device_id),
            "user_id": str(_USER_ID),
            "mint_provenance": "paired",
        }
        client = TestClient(_app(sso_user=False))
        with (
            self._revoked(),
            patch(
                "app.api.deps._verify_device_jwt",
                AsyncMock(return_value=(claims, _mock_user())),
            ),
            patch.object(coord_device, "get_device_state", AsyncMock()) as state,
            patch.object(dmk_crud, "mint", AsyncMock()) as mint,
        ):
            resp = client.post(
                f"{API_PREFIX}/{device_id}/machine-credential/self-mint",
                headers={"Authorization": "Bearer device-jwt"},
            )
        assert resp.status_code == 403, resp.text
        assert resp.json()["detail"]["code"] == "device_credential_revoked"
        state.assert_not_called()
        mint.assert_not_called()

    def test_exchange_refuses(self) -> None:
        from app.api.v1.endpoints.devices import get_authenticated_device_credential

        device_id = uuid4()
        app = _app(sso_user=False)
        app.dependency_overrides[get_authenticated_device_credential] = (
            lambda: _usable_cred(device_id)
        )
        with (
            self._revoked(),
            patch.object(coord_service_account, "_admin_secret", "test-secret"),
            patch.object(dmk_crud, "bump_last_used", AsyncMock()) as bump,
            patch.object(
                coord_service_account, "mint_device_token", AsyncMock()
            ) as mint,
        ):
            resp = TestClient(app).post(
                f"{API_PREFIX}/{device_id}/machine-credential/exchange"
            )
        assert resp.status_code == 403, resp.text
        assert resp.json()["detail"]["code"] == "device_credential_revoked"
        bump.assert_not_called()
        mint.assert_not_called()

    def test_unreadable_state_refuses_exchange(self) -> None:
        from app.api.v1.endpoints.devices import get_authenticated_device_credential

        device_id = uuid4()
        app = _app(sso_user=False)
        app.dependency_overrides[get_authenticated_device_credential] = (
            lambda: _usable_cred(device_id)
        )
        with (
            patch.object(
                device_crud,
                "get_credential_revoked_at",
                AsyncMock(side_effect=RuntimeError("db down")),
            ),
            patch.object(coord_service_account, "_admin_secret", "test-secret"),
            patch.object(
                coord_service_account, "mint_device_token", AsyncMock()
            ) as mint,
        ):
            resp = TestClient(app).post(
                f"{API_PREFIX}/{device_id}/machine-credential/exchange"
            )
        assert resp.status_code == 503, resp.text
        mint.assert_not_called()


# ---------------------------------------------------------------------------
# credential-overview
# ---------------------------------------------------------------------------


class TestCredentialOverview:
    def test_lists_only_callers_tenant_devices_with_web_facts(self) -> None:
        mine, theirs = uuid4(), uuid4()
        keyed, bare, foreign = uuid4(), uuid4(), uuid4()
        revoked = datetime(2026, 9, 30, 10, tzinfo=UTC)
        key_expiry = datetime.now(UTC) + timedelta(days=40)
        code = _code_row(bare)
        client = TestClient(_app())
        with (
            _operator(
                tenants=(mine,),
                owned_rows={},
                by_user=[
                    # A coord row whose JSON says "not revoked" must not win:
                    # the deny is read from web's own database.
                    _row(keyed, mine, credential_revoked_at=None),
                    _row(bare, mine),
                    _row(foreign, theirs),
                ],
            ),
            patch.object(
                dmk_crud,
                "list_for_devices",
                AsyncMock(
                    return_value={
                        keyed: DeviceMachineCredential(
                            device_id=keyed,
                            dmk_hash="x",
                            dmk_prefix="dmk_x",
                            expires_at=key_expiry,
                        )
                    }
                ),
            ) as list_keys,
            patch.object(
                pair_code_crud,
                "pending_for_devices",
                AsyncMock(return_value={bare: code}),
            ),
            patch.object(
                device_crud,
                "credential_revoked_at_for_devices",
                AsyncMock(return_value={keyed: revoked, bare: None}),
            ),
        ):
            resp = client.get(f"{API_PREFIX}/credential-overview")

        assert resp.status_code == 200, resp.text
        devices = {d["device_id"]: d for d in resp.json()["devices"]}
        assert set(devices) == {str(keyed), str(bare)}
        assert foreign not in list_keys.call_args.args[1]

        k = devices[str(keyed)]
        assert k["hostname"] == "merytshost"
        assert k["machine_key"]["present"] is True
        assert k["machine_key"]["expires_at"] is not None
        assert k["machine_key"]["revoked_at"] is None
        assert k["credential_revoked_at"].startswith("2026-09-30T10:00:00")
        assert k["pending_redeem"] is None

        b = devices[str(bare)]
        assert b["machine_key"] == {
            "present": False,
            "expires_at": None,
            "revoked_at": None,
        }
        assert b["credential_revoked_at"] is None
        assert b["pending_redeem"]["expires_at"]
        assert b["pending_redeem"]["delivered_at"] is None
        # Posture is coord's /coord/status — never served (or defaulted) here.
        assert "posture" not in b and "status" not in b

    def test_route_is_not_captured_as_a_device_id(self) -> None:
        client = TestClient(_app())
        with (
            _operator(tenants=(uuid4(),), owned_rows={}, by_user=[]),
            patch.object(dmk_crud, "list_for_devices", AsyncMock(return_value={})),
            patch.object(
                pair_code_crud, "pending_for_devices", AsyncMock(return_value={})
            ),
            patch.object(
                device_crud,
                "credential_revoked_at_for_devices",
                AsyncMock(return_value={}),
            ),
        ):
            resp = client.get(f"{API_PREFIX}/credential-overview")
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"devices": []}


# ---------------------------------------------------------------------------
# pair-cli auto-mint no longer rotates a usable key (finding 414676cf)
# ---------------------------------------------------------------------------


class TestPairCliKeepsAUsableKey:
    _BODY = {"hostname": "spaceship"}

    @contextmanager
    def _coord_pair_cli(self, device_id: UUID) -> Iterator[None]:
        resp = MagicMock(spec=httpx.Response)
        resp.status_code = 201
        resp.json.return_value = {"device_id": str(device_id), "token": "device-jwt"}
        resp.text = ""
        with (
            patch.object(coord_service_account, "_admin_secret", "test-secret"),
            patch("app.services.coord_proxy.httpx.AsyncClient") as MockClient,
        ):
            instance = AsyncMock()
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            instance.post.return_value = resp
            MockClient.return_value = instance
            yield

    def _post(self, device_id: UUID) -> httpx.Response:
        return TestClient(_app()).post(
            f"{API_PREFIX}/pair-cli",
            json={"device_id": str(device_id), **self._BODY},
            headers={"Authorization": "Bearer cognito-tok"},
        )

    def test_usable_key_is_kept_not_rotated(self) -> None:
        device_id = uuid4()
        with (
            self._coord_pair_cli(device_id),
            patch.object(
                device_crud, "get_credential_revoked_at", AsyncMock(return_value=None)
            ),
            patch.object(
                dmk_crud,
                "mint",
                AsyncMock(
                    side_effect=dmk_crud.DeviceMachineKeyStillUsableError(device_id)
                ),
            ) as mint,
        ):
            resp = self._post(device_id)
        assert resp.status_code == 201, resp.text
        assert resp.json()["device_machine_key"] is None
        kwargs = mint.call_args.kwargs
        assert kwargs["refuse_if_usable_beyond"] == timedelta(days=7)
        assert kwargs["refuse_if_revoked"] is True

    def test_revoked_device_gets_no_jwt(self) -> None:
        """Once coord accepts the pairing, a revoked device is refused and the
        JWT coord minted is withheld; no key is minted either."""
        device_id = uuid4()
        with (
            self._coord_pair_cli(device_id),
            patch.object(
                device_crud,
                "get_credential_revoked_at",
                AsyncMock(return_value=datetime.now(UTC)),
            ),
            patch.object(dmk_crud, "mint", AsyncMock()) as mint,
        ):
            resp = self._post(device_id)
        assert resp.status_code == 403, resp.text
        assert resp.json()["detail"]["code"] == "device_credential_revoked"
        assert "device-jwt" not in resp.text
        mint.assert_not_called()

    def test_coord_refusal_discloses_no_revocation_state(self) -> None:
        """A caller coord will not pair (e.g. not the owner) never reaches the
        revocation read, so learns nothing about the device's state."""
        device_id = uuid4()
        refused = MagicMock(spec=httpx.Response)
        refused.status_code = 403
        refused.json.return_value = {"error": "user_mismatch"}
        refused.text = "user_mismatch"
        with (
            patch.object(coord_service_account, "_admin_secret", "test-secret"),
            patch(
                "app.api.v1.endpoints.devices.post_to_coord",
                AsyncMock(return_value=refused),
            ),
            patch.object(device_crud, "get_credential_revoked_at", AsyncMock()) as read,
        ):
            resp = self._post(device_id)
        assert resp.status_code == 502, resp.text
        read.assert_not_called()


# ---------------------------------------------------------------------------
# DB-backed: the real crud against Postgres
# ---------------------------------------------------------------------------


async def _device(db: AsyncSession, user_id: UUID) -> UUID:
    device_id = uuid4()
    db.add(
        Device(
            device_id=device_id,
            user_id=user_id,
            name=f"runner-{device_id.hex[:6]}",
            hostname="merytshost",
            state="healthy",
        )
    )
    await db.flush()
    return device_id


def _asgi_client(db: AsyncSession, user_id: UUID | None) -> httpx.AsyncClient:
    """In-process app sharing the test's async session (same event loop)."""
    from app.api.deps import get_async_db, get_current_active_user_async
    from app.api.v1.endpoints.devices import router as devices_router
    from app.api.v1.endpoints.pair_codes import router as pair_codes_router

    app = FastAPI()

    async def _db() -> Any:
        yield db

    app.dependency_overrides[get_async_db] = _db
    if user_id is not None:
        user = MagicMock()
        user.id = user_id
        user.is_active = True
        app.dependency_overrides[get_current_active_user_async] = lambda: user
    app.include_router(devices_router, prefix=API_PREFIX)
    app.include_router(pair_codes_router, prefix=f"{API_PREFIX}/pair-codes")
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


_TENANT = UUID("11111111-2222-3333-4444-555555555555")


class TestDatabaseBacked:
    @pytest.mark.asyncio
    async def test_pending_redeem_delivers_exactly_once(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        device_id = await _device(async_db_session, test_user.id)
        coord = _Coord()
        token = coord.token(device_id, expired_ago_s=3 * _DAY_S)

        async with _asgi_client(async_db_session, test_user.id) as client:
            with _operator(
                tenants=(_TENANT,), owned_rows={device_id: _row(device_id, _TENANT)}
            ):
                auth = await client.post(f"{API_PREFIX}/{device_id}/authorize-redeem")
            assert auth.status_code == 202, auth.text
            assert "code" not in auth.json()

            with coord.installed():
                first = await client.get(
                    f"{API_PREFIX}/{device_id}/pending-redeem",
                    headers={"Authorization": f"Bearer {token}"},
                )
                second = await client.get(
                    f"{API_PREFIX}/{device_id}/pending-redeem",
                    headers={"Authorization": f"Bearer {token}"},
                )

        assert first.status_code == 200, first.text
        code = first.json()["code"]
        row = (
            await async_db_session.execute(
                select(PairCode).where(PairCode.code == code)
            )
        ).scalar_one()
        assert row.bound_device_id == device_id
        assert row.tenant_id == _TENANT
        assert row.delivered_at is not None
        assert second.status_code == 204, second.text

    @pytest.mark.asyncio
    async def test_bound_code_refuses_redemption_for_another_device(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        device_id = await _device(async_db_session, test_user.id)
        row = await pair_code_crud.mint_pair_code(
            async_db_session,
            tenant_id=_TENANT,
            issued_by_user_id=test_user.id,
            bound_device_id=device_id,
            ttl=pair_code_crud.BOUND_PAIR_CODE_TTL,
        )
        assert await pair_code_crud.claim_undelivered_for_device(
            async_db_session, device_id
        )
        async with _asgi_client(async_db_session, None) as client:
            with patch(
                "app.api.v1.endpoints.pair_codes.post_to_coord", AsyncMock()
            ) as coord_call:
                resp = await client.post(
                    f"{API_PREFIX}/pair-codes/{row.code}/redeem",
                    json={"device_id": str(uuid4()), "hostname": "intruder"},
                )
        assert resp.status_code == 403, resp.text
        assert resp.json()["detail"]["code"] == "pair_code_bound_to_other_device"
        coord_call.assert_not_called()
        await async_db_session.refresh(row)
        assert row.redeemed_at is None  # the rightful device can still use it

    @pytest.mark.asyncio
    async def test_bound_code_redeems_for_its_own_device(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        device_id = await _device(async_db_session, test_user.id)
        row = await pair_code_crud.mint_pair_code(
            async_db_session,
            tenant_id=_TENANT,
            issued_by_user_id=test_user.id,
            bound_device_id=device_id,
            ttl=pair_code_crud.BOUND_PAIR_CODE_TTL,
        )
        assert await pair_code_crud.claim_undelivered_for_device(
            async_db_session, device_id
        )
        coord_resp = MagicMock(spec=httpx.Response)
        coord_resp.status_code = 201
        coord_resp.json.return_value = {"device_id": str(device_id), "token": "jwt"}
        coord_resp.text = ""
        async with _asgi_client(async_db_session, None) as client:
            with (
                patch(
                    "app.api.v1.endpoints.pair_codes.post_to_coord",
                    AsyncMock(return_value=coord_resp),
                ),
                patch(
                    "app.api.v1.endpoints.pair_codes.coord_service_account"
                ) as bridge,
            ):
                bridge.enabled = True
                bridge._headers = AsyncMock(return_value={})
                resp = await client.post(
                    f"{API_PREFIX}/pair-codes/{row.code}/redeem",
                    json={"device_id": str(device_id), "hostname": "merytshost"},
                )
        assert resp.status_code == 200, resp.text
        assert resp.json()["device_token_jwt"] == "jwt"

    @pytest.mark.asyncio
    async def test_revoke_arms_every_refusal_and_authorize_clears_it(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        device_id = await _device(async_db_session, test_user.id)
        await dmk_crud.mint(
            async_db_session,
            device_id=device_id,
            owner_user_id=test_user.id,
            tenant_id=_TENANT,
        )
        coord = _Coord()
        token = coord.token(device_id, expired_ago_s=_DAY_S)
        live_claims = {
            "sub_type": "device",
            "device_id": str(device_id),
            "user_id": str(test_user.id),
            "mint_provenance": "paired",
        }
        owned = {device_id: _row(device_id, _TENANT)}

        async with _asgi_client(async_db_session, test_user.id) as client:
            with _operator(tenants=(_TENANT,), owned_rows=owned):
                # A pending authorization exists before the revoke...
                pre = await client.post(f"{API_PREFIX}/{device_id}/authorize-redeem")
                assert pre.status_code == 202, pre.text
                revoke = await client.post(
                    f"{API_PREFIX}/{device_id}/machine-credential/revoke"
                )
                assert revoke.status_code == 200, revoke.text
                assert await device_crud.get_credential_revoked_at(
                    async_db_session, device_id
                )

                mint = await client.post(
                    f"{API_PREFIX}/{device_id}/machine-credential/mint"
                )
                assert mint.status_code == 403, mint.text
                assert mint.json()["detail"]["code"] == "device_credential_revoked"

            with (
                patch(
                    "app.api.deps._verify_device_jwt",
                    AsyncMock(return_value=(live_claims, test_user)),
                ),
                patch.object(coord_device, "get_device_state", AsyncMock()) as state,
            ):
                self_mint = await client.post(
                    f"{API_PREFIX}/{device_id}/machine-credential/self-mint",
                    headers={"Authorization": "Bearer live-device-jwt"},
                )
            assert self_mint.status_code == 403, self_mint.text
            assert self_mint.json()["detail"]["code"] == "device_credential_revoked"
            state.assert_not_called()

            with coord.installed():
                # ...and the revoke cancelled it: the poll refuses outright.
                poll = await client.get(
                    f"{API_PREFIX}/{device_id}/pending-redeem",
                    headers={"Authorization": f"Bearer {token}"},
                )
            assert poll.status_code == 403, poll.text
            assert poll.json()["detail"]["code"] == "device_credential_revoked"

            # The revoked key row blocks re-enrolment...
            cred = (
                await async_db_session.execute(
                    select(DeviceMachineCredential).where(
                        DeviceMachineCredential.device_id == device_id
                    )
                )
            ).scalar_one()
            assert cred.revoked_at is not None and cred.dmk_hash == ""

            # ...until an operator authorizes the device again.
            with _operator(tenants=(_TENANT,), owned_rows=owned):
                again = await client.post(f"{API_PREFIX}/{device_id}/authorize-redeem")
            assert again.status_code == 202, again.text
            assert (
                await device_crud.get_credential_revoked_at(async_db_session, device_id)
                is None
            )
            gone = (
                await async_db_session.execute(
                    select(DeviceMachineCredential).where(
                        DeviceMachineCredential.device_id == device_id
                    )
                )
            ).scalar_one_or_none()
            assert gone is None

            with coord.installed():
                poll = await client.get(
                    f"{API_PREFIX}/{device_id}/pending-redeem",
                    headers={"Authorization": f"Bearer {token}"},
                )
            assert poll.status_code == 200, poll.text

    @pytest.mark.asyncio
    async def test_new_authorization_supersedes_the_old_one(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        device_id = await _device(async_db_session, test_user.id)
        old = await pair_code_crud.mint_pair_code(
            async_db_session,
            tenant_id=_TENANT,
            issued_by_user_id=test_user.id,
            bound_device_id=device_id,
            ttl=pair_code_crud.BOUND_PAIR_CODE_TTL,
        )
        new = await pair_code_crud.mint_pair_code(
            async_db_session,
            tenant_id=_TENANT,
            issued_by_user_id=test_user.id,
            bound_device_id=device_id,
            ttl=pair_code_crud.BOUND_PAIR_CODE_TTL,
        )
        cancelled = await pair_code_crud.cancel_pending_for_device(
            async_db_session, device_id, except_code=new.code
        )
        assert cancelled == 1
        pending = await pair_code_crud.pending_for_devices(
            async_db_session, [device_id]
        )
        assert pending[device_id].code == new.code
        assert await pair_code_crud.get_redeemable(async_db_session, old.code) is None

    @pytest.mark.asyncio
    async def test_delete_if_revoked_leaves_a_usable_key(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        device_id = await _device(async_db_session, test_user.id)
        await dmk_crud.mint(
            async_db_session, device_id=device_id, owner_user_id=test_user.id
        )
        assert await dmk_crud.delete_if_revoked(async_db_session, device_id) is False
        keys = await dmk_crud.list_for_devices(async_db_session, [device_id])
        assert device_id in keys

    @pytest.mark.asyncio
    async def test_unbound_code_keeps_the_default_ttl_and_no_binding(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """An operator-typed code (no binding) is untouched by the new rule."""
        row = await pair_code_crud.mint_pair_code(
            async_db_session, tenant_id=_TENANT, issued_by_user_id=test_user.id
        )
        assert row.bound_device_id is None
        assert row.expires_at - row.created_at == pair_code_crud.PAIR_CODE_TTL

    @pytest.mark.asyncio
    async def test_uncollected_bound_code_answers_like_an_unknown_code(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """Before its device collected it, a bound code cannot be redeemed —
        not even for its own device — and does not reveal that it exists."""
        device_id = await _device(async_db_session, test_user.id)
        row = await pair_code_crud.mint_pair_code(
            async_db_session,
            tenant_id=_TENANT,
            issued_by_user_id=test_user.id,
            bound_device_id=device_id,
            ttl=pair_code_crud.BOUND_PAIR_CODE_TTL,
        )
        async with _asgi_client(async_db_session, None) as client:
            with patch(
                "app.api.v1.endpoints.pair_codes.post_to_coord", AsyncMock()
            ) as coord_call:
                for presented in (device_id, uuid4()):
                    resp = await client.post(
                        f"{API_PREFIX}/pair-codes/{row.code}/redeem",
                        json={"device_id": str(presented), "hostname": "h"},
                    )
                    assert resp.status_code == 404, resp.text
                    assert resp.json()["detail"]["code"] == "pair_code_not_found"
        coord_call.assert_not_called()

    @pytest.mark.asyncio
    async def test_unbound_code_refuses_a_revoked_device(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """Typing an ordinary code into a revoked device does not re-arm it."""
        device_id = await _device(async_db_session, test_user.id)
        await device_crud.set_credential_revoked_at(
            async_db_session, device_id, datetime.now(UTC)
        )
        row = await pair_code_crud.mint_pair_code(
            async_db_session, tenant_id=_TENANT, issued_by_user_id=test_user.id
        )
        async with _asgi_client(async_db_session, None) as client:
            with patch(
                "app.api.v1.endpoints.pair_codes.post_to_coord", AsyncMock()
            ) as coord_call:
                resp = await client.post(
                    f"{API_PREFIX}/pair-codes/{row.code}/redeem",
                    json={"device_id": str(device_id), "hostname": "h"},
                )
        assert resp.status_code == 403, resp.text
        assert resp.json()["detail"]["code"] == "device_credential_revoked"
        coord_call.assert_not_called()
        await async_db_session.refresh(row)
        assert row.redeemed_at is None

    @pytest.mark.asyncio
    async def test_overview_reads_the_deny_from_the_database(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        revoked_device = await _device(async_db_session, test_user.id)
        live_device = await _device(async_db_session, test_user.id)
        stamp = datetime.now(UTC)
        await device_crud.set_credential_revoked_at(
            async_db_session, revoked_device, stamp
        )
        denies = await device_crud.credential_revoked_at_for_devices(
            async_db_session, [revoked_device, live_device, uuid4()]
        )
        assert denies[revoked_device] is not None
        assert denies[live_device] is None
        assert len(denies) == 2  # a device with no row is ABSENT, not "None"
        assert await device_crud.lock_device_row(async_db_session, revoked_device)
        assert not await device_crud.lock_device_row(async_db_session, uuid4())


# ---------------------------------------------------------------------------
# Fail-closed edges (mock session)
# ---------------------------------------------------------------------------


class TestFailClosedEdges:
    def test_redeem_refuses_when_the_deny_is_unreadable(self) -> None:
        from app.api.deps import get_async_db
        from app.api.v1.endpoints.pair_codes import router

        now = datetime.now(UTC)
        unbound = PairCode(
            code="ABCDEF",
            tenant_id=uuid4(),
            issued_by_user_id=_USER_ID,
            created_at=now,
            expires_at=now + timedelta(minutes=5),
        )
        app = FastAPI()
        app.dependency_overrides[get_async_db] = _fake_db
        app.include_router(router, prefix=f"{API_PREFIX}/pair-codes")
        with (
            patch.object(
                pair_code_crud, "get_redeemable", AsyncMock(return_value=unbound)
            ),
            patch.object(
                device_crud,
                "get_credential_revoked_at",
                AsyncMock(side_effect=RuntimeError("db down")),
            ),
            patch(
                "app.api.v1.endpoints.pair_codes.post_to_coord", AsyncMock()
            ) as coord_call,
            patch.object(pair_code_crud, "mark_redeemed", AsyncMock()) as consumed,
        ):
            resp = TestClient(app).post(
                f"{API_PREFIX}/pair-codes/ABCDEF/redeem",
                json={"device_id": str(uuid4()), "hostname": "h"},
            )
        assert resp.status_code == 503, resp.text
        assert resp.json()["detail"]["code"] == "device_credential_state_unavailable"
        coord_call.assert_not_called()
        consumed.assert_not_called()

    def test_poll_answers_503_when_coord_jwks_is_unreachable(self) -> None:
        from app.services.coord_jwks import CoordJWKSUnavailableError

        device_id = uuid4()
        unreachable = MagicMock()
        unreachable.verify_token = AsyncMock(
            side_effect=CoordJWKSUnavailableError("connect refused")
        )
        with (
            patch(f"{_DEVICES_MODULE}.coord_jwks_client", unreachable),
            patch.object(
                pair_code_crud, "claim_undelivered_for_device", AsyncMock()
            ) as claim,
        ):
            resp = TestClient(_app(sso_user=False)).get(
                f"{API_PREFIX}/{device_id}/pending-redeem",
                headers={"Authorization": "Bearer whatever"},
            )
        assert resp.status_code == 503, resp.text
        assert resp.json()["detail"]["code"] == "device_auth_unavailable"
        claim.assert_not_called()

    def test_authorize_locks_the_device_row_before_minting(self) -> None:
        device_id, tenant = uuid4(), uuid4()
        order: list[str] = []

        async def _lock(*_a: Any, **_k: Any) -> bool:
            order.append("lock")
            return True

        async def _mint(*_a: Any, **_k: Any) -> PairCode:
            order.append("mint")
            return _code_row(device_id)

        with (
            _operator(
                tenants=(tenant,), owned_rows={device_id: _row(device_id, tenant)}
            ),
            patch.object(device_crud, "lock_device_row", AsyncMock(side_effect=_lock)),
            patch.object(
                pair_code_crud, "mint_pair_code", AsyncMock(side_effect=_mint)
            ),
            patch.object(pair_code_crud, "cancel_pending_for_device", AsyncMock()),
            patch.object(device_crud, "set_credential_revoked_at", AsyncMock()),
            patch.object(dmk_crud, "delete_if_revoked", AsyncMock(return_value=False)),
        ):
            resp = TestClient(_app()).post(f"{API_PREFIX}/{device_id}/authorize-redeem")
        assert resp.status_code == 202, resp.text
        assert order == ["lock", "mint"]

    def test_authorize_with_no_device_row_mints_nothing(self) -> None:
        device_id, tenant = uuid4(), uuid4()
        with (
            _operator(
                tenants=(tenant,), owned_rows={device_id: _row(device_id, tenant)}
            ),
            patch.object(device_crud, "lock_device_row", AsyncMock(return_value=False)),
            patch.object(pair_code_crud, "mint_pair_code", AsyncMock()) as mint,
        ):
            resp = TestClient(_app()).post(f"{API_PREFIX}/{device_id}/authorize-redeem")
        assert resp.status_code == 404, resp.text
        mint.assert_not_called()

    def test_pair_cli_unreadable_deny_refuses(self) -> None:
        device_id = uuid4()
        helper = TestPairCliKeepsAUsableKey()
        with (
            helper._coord_pair_cli(device_id),
            patch.object(
                device_crud,
                "get_credential_revoked_at",
                AsyncMock(side_effect=RuntimeError("db down")),
            ),
            patch.object(dmk_crud, "mint", AsyncMock()) as mint,
        ):
            resp = helper._post(device_id)
        assert resp.status_code == 503, resp.text
        assert resp.json()["detail"]["code"] == "device_credential_state_unavailable"
        assert "device-jwt" not in resp.text
        mint.assert_not_called()

    @contextmanager
    def _pair_confirm(
        self, device_id: UUID, coord_status: int = 201
    ) -> Iterator[AsyncMock]:
        coord_resp = MagicMock(spec=httpx.Response)
        coord_resp.status_code = coord_status
        coord_resp.json.return_value = {"device_id": str(device_id), "token": "jwt-x"}
        coord_resp.text = ""
        post = AsyncMock(return_value=coord_resp)
        with (
            patch.object(coord_service_account, "_admin_secret", "test-secret"),
            patch.object(coord_service_account, "_headers", AsyncMock(return_value={})),
            patch(
                f"{_DEVICES_MODULE}.get_coord_identity",
                AsyncMock(return_value=_identity(uuid4())),
            ),
            patch("app.api.v1.endpoints.devices.post_to_coord", post),
        ):
            yield post

    def _confirm(self, device_id: str) -> httpx.Response:
        return TestClient(_app()).post(
            f"{API_PREFIX}/pair-confirm",
            json={"state": "s" * 32, "device_id": device_id},
        )

    def test_pair_confirm_refuses_a_revoked_device(self) -> None:
        device_id = uuid4()
        with (
            self._pair_confirm(device_id),
            patch.object(
                device_crud,
                "get_credential_revoked_at",
                AsyncMock(return_value=datetime.now(UTC)),
            ),
        ):
            resp = self._confirm(str(device_id))
        assert resp.status_code == 403, resp.text
        assert resp.json()["detail"]["code"] == "device_credential_revoked"
        assert "jwt-x" not in resp.text

    def test_pair_confirm_coord_refusal_discloses_no_revocation_state(self) -> None:
        device_id = uuid4()
        with (
            self._pair_confirm(device_id, coord_status=403),
            patch.object(device_crud, "get_credential_revoked_at", AsyncMock()) as read,
        ):
            resp = self._confirm(str(device_id))
        assert resp.status_code == 502, resp.text
        read.assert_not_called()

    def test_pair_confirm_refuses_an_unparseable_device_id(self) -> None:
        with (
            self._pair_confirm(uuid4()) as post,
            patch.object(device_crud, "get_credential_revoked_at", AsyncMock()) as read,
        ):
            resp = self._confirm("not-a-uuid")
        assert resp.status_code == 422, resp.text
        assert resp.json()["detail"]["code"] == "device_id_malformed"
        post.assert_not_called()
        read.assert_not_called()

    def test_owner_mint_loses_the_race_to_a_concurrent_revoke(self) -> None:
        """The deny read passed, but the key was revoked before the locked
        re-read in ``dmk_crud.mint``: the mint refuses instead of rotating."""
        device_id, tenant = uuid4(), uuid4()
        with (
            _operator(
                tenants=(tenant,), owned_rows={device_id: _row(device_id, tenant)}
            ),
            patch.object(
                device_crud, "get_credential_revoked_at", AsyncMock(return_value=None)
            ),
            patch.object(
                dmk_crud,
                "mint",
                AsyncMock(side_effect=dmk_crud.DeviceMachineKeyRevokedError(device_id)),
            ) as mint,
        ):
            resp = TestClient(_app()).post(
                f"{API_PREFIX}/{device_id}/machine-credential/mint"
            )
        assert resp.status_code == 403, resp.text
        assert resp.json()["detail"]["code"] == "device_credential_revoked"
        assert mint.call_args.kwargs["refuse_if_revoked"] is True

    def test_redeem_withholds_a_jwt_coord_minted_for_another_device(self) -> None:
        from app.api.deps import get_async_db
        from app.api.v1.endpoints.pair_codes import router

        bound, other = uuid4(), uuid4()
        code = _code_row(bound)
        code.delivered_at = datetime.now(UTC)
        coord_resp = MagicMock(spec=httpx.Response)
        coord_resp.status_code = 201
        coord_resp.json.return_value = {"device_id": str(other), "token": "jwt"}
        coord_resp.text = ""
        app = FastAPI()
        app.dependency_overrides[get_async_db] = _fake_db
        app.include_router(router, prefix=f"{API_PREFIX}/pair-codes")
        with (
            patch.object(
                pair_code_crud, "get_redeemable", AsyncMock(return_value=code)
            ),
            patch.object(
                device_crud, "get_credential_revoked_at", AsyncMock(return_value=None)
            ),
            patch(
                "app.api.v1.endpoints.pair_codes.post_to_coord",
                AsyncMock(return_value=coord_resp),
            ),
            patch("app.api.v1.endpoints.pair_codes.coord_service_account") as bridge,
            patch.object(pair_code_crud, "mark_redeemed", AsyncMock()) as consumed,
        ):
            bridge.enabled = True
            bridge._headers = AsyncMock(return_value={})
            resp = TestClient(app).post(
                f"{API_PREFIX}/pair-codes/{code.code}/redeem",
                json={"device_id": str(bound), "hostname": "h"},
            )
        assert resp.status_code == 502, resp.text
        assert resp.json()["detail"]["code"] == "coord_device_mismatch"
        assert "jwt" not in resp.text
        consumed.assert_not_called()
