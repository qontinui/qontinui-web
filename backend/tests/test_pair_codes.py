"""Tests for the single-use pair-code surface.

Phase 2a.1 of plan
``D:/qontinui-root/plans/2026-05-22-mtc-iter3-remediation-web-dashboard.md``.

Covers:

* Code generator: unambiguous-alphabet draw, no 0/O/1/I.
* CRUD mint: 6-char code, 5-min TTL, fresh row.
* CRUD redeem: get_redeemable returns valid/None correctly for
  unknown/expired/redeemed.
* Endpoint redeem: 404 for unknown, 409 for already-redeemed, 410 for
  expired, 200 + canonical PairCompleteResponse shape for happy path.
* Endpoint redeem requires NO operator JWT (the code IS the credential).
* Sweep: expired-unredeemed rows older than 24h are deleted.

The endpoint tests use ``httpx.AsyncClient`` against the running app
(not ``TestClient``) so the async SQLAlchemy session shares an asyncio
loop with the request handler — TestClient bridges sync→async via
anyio.from_thread and fails on shared asyncpg connections.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud import pair_code_crud

_FIXTURE_TENANT_ID = UUID("11111111-2222-3333-4444-555555555555")
_FIXTURE_DEVICE_ID = UUID("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")


# ---------------------------------------------------------------------------
# Code-generator unit tests (no DB)
# ---------------------------------------------------------------------------


def test_generate_code_length_and_alphabet() -> None:
    """Generated codes must be 6 chars from the unambiguous alphabet."""
    for _ in range(100):
        code = pair_code_crud.generate_code()
        assert len(code) == 6
        for ch in code:
            assert ch in pair_code_crud.PAIR_CODE_ALPHABET, (
                f"char {ch!r} not in unambiguous alphabet"
            )
        # Explicitly drop confusable chars.
        assert "0" not in code
        assert "O" not in code
        assert "1" not in code
        assert "I" not in code


def test_generate_code_randomness() -> None:
    """100 draws should yield mostly-distinct codes (loose lower bound)."""
    codes = {pair_code_crud.generate_code() for _ in range(100)}
    # 32^6 = ~10.7 billion possibilities — 100 draws should give ~100
    # distinct codes. Bail out only on catastrophic collision.
    assert len(codes) > 90


# ---------------------------------------------------------------------------
# CRUD-level tests (DB only, no HTTP)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_mint_pair_code_sets_ttl(
    async_db_session: AsyncSession, test_user
) -> None:
    """Minted code: stored TTL is ~5 minutes from now."""
    row = await pair_code_crud.mint_pair_code(
        async_db_session,
        tenant_id=_FIXTURE_TENANT_ID,
        issued_by_user_id=test_user.id,
    )
    assert len(row.code) == 6
    assert row.tenant_id == _FIXTURE_TENANT_ID
    assert row.issued_by_user_id == test_user.id
    assert row.redeemed_at is None
    assert row.redeemed_by_device_id is None

    now = datetime.now(UTC)
    expected_min = now + timedelta(minutes=5) - timedelta(seconds=30)
    expected_max = now + timedelta(minutes=5) + timedelta(seconds=30)
    assert expected_min <= row.expires_at <= expected_max


@pytest.mark.asyncio
async def test_mint_then_response_shape(
    async_db_session: AsyncSession, test_user
) -> None:
    """``PairCodeMintOut`` round-trips with the minted row."""
    from app.schemas.pair_code import PairCodeMintOut

    row = await pair_code_crud.mint_pair_code(
        async_db_session,
        tenant_id=_FIXTURE_TENANT_ID,
        issued_by_user_id=test_user.id,
    )
    out = PairCodeMintOut(code=row.code, expires_at=row.expires_at)
    assert len(out.code) == 6
    for ch in out.code:
        assert ch in pair_code_crud.PAIR_CODE_ALPHABET


@pytest.mark.asyncio
async def test_get_redeemable_returns_valid_code(
    async_db_session: AsyncSession, test_user
) -> None:
    """A freshly-minted code is redeemable."""
    minted = await pair_code_crud.mint_pair_code(
        async_db_session,
        tenant_id=_FIXTURE_TENANT_ID,
        issued_by_user_id=test_user.id,
    )
    row = await pair_code_crud.get_redeemable(async_db_session, minted.code)
    assert row is not None
    assert row.code == minted.code


@pytest.mark.asyncio
async def test_get_redeemable_returns_none_for_expired(
    async_db_session: AsyncSession, test_user
) -> None:
    """An expired code is NOT redeemable."""
    minted = await pair_code_crud.mint_pair_code(
        async_db_session,
        tenant_id=_FIXTURE_TENANT_ID,
        issued_by_user_id=test_user.id,
    )
    minted.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await async_db_session.flush()
    row = await pair_code_crud.get_redeemable(async_db_session, minted.code)
    assert row is None


@pytest.mark.asyncio
async def test_get_redeemable_returns_none_for_already_redeemed(
    async_db_session: AsyncSession, test_user
) -> None:
    """A redeemed code is NOT redeemable a second time."""
    minted = await pair_code_crud.mint_pair_code(
        async_db_session,
        tenant_id=_FIXTURE_TENANT_ID,
        issued_by_user_id=test_user.id,
    )
    await pair_code_crud.mark_redeemed(
        async_db_session, row=minted, device_id=_FIXTURE_DEVICE_ID
    )
    row = await pair_code_crud.get_redeemable(async_db_session, minted.code)
    assert row is None


@pytest.mark.asyncio
async def test_get_redeemable_returns_none_for_unknown(
    async_db_session: AsyncSession,
) -> None:
    """An unknown code returns None."""
    row = await pair_code_crud.get_redeemable(async_db_session, "AAAAAA")
    assert row is None


@pytest.mark.asyncio
async def test_find_by_code_returns_redeemed_row(
    async_db_session: AsyncSession, test_user
) -> None:
    """``find_by_code`` returns the row even after it has been redeemed.

    The redeem endpoint uses this to differentiate 404 vs. 409 vs. 410.
    """
    minted = await pair_code_crud.mint_pair_code(
        async_db_session,
        tenant_id=_FIXTURE_TENANT_ID,
        issued_by_user_id=test_user.id,
    )
    await pair_code_crud.mark_redeemed(
        async_db_session, row=minted, device_id=_FIXTURE_DEVICE_ID
    )
    found = await pair_code_crud.find_by_code(async_db_session, minted.code)
    assert found is not None
    assert found.redeemed_at is not None


@pytest.mark.asyncio
async def test_sweep_expired_unredeemed(
    async_db_session: AsyncSession, test_user
) -> None:
    """Sweep deletes expired-unused rows older than 24h."""
    fresh = await pair_code_crud.mint_pair_code(
        async_db_session,
        tenant_id=_FIXTURE_TENANT_ID,
        issued_by_user_id=test_user.id,
    )
    ancient = await pair_code_crud.mint_pair_code(
        async_db_session,
        tenant_id=_FIXTURE_TENANT_ID,
        issued_by_user_id=test_user.id,
    )
    ancient.expires_at = datetime.now(UTC) - timedelta(hours=25)
    await async_db_session.flush()

    deleted = await pair_code_crud.sweep_expired_unredeemed(async_db_session)
    assert deleted >= 1
    survivor = await pair_code_crud.find_by_code(async_db_session, fresh.code)
    assert survivor is not None


# ---------------------------------------------------------------------------
# HTTP endpoint tests — use httpx.AsyncClient so the request handler
# runs in the SAME asyncio loop as the async DB session.
# ---------------------------------------------------------------------------


def _build_test_app(
    *,
    db_session: AsyncSession,
    user_id: UUID | None,
    include_auth: bool = True,
) -> FastAPI:
    """Build a FastAPI app with overridden deps for endpoint testing.

    ``include_auth=False`` deliberately omits the auth override so the
    redeem-unauthenticated test can confirm the endpoint doesn't require
    a JWT.
    """
    from app.api.deps import get_async_db, get_current_active_user_async
    from app.api.v1.endpoints.pair_codes import router as pair_codes_router

    test_app = FastAPI()

    if include_auth and user_id is not None:
        mock_user = MagicMock()
        mock_user.id = user_id
        mock_user.email = "operator@example.com"
        mock_user.is_active = True
        mock_user.is_verified = True
        mock_user.is_superuser = False
        test_app.dependency_overrides[get_current_active_user_async] = lambda: mock_user

    async def _db_override():
        yield db_session

    test_app.dependency_overrides[get_async_db] = _db_override
    test_app.include_router(pair_codes_router, prefix="/api/v1/devices/pair-codes")
    return test_app


def _mock_resp(status_code: int = 200, json_data=None, text: str = "") -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data or {}
    resp.text = text or (str(json_data) if json_data else "")
    return resp


@pytest_asyncio.fixture()
async def async_http_client(async_db_session: AsyncSession, test_user):
    """``httpx.AsyncClient`` against an in-process app (no TestClient)."""
    app = _build_test_app(db_session=async_db_session, user_id=test_user.id)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


class TestRedeemEndpoint:
    """``POST /api/v1/devices/pair-codes/{code}/redeem`` — single-use."""

    @pytest.mark.asyncio
    async def test_redeem_happy_path(
        self,
        async_db_session: AsyncSession,
        test_user,
    ) -> None:
        """Valid code: 200 + canonical PairCompleteResponse shape.

        Patches the coord call by stubbing the endpoint's HTTP-client
        callable on the module (NOT via ``patch("httpx.AsyncClient")``
        which would also intercept the outer test client). We swap in a
        fake async-context-manager factory that returns a mock with a
        prepared ``post`` coroutine.
        """
        row = await pair_code_crud.mint_pair_code(
            async_db_session,
            tenant_id=_FIXTURE_TENANT_ID,
            issued_by_user_id=test_user.id,
        )

        coord_device_id = uuid4()
        coord_response = {
            "token": "device-jwt-abc",
            "device_id": str(coord_device_id),
            "user_id": str(test_user.id),
            "exp": 1234567890,
        }

        app = _build_test_app(db_session=async_db_session, user_id=test_user.id)
        transport = httpx.ASGITransport(app=app)

        # Capture the body coord sees so we can assert tenant_id pass-through.
        captured: dict = {}

        class _FakeClient:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return False

            async def post(self, url, *, headers=None, json=None):
                captured["url"] = url
                captured["json"] = json
                captured["headers"] = headers
                return _mock_resp(status_code=201, json_data=coord_response)

        # The outbound POST now lives in the shared coord_proxy helper —
        # swap ITS bound ``httpx`` reference (NOT via
        # ``patch("httpx.AsyncClient")`` which would also intercept the
        # outer ASGI test client). The fake carries the real exception
        # classes so the helper's except clauses stay valid.
        from app.services import coord_proxy as proxy_mod

        fake_httpx = MagicMock()
        fake_httpx.AsyncClient = _FakeClient
        fake_httpx.HTTPError = httpx.HTTPError
        fake_httpx.ConnectError = httpx.ConnectError
        fake_httpx.ConnectTimeout = httpx.ConnectTimeout
        fake_httpx.TimeoutException = httpx.TimeoutException

        with patch(
            "app.api.v1.endpoints.pair_codes.coord_service_account"
        ) as mock_bridge:
            mock_bridge.enabled = True
            mock_bridge._headers = AsyncMock(return_value={"X-Test": "1"})
            original_httpx = proxy_mod.httpx
            proxy_mod.httpx = fake_httpx
            try:
                async with httpx.AsyncClient(
                    transport=transport, base_url="http://test"
                ) as client:
                    resp = await client.post(
                        f"/api/v1/devices/pair-codes/{row.code}/redeem",
                        json={
                            "device_id": str(_FIXTURE_DEVICE_ID),
                            "hostname": "spaceship",
                        },
                    )
            finally:
                proxy_mod.httpx = original_httpx

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["device_token_jwt"] == "device-jwt-abc"
        assert body["tenant_id"] == str(_FIXTURE_TENANT_ID)
        assert body["user_id"] == str(test_user.id)
        assert body["device_id"] == str(coord_device_id)

        # Coord was called with the row's tenant_id, NOT anything the
        # runner sent in the request body.
        assert captured["json"]["tenant_id"] == str(_FIXTURE_TENANT_ID)
        assert captured["json"]["user_id"] == str(test_user.id)
        assert captured["json"]["device_id"] == str(_FIXTURE_DEVICE_ID)

    @pytest.mark.asyncio
    async def test_redeem_forwards_service_token_and_user_header(
        self,
        async_db_session: AsyncSession,
        test_user,
    ) -> None:
        """The redeem's call to coord is coord's pairing **arm B**: the web
        service token in ``Authorization`` plus ``X-Qontinui-User-Id`` naming
        the code's ISSUER, alongside the code's burned-in ``tenant_id``. Coord
        verifies that credential and proves the issuer's membership in the
        tenant by Cognito subject — so the identity coord acts on is the
        issuer's, taken from the header web sends, never from the runner.
        """
        row = await pair_code_crud.mint_pair_code(
            async_db_session,
            tenant_id=_FIXTURE_TENANT_ID,
            issued_by_user_id=test_user.id,
        )
        coord_response = {
            "token": "device-jwt-abc",
            "device_id": str(_FIXTURE_DEVICE_ID),
            "user_id": str(test_user.id),
            "exp": 1234567890,
        }
        app = _build_test_app(db_session=async_db_session, user_id=test_user.id)
        transport = httpx.ASGITransport(app=app)
        captured: dict = {}

        class _FakeClient:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return False

            async def post(self, url, *, headers=None, json=None):
                captured["url"] = url
                captured["json"] = json
                captured["headers"] = headers
                return _mock_resp(status_code=201, json_data=coord_response)

        from app.services import coord_proxy as proxy_mod

        fake_httpx = MagicMock()
        fake_httpx.AsyncClient = _FakeClient
        fake_httpx.HTTPError = httpx.HTTPError
        fake_httpx.ConnectError = httpx.ConnectError
        fake_httpx.ConnectTimeout = httpx.ConnectTimeout
        fake_httpx.TimeoutException = httpx.TimeoutException

        service_headers = {
            "Authorization": "Bearer coord-service-jwt-for-qontinui-web-strategy",
            "X-Qontinui-User-Id": str(test_user.id),
        }
        with patch(
            "app.api.v1.endpoints.pair_codes.coord_service_account"
        ) as mock_bridge:
            mock_bridge.enabled = True
            mock_bridge._headers = AsyncMock(return_value=service_headers)
            original_httpx = proxy_mod.httpx
            proxy_mod.httpx = fake_httpx
            try:
                async with httpx.AsyncClient(
                    transport=transport, base_url="http://test"
                ) as client:
                    resp = await client.post(
                        f"/api/v1/devices/pair-codes/{row.code}/redeem",
                        json={
                            "device_id": str(_FIXTURE_DEVICE_ID),
                            "hostname": "spaceship",
                        },
                    )
            finally:
                proxy_mod.httpx = original_httpx

        assert resp.status_code == 200, resp.text
        # The service headers are minted FOR the issuer, and forwarded verbatim.
        mock_bridge._headers.assert_awaited_once_with(str(test_user.id))
        assert captured["url"].endswith("/coord/devices/pair-cli")
        assert captured["headers"]["Authorization"] == service_headers["Authorization"]
        assert captured["headers"]["X-Qontinui-User-Id"] == str(test_user.id)
        # The requested tenant is the code's, which coord then proves the
        # issuer is a member of.
        assert captured["json"]["tenant_id"] == str(_FIXTURE_TENANT_ID)

    @pytest.mark.asyncio
    async def test_redeem_unknown_code_returns_404(
        self, async_http_client: httpx.AsyncClient
    ) -> None:
        """Unknown code: 404 with structured detail."""
        resp = await async_http_client.post(
            "/api/v1/devices/pair-codes/ZZZZZZ/redeem",
            json={
                "device_id": str(_FIXTURE_DEVICE_ID),
                "hostname": "spaceship",
            },
        )
        assert resp.status_code == 404, resp.text
        body = resp.json()
        assert body["detail"]["code"] == "pair_code_not_found"

    @pytest.mark.asyncio
    async def test_redeem_already_redeemed_returns_409(
        self,
        async_db_session: AsyncSession,
        test_user,
    ) -> None:
        """Used code: 409."""
        row = await pair_code_crud.mint_pair_code(
            async_db_session,
            tenant_id=_FIXTURE_TENANT_ID,
            issued_by_user_id=test_user.id,
        )
        await pair_code_crud.mark_redeemed(
            async_db_session, row=row, device_id=_FIXTURE_DEVICE_ID
        )

        app = _build_test_app(db_session=async_db_session, user_id=test_user.id)
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://test"
        ) as client:
            resp = await client.post(
                f"/api/v1/devices/pair-codes/{row.code}/redeem",
                json={
                    "device_id": str(uuid4()),
                    "hostname": "spaceship",
                },
            )
        assert resp.status_code == 409, resp.text
        assert resp.json()["detail"]["code"] == "pair_code_already_redeemed"

    @pytest.mark.asyncio
    async def test_redeem_expired_returns_410(
        self,
        async_db_session: AsyncSession,
        test_user,
    ) -> None:
        """Expired code: 410."""
        row = await pair_code_crud.mint_pair_code(
            async_db_session,
            tenant_id=_FIXTURE_TENANT_ID,
            issued_by_user_id=test_user.id,
        )
        row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await async_db_session.flush()

        app = _build_test_app(db_session=async_db_session, user_id=test_user.id)
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://test"
        ) as client:
            resp = await client.post(
                f"/api/v1/devices/pair-codes/{row.code}/redeem",
                json={
                    "device_id": str(uuid4()),
                    "hostname": "spaceship",
                },
            )
        assert resp.status_code == 410, resp.text
        assert resp.json()["detail"]["code"] == "pair_code_expired"

    @pytest.mark.asyncio
    async def test_redeem_does_not_require_operator_jwt(
        self,
        async_db_session: AsyncSession,
    ) -> None:
        """The redeem endpoint must NOT require an Authorization header.

        Build an app that does NOT override
        ``get_current_active_user_async`` — if redeem required auth,
        the request would 401. The fact that it gets to the 404 branch
        (unknown code) proves the endpoint is unauthenticated.
        """
        app = _build_test_app(
            db_session=async_db_session, user_id=None, include_auth=False
        )
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://test"
        ) as client:
            resp = await client.post(
                "/api/v1/devices/pair-codes/ZZZZZZ/redeem",
                json={
                    "device_id": str(uuid4()),
                    "hostname": "spaceship",
                },
            )
        assert resp.status_code == 404, (
            f"redeem must be unauthenticated; got {resp.status_code}: {resp.text}"
        )


class TestRedeemCoordFailureRelay:
    """What a failed coord pair-cli call tells the code's holder.

    A coord 5xx's text can carry SQL/pool context, so only its status and a
    fixed sentence reach the browser (the rule ``fleet_targets`` applies); a
    coord 4xx is coord's refusal of this device, and its body is relayed.
    """

    _COORD_5XX_TEXT = 'pg_error: relation "coord.devices" pool timed out at 10.0.0.5'

    async def _redeem_with_coord_answer(
        self, async_db_session: AsyncSession, test_user, status_code: int, text: str
    ) -> httpx.Response:
        row = await pair_code_crud.mint_pair_code(
            async_db_session,
            tenant_id=_FIXTURE_TENANT_ID,
            issued_by_user_id=test_user.id,
        )
        app = _build_test_app(db_session=async_db_session, user_id=test_user.id)
        transport = httpx.ASGITransport(app=app)
        with (
            patch("app.api.v1.endpoints.pair_codes.coord_service_account") as bridge,
            patch(
                "app.api.v1.endpoints.pair_codes.post_to_coord",
                AsyncMock(return_value=_mock_resp(status_code=status_code, text=text)),
            ),
        ):
            bridge.enabled = True
            bridge._headers = AsyncMock(return_value={"X-Test": "1"})
            async with httpx.AsyncClient(
                transport=transport, base_url="http://test"
            ) as client:
                return await client.post(
                    f"/api/v1/devices/pair-codes/{row.code}/redeem",
                    json={"device_id": str(_FIXTURE_DEVICE_ID), "hostname": "host-a"},
                )

    @pytest.mark.asyncio
    async def test_a_coord_5xx_relays_its_status_and_a_fixed_sentence_only(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        resp = await self._redeem_with_coord_answer(
            async_db_session, test_user, 500, self._COORD_5XX_TEXT
        )
        assert resp.status_code == 502, resp.text
        detail = resp.json()["detail"]
        assert detail["coord_status"] == 500
        assert "coord_body" not in detail
        assert detail["message"] == (
            "Coord failed to pair the device (HTTP 500). "
            "Retry; if it persists, check coord."
        )
        assert "pg_error" not in resp.text and "10.0.0.5" not in resp.text

    @pytest.mark.asyncio
    async def test_a_coord_4xx_relays_its_body(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        refusal = '{"error":"device_already_paired"}'
        resp = await self._redeem_with_coord_answer(
            async_db_session, test_user, 409, refusal
        )
        assert resp.status_code == 502, resp.text
        assert resp.json()["detail"] == {"coord_status": 409, "coord_body": refusal}


class TestRedeemMintsDeviceMachineKey:
    """A pair-code redeem hands the box a device machine key (``dmk_``), the
    same cold-start credential ``/pair-cli`` returns (plan
    ``2026-11-03-pair-code-pairing-mints-no-device-machine-key`` Phase 1),
    and only when the code's tenant is the device's home tenant
    (``coord.devices.tenant_id``).

    These run against the real test database: the device row, the mint, the
    code's consumption and the savepoint that separates them are what is
    under test. Every refusal asserts the logged ``outcome``, so a generic
    ``failed`` cannot pass for a guard.
    """

    # -- fixtures ------------------------------------------------------------

    async def _device(
        self,
        async_db_session: AsyncSession,
        *,
        tenant_id: UUID | None = _FIXTURE_TENANT_ID,
        credential_revoked_at: datetime | None = None,
    ) -> UUID:
        """A ``coord.devices`` row — what coord's pair-cli leaves behind."""
        from app.models.device import Device

        device_id = uuid4()
        async_db_session.add(
            Device(
                device_id=device_id,
                name="host-a",
                hostname="host-a",
                state="healthy",
                tenant_id=tenant_id,
                credential_revoked_at=credential_revoked_at,
            )
        )
        await async_db_session.commit()
        return device_id

    async def _redeem(
        self,
        async_db_session: AsyncSession,
        code: str,
        device_id: UUID,
        outcomes: list[str] | None = None,
    ) -> httpx.Response:
        """Redeem ``code`` for ``device_id`` with coord's pair-cli stubbed;
        append each logged auto-mint outcome to ``outcomes``."""
        from app.services import device_machine_key_automint as automint_mod

        coord_body = {
            "token": "device-jwt-abc",
            "device_id": str(device_id),
            "exp": 1234567890,
        }
        app = _build_test_app(db_session=async_db_session, user_id=None)
        transport = httpx.ASGITransport(app=app)
        recorder = MagicMock()
        with (
            patch("app.api.v1.endpoints.pair_codes.coord_service_account") as bridge,
            patch(
                "app.api.v1.endpoints.pair_codes.post_to_coord",
                AsyncMock(
                    return_value=_mock_resp(status_code=201, json_data=coord_body)
                ),
            ),
            patch.object(automint_mod, "logger", recorder),
        ):
            bridge.enabled = True
            bridge._headers = AsyncMock(return_value={"X-Test": "1"})
            async with httpx.AsyncClient(
                transport=transport, base_url="http://test"
            ) as client:
                resp = await client.post(
                    f"/api/v1/devices/pair-codes/{code}/redeem",
                    json={"device_id": str(device_id), "hostname": "host-a"},
                )
        self.automint_logs = [
            call.kwargs
            for call in recorder.info.call_args_list + recorder.warning.call_args_list
            if call.args and call.args[0] == "device_machine_key_automint"
        ]
        if outcomes is not None:
            outcomes.extend(kw["outcome"] for kw in self.automint_logs)
        return resp

    async def _mint_code(self, async_db_session: AsyncSession, test_user):
        return await pair_code_crud.mint_pair_code(
            async_db_session,
            tenant_id=_FIXTURE_TENANT_ID,
            issued_by_user_id=test_user.id,
        )

    async def _credentials_for(self, async_db_session: AsyncSession, device_id: UUID):
        from sqlalchemy import select

        from app.models.devenv import DeviceMachineCredential

        stmt = select(DeviceMachineCredential).where(
            DeviceMachineCredential.device_id == device_id
        )
        rows = list((await async_db_session.execute(stmt)).scalars().all())
        for row in rows:
            await async_db_session.refresh(row)
        return rows

    async def _existing_key(
        self,
        async_db_session: AsyncSession,
        device_id: UUID,
        test_user,
        *,
        tenant_id: UUID | None,
        expires_in: timedelta | None = None,
    ):
        from app.crud import device_machine_credential_crud as dmk_crud

        key, cred = await dmk_crud.mint(
            async_db_session,
            device_id=device_id,
            owner_user_id=test_user.id,
            tenant_id=tenant_id,
        )
        if expires_in is not None:
            cred.expires_at = datetime.now(UTC) + expires_in
        await async_db_session.commit()
        return key, cred

    @staticmethod
    def _snapshot(cred) -> tuple:
        return (
            cred.dmk_hash,
            cred.dmk_prefix,
            cred.owner_user_id,
            cred.tenant_id,
            cred.expires_at,
            cred.revoked_at,
        )

    async def _assert_consumed(
        self, async_db_session: AsyncSession, code: str, device_id: UUID
    ) -> None:
        consumed = await pair_code_crud.find_by_code(async_db_session, code)
        assert consumed is not None
        await async_db_session.refresh(consumed)
        assert consumed.redeemed_at is not None
        assert consumed.redeemed_by_device_id == device_id
        assert await pair_code_crud.get_redeemable(async_db_session, code) is None

    async def _assert_refused(
        self,
        async_db_session: AsyncSession,
        test_user,
        device_id: UUID,
        expected_outcome: str,
    ) -> None:
        """Redeem a fresh code for ``device_id``: 200, no key, the code
        consumed, and exactly ``expected_outcome`` logged."""
        row = await self._mint_code(async_db_session, test_user)
        outcomes: list[str] = []
        resp = await self._redeem(async_db_session, row.code, device_id, outcomes)
        assert resp.status_code == 200, resp.text
        assert resp.json()["device_machine_key"] is None
        assert outcomes == [expected_outcome]
        # ``committed`` is meaningful only for a minted outcome.
        assert self.automint_logs[0]["committed"] is None
        await self._assert_consumed(async_db_session, row.code, device_id)

    # -- minting -------------------------------------------------------------

    @pytest.mark.asyncio
    async def test_redeem_returns_a_dmk_the_exchange_door_accepts(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        from app.api.deps import get_async_db
        from app.api.v1.endpoints.devices import (
            get_authenticated_device_credential,
        )
        from app.api.v1.endpoints.devices import router as devices_router
        from app.crud import device_crud
        from app.services.coord_service_account import coord_service_account

        device_id = await self._device(async_db_session)
        row = await self._mint_code(async_db_session, test_user)
        outcomes: list[str] = []
        with patch.object(
            device_crud,
            "get_credential_anchor",
            wraps=device_crud.get_credential_anchor,
        ) as anchor_read:
            resp = await self._redeem(async_db_session, row.code, device_id, outcomes)

        assert resp.status_code == 200, resp.text
        assert outcomes == ["minted"]
        # An UNBOUND code shares no pair-code lock with the operator paths, so
        # the auto-mint serializes with them on the device row (FOR SHARE).
        assert anchor_read.call_args.kwargs == {"lock_for_share": True}
        # The redeem owns the commit, so the helper's line is pre-commit.
        assert self.automint_logs[0]["committed"] is False
        key = resp.json()["device_machine_key"]
        assert isinstance(key, str) and key.startswith("dmk_")

        # Minted under the code's issuer and the device's (= code's) tenant.
        (cred,) = await self._credentials_for(async_db_session, device_id)
        assert cred.owner_user_id == test_user.id
        assert cred.tenant_id == _FIXTURE_TENANT_ID

        # The header auth dependency accepts it ...
        authed = await get_authenticated_device_credential(
            x_device_machine_key=key, db=async_db_session
        )
        assert authed.device_id == device_id

        # ... and so does the exchange door, end to end.
        app = FastAPI()

        async def _db_override():
            yield async_db_session

        app.dependency_overrides[get_async_db] = _db_override
        app.include_router(devices_router, prefix="/api/v1/devices")
        with (
            patch.object(coord_service_account, "_admin_secret", "test-secret"),
            patch.object(
                coord_service_account,
                "mint_device_token",
                AsyncMock(return_value=(200, {"token": "exchanged-device-jwt"})),
            ) as mock_mint_token,
        ):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://test"
            ) as client:
                exch = await client.post(
                    f"/api/v1/devices/{device_id}/machine-credential/exchange",
                    headers={"X-Device-Machine-Key": key},
                )
        assert exch.status_code == 200, exch.text
        assert exch.json()["token"] == "exchanged-device-jwt"
        assert mock_mint_token.call_args.args[:2] == (
            str(test_user.id),
            str(device_id),
        )

    @pytest.mark.asyncio
    async def test_second_redeem_is_409_and_mints_nothing(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        from app.crud import device_machine_credential_crud as dmk_crud

        device_id = await self._device(async_db_session)
        row = await self._mint_code(async_db_session, test_user)
        first = await self._redeem(async_db_session, row.code, device_id)
        assert first.status_code == 200, first.text
        (cred,) = await self._credentials_for(async_db_session, device_id)
        hash_after_first = cred.dmk_hash

        outcomes: list[str] = []
        with patch.object(dmk_crud, "mint", AsyncMock()) as mock_mint:
            second = await self._redeem(async_db_session, row.code, device_id, outcomes)

        assert second.status_code == 409, second.text
        assert second.json()["detail"]["code"] == "pair_code_already_redeemed"
        mock_mint.assert_not_called()
        assert outcomes == []
        (cred,) = await self._credentials_for(async_db_session, device_id)
        assert cred.dmk_hash == hash_after_first

    @pytest.mark.asyncio
    async def test_a_failing_mint_never_fails_the_redeem_and_the_code_is_consumed(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """The mint fails with a real database error. Without the savepoint
        that aborts the redeem's transaction and its commit fails; with it,
        only the key's work is rolled back and the code is still consumed."""
        from sqlalchemy import text

        from app.crud import device_machine_credential_crud as dmk_crud

        async def _broken_mint(db, **_kwargs):
            await db.execute(text("SELECT 1 / 0"))
            raise AssertionError("unreachable")

        device_id = await self._device(async_db_session)
        row = await self._mint_code(async_db_session, test_user)
        outcomes: list[str] = []
        with patch.object(dmk_crud, "mint", _broken_mint):
            resp = await self._redeem(async_db_session, row.code, device_id, outcomes)

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["device_machine_key"] is None
        assert body["device_token_jwt"] == "device-jwt-abc"
        assert outcomes == ["failed"]
        await self._assert_consumed(async_db_session, row.code, device_id)
        assert await self._credentials_for(async_db_session, device_id) == []

    @pytest.mark.asyncio
    async def test_a_device_with_a_usable_key_keeps_it(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        from app.crud import device_machine_credential_crud as dmk_crud

        device_id = await self._device(async_db_session)
        key, existing = await self._existing_key(
            async_db_session, device_id, test_user, tenant_id=_FIXTURE_TENANT_ID
        )
        before = self._snapshot(existing)

        await self._assert_refused(
            async_db_session, test_user, device_id, "kept_usable_key"
        )
        (cred,) = await self._credentials_for(async_db_session, device_id)
        assert self._snapshot(cred) == before
        assert cred.dmk_hash == dmk_crud.hash_device_machine_key(key)

    @pytest.mark.asyncio
    async def test_same_tenant_expired_key_is_renewed(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        from app.crud import device_machine_credential_crud as dmk_crud

        device_id = await self._device(async_db_session)
        _key, existing = await self._existing_key(
            async_db_session,
            device_id,
            test_user,
            tenant_id=_FIXTURE_TENANT_ID,
            expires_in=timedelta(days=-1),
        )
        old_hash = existing.dmk_hash

        row = await self._mint_code(async_db_session, test_user)
        outcomes: list[str] = []
        resp = await self._redeem(async_db_session, row.code, device_id, outcomes)

        assert resp.status_code == 200, resp.text
        assert outcomes == ["minted"]
        new_key = resp.json()["device_machine_key"]
        assert isinstance(new_key, str) and new_key.startswith("dmk_")
        (cred,) = await self._credentials_for(async_db_session, device_id)
        assert cred.dmk_hash != old_hash
        assert cred.dmk_hash == dmk_crud.hash_device_machine_key(new_key)

    # -- the tenant anchor: coord.devices.tenant_id, not the key row ---------

    @pytest.mark.asyncio
    async def test_a_foreign_device_gets_no_key_and_no_row_is_created(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """The squat: a code from this tenant names ANOTHER tenant's device
        that has no key yet. Nothing is inserted, so the rightful tenant's
        own pairing is not locked out later."""
        device_id = await self._device(async_db_session, tenant_id=uuid4())

        await self._assert_refused(
            async_db_session, test_user, device_id, "foreign_tenant_key"
        )
        assert await self._credentials_for(async_db_session, device_id) == []

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "expires_in",
        [timedelta(days=-1), timedelta(days=2)],
        ids=["expired", "near_expiry"],
    )
    async def test_another_tenants_key_is_never_re_owned(
        self, async_db_session: AsyncSession, test_user, expires_in: timedelta
    ) -> None:
        """A key the renewal window would otherwise rotate (expired, or near
        expiry) on another tenant's device is left exactly as it is."""
        other_tenant = uuid4()
        device_id = await self._device(async_db_session, tenant_id=other_tenant)
        _key, existing = await self._existing_key(
            async_db_session,
            device_id,
            test_user,
            tenant_id=other_tenant,
            expires_in=expires_in,
        )
        before = self._snapshot(existing)

        await self._assert_refused(
            async_db_session, test_user, device_id, "foreign_tenant_key"
        )
        (cred,) = await self._credentials_for(async_db_session, device_id)
        assert self._snapshot(cred) == before

    @pytest.mark.asyncio
    async def test_a_squatted_foreign_row_is_repaired_by_the_rightful_tenant(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """A key row recorded under a foreign tenant (a squat written before
        the anchor existed) does not lock the device's own tenant out: its
        pairing rotates the row and re-stamps the device's tenant."""
        device_id = await self._device(async_db_session)
        _key, existing = await self._existing_key(
            async_db_session,
            device_id,
            test_user,
            tenant_id=uuid4(),
            expires_in=timedelta(days=-1),
        )
        squat_hash = existing.dmk_hash

        row = await self._mint_code(async_db_session, test_user)
        outcomes: list[str] = []
        resp = await self._redeem(async_db_session, row.code, device_id, outcomes)

        assert resp.status_code == 200, resp.text
        assert outcomes == ["minted"]
        assert resp.json()["device_machine_key"].startswith("dmk_")
        (cred,) = await self._credentials_for(async_db_session, device_id)
        assert cred.dmk_hash != squat_hash
        assert cred.tenant_id == _FIXTURE_TENANT_ID

    @pytest.mark.asyncio
    async def test_a_null_tenant_row_is_renewed_by_the_rightful_tenant(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """Legacy rows (pair-cli used to mint with no tenant) are renewable."""
        device_id = await self._device(async_db_session)
        _key, existing = await self._existing_key(
            async_db_session,
            device_id,
            test_user,
            tenant_id=None,
            expires_in=timedelta(days=-1),
        )
        legacy_hash = existing.dmk_hash

        row = await self._mint_code(async_db_session, test_user)
        outcomes: list[str] = []
        resp = await self._redeem(async_db_session, row.code, device_id, outcomes)

        assert resp.status_code == 200, resp.text
        assert outcomes == ["minted"]
        (cred,) = await self._credentials_for(async_db_session, device_id)
        assert cred.dmk_hash != legacy_hash
        assert cred.tenant_id == _FIXTURE_TENANT_ID

    @pytest.mark.asyncio
    async def test_a_device_with_no_tenant_is_refused(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        device_id = await self._device(async_db_session, tenant_id=None)

        await self._assert_refused(
            async_db_session, test_user, device_id, "device_tenant_unknown"
        )
        assert await self._credentials_for(async_db_session, device_id) == []

    @pytest.mark.asyncio
    async def test_a_device_with_no_row_is_refused(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        device_id = uuid4()

        await self._assert_refused(
            async_db_session, test_user, device_id, "device_tenant_unknown"
        )
        assert await self._credentials_for(async_db_session, device_id) == []

    # -- revocation ----------------------------------------------------------

    @pytest.mark.asyncio
    async def test_a_revoked_machine_key_is_never_re_armed(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        from app.crud import device_machine_credential_crud as dmk_crud

        device_id = await self._device(async_db_session)
        await self._existing_key(
            async_db_session, device_id, test_user, tenant_id=_FIXTURE_TENANT_ID
        )
        revoked = await dmk_crud.revoke(async_db_session, device_id)
        assert revoked is not None
        await async_db_session.commit()
        before = self._snapshot(revoked)

        await self._assert_refused(
            async_db_session, test_user, device_id, "machine_key_revoked"
        )
        (cred,) = await self._credentials_for(async_db_session, device_id)
        assert self._snapshot(cred) == before
        assert cred.revoked_at is not None and cred.dmk_hash == ""

    @pytest.mark.asyncio
    async def test_a_device_whose_credentials_are_revoked_gets_no_key(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        """The redeem refuses such a device up front (next test), so the
        helper's own arm is reached only when an operator's revoke lands after
        that check — simulated by passing the up-front check while
        ``coord.devices.credential_revoked_at`` is set."""
        device_id = await self._device(
            async_db_session, credential_revoked_at=datetime.now(UTC)
        )
        with patch(
            "app.api.v1.endpoints.pair_codes.refuse_if_credential_revoked",
            AsyncMock(return_value=None),
        ):
            await self._assert_refused(
                async_db_session, test_user, device_id, "device_credential_revoked"
            )
        assert await self._credentials_for(async_db_session, device_id) == []

    @pytest.mark.asyncio
    async def test_a_revoked_device_is_refused_before_anything_is_consumed(
        self, async_db_session: AsyncSession, test_user
    ) -> None:
        device_id = await self._device(
            async_db_session, credential_revoked_at=datetime.now(UTC)
        )

        row = await self._mint_code(async_db_session, test_user)
        outcomes: list[str] = []
        resp = await self._redeem(async_db_session, row.code, device_id, outcomes)

        assert resp.status_code == 403, resp.text
        assert outcomes == []
        assert await self._credentials_for(async_db_session, device_id) == []
        assert await pair_code_crud.get_redeemable(async_db_session, row.code)
