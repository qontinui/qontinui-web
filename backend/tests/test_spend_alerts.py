"""Provider-reported spend, Phase 3: the evaluator, the push to the phone,
and the coord delivery — against real Postgres.

Plan ``2026-10-03-provider-reported-spend-collection-alerts-and-mobile``.
Pins each rule at its boundary, the median over OBSERVED days only (a gap is
never a $0 day), insufficient history, highest-threshold-only, dedup across
ticks, the first-run guard, scheduled-renewal exclusion, the one-digest-a-day
push, honest push status (failed → retried; accepted → delivered only from a
receipt), unknown recipients, muting, and the coord delivery states.

Expo and coord are the only things stubbed.
"""

from __future__ import annotations

import hashlib
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.asyncio

TENANT = UUID("cccccccc-0000-4000-8000-0000000000c3")
NOW = datetime(2026, 10, 3, 12, 0, tzinfo=UTC)
TODAY = NOW.date()
D = TODAY - timedelta(days=1)  # 2026-10-02, the newest complete day
M = 1_000_000


# ===========================================================================
# Seeding
# ===========================================================================


async def _vendor(
    db: AsyncSession, name: str = "GitHub", connector: str | None = "github_billing"
) -> Any:
    from app.models.overview import Vendor

    vendor = Vendor(
        tenant_id=TENANT, name=name, category="source_hosting", connector=connector
    )
    db.add(vendor)
    await db.flush()
    return vendor


async def _complete(db: AsyncSession, vendor: Any, *days: date) -> None:
    """An ok day run per day, finished after the day ended."""
    from app.models.overview import CostImportRun

    for day in days:
        finished = datetime.combine(day + timedelta(days=1), datetime.min.time(), UTC)
        db.add(
            CostImportRun(
                tenant_id=TENANT,
                vendor_id=vendor.id,
                connector=vendor.connector,
                transport="push",
                granularity="day",
                status="ok",
                started_at=finished + timedelta(hours=6),
                finished_at=finished + timedelta(hours=6),
                period_start=day,
                period_end=day,
            )
        )
    await db.flush()


async def _partial_today(db: AsyncSession, vendor: Any) -> None:
    from app.models.overview import CostImportRun

    db.add(
        CostImportRun(
            tenant_id=TENANT,
            vendor_id=vendor.id,
            connector=vendor.connector,
            transport="push",
            granularity="day",
            status="ok",
            started_at=NOW - timedelta(hours=1),
            finished_at=NOW - timedelta(hours=1),
            period_start=TODAY,
            period_end=TODAY,
        )
    )
    await db.flush()


async def _spend(
    db: AsyncSession,
    vendor: Any,
    day: date,
    micros: int,
    scope: str = "repo-a",
    product: str = "actions",
) -> None:
    from app.models.overview import CostEntry

    db.add(
        CostEntry(
            tenant_id=TENANT,
            vendor_id=vendor.id,
            source="connector",
            source_ref=f"t:{vendor.id}:{day}:{scope}:{product}:{uuid4().hex[:6]}",
            amount_micros=micros,
            currency="USD",
            period_start=day,
            period_end=day,
            scope_label=scope,
            product=product,
        )
    )
    await db.flush()


async def _rule(db: AsyncSession, vendor: Any | None, **values: Any) -> Any:
    from app.models.overview import SpendRule

    rule = SpendRule(
        tenant_id=TENANT, vendor_id=vendor.id if vendor else None, **values
    )
    db.add(rule)
    await db.flush()
    return rule


async def _evaluate(db: AsyncSession, now: datetime = NOW) -> Any:
    from app.spend.evaluate import evaluate_tenant

    return await evaluate_tenant(db, TENANT, now)


async def _alerts(db: AsyncSession, rule: str | None = None) -> list[Any]:
    from app.models.overview import SpendAlert

    stmt = select(SpendAlert).where(SpendAlert.tenant_id == TENANT)
    if rule:
        stmt = stmt.where(SpendAlert.rule == rule)
    rows = list((await db.execute(stmt.order_by(SpendAlert.period_key))).scalars())
    for row in rows:
        await db.refresh(row)
    return rows


# ===========================================================================
# Rules
# ===========================================================================


class TestDailyAbsolute:
    async def test_boundary(self, async_db_session) -> None:
        db = async_db_session
        vendor = await _vendor(db)
        await _complete(db, vendor, D)
        await _rule(db, vendor, daily_abs_micros=50 * M)
        await _spend(db, vendor, D, 50 * M)
        await _evaluate(db)
        assert await _alerts(db, "daily_abs") == []
        await _spend(db, vendor, D, 1, scope="repo-b")
        await _evaluate(db)
        [alert] = await _alerts(db, "daily_abs")
        assert (alert.period_key, alert.observed_micros) == (D.isoformat(), 50 * M + 1)

    async def test_today_so_far_and_product_filter(self, async_db_session) -> None:
        db = async_db_session
        vendor = await _vendor(db)
        await _complete(db, vendor, D)
        await _partial_today(db, vendor)
        await _rule(db, vendor, daily_abs_micros=50 * M, product_filter=["actions"])
        await _spend(db, vendor, TODAY, 60 * M)
        await _spend(db, vendor, D, 90 * M, product="packages")
        await _evaluate(db)
        [alert] = await _alerts(db, "daily_abs")
        assert alert.period_key == TODAY.isoformat()
        assert alert.detail["complete"] is False


class TestSpike:
    async def _history(self, db: AsyncSession, vendor: Any, days: list[date]) -> None:
        await _complete(db, vendor, *days)
        for day in days:
            await _spend(db, vendor, day, 10 * M)

    async def test_median_runs_over_observed_days_only(self, async_db_session) -> None:
        db = async_db_session
        vendor = await _vendor(db)
        # 7 observed days in a 14-day window; the other 7 were never fetched.
        # Zero-filling them would halve the median to $5 and fire at $20.
        observed = [D - timedelta(days=i) for i in (2, 4, 6, 8, 10, 12, 14)]
        await self._history(db, vendor, observed)
        await _complete(db, vendor, D)
        await _spend(db, vendor, D, 20 * M)
        await _evaluate(db)
        assert await _alerts(db, "spike") == []

    async def test_boundary_at_three_times_the_median(self, async_db_session) -> None:
        db = async_db_session
        vendor = await _vendor(db)
        await self._history(db, vendor, [D - timedelta(days=i) for i in range(2, 9)])
        await _complete(db, vendor, D)
        await _spend(db, vendor, D, 30 * M)
        await _evaluate(db)
        assert await _alerts(db, "spike") == []
        await _spend(db, vendor, D, 1)
        await _evaluate(db)
        [alert] = await _alerts(db, "spike")
        assert alert.scope_key == "repo-a"
        assert alert.threshold_micros == 30 * M
        assert alert.detail["median_micros"] == 10 * M
        assert alert.detail["observed_days"] == 7

    async def test_a_complete_day_with_no_line_is_a_stated_zero(
        self, async_db_session
    ) -> None:
        db = async_db_session
        vendor = await _vendor(db)
        days = [D - timedelta(days=i) for i in range(2, 10)]  # 8 complete days
        await _complete(db, vendor, *days, D)
        for day in days[:3]:
            await _spend(db, vendor, day, 10 * M)
        for day in days[3:]:  # repo-a idle; another repo keeps the day real
            await _spend(db, vendor, day, 1 * M, scope="repo-z")
        await _spend(db, vendor, D, 5 * M)
        report = await _evaluate(db)
        # repo-a's median over 8 observed days is $0 (5 of them stated $0).
        assert await _alerts(db, "spike") == []
        assert any(
            "repo-a" in s and "zero median" in s for s in report.insufficient_history
        )

    async def test_insufficient_history_is_recorded_not_passed(
        self, async_db_session
    ) -> None:
        db = async_db_session
        vendor = await _vendor(db)
        await self._history(db, vendor, [D - timedelta(days=i) for i in range(2, 8)])
        await _complete(db, vendor, D)
        await _spend(db, vendor, D, 500 * M)
        report = await _evaluate(db)
        assert await _alerts(db, "spike") == []
        assert any(
            s.startswith(f"GitHub:repo-a:{D.isoformat()}") and "6 observed" in s
            for s in report.insufficient_history
        )

    async def test_first_run_guard_ignores_backfilled_history(
        self, async_db_session
    ) -> None:
        db = async_db_session
        vendor = await _vendor(db)
        old = D - timedelta(days=10)
        await self._history(db, vendor, [old - timedelta(days=i) for i in range(1, 15)])
        await _complete(db, vendor, old, D)
        await _spend(db, vendor, old, 900 * M)
        await _evaluate(db)
        assert await _alerts(db, "spike") == []

    async def test_a_scheduled_renewal_is_not_a_spike(self, async_db_session) -> None:
        from app.models.overview import RecurringCost

        db = async_db_session
        vendor = await _vendor(db, "Cloudflare", "cloudflare_billing")
        await self._history(db, vendor, [D - timedelta(days=i) for i in range(2, 10)])
        db.add(
            RecurringCost(
                tenant_id=TENANT,
                vendor_id=vendor.id,
                description="Pro plan",
                unit_amount_micros=500 * M,
                quantity=Decimal("1"),
                currency="USD",
                cadence="annual",
                start_date=date(2024, 10, 1),
                renews_on=D + timedelta(days=1),  # within ±3 days of D
            )
        )
        await _complete(db, vendor, D)
        await _spend(db, vendor, D, 520 * M)  # within ±10% of $500
        await _evaluate(db)
        assert await _alerts(db, "spike") == []
        await _spend(db, vendor, D, 300 * M, scope="repo-a")  # $820: not the renewal
        await _evaluate(db)
        assert [a.scope_key for a in await _alerts(db, "spike")] == ["repo-a"]

    async def test_no_rule_still_runs_the_default_spike(self, async_db_session) -> None:
        db = async_db_session
        vendor = await _vendor(db)
        await self._history(db, vendor, [D - timedelta(days=i) for i in range(2, 16)])
        await _complete(db, vendor, D)
        await _spend(db, vendor, D, 31 * M)
        await _evaluate(db)
        [alert] = await _alerts(db, "spike")
        assert alert.detail["multiplier"] == "3"
        assert alert.detail["window_days"] == 14


class TestMonthToDate:
    async def _setup(self, db: AsyncSession) -> Any:
        vendor = await _vendor(db)
        await _complete(db, vendor, D)
        await _rule(
            db,
            vendor,
            monthly_ceiling_micros=750 * M,
            mtd_thresholds_pct=[50, 75, 90, 100],
            product_filter=["actions"],
        )
        return vendor

    async def test_only_the_highest_crossed_threshold_fires(
        self, async_db_session
    ) -> None:
        db = async_db_session
        vendor = await self._setup(db)
        await _spend(db, vendor, date(2026, 10, 1), 389_220_000)
        await _spend(db, vendor, D, 359_450_000)
        await _spend(db, vendor, D, 249_120_000, scope="repo-b")
        await _spend(db, vendor, D, 900 * M, product="packages")  # outside the filter
        await _evaluate(db)
        [alert] = await _alerts(db, "mtd_threshold")
        assert alert.threshold_key == 100
        assert alert.period_key == "2026-10"
        assert alert.observed_micros == 997_790_000
        assert alert.threshold_micros == 750 * M
        # The next tick fires nothing more this month.
        assert (await _evaluate(db)).fired == []

    async def test_a_lower_crossing_then_a_higher_one(self, async_db_session) -> None:
        db = async_db_session
        vendor = await self._setup(db)
        await _spend(db, vendor, D, 400 * M)
        await _evaluate(db)
        await _spend(db, vendor, D, 200 * M, scope="repo-b")  # now 80%
        await _evaluate(db)
        assert [a.threshold_key for a in await _alerts(db, "mtd_threshold")] == [50, 75]

    async def test_a_corrected_lower_month_to_date_fires_no_lower_threshold(
        self, async_db_session
    ) -> None:
        from app.models.overview import CostEntry

        db = async_db_session
        vendor = await self._setup(db)
        await _spend(db, vendor, D, 800 * M)
        await _evaluate(db)
        # A re-ingest corrects the day down to 80%: 75% was passed on the way
        # to 100% and is not news.
        entry = await db.scalar(
            select(CostEntry).where(CostEntry.vendor_id == vendor.id)
        )
        entry.amount_micros = 600 * M
        await db.flush()
        assert (await _evaluate(db)).fired == []
        assert [a.threshold_key for a in await _alerts(db, "mtd_threshold")] == [100]

    async def test_a_new_month_fires_again(self, async_db_session) -> None:
        db = async_db_session
        vendor = await self._setup(db)
        await _spend(db, vendor, D, 800 * M)
        await _evaluate(db)
        nov = date(2026, 11, 2)
        await _complete(db, vendor, nov - timedelta(days=1))
        await _spend(db, vendor, nov, 800 * M)
        await _evaluate(db, datetime(2026, 11, 2, 12, 0, tzinfo=UTC))
        assert [a.period_key for a in await _alerts(db, "mtd_threshold")] == [
            "2026-10",
            "2026-11",
        ]

    async def test_org_wide_rule_reads_the_amortized_view(
        self, async_db_session
    ) -> None:
        from app.models.overview import RecurringCost

        db = async_db_session
        manual = await _vendor(db, "Workspace", None)
        db.add(
            RecurringCost(
                tenant_id=TENANT,
                vendor_id=manual.id,
                description="3 seats",
                unit_amount_micros=31 * M,
                quantity=Decimal("1"),
                currency="USD",
                cadence="monthly",
                start_date=date(2026, 9, 1),
            )
        )
        await _rule(db, None, monthly_ceiling_micros=3 * M, mtd_thresholds_pct=[100])
        await _evaluate(db)
        [alert] = await _alerts(db, "mtd_threshold")
        assert alert.vendor_key == "*"
        assert alert.vendor_id is None
        assert alert.observed_micros == 3 * M  # Oct 1-3 of a $31/month entry


class TestDedupAndStale:
    async def test_a_second_tick_writes_nothing(self, async_db_session) -> None:
        db = async_db_session
        vendor = await _vendor(db)
        await _complete(db, vendor, D)
        await _rule(db, vendor, daily_abs_micros=50 * M)
        await _spend(db, vendor, D, 60 * M)
        first = await _evaluate(db)
        second = await _evaluate(db)
        assert len(first.fired) == 1 and second.fired == []
        assert len(await _alerts(db)) == 1

    async def test_stale_fires_and_resolves_when_a_fresh_run_lands(
        self, async_db_session
    ) -> None:
        db = async_db_session
        vendor = await _vendor(db)
        await _rule(db, vendor, daily_abs_micros=50 * M)
        await _complete(db, vendor, date(2026, 9, 28))
        await _evaluate(db)
        [alert] = await _alerts(db, "stale")
        # The last ok run's instant: one episode per staleness.
        assert alert.period_key == "2026-09-29T06:00:00Z"
        assert alert.resolved_at is None
        alert.coord_status = "sent"
        await db.flush()
        await _complete(db, vendor, D)
        report = await _evaluate(db)
        [alert] = await _alerts(db, "stale")
        assert alert.resolved_at is not None
        assert alert.coord_status == "pending"  # the resolve goes to coord
        assert str(alert.id) in report.resolved

    async def test_stale_twice_in_a_day_is_two_alerts(self, async_db_session) -> None:
        from app.models.overview import CostImportRun

        db = async_db_session
        vendor = await _vendor(db)
        await _rule(db, vendor, daily_abs_micros=50 * M)
        await _complete(db, vendor, D)

        async def run(status: str, at: datetime) -> None:
            db.add(
                CostImportRun(
                    tenant_id=TENANT,
                    vendor_id=vendor.id,
                    connector="github_billing",
                    transport="push",
                    granularity="day",
                    status=status,
                    started_at=at,
                    finished_at=at,
                    period_start=TODAY,
                    period_end=TODAY,
                )
            )
            await db.flush()

        await run("failed", NOW - timedelta(hours=3))
        await _evaluate(db)
        await run("ok", NOW - timedelta(hours=2))
        await _evaluate(db)
        await run("failed", NOW - timedelta(hours=1))
        await _evaluate(db)
        stale = await _alerts(db, "stale")
        assert len(stale) == 2
        assert [a.resolved_at is None for a in stale] == [False, True]

    async def test_a_seeded_connector_with_no_rule_is_not_stale_noise(
        self, async_db_session
    ) -> None:
        db = async_db_session
        await _vendor(db, "AWS", "aws_cost_explorer")
        await _evaluate(db)
        assert await _alerts(db) == []


# ===========================================================================
# Delivery
# ===========================================================================


def _tickets(tokens: list[str], ok: bool = True) -> list[Any]:
    from app.services.push_notifications import PushTicket

    return [
        PushTicket(token=t, status="ok", ticket_id=f"ticket-{t[-4:]}")
        if ok
        else PushTicket(token=t, status="error", error="transport")
        for t in tokens
    ]


@pytest_asyncio.fixture()
async def recipient(async_db_session, monkeypatch):
    """One admin with one device; coord answers the admins read."""
    from app.models.push_device import PushDevice
    from app.models.user import User
    from app.spend import recipients

    sub = f"sub-{uuid4().hex[:8]}"
    user = User(
        email=f"admin_{uuid4().hex[:8]}@example.com",
        username=f"admin_{uuid4().hex[:8]}",
        cognito_sub=sub,
        is_active=True,
        is_verified=True,
    )
    async_db_session.add(user)
    await async_db_session.flush()
    device = PushDevice(
        user_id=user.id, push_token=f"ExponentPushToken[{uuid4().hex[:12]}]"
    )
    async_db_session.add(device)
    await async_db_session.flush()

    async def admins(tenant_id: UUID) -> tuple[list[dict] | None, str | None]:
        assert tenant_id == TENANT
        return [{"operator_id": "op", "email": None, "cognito_sub": sub}], None

    monkeypatch.setattr(recipients, "fetch_tenant_admins", admins)
    return user, device


@pytest.fixture()
def expo(monkeypatch) -> dict[str, AsyncMock]:
    from app.services import push_notifications

    send = AsyncMock(side_effect=lambda tokens, **_: _tickets(tokens))
    receipts = AsyncMock(return_value={})
    monkeypatch.setattr(push_notifications, "send_push_notifications", send)
    monkeypatch.setattr(push_notifications, "get_push_receipts", receipts)
    return {"send": send, "receipts": receipts}


@pytest.fixture()
def coord(monkeypatch) -> AsyncMock:
    from app.services.coord_service_account import coord_service_account

    post = AsyncMock(return_value=(201, {"alert_kind": "spend_threshold_crossed"}))
    monkeypatch.setattr(coord_service_account, "post_spend_alert", post)
    return post


async def _deliver(db: AsyncSession, now: datetime = NOW) -> None:
    from app.spend.deliver import deliver_tenant

    await deliver_tenant(db, TENANT, now)


async def _busy_day(db: AsyncSession) -> Any:
    """Two daily rows, one spike and one 100% month-to-date crossing."""
    vendor = await _vendor(db)
    history = [D - timedelta(days=i) for i in range(2, 10)]
    await _complete(db, vendor, *history, D)
    await _partial_today(db, vendor)
    for day in history:
        await _spend(db, vendor, day, 10 * M)
    await _spend(db, vendor, D, 360 * M)
    await _spend(db, vendor, TODAY, 250 * M, scope="repo-b")
    await _rule(
        db,
        vendor,
        daily_abs_micros=50 * M,
        monthly_ceiling_micros=500 * M,
        mtd_thresholds_pct=[50, 75, 90, 100],
    )
    await _evaluate(db)
    return vendor


class TestPush:
    async def test_daily_and_spike_rows_collapse_into_one_digest(
        self, async_db_session, recipient, expo, coord
    ) -> None:
        db = async_db_session
        vendor = await _busy_day(db)
        await _deliver(db)
        alerts = await _alerts(db)
        assert sorted(a.rule for a in alerts) == [
            "daily_abs",
            "daily_abs",
            "mtd_threshold",
            "spike",
        ]
        assert expo["send"].await_count == 2  # one digest + the 100% alert
        calls = {
            c.kwargs["collapse_id"]: c.kwargs for c in expo["send"].await_args_list
        }
        digest = calls[f"spend-digest-{TODAY.isoformat()}"]
        assert digest["priority"] == "high"  # a spike is in it
        assert digest["title"] == "GitHub spend spike (+2 more)"
        assert (
            "repo-a: $360 on Oct 2 (36.0× its 14-day median of $10.00)"
            in digest["body"]
        )
        assert digest["data"]["kind"] == "spend_alert"
        assert digest["data"]["url"].startswith("/financials?vendor=")
        vendor_hash = hashlib.sha256(str(vendor.id).encode()).hexdigest()[:8]
        single = calls[f"spend-mtd_threshold-org-2026-10-{vendor_hash}"]
        assert single["priority"] == "high"
        assert "of $500" in single["body"] and "GitHub" in single["body"]
        digest_rows = [a for a in alerts if a.rule != "mtd_threshold"]
        assert len({a.push_delivery_id for a in digest_rows}) == 1
        assert {a.push_status for a in alerts} == {"accepted"}

    async def test_one_digest_a_day_later_rows_wait(
        self, async_db_session, recipient, expo, coord
    ) -> None:
        from app.models.overview import SpendAlert

        db = async_db_session
        await _busy_day(db)
        await _deliver(db)
        sends = expo["send"].await_count
        db.add(
            SpendAlert(
                tenant_id=TENANT,
                vendor_key="*",
                rule="daily_abs",
                scope_key="org",
                period_key=TODAY.isoformat(),
                observed_micros=60 * M,
                threshold_micros=50 * M,
                fired_at=NOW + timedelta(hours=2),
                detail={"vendor": "All vendors"},
            )
        )
        await db.flush()
        await _deliver(db, NOW + timedelta(hours=3))
        assert expo["send"].await_count == sends
        late = [a for a in await _alerts(db, "daily_abs") if a.vendor_key == "*"]
        assert late[0].push_status == "pending"
        # Tomorrow's digest carries it.
        await _deliver(db, NOW + timedelta(days=1))
        assert expo["send"].await_args.kwargs["collapse_id"] == (
            f"spend-digest-{(TODAY + timedelta(days=1)).isoformat()}"
        )
        late = [a for a in await _alerts(db, "daily_abs") if a.vendor_key == "*"]
        assert late[0].push_status == "accepted"

    async def test_a_failed_send_is_failed_and_the_retry_succeeds(
        self, async_db_session, recipient, expo, coord
    ) -> None:
        db = async_db_session
        await _busy_day(db)
        expo["send"].side_effect = lambda tokens, **_: _tickets(tokens, ok=False)
        await _deliver(db)
        assert {a.push_status for a in await _alerts(db)} == {"failed"}
        assert all("transport" in (a.push_detail or "") for a in await _alerts(db))
        expo["send"].side_effect = lambda tokens, **_: _tickets(tokens)
        await _deliver(db, NOW + timedelta(hours=1))
        assert {a.push_status for a in await _alerts(db)} == {"accepted"}

    async def test_a_ticket_then_a_receipt_moves_accepted_to_delivered(
        self, async_db_session, recipient, expo, coord
    ) -> None:
        db = async_db_session
        await _busy_day(db)
        await _deliver(db)
        assert {a.push_status for a in await _alerts(db)} == {"accepted"}
        _, device = recipient
        ticket = f"ticket-{device.push_token[-4:]}"
        expo["receipts"].return_value = {}  # not published yet
        await _deliver(db, NOW + timedelta(minutes=20))
        assert {a.push_status for a in await _alerts(db)} == {"accepted"}
        expo["receipts"].return_value = {ticket: {"status": "ok", "error": None}}
        await _deliver(db, NOW + timedelta(hours=1))
        assert {a.push_status for a in await _alerts(db)} == {"delivered"}

    async def test_device_not_registered_fails_and_deactivates_the_device(
        self, async_db_session, recipient, expo, coord
    ) -> None:
        db = async_db_session
        await _busy_day(db)
        await _deliver(db)
        _, device = recipient
        ticket = f"ticket-{device.push_token[-4:]}"
        expo["receipts"].return_value = {
            ticket: {"status": "error", "error": "DeviceNotRegistered"}
        }
        await _deliver(db, NOW + timedelta(hours=1))
        alerts = await _alerts(db)
        # Failed rows within the window are retried — with no device left the
        # retry cannot send, and says so.
        assert {a.push_status for a in alerts} == {"failed"}
        await db.refresh(device)
        assert device.is_active is False

    async def test_unreadable_recipients_are_unknown_not_none(
        self, async_db_session, expo, coord, monkeypatch
    ) -> None:
        from app.services.coord_service_account import coord_service_account

        db = async_db_session
        monkeypatch.setattr(
            coord_service_account,
            "get_tenant_admins",
            AsyncMock(return_value=(404, {"error": "no route"})),
        )
        await _busy_day(db)
        await _deliver(db)
        alerts = await _alerts(db)
        assert {a.push_status for a in alerts} == {"unknown_recipients"}
        assert "unsupported" in (alerts[0].push_detail or "")
        expo["send"].assert_not_awaited()

    async def test_a_disabled_coord_bridge_is_unknown_recipients(
        self, async_db_session, expo, coord
    ) -> None:
        db = async_db_session
        await _busy_day(db)
        await _deliver(db)  # COORD_ADMIN_SECRET is unset under test
        assert {a.push_status for a in await _alerts(db)} == {"unknown_recipients"}

    async def test_muted_recipients_are_skipped(
        self, async_db_session, recipient, expo, coord
    ) -> None:
        from app.models.overview import SpendAlertPreference

        db = async_db_session
        user, _ = recipient
        db.add(SpendAlertPreference(tenant_id=TENANT, user_id=user.id, muted=True))
        await db.flush()
        await _busy_day(db)
        await _deliver(db)
        assert {a.push_status for a in await _alerts(db)} == {"muted"}
        expo["send"].assert_not_awaited()


class TestRetryPolicy:
    async def test_pre_acceptance_failures_are_retried_up_to_the_cap(
        self, async_db_session, recipient, expo, coord
    ) -> None:
        from app.spend.deliver import MAX_PUSH_ATTEMPTS

        db = async_db_session
        await _busy_day(db)
        expo["send"].side_effect = lambda tokens, **_: _tickets(tokens, ok=False)
        for hour in range(MAX_PUSH_ATTEMPTS + 2):
            await _deliver(db, NOW + timedelta(hours=hour))
        # Two sends a tick (one digest, one single) for MAX ticks, then none.
        assert expo["send"].await_count == 2 * MAX_PUSH_ATTEMPTS
        alerts = await _alerts(db)
        assert {a.push_status for a in alerts} == {"failed"}
        assert {a.push_attempts for a in alerts} == {MAX_PUSH_ATTEMPTS}

    async def test_a_receipt_failure_is_terminal(
        self, async_db_session, recipient, expo, coord
    ) -> None:
        db = async_db_session
        await _busy_day(db)
        await _deliver(db)
        sends = expo["send"].await_count
        _, device = recipient
        expo["receipts"].return_value = {
            f"ticket-{device.push_token[-4:]}": {
                "status": "error",
                "error": "MessageRateExceeded",
            }
        }
        await _deliver(db, NOW + timedelta(hours=1))
        await _deliver(db, NOW + timedelta(hours=2))
        assert expo["send"].await_count == sends  # never resent
        assert {a.push_status for a in await _alerts(db)} == {"failed"}
        await db.refresh(device)
        assert device.is_active is True  # only DeviceNotRegistered deactivates


class TestCollapseId:
    async def test_at_most_64_bytes_and_distinct_per_vendor(self) -> None:
        from app.models.overview import SpendAlert
        from app.spend.deliver import collapse_id

        def alert(vendor_key: str, scope: str, period: str = "2026-10-02") -> Any:
            return SpendAlert(
                rule="spike", vendor_key=vendor_key, scope_key=scope, period_key=period
            )

        a = collapse_id(alert(str(uuid4()), "org"))
        b = collapse_id(alert(str(uuid4()), "org"))
        assert a != b and a.startswith("spend-spike-org-2026-10-02-")
        long_scope = "qontinui-a-very-long-repository-name-é" * 4
        key = str(uuid4())
        c = collapse_id(alert(key, long_scope, "2026-09-29T06:00:00Z"))
        assert len(c.encode("utf-8")) <= 64
        assert c.endswith(
            "-2026-09-29T06:00:00Z-" + hashlib.sha256(key.encode()).hexdigest()[:8]
        )


class TestForeignCurrency:
    async def test_a_vendor_with_foreign_rows_is_skipped_and_reported(
        self, async_db_session
    ) -> None:
        from app.models.overview import CostEntry

        db = async_db_session
        vendor = await _vendor(db)
        await _complete(db, vendor, D)
        await _rule(db, vendor, daily_abs_micros=50 * M)
        await _rule(db, None, daily_abs_micros=1)
        await _spend(db, vendor, D, 60 * M)
        db.add(
            CostEntry(
                tenant_id=TENANT,
                vendor_id=vendor.id,
                source="connector",
                source_ref="eur",
                amount_micros=10 * M,
                currency="EUR",
                period_start=D,
                period_end=D,
            )
        )
        await db.flush()
        report = await _evaluate(db)
        assert report.unknown_currency == ["GitHub"]
        assert await _alerts(db) == []


class TestForeignCurrencyStale:
    async def test_stale_still_raises_and_resolves_for_a_foreign_vendor(
        self, async_db_session
    ) -> None:
        from app.models.overview import CostEntry

        db = async_db_session
        vendor = await _vendor(db)
        await _rule(db, vendor, daily_abs_micros=50 * M)
        await _complete(db, vendor, date(2026, 9, 28))
        db.add(
            CostEntry(
                tenant_id=TENANT,
                vendor_id=vendor.id,
                source="connector",
                source_ref="eur",
                amount_micros=500 * M,
                currency="EUR",
                period_start=date(2026, 9, 28),
                period_end=date(2026, 9, 28),
            )
        )
        await db.flush()
        report = await _evaluate(db)
        assert report.unknown_currency == ["GitHub"]
        assert [a.rule for a in await _alerts(db)] == ["stale"]
        await _complete(db, vendor, D)
        await _spend(db, vendor, D, 900 * M)  # over daily_abs, but not evaluated
        report = await _evaluate(db)
        [stale] = await _alerts(db, "stale")
        assert stale.resolved_at is not None
        assert await _alerts(db, "daily_abs") == []


class TestRecipients:
    async def test_a_subject_match_does_not_count_an_email_admin_matched(
        self, async_db_session, monkeypatch
    ) -> None:
        from app.models.user import User
        from app.spend import recipients

        db = async_db_session
        email = f"both_{uuid4().hex[:8]}@example.com"
        sub = f"sub-{uuid4().hex[:8]}"
        db.add(
            User(
                email=email,
                username=f"u_{uuid4().hex[:8]}",
                cognito_sub=sub,
                is_active=True,
            )
        )
        await db.flush()

        async def admins(tenant_id: UUID) -> tuple[list[dict] | None, str | None]:
            return [
                {"operator_id": "a", "email": None, "cognito_sub": sub},
                # A second admin with no subject, whose email is the (unverified)
                # account above: not a verified match, so it is unmatched.
                {"operator_id": "b", "email": email, "cognito_sub": None},
                {"operator_id": "c", "email": None, "cognito_sub": None},
            ], None

        monkeypatch.setattr(recipients, "fetch_tenant_admins", admins)
        who = await recipients.resolve_recipients(db, TENANT)
        assert who.users == 1
        assert who.unmatched == 2

    async def test_email_matches_only_an_admin_with_no_subject(
        self, async_db_session, monkeypatch
    ) -> None:
        from app.models.push_device import PushDevice
        from app.models.user import User
        from app.spend import recipients

        db = async_db_session
        shared = f"shared_{uuid4().hex[:8]}@example.com"
        impostor = User(email=shared, username=f"u_{uuid4().hex[:8]}", is_active=True)
        db.add(impostor)
        await db.flush()
        db.add(PushDevice(user_id=impostor.id, push_token=f"tok-{uuid4().hex}"))
        await db.flush()

        async def admins(tenant_id: UUID) -> tuple[list[dict] | None, str | None]:
            return [{"operator_id": "o", "email": shared, "cognito_sub": "sub-x"}], None

        monkeypatch.setattr(recipients, "fetch_tenant_admins", admins)
        assert (await recipients.resolve_recipients(db, TENANT)).devices == []

        async def no_sub(tenant_id: UUID) -> tuple[list[dict] | None, str | None]:
            return [{"operator_id": "o", "email": shared, "cognito_sub": None}], None

        monkeypatch.setattr(recipients, "fetch_tenant_admins", no_sub)
        # An UNVERIFIED local email is not matched: recorded as unmatched.
        who = await recipients.resolve_recipients(db, TENANT)
        assert who.devices == [] and who.unmatched == 1
        impostor.is_verified = True
        await db.flush()
        who = await recipients.resolve_recipients(db, TENANT)
        assert len(who.devices) == 1 and who.unmatched == 0


class TestCoordDelivery:
    async def test_sent_unsupported_and_resolved(
        self, async_db_session, recipient, expo, coord
    ) -> None:
        db = async_db_session
        vendor = await _vendor(db)
        await _rule(db, vendor, daily_abs_micros=50 * M)
        await _complete(db, vendor, date(2026, 9, 28))
        await _evaluate(db)
        coord.return_value = (404, None)
        await _deliver(db)
        [stale] = await _alerts(db, "stale")
        assert stale.coord_status == "unsupported"
        coord.return_value = (
            201,
            {"alert_kind": "spend_threshold_crossed", "fired": True},
        )
        await _deliver(db, NOW + timedelta(hours=1))
        [stale] = await _alerts(db, "stale")
        assert stale.coord_status == "sent"
        body = coord.await_args.args[0]
        assert body["tenant_id"] == str(TENANT)
        assert body["rule"] == "stale" and body["resolved"] is False
        assert set(body) == {
            "tenant_id",
            "alert_id",
            "rule",
            "scope_key",
            "period_key",
            "observed_micros",
            "threshold_micros",
            "vendor",
            "resolved",
        }
        await _complete(db, vendor, D)
        await _evaluate(db)
        await _deliver(db, NOW + timedelta(hours=2))
        assert coord.await_args.args[0]["resolved"] is True
        [stale] = await _alerts(db, "stale")
        assert stale.coord_status == "sent"

    async def test_coord_error_is_failed(
        self, async_db_session, recipient, expo, coord
    ) -> None:
        db = async_db_session
        await _busy_day(db)
        coord.return_value = (500, {"error": "boom"})
        await _deliver(db)
        assert {a.coord_status for a in await _alerts(db)} == {"failed"}


# ===========================================================================
# The Expo client and the scheduler entry
# ===========================================================================


class TestExpoClient:
    async def test_send_returns_one_ticket_per_token(self, monkeypatch) -> None:
        from app.services import push_notifications

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "data": [
                        {"status": "ok", "id": "t-1"},
                        {
                            "status": "error",
                            "message": "not registered",
                            "details": {"error": "DeviceNotRegistered"},
                        },
                    ]
                },
            )

        real = httpx.AsyncClient
        monkeypatch.setattr(
            push_notifications.httpx,
            "AsyncClient",
            lambda **kw: real(transport=httpx.MockTransport(handler), **kw),
        )
        tickets = await push_notifications.send_push_notifications(
            ["tok-1", "tok-2"], "t", "b"
        )
        assert [(t.status, t.ticket_id, t.error) for t in tickets] == [
            ("ok", "t-1", None),
            ("error", None, "DeviceNotRegistered"),
        ]

    async def test_a_transport_failure_is_an_error_ticket_per_token(
        self, monkeypatch
    ) -> None:
        from app.services import push_notifications

        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("down")

        real = httpx.AsyncClient
        monkeypatch.setattr(
            push_notifications.httpx,
            "AsyncClient",
            lambda **kw: real(transport=httpx.MockTransport(handler), **kw),
        )
        tickets = await push_notifications.send_push_notifications(["a", "b"], "t", "b")
        assert [t.status for t in tickets] == ["error", "error"]
        assert {t.error for t in tickets} == {"transport"}

    async def test_receipts_poll(self, monkeypatch) -> None:
        from app.services import push_notifications

        def handler(request: httpx.Request) -> httpx.Response:
            assert request.url.path.endswith("/getReceipts")
            return httpx.Response(
                200,
                json={
                    "data": {
                        "t-1": {"status": "ok"},
                        "t-2": {
                            "status": "error",
                            "details": {"error": "DeviceNotRegistered"},
                        },
                    }
                },
            )

        real = httpx.AsyncClient
        monkeypatch.setattr(
            push_notifications.httpx,
            "AsyncClient",
            lambda **kw: real(transport=httpx.MockTransport(handler), **kw),
        )
        receipts = await push_notifications.get_push_receipts(["t-1", "t-2", "t-3"])
        assert receipts is not None
        assert receipts["t-1"]["status"] == "ok"
        assert receipts["t-2"]["error"] == "DeviceNotRegistered"
        assert "t-3" not in receipts

    async def test_event_push_never_raises_on_token_lookup(self, monkeypatch) -> None:
        from app.services import push_notifications

        monkeypatch.setattr(
            push_notifications,
            "get_user_push_tokens",
            AsyncMock(side_effect=RuntimeError("db down")),
        )
        send = AsyncMock()
        monkeypatch.setattr(push_notifications, "send_push_notifications", send)
        event = type(
            "E",
            (),
            {
                "event_type": "run_failed",
                "user_id": uuid4(),
                "runner_name": "r",
                "summary": "s",
                "run_id": "r1",
                "id": uuid4(),
                "device_id": "d",
            },
        )()
        assert (
            await push_notifications.dispatch_push_for_event(AsyncMock(), event) == []
        )
        send.assert_not_awaited()

    async def test_event_push_never_raises_on_housekeeping(self, monkeypatch) -> None:
        from app.services import push_notifications
        from app.services.push_notifications import PushTicket

        monkeypatch.setattr(
            push_notifications, "get_user_push_tokens", AsyncMock(return_value=["gone"])
        )
        monkeypatch.setattr(
            push_notifications,
            "send_push_notifications",
            AsyncMock(
                return_value=[
                    PushTicket(
                        token="gone", status="error", error="DeviceNotRegistered"
                    )
                ]
            ),
        )
        monkeypatch.setattr(
            push_notifications,
            "deactivate_push_tokens",
            AsyncMock(side_effect=RuntimeError("db down")),
        )
        event = type(
            "E",
            (),
            {
                "event_type": "run_failed",
                "user_id": uuid4(),
                "runner_name": "r",
                "summary": "s",
                "run_id": "run-1",
                "id": uuid4(),
                "device_id": "d",
            },
        )()
        tickets = await push_notifications.dispatch_push_for_event(AsyncMock(), event)
        assert tickets[0].error == "DeviceNotRegistered"

    async def test_event_push_deactivates_an_unregistered_device(
        self, monkeypatch
    ) -> None:
        from app.services import push_notifications
        from app.services.push_notifications import PushTicket

        monkeypatch.setattr(
            push_notifications,
            "get_user_push_tokens",
            AsyncMock(return_value=["gone"]),
        )
        monkeypatch.setattr(
            push_notifications,
            "send_push_notifications",
            AsyncMock(
                return_value=[
                    PushTicket(
                        token="gone", status="error", error="DeviceNotRegistered"
                    )
                ]
            ),
        )
        deactivate = AsyncMock(return_value=1)
        monkeypatch.setattr(push_notifications, "deactivate_push_tokens", deactivate)
        event = type(
            "E",
            (),
            {
                "event_type": "run_failed",
                "user_id": uuid4(),
                "runner_name": "r",
                "summary": "s",
                "run_id": "run-1",
                "id": uuid4(),
                "device_id": "d",
            },
        )()
        tickets = await push_notifications.dispatch_push_for_event(AsyncMock(), event)
        assert tickets[0].error == "DeviceNotRegistered"
        deactivate.assert_awaited_once()


async def test_spend_evaluate_is_hourly_and_runs_at_boot() -> None:
    from app.core.scheduler import SchedulerService, install_default_tasks

    service = SchedulerService()
    install_default_tasks(service)
    task = service._tasks["spend_evaluate"]
    assert task.cron == "20 * * * *"
    assert task.run_at_boot


async def test_the_tenant_lock_admits_one_evaluator(test_engine, monkeypatch) -> None:
    """The real per-tenant path: alert rows committed, the lock held across
    the commits, and a second evaluator for the same tenant turned away."""
    from sqlalchemy import delete, text
    from sqlalchemy.ext.asyncio import async_sessionmaker

    from app.models.overview import CostImportRun, SpendAlert, SpendRule, Vendor
    from app.spend import evaluate
    from app.spend import recipients as recipients_module

    async def no_admins(tenant_id: UUID) -> tuple[list[dict] | None, str | None]:
        return None, "test"

    monkeypatch.setattr(recipients_module, "fetch_tenant_admins", no_admins)
    maker = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)
    tenant = uuid4()
    async with maker() as db:
        vendor = Vendor(
            tenant_id=tenant,
            name="GitHub",
            category="source_hosting",
            connector="github_billing",
        )
        db.add(vendor)
        await db.flush()
        db.add(SpendRule(tenant_id=tenant, vendor_id=vendor.id, daily_abs_micros=1))
        await db.commit()
    try:
        async with maker() as holder:
            await holder.execute(
                text("SELECT pg_advisory_lock(hashtext('spend:' || :t))"),
                {"t": str(tenant)},
            )
            assert (
                await evaluate.evaluate_and_deliver_tenant(
                    tenant, session_factory=maker, now=NOW
                )
                is None
            )
            await holder.execute(
                text("SELECT pg_advisory_unlock(hashtext('spend:' || :t))"),
                {"t": str(tenant)},
            )
            await holder.commit()
        report = await evaluate.evaluate_and_deliver_tenant(
            tenant, session_factory=maker, now=NOW
        )
        assert report is not None and report.fired == ["stale:org:never"]
        async with maker() as db:
            [alert] = (
                await db.execute(
                    select(SpendAlert).where(SpendAlert.tenant_id == tenant)
                )
            ).scalars()
            assert alert.push_status == "unknown_recipients"  # committed by delivery
    finally:
        async with maker() as db:
            for model in (SpendAlert, CostImportRun, SpendRule, Vendor):
                await db.execute(delete(model).where(model.tenant_id == tenant))
            await db.commit()


async def test_a_failed_unlock_invalidates_the_lock_connection() -> None:
    """A pooled connection still holding the tenant lock would turn every
    later evaluator away; when the unlock fails the connection is dropped."""
    from app.spend.evaluate import _release

    connection = AsyncMock()
    lock_db = AsyncMock()
    lock_db.execute.side_effect = RuntimeError("connection lost")
    lock_db.connection.return_value = connection
    with pytest.raises(RuntimeError):
        await _release(lock_db, {"tenant": str(TENANT)}, TENANT)
    connection.invalidate.assert_awaited_once()


class TestFreshnessBounds:
    async def test_since_bounds_the_day_sets_not_the_aggregates(
        self, async_db_session
    ) -> None:
        from app.models.overview import CostImportRun
        from app.spend.freshness import vendor_freshness

        db = async_db_session
        vendor = await _vendor(db)
        await _complete(db, vendor, date(2026, 6, 1), D)
        # An ok run with no period must not move newest_complete_day.
        db.add(
            CostImportRun(
                tenant_id=TENANT,
                vendor_id=vendor.id,
                connector="github_billing",
                transport="push",
                granularity="range",
                status="ok",
                started_at=NOW,
                finished_at=NOW,
                period_start=TODAY,
                period_end=None,
            )
        )
        await db.flush()
        fresh = (
            await vendor_freshness(db, TENANT, [vendor], NOW, since=date(2026, 9, 1))
        )[vendor.id]
        assert fresh.covered_days == {D}
        assert fresh.oldest_covered_day == date(2026, 6, 1)
        assert fresh.newest_complete_day == D
        unbounded = (await vendor_freshness(db, TENANT, [vendor], NOW))[vendor.id]
        assert unbounded.covered_days == {date(2026, 6, 1), D}
