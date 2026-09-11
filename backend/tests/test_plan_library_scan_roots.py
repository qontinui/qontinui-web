"""``/api/v1/plan-library/scan-roots`` — per-device plan-scan-source readings.

Revised Phase 2 (web half) of
``2026-09-11-the-plan-corpus-scan-root-does-not-report-its-own-drift``.

What is asserted here
---------------------
1. **One row per device, overwritten.** A device's first report creates its
   row (201), every later one replaces it (200) — never a second row, and a
   later reading's nulls clear the earlier reading's values.
2. **The device is the TOKEN's.** ``device_id`` is the verified token's claim;
   a body ``device_id`` (or ``organization_id``) is a 422 and writes nothing.
3. **Only a device may write.** An operator session is a 403 naming why —
   including one that also forwards a device bearer — and anonymous is a 401.
4. **Staleness reads UNKNOWN.** A just-written reading is fresh; one older than
   2700 s reads ``effective_state: "unknown"`` with an ``observation_stale:``
   detail, judged from the OLDER of the two timestamps. An organization with
   no readings answers top-level ``state: "unknown"``, never an empty "all
   current".
5. **Route order.** Through the real ``api_router``, ``GET
   /api/v1/plan-library/scan-roots`` reaches this handler and is not swallowed
   by ``plan_library``'s ``GET /{artifact_id}``.
6. **Validation.** Bad ``state``, negative or oversized counts, a ``measured``
   reading without counts, counts on an unmeasured state, an unexplained
   ``unknown`` and a naive ``observed_at`` are all 422s.

Layering matches ``tests/test_plan_library_device_auth.py``: ``httpx`` +
``ASGITransport`` so handlers share the test's asyncio loop and session, the
Cognito arm pinned by overriding ``current_active_user_optional``, and coord's
JWKS stubbed at ``deps._verify_device_jwt``.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI, HTTPException, status
from pydantic import ValidationError
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.plan_library_scan_roots import FRESH_WITHIN_SECS
from app.models.plan_scan_root import PlanScanRootObservation
from app.schemas.plan_library_scan_roots import ScanRootReport

API_PREFIX = "/api/v1/plan-library"
SCAN_ROOTS = f"{API_PREFIX}/scan-roots"

pytestmark = pytest.mark.asyncio

DEVICE_A = UUID("0a0a0a0a-0000-4000-8000-00000000000a")
DEVICE_B = UUID("0b0b0b0b-0000-4000-8000-00000000000b")

TOKEN_A = "device-a-jwt"
TOKEN_B = "device-b-jwt"
TOKEN_NO_DEVICE_ID = "device-jwt-without-device-id-claim"


def _reading(**overrides: Any) -> dict[str, Any]:
    """A ``measured`` reading as the runner's ``report_scan_root`` sends it."""
    body: dict[str, Any] = {
        "state": "measured",
        "plans_dir": "/home/op/qontinui-dev-notes/plans",
        "repo_root": "/home/op/qontinui-dev-notes",
        "source_repo": "qontinui-dev-notes/plans",
        "default_ref": "origin/main",
        "ref_sha": "a" * 40,
        "head_sha": "b" * 40,
        "behind": 254,
        "ahead": 0,
        "ref_age_secs": 220,
        "counts_are_floors": False,
        "detail": None,
        "observed_at": datetime.now(UTC).isoformat(),
    }
    body.update(overrides)
    return body


async def _make_user(db: AsyncSession, stem: str):
    from app.models.user import User

    user = User(
        email=f"{stem}_{uuid4().hex[:8]}@example.com",
        username=f"{stem}_{uuid4().hex[:8]}",
        full_name="Scan Root Test User",
        is_active=True,
        is_verified=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _make_personal_org(db: AsyncSession, user):
    """A REAL personal org, so scope assertions never compare ``None`` to ``None``."""
    from app.models.organization import Organization

    org = Organization(
        name=f"Personal {uuid4().hex[:6]}",
        slug=f"personal-{uuid4().hex[:10]}",
        owner_id=user.id,
        settings={"is_personal": True},
    )
    db.add(org)
    await db.commit()
    await db.refresh(org)
    return org


def _build_app(*, db_session: AsyncSession, cognito_user=None) -> FastAPI:
    """Mount ONLY the scan-roots router, Cognito arm pinned, DB overridden."""
    from app.api.deps import current_active_user_optional, get_async_db
    from app.api.v1.endpoints.plan_library_scan_roots import router

    app = FastAPI()
    app.dependency_overrides[current_active_user_optional] = lambda: cognito_user

    async def _db_override():
        yield db_session

    app.dependency_overrides[get_async_db] = _db_override
    app.include_router(router, prefix=API_PREFIX)
    return app


@pytest_asyncio.fixture()
async def owner(async_db_session: AsyncSession):
    """The operator the device tokens resolve to, with a personal org."""
    user = await _make_user(async_db_session, "scanroot_owner")
    org = await _make_personal_org(async_db_session, user)
    return user, org


@pytest.fixture()
def stub_device_jwt(monkeypatch, owner):
    """Two device tokens and one without a ``device_id`` claim, all owned by
    ``owner``. Any other token gets the verifier's own 401."""
    from app.api import deps

    user, _org = owner
    claims_by_token = {
        TOKEN_A: {"device_id": str(DEVICE_A), "user_id": str(user.id)},
        TOKEN_B: {"device_id": str(DEVICE_B), "user_id": str(user.id)},
        TOKEN_NO_DEVICE_ID: {"user_id": str(user.id)},
    }
    seen: list[str] = []

    async def _fake_verify(token: str):
        seen.append(token)
        if token not in claims_by_token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired device token.",
            )
        return claims_by_token[token], user

    monkeypatch.setattr(deps, "_verify_device_jwt", _fake_verify)
    return seen


@pytest_asyncio.fixture()
async def app_no_cognito(async_db_session: AsyncSession, stub_device_jwt):
    return _build_app(db_session=async_db_session, cognito_user=None)


def _client(app: FastAPI, token: str | None = None) -> httpx.AsyncClient:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers=headers,
    )


def _received_at(resp: httpx.Response) -> datetime:
    return datetime.fromisoformat(resp.json()["row"]["received_at"])


async def _rows_for(db: AsyncSession, device_id: UUID) -> list[PlanScanRootObservation]:
    # ``populate_existing`` rather than ``expire_all()``: the latter would also
    # expire the fixtures' user/org rows, whose next attribute read is then a
    # sync lazy load inside async code.
    result = await db.execute(
        select(PlanScanRootObservation)
        .where(PlanScanRootObservation.device_id == device_id)
        .execution_options(populate_existing=True)
    )
    return list(result.scalars().all())


# ===========================================================================
# 1-2. The upsert is keyed per device, and the device is the token's
# ===========================================================================


class TestUpsertKeyedPerDevice:
    async def test_first_report_creates_and_later_reports_overwrite_one_row(
        self,
        app_no_cognito: FastAPI,
        async_db_session: AsyncSession,
        owner,
        stub_device_jwt: list[str],
    ) -> None:
        _user, org = owner
        async with _client(app_no_cognito, TOKEN_A) as client:
            first = await client.post(SCAN_ROOTS, json=_reading(behind=254))
            second = await client.post(SCAN_ROOTS, json=_reading(behind=3, ahead=1))

        assert first.status_code == 201, first.text
        assert first.json()["created"] is True
        assert second.status_code == 200, second.text
        assert second.json()["created"] is False
        # The bearer really went through device verification.
        assert stub_device_jwt == [TOKEN_A, TOKEN_A]

        rows = await _rows_for(async_db_session, DEVICE_A)
        assert len(rows) == 1, "a second report must overwrite, not append"
        row = rows[0]
        assert row.device_id == DEVICE_A
        assert row.organization_id == org.id
        assert (row.behind, row.ahead) == (3, 1)
        assert second.json()["row"]["device_id"] == str(DEVICE_A)
        # ``received_at`` moves with every report; ``created_at`` does not.
        assert row.received_at >= _received_at(first)
        assert row.created_at == _received_at(first)

    async def test_a_later_reading_clears_what_it_no_longer_reports(
        self, app_no_cognito: FastAPI, async_db_session: AsyncSession
    ) -> None:
        """A reading is a whole snapshot: a device that went from ``measured``
        to ``not_scanning`` must not keep showing its old counts."""
        async with _client(app_no_cognito, TOKEN_A) as client:
            await client.post(SCAN_ROOTS, json=_reading(behind=254))
            resp = await client.post(
                SCAN_ROOTS,
                json={
                    "state": "not_scanning",
                    "counts_are_floors": False,
                    "observed_at": datetime.now(UTC).isoformat(),
                },
            )
        assert resp.status_code == 200, resp.text
        [row] = await _rows_for(async_db_session, DEVICE_A)
        assert row.state == "not_scanning"
        assert row.behind is None and row.ahead is None
        assert row.plans_dir is None and row.ref_sha is None

    async def test_two_devices_get_two_rows(
        self, app_no_cognito: FastAPI, async_db_session: AsyncSession
    ) -> None:
        async with _client(app_no_cognito, TOKEN_A) as a:
            assert (
                await a.post(SCAN_ROOTS, json=_reading(behind=10))
            ).status_code == 201
        async with _client(app_no_cognito, TOKEN_B) as b:
            assert (
                await b.post(SCAN_ROOTS, json=_reading(behind=20))
            ).status_code == 201
            listed = await b.get(SCAN_ROOTS)

        assert listed.status_code == 200, listed.text
        by_device = {r["device_id"]: r["behind"] for r in listed.json()["rows"]}
        assert by_device == {str(DEVICE_A): 10, str(DEVICE_B): 20}
        assert listed.json()["count"] == 2

    async def test_a_body_device_id_is_refused_and_writes_nothing(
        self, app_no_cognito: FastAPI, async_db_session: AsyncSession
    ) -> None:
        """The body has nowhere to put a device: ``extra="forbid"`` turns the
        attempt into a 422 naming the key, rather than a silently ignored or —
        worse — honoured override."""
        forged = uuid4()
        async with _client(app_no_cognito, TOKEN_A) as client:
            resp = await client.post(SCAN_ROOTS, json=_reading(device_id=str(forged)))
        assert resp.status_code == 422, resp.text
        assert any(err["loc"][-1] == "device_id" for err in resp.json()["detail"])
        assert await _rows_for(async_db_session, forged) == []
        assert await _rows_for(async_db_session, DEVICE_A) == []

    async def test_a_body_organization_id_is_refused(
        self, app_no_cognito: FastAPI
    ) -> None:
        async with _client(app_no_cognito, TOKEN_A) as client:
            resp = await client.post(
                SCAN_ROOTS, json=_reading(organization_id=str(uuid4()))
            )
        assert resp.status_code == 422, resp.text
        assert any(err["loc"][-1] == "organization_id" for err in resp.json()["detail"])

    async def test_a_token_without_a_device_id_claim_is_401(
        self, app_no_cognito: FastAPI
    ) -> None:
        async with _client(app_no_cognito, TOKEN_NO_DEVICE_ID) as client:
            resp = await client.post(SCAN_ROOTS, json=_reading())
        assert resp.status_code == 401, resp.text
        assert "device_id" in resp.json()["detail"]


# ===========================================================================
# 3. Only a device may write
# ===========================================================================


class TestOnlyADeviceMayWrite:
    async def test_an_operator_session_is_403_with_the_reason(
        self, async_db_session: AsyncSession, owner, stub_device_jwt: list[str]
    ) -> None:
        from app.api.deps import DEVICE_ONLY_REFUSAL

        user, _org = owner
        app = _build_app(db_session=async_db_session, cognito_user=user)
        async with _client(app) as client:
            resp = await client.post(SCAN_ROOTS, json=_reading())
        assert resp.status_code == 403, resp.text
        assert resp.json()["detail"] == DEVICE_ONLY_REFUSAL
        assert "device_id claim" in DEVICE_ONLY_REFUSAL
        result = await async_db_session.execute(
            select(func.count()).select_from(PlanScanRootObservation)
        )
        assert result.scalar_one() == 0
        # The operator arm answered; the device verifier was never consulted.
        assert stub_device_jwt == []

    async def test_an_operator_forwarding_a_device_bearer_is_still_403(
        self, async_db_session: AsyncSession, owner, stub_device_jwt: list[str]
    ) -> None:
        """The operator arm wins, exactly as in the dual-auth tree: a browser
        user cannot report as a device by carrying its token."""
        user, _org = owner
        app = _build_app(db_session=async_db_session, cognito_user=user)
        async with _client(app, TOKEN_A) as client:
            resp = await client.post(SCAN_ROOTS, json=_reading())
        assert resp.status_code == 403, resp.text
        assert await _rows_for(async_db_session, DEVICE_A) == []

    async def test_anonymous_is_401(self, app_no_cognito: FastAPI) -> None:
        async with _client(app_no_cognito) as client:
            resp = await client.post(SCAN_ROOTS, json=_reading())
        assert resp.status_code == 401, resp.text

    async def test_an_invalid_bearer_is_401_not_a_silent_pass(
        self, app_no_cognito: FastAPI
    ) -> None:
        async with _client(app_no_cognito, "not-a-device-token") as client:
            resp = await client.post(SCAN_ROOTS, json=_reading())
        assert resp.status_code == 401, resp.text

    async def test_an_operator_can_still_READ(
        self, async_db_session: AsyncSession, owner, app_no_cognito: FastAPI
    ) -> None:
        """Refusing the operator is a WRITE rule. The device's paired operator
        reads the same organization the device wrote into."""
        user, _org = owner
        async with _client(app_no_cognito, TOKEN_A) as device:
            assert (await device.post(SCAN_ROOTS, json=_reading())).status_code == 201
        app = _build_app(db_session=async_db_session, cognito_user=user)
        async with _client(app) as operator:
            resp = await operator.get(SCAN_ROOTS)
        assert resp.status_code == 200, resp.text
        assert [r["device_id"] for r in resp.json()["rows"]] == [str(DEVICE_A)]


# ===========================================================================
# 4. The read: freshness, staleness, and silence
# ===========================================================================


async def _age_row(
    db: AsyncSession,
    device_id: UUID,
    *,
    observed_ago: timedelta,
    received_ago: timedelta,
) -> None:
    now = datetime.now(UTC)
    await db.execute(
        update(PlanScanRootObservation)
        .where(PlanScanRootObservation.device_id == device_id)
        .values(observed_at=now - observed_ago, received_at=now - received_ago)
    )
    await db.commit()


class TestReadFreshness:
    async def test_a_just_written_reading_is_fresh_and_reads_as_reported(
        self, app_no_cognito: FastAPI
    ) -> None:
        async with _client(app_no_cognito, TOKEN_A) as client:
            await client.post(
                SCAN_ROOTS, json=_reading(behind=254, counts_are_floors=True)
            )
            resp = await client.get(SCAN_ROOTS)

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["state"] == "reported"
        assert body["detail"] is None
        assert body["fresh_within_secs"] == 2700 == FRESH_WITHIN_SECS
        assert (body["count"], body["fresh_count"]) == (1, 1)
        [row] = body["rows"]
        assert row["observation_fresh"] is True
        assert 0 <= row["observation_age_secs"] < 60
        assert row["state"] == row["effective_state"] == "measured"
        assert row["effective_detail"] is None
        # Every reported field round-trips.
        assert row["behind"] == 254
        assert row["counts_are_floors"] is True
        assert row["source_repo"] == "qontinui-dev-notes/plans"
        assert row["ref_age_secs"] == 220

    async def test_a_reading_older_than_the_window_reads_unknown(
        self, app_no_cognito: FastAPI, async_db_session: AsyncSession
    ) -> None:
        """The stale rule. Mutation-proved at authoring: replacing
        ``fresh = age <= FRESH_WITHIN_SECS`` in ``render_row`` with
        ``fresh = True`` fails this test and the two older-stamp tests below;
        taking ``max`` instead of ``min`` of the two stamps fails those two."""
        async with _client(app_no_cognito, TOKEN_A) as client:
            await client.post(SCAN_ROOTS, json=_reading(behind=0, ahead=0))
            stale = timedelta(seconds=FRESH_WITHIN_SECS + 60)
            await _age_row(
                async_db_session, DEVICE_A, observed_ago=stale, received_ago=stale
            )
            resp = await client.get(SCAN_ROOTS)

        body = resp.json()
        assert body["state"] == "reported"
        assert (body["count"], body["fresh_count"]) == (1, 0)
        [row] = body["rows"]
        assert row["observation_fresh"] is False
        assert row["observation_age_secs"] >= FRESH_WITHIN_SECS + 60
        # The reading is preserved verbatim; only the VERDICT degrades. A
        # stale "0 behind" must not read as "in step".
        assert row["state"] == "measured"
        assert row["behind"] == 0
        assert row["effective_state"] == "unknown"
        assert row["effective_detail"].startswith("observation_stale:")
        assert "measured" in row["effective_detail"]

    async def test_a_reading_inside_the_window_is_still_fresh(
        self, app_no_cognito: FastAPI, async_db_session: AsyncSession
    ) -> None:
        """The window is not narrower than 2700 s: two missed heartbeats is
        jitter, not silence."""
        async with _client(app_no_cognito, TOKEN_A) as client:
            await client.post(SCAN_ROOTS, json=_reading())
            inside = timedelta(seconds=FRESH_WITHIN_SECS - 120)
            await _age_row(
                async_db_session, DEVICE_A, observed_ago=inside, received_ago=inside
            )
            resp = await client.get(SCAN_ROOTS)
        [row] = resp.json()["rows"]
        assert row["observation_fresh"] is True
        assert row["effective_state"] == "measured"

    async def test_an_old_observation_is_stale_even_if_recently_received(
        self, app_no_cognito: FastAPI, async_db_session: AsyncSession
    ) -> None:
        """Age is taken from the OLDER stamp: an old reading re-posted just now
        says nothing more about now than it did when it was taken."""
        async with _client(app_no_cognito, TOKEN_A) as client:
            await client.post(SCAN_ROOTS, json=_reading())
            await _age_row(
                async_db_session,
                DEVICE_A,
                observed_ago=timedelta(hours=3),
                received_ago=timedelta(seconds=5),
            )
            resp = await client.get(SCAN_ROOTS)
        [row] = resp.json()["rows"]
        assert row["observation_fresh"] is False
        assert row["effective_state"] == "unknown"

    async def test_a_runner_clock_ahead_cannot_make_a_quiet_device_fresh(
        self, app_no_cognito: FastAPI, async_db_session: AsyncSession
    ) -> None:
        """A future ``observed_at`` (runner clock ahead) must not rescue a row
        this server has not heard from in hours."""
        async with _client(app_no_cognito, TOKEN_A) as client:
            await client.post(SCAN_ROOTS, json=_reading())
            await _age_row(
                async_db_session,
                DEVICE_A,
                observed_ago=timedelta(hours=-1),
                received_ago=timedelta(hours=2),
            )
            resp = await client.get(SCAN_ROOTS)
        [row] = resp.json()["rows"]
        assert row["observation_fresh"] is False
        assert row["effective_state"] == "unknown"

    async def test_an_unreported_org_reads_unknown_not_all_current(
        self, app_no_cognito: FastAPI
    ) -> None:
        async with _client(app_no_cognito, TOKEN_A) as client:
            resp = await client.get(SCAN_ROOTS)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["state"] == "unknown"
        assert body["detail"].startswith("no_observation:")
        assert body["rows"] == []
        assert (body["count"], body["fresh_count"]) == (0, 0)

    async def test_another_organization_sees_none_of_these_readings(
        self, app_no_cognito: FastAPI, async_db_session: AsyncSession
    ) -> None:
        async with _client(app_no_cognito, TOKEN_A) as device:
            assert (await device.post(SCAN_ROOTS, json=_reading())).status_code == 201
        stranger = await _make_user(async_db_session, "scanroot_stranger")
        await _make_personal_org(async_db_session, stranger)
        app = _build_app(db_session=async_db_session, cognito_user=stranger)
        async with _client(app) as client:
            resp = await client.get(SCAN_ROOTS)
        assert resp.json()["state"] == "unknown"
        assert resp.json()["rows"] == []

    async def test_an_unknown_query_key_is_refused(
        self, app_no_cognito: FastAPI
    ) -> None:
        """``StrictQueryRoute``: a filter this route does not implement is a
        422, not a silently unfiltered page."""
        async with _client(app_no_cognito, TOKEN_A) as client:
            resp = await client.get(SCAN_ROOTS, params={"device_id": str(DEVICE_A)})
        assert resp.status_code == 422, resp.text


# ===========================================================================
# 5. Route order through the REAL api_router
# ===========================================================================


class TestRouteOrder:
    def test_scan_roots_is_registered_before_the_artifact_id_route(self) -> None:
        from app.api.v1.api import api_router

        paths = [getattr(r, "path", None) for r in api_router.routes]
        scan_roots_idx = paths.index("/plan-library/scan-roots")
        artifact_idx = paths.index("/plan-library/{artifact_id}")
        assert scan_roots_idx < artifact_idx, (
            "plan_library's GET /{artifact_id} would swallow /scan-roots "
            "(FastAPI does not fall through on a failed path-param conversion)"
        )

    async def test_get_scan_roots_reaches_its_handler_through_api_router(
        self, async_db_session: AsyncSession, stub_device_jwt: list[str]
    ) -> None:
        from app.api.deps import current_active_user_optional, get_async_db
        from app.api.v1.api import api_router

        app = FastAPI()
        app.dependency_overrides[current_active_user_optional] = lambda: None

        async def _db_override():
            yield async_db_session

        app.dependency_overrides[get_async_db] = _db_override
        app.include_router(api_router, prefix="/api/v1")

        async with _client(app, TOKEN_A) as client:
            posted = await client.post(SCAN_ROOTS, json=_reading())
            resp = await client.get(SCAN_ROOTS)

        assert posted.status_code == 201, posted.text
        # A 422 here is the /{artifact_id} route rejecting "scan-roots" as a UUID.
        assert resp.status_code == 200, resp.text
        assert resp.json()["fresh_within_secs"] == FRESH_WITHIN_SECS
        assert [r["device_id"] for r in resp.json()["rows"]] == [str(DEVICE_A)]


# ===========================================================================
# 6. Validation
# ===========================================================================


class TestValidation:
    @pytest.mark.parametrize(
        ("overrides", "why"),
        [
            ({"state": "exact"}, "state outside the four-value vocabulary"),
            ({"behind": -1}, "negative behind"),
            ({"ahead": -3}, "negative ahead"),
            ({"ref_age_secs": -1}, "negative ref age"),
            ({"behind": 2**63}, "behind past the BIGINT ceiling"),
            ({"behind": None}, "measured without behind"),
            ({"ahead": None}, "measured without ahead"),
            (
                {"state": "unknown", "detail": "no origin/HEAD", "behind": 5},
                "a count on an unmeasured state",
            ),
            (
                {"state": "unknown", "behind": None, "ahead": None},
                "unexplained unknown",
            ),
            (
                {
                    "state": "not_a_git_work_tree",
                    "behind": None,
                    "ahead": None,
                    "detail": "   ",
                },
                "blank detail on not_a_git_work_tree",
            ),
            ({"observed_at": "2026-09-11T12:00:00"}, "naive observed_at"),
            ({"counts_are_floors": None}, "counts_are_floors missing"),
        ],
    )
    def test_the_schema_rejects(self, overrides: dict[str, Any], why: str) -> None:
        with pytest.raises(ValidationError):
            ScanRootReport.model_validate(_reading(**overrides))

    def test_each_valid_state_is_accepted(self) -> None:
        ScanRootReport.model_validate(_reading())
        ScanRootReport.model_validate(
            _reading(state="unknown", behind=None, ahead=None, detail="no origin/HEAD")
        )
        ScanRootReport.model_validate(
            _reading(
                state="not_a_git_work_tree",
                behind=None,
                ahead=None,
                detail="plain directory",
            )
        )
        ScanRootReport.model_validate(
            {
                "state": "not_scanning",
                "counts_are_floors": False,
                "observed_at": "2026-09-11T12:00:00Z",
            }
        )

    async def test_bad_bodies_are_422_over_http_and_write_nothing(
        self, app_no_cognito: FastAPI, async_db_session: AsyncSession
    ) -> None:
        async with _client(app_no_cognito, TOKEN_A) as client:
            bad_state = await client.post(SCAN_ROOTS, json=_reading(state="stale"))
            negative = await client.post(SCAN_ROOTS, json=_reading(behind=-5))
        assert bad_state.status_code == 422, bad_state.text
        assert negative.status_code == 422, negative.text
        assert await _rows_for(async_db_session, DEVICE_A) == []
