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
        test_app.dependency_overrides[get_current_active_user_async] = (
            lambda: mock_user
        )

    async def _db_override():
        yield db_session

    test_app.dependency_overrides[get_async_db] = _db_override
    test_app.include_router(
        pair_codes_router, prefix="/api/v1/devices/pair-codes"
    )
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

        app = _build_test_app(
            db_session=async_db_session, user_id=test_user.id
        )
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

        from app.api.v1.endpoints import pair_codes as endpoint_mod

        # Swap the endpoint's bound ``httpx`` reference with a fake that
        # exposes only an ``AsyncClient`` attribute → our fake. The
        # outer test client still uses the real httpx.
        fake_httpx = MagicMock()
        fake_httpx.AsyncClient = _FakeClient
        fake_httpx.HTTPError = httpx.HTTPError

        with patch("app.api.v1.endpoints.pair_codes.strategy_client") as mock_strategy:
            mock_strategy.enabled = True
            mock_strategy._headers = AsyncMock(return_value={"X-Test": "1"})
            original_httpx = endpoint_mod.httpx
            endpoint_mod.httpx = fake_httpx
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
                endpoint_mod.httpx = original_httpx

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

        app = _build_test_app(
            db_session=async_db_session, user_id=test_user.id
        )
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

        app = _build_test_app(
            db_session=async_db_session, user_id=test_user.id
        )
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
            f"redeem must be unauthenticated; got {resp.status_code}: "
            f"{resp.text}"
        )
