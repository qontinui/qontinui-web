"""The spend read: ``GET /overview/spend/summary`` and ``…/renewals``.

Every figure is the provider's statement (connector rows), an operator's
statement of an invoice (recurring and manual rows), or a sum of those. An
UNKNOWN vendor's own figures are ``None``; a total over one is marked
``partial`` with the vendor named, never presented as complete.
"""

from __future__ import annotations

import calendar
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.overview import CostEntry, RecurringCost, SpendAlert, SpendRule, Vendor
from app.spend.connectors import connector_spec
from app.spend.freshness import Freshness, vendor_freshness
from app.spend.recurring import View, amount_micros, materialise, next_charge_on

GroupBy = Literal["day", "month", "scope", "sku"]


@dataclass(frozen=True)
class SpendRow:
    """One day's figure from one source line."""

    day: date
    vendor_id: UUID
    source: str
    net_micros: int
    gross_micros: int | None
    discount_micros: int | None
    scope_label: str | None
    sku: str | None
    product: str | None
    description: str
    currency: str


def month_bounds(day: date) -> tuple[date, date]:
    return day.replace(day=1), day.replace(
        day=calendar.monthrange(day.year, day.month)[1]
    )


async def load_rows(
    db: AsyncSession,
    tenant_id: UUID,
    vendor_ids: list[UUID],
    start: date,
    end: date,
    view: View,
) -> list[SpendRow]:
    """Every figure for these vendors with a day in ``[start, end]``.

    Connector and manual entries are stored per day (a multi-day manual entry
    is placed on its ``period_start``); recurring entries are materialised
    here under ``view``.
    """
    if not vendor_ids:
        return []
    rows: list[SpendRow] = []
    entries = (
        (
            await db.execute(
                select(CostEntry).where(
                    CostEntry.tenant_id == tenant_id,
                    CostEntry.vendor_id.in_(vendor_ids),
                    CostEntry.period_start >= start,
                    CostEntry.period_start <= end,
                )
            )
        )
        .scalars()
        .all()
    )
    for e in entries:
        rows.append(
            SpendRow(
                day=e.period_start,
                vendor_id=e.vendor_id,
                source=e.source,
                net_micros=e.amount_micros,
                gross_micros=e.gross_micros,
                discount_micros=e.discount_micros,
                scope_label=e.scope_label,
                sku=e.sku,
                product=e.product,
                description=e.description,
                currency=e.currency,
            )
        )
    recurring = (
        (
            await db.execute(
                select(RecurringCost).where(
                    RecurringCost.tenant_id == tenant_id,
                    RecurringCost.vendor_id.in_(vendor_ids),
                )
            )
        )
        .scalars()
        .all()
    )
    for r in recurring:
        for part in materialise(r, start, end, view):
            rows.append(
                SpendRow(
                    day=part.day,
                    vendor_id=r.vendor_id,
                    source="recurring",
                    net_micros=part.micros,
                    gross_micros=None,
                    discount_micros=None,
                    scope_label=None,
                    sku=None,
                    product=None,
                    description=r.description,
                    currency=r.currency,
                )
            )
    return rows


def _group_key(row: SpendRow, group_by: GroupBy) -> str:
    if group_by == "day":
        return row.day.isoformat()
    if group_by == "month":
        return row.day.strftime("%Y-%m")
    if group_by == "scope":
        return row.scope_label or row.description or "(unscoped)"
    return row.sku or row.description or "(no sku)"


# ---------------------------------------------------------------------------
# Response shapes (the wire contract)
# ---------------------------------------------------------------------------


class VendorSummary(BaseModel):
    id: str
    name: str
    category: str
    connector: str | None
    status: str
    status_reason: str | None
    last_ok_at: datetime | None
    newest_complete_day: date | None
    #: The first day an ok import covered. Inside [oldest_covered_day,
    #: newest_complete_day] a day with no series row is a REPORTED $0.
    oldest_covered_day: date | None
    expected_lag_hours: int | None
    provenance: str
    month_to_date_micros: int | None
    ceiling_micros: int | None
    ceiling_pct: float | None
    #: The month-to-date amount ``ceiling_pct`` is computed from: connector
    #: rows only, through the rule's product filter. ``null`` with the pct.
    ceiling_basis_micros: int | None
    today_micros: int | None
    yesterday_micros: int | None
    last_month_micros: int | None
    #: A prepaid balance where one is known — a balance, never spend.
    balance_micros: int | None = None


class SeriesPoint(BaseModel):
    key: str
    vendor_id: str
    net_micros: int
    gross_micros: int | None
    discount_micros: int | None
    source: str


class Totals(BaseModel):
    net_micros: int
    partial: bool
    #: The names of the vendors whose figures are UNKNOWN in this read.
    unknown_vendors: list[str]


class AlertOut(BaseModel):
    id: str
    rule: str
    scope_key: str
    period_key: str
    observed_micros: int | None
    threshold_micros: int | None
    fired_at: datetime
    push_status: str
    resolved_at: datetime | None
    vendor_id: str | None
    coord_status: str
    detail: dict[str, Any]


class SpendSummary(BaseModel):
    currency: str
    view: str
    from_: date
    to: date
    generated_at: datetime
    vendors: list[VendorSummary]
    series: list[SeriesPoint]
    totals: Totals
    alerts: list[AlertOut]

    def wire(self) -> dict[str, Any]:
        out = self.model_dump(mode="json")
        out["from"] = out.pop("from_")
        return out


def _provenance(vendor: Vendor, fresh: Freshness, has_recurring: bool) -> str:
    spec = connector_spec(vendor.connector)
    parts: list[str] = []
    if spec is not None:
        line = spec.provenance
        if fresh.last_ok_at is not None:
            line += f", fetched {fresh.last_ok_at.astimezone(UTC):%Y-%m-%d %H:%M} UTC"
        parts.append(line)
    if has_recurring or spec is None:
        parts.append("entered manually — from the provider's invoice")
    return "; ".join(parts)


def _matches(product: str | None, product_filter: list[str] | None) -> bool:
    return not product_filter or (product is not None and product in product_filter)


def _window(
    f: Freshness,
    has_connector: bool,
    vrows: list[SpendRow],
    lo: date,
    hi: date,
    today: date,
) -> int | None:
    """A vendor's total over ``[lo, hi]``, or ``None`` when it is UNKNOWN: the
    vendor is not known, or a connector day in the window was never fetched (a
    gap is not $0). Today counts only for a window that is today alone; a
    longer window runs through yesterday plus whatever of today is fetched."""
    if not f.known:
        return None
    if has_connector:
        last = hi if hi < today else today - timedelta(days=1)
        if lo == today:
            last = today
        day = lo
        while day <= last:
            if day not in f.covered_days:
                return None
            day += timedelta(days=1)
    return sum(r.net_micros for r in vrows if lo <= r.day <= hi)


#: The one currency every total is in. Recurring entries in any other
#: currency are refused at write time; a connector row in another currency is
#: left out of every total and its vendor named as partial.
SUMMARY_CURRENCY = "USD"


async def _day_totals(
    db: AsyncSession,
    tenant_id: UUID,
    vendor_ids: list[UUID],
    start: date,
    end: date,
    view: View,
) -> list[SpendRow]:
    """One row per (vendor, day, source, product), summed in SQL, plus the
    recurring entries materialised under ``view``."""
    if not vendor_ids:
        return []
    stmt = (
        select(
            CostEntry.vendor_id,
            CostEntry.period_start,
            CostEntry.source,
            CostEntry.product,
            func.sum(CostEntry.amount_micros),
        )
        .where(
            CostEntry.tenant_id == tenant_id,
            CostEntry.vendor_id.in_(vendor_ids),
            CostEntry.currency == SUMMARY_CURRENCY,
            CostEntry.period_start >= start,
            CostEntry.period_start <= end,
        )
        .group_by(
            CostEntry.vendor_id,
            CostEntry.period_start,
            CostEntry.source,
            CostEntry.product,
        )
    )
    out = [
        SpendRow(
            day=day,
            vendor_id=vid,
            source=source,
            net_micros=int(net),
            gross_micros=None,
            discount_micros=None,
            scope_label=None,
            sku=None,
            product=product,
            description="",
            currency=SUMMARY_CURRENCY,
        )
        for vid, day, source, product, net in (await db.execute(stmt)).all()
    ]
    out.extend(await _recurring_rows(db, tenant_id, vendor_ids, start, end, view))
    return out


async def _recurring_rows(
    db: AsyncSession,
    tenant_id: UUID,
    vendor_ids: list[UUID],
    start: date,
    end: date,
    view: View,
) -> list[SpendRow]:
    entries = (
        await db.execute(
            select(RecurringCost).where(
                RecurringCost.tenant_id == tenant_id,
                RecurringCost.vendor_id.in_(vendor_ids),
                RecurringCost.currency == SUMMARY_CURRENCY,
            )
        )
    ).scalars()
    rows: list[SpendRow] = []
    for r in entries:
        for part in materialise(r, start, end, view):
            rows.append(
                SpendRow(
                    day=part.day,
                    vendor_id=r.vendor_id,
                    source="recurring",
                    net_micros=part.micros,
                    gross_micros=None,
                    discount_micros=None,
                    scope_label=None,
                    sku=None,
                    product=None,
                    description=r.description,
                    currency=r.currency,
                )
            )
    return rows


async def _vendors_with_other_currency(
    db: AsyncSession, tenant_id: UUID, vendor_ids: list[UUID], start: date, end: date
) -> set[UUID]:
    if not vendor_ids:
        return set()
    return set(
        (
            await db.execute(
                select(CostEntry.vendor_id)
                .where(
                    CostEntry.tenant_id == tenant_id,
                    CostEntry.vendor_id.in_(vendor_ids),
                    CostEntry.currency != SUMMARY_CURRENCY,
                    CostEntry.period_start >= start,
                    CostEntry.period_start <= end,
                )
                .distinct()
            )
        ).scalars()
    )


async def _series(
    db: AsyncSession,
    tenant_id: UUID,
    vendor_ids: list[UUID],
    start: date,
    end: date,
    group_by: GroupBy,
    view: View,
) -> list[SeriesPoint]:
    """The series, grouped in SQL for stored entries (GROUP BY key, vendor,
    source) and in Python for the materialised recurring entries."""
    if not vendor_ids:
        return []
    key: Any
    if group_by == "day":
        key = func.to_char(CostEntry.period_start, "YYYY-MM-DD")
    elif group_by == "month":
        key = func.to_char(CostEntry.period_start, "YYYY-MM")
    elif group_by == "scope":
        key = func.coalesce(
            CostEntry.scope_label, func.nullif(CostEntry.description, ""), "(unscoped)"
        )
    else:
        key = func.coalesce(
            CostEntry.sku, func.nullif(CostEntry.description, ""), "(no sku)"
        )
    key = key.label("key")
    stmt = (
        select(
            key,
            CostEntry.vendor_id,
            CostEntry.source,
            func.sum(CostEntry.amount_micros),
            func.sum(CostEntry.gross_micros),
            func.sum(CostEntry.discount_micros),
            # A group with any NULL gross/discount has an UNKNOWN sum.
            func.count() - func.count(CostEntry.gross_micros),
            func.count() - func.count(CostEntry.discount_micros),
        )
        .where(
            CostEntry.tenant_id == tenant_id,
            CostEntry.vendor_id.in_(vendor_ids),
            CostEntry.currency == SUMMARY_CURRENCY,
            CostEntry.period_start >= start,
            CostEntry.period_start <= end,
        )
        .group_by(key, CostEntry.vendor_id, CostEntry.source)
    )
    points: dict[tuple[str, str, str], SeriesPoint] = {}
    for k, vid, source, net, gross, disc, gross_nulls, disc_nulls in (
        await db.execute(stmt)
    ).all():
        points[(k, str(vid), source)] = SeriesPoint(
            key=k,
            vendor_id=str(vid),
            net_micros=int(net),
            gross_micros=None if gross_nulls else int(gross),
            discount_micros=None if disc_nulls else int(disc),
            source=source,
        )
    for row in await _recurring_rows(db, tenant_id, vendor_ids, start, end, view):
        k = _group_key(row, group_by)
        point = points.get((k, str(row.vendor_id), "recurring"))
        if point is None:
            points[(k, str(row.vendor_id), "recurring")] = SeriesPoint(
                key=k,
                vendor_id=str(row.vendor_id),
                net_micros=row.net_micros,
                gross_micros=None,
                discount_micros=None,
                source="recurring",
            )
        else:
            point.net_micros += row.net_micros
    return [points[k] for k in sorted(points)]


async def build_summary(
    db: AsyncSession,
    tenant_id: UUID,
    *,
    start: date,
    end: date,
    vendor_id: UUID | None,
    group_by: GroupBy,
    view: View,
    now: datetime,
) -> SpendSummary:
    today = now.astimezone(UTC).date()
    vendor_stmt = select(Vendor).where(Vendor.tenant_id == tenant_id)
    if vendor_id is not None:
        vendor_stmt = vendor_stmt.where(Vendor.id == vendor_id)
    vendors = list((await db.execute(vendor_stmt.order_by(Vendor.name))).scalars())
    ids = [v.id for v in vendors]

    rules = {
        r.vendor_id: r
        for r in (
            await db.execute(select(SpendRule).where(SpendRule.tenant_id == tenant_id))
        ).scalars()
    }
    recurring_vendors = set(
        (
            await db.execute(
                select(RecurringCost.vendor_id).where(
                    RecurringCost.tenant_id == tenant_id
                )
            )
        ).scalars()
    )

    month_start, _ = month_bounds(today)
    last_month_start, last_month_end = month_bounds(month_start - timedelta(days=1))
    load_start = min(start, last_month_start)
    load_end = max(end, today)
    fresh = await vendor_freshness(db, tenant_id, vendors, now, since=load_start)

    # Per-vendor DAY totals for the figures, aggregated in SQL; recurring
    # entries are materialised (they are few) and folded in per day.
    day_rows = await _day_totals(db, tenant_id, ids, load_start, load_end, view)
    by_vendor: dict[UUID, list[SpendRow]] = defaultdict(list)
    for row in day_rows:
        by_vendor[row.vendor_id].append(row)
    other_currency = await _vendors_with_other_currency(db, tenant_id, ids, start, end)

    summaries: list[VendorSummary] = []
    unknown: list[str] = []
    for vendor in vendors:
        f = fresh[vendor.id]
        spec = connector_spec(vendor.connector)
        vrows = by_vendor.get(vendor.id, [])
        rule = rules.get(vendor.id)
        ceiling = rule.monthly_ceiling_micros if rule else None
        has_connector = spec is not None

        mtd = _window(f, has_connector, vrows, month_start, today, today)
        today_m = _window(f, has_connector, vrows, today, today, today)
        yesterday = today - timedelta(days=1)
        yesterday_m = _window(f, has_connector, vrows, yesterday, yesterday, today)
        last_month = _window(
            f, has_connector, vrows, last_month_start, last_month_end, today
        )
        pct: float | None = None
        basis: int | None = None
        if mtd is not None and ceiling:
            # A ceiling reads connector-reported spend for its own vendor,
            # through the rule's product filter (decisions 8 and 12): a yearly
            # renewal never moves it.
            basis = sum(
                r.net_micros
                for r in vrows
                if r.source == "connector"
                and month_start <= r.day <= today
                and _matches(r.product, rule.product_filter if rule else None)
            )
            pct = round(basis * 100 / ceiling, 1)
        gap_in_range = (
            f.known
            and has_connector
            and _window(
                f, has_connector, vrows, start, end if end < today else today, today
            )
            is None
        )
        if not f.known or gap_in_range or vendor.id in other_currency:
            unknown.append(vendor.name)
        summaries.append(
            VendorSummary(
                id=str(vendor.id),
                name=vendor.name,
                category=vendor.category,
                connector=vendor.connector,
                status=f.status,
                status_reason=(
                    f.reason
                    if vendor.id not in other_currency
                    else "has figures in a currency other than USD, left out of "
                    "every total"
                ),
                last_ok_at=f.last_ok_at,
                newest_complete_day=f.newest_complete_day,
                oldest_covered_day=f.oldest_covered_day,
                expected_lag_hours=spec.expected_lag_hours if spec else None,
                provenance=_provenance(vendor, f, vendor.id in recurring_vendors),
                month_to_date_micros=mtd,
                ceiling_micros=ceiling,
                ceiling_pct=pct,
                ceiling_basis_micros=basis,
                today_micros=today_m,
                yesterday_micros=yesterday_m,
                last_month_micros=last_month,
            )
        )

    series = await _series(db, tenant_id, ids, start, end, group_by, view)

    alert_stmt = (
        select(SpendAlert)
        .where(
            SpendAlert.tenant_id == tenant_id,
            SpendAlert.fired_at
            >= datetime.combine(start, datetime.min.time(), tzinfo=UTC),
        )
        .order_by(SpendAlert.fired_at.desc())
        .limit(200)
    )
    if vendor_id is not None:
        alert_stmt = alert_stmt.where(SpendAlert.vendor_id == vendor_id)
    alerts = [
        AlertOut(
            id=str(a.id),
            rule=a.rule,
            scope_key=a.scope_key,
            period_key=a.period_key,
            observed_micros=a.observed_micros,
            threshold_micros=a.threshold_micros,
            fired_at=a.fired_at,
            push_status=a.push_status,
            resolved_at=a.resolved_at,
            vendor_id=str(a.vendor_id) if a.vendor_id else None,
            coord_status=a.coord_status,
            detail=dict(a.detail or {}),
        )
        for a in (await db.execute(alert_stmt)).scalars()
    ]

    return SpendSummary(
        currency="USD",
        view=view,
        from_=start,
        to=end,
        generated_at=now,
        vendors=summaries,
        series=series,
        totals=Totals(
            net_micros=sum(p.net_micros for p in series),
            partial=bool(unknown),
            unknown_vendors=unknown,
        ),
        alerts=alerts,
    )


class Renewal(BaseModel):
    id: str
    vendor_id: str
    vendor_name: str
    description: str
    external_ref: str | None
    renews_on: date
    amount_micros: int
    currency: str
    #: Whether the provider will renew it by itself — known only from a
    #: connector (Phase 9); ``null`` until one reports it.
    auto_renew: bool | None = None


async def build_renewals(
    db: AsyncSession, tenant_id: UUID, *, days: int, now: datetime
) -> list[Renewal]:
    """Annual charges falling within the next ``days`` days, soonest first."""
    today = now.astimezone(UTC).date()
    horizon = today + timedelta(days=days)
    result = await db.execute(
        select(RecurringCost, Vendor.name)
        .join(Vendor, Vendor.id == RecurringCost.vendor_id)
        .where(
            RecurringCost.tenant_id == tenant_id,
            RecurringCost.cadence == "annual",
        )
    )
    out: list[Renewal] = []
    for entry, vendor_name in result.all():
        nxt = next_charge_on(entry, today)
        if nxt is None or nxt > horizon:
            continue
        out.append(
            Renewal(
                id=str(entry.id),
                vendor_id=str(entry.vendor_id),
                vendor_name=vendor_name,
                description=entry.description,
                external_ref=entry.external_ref,
                renews_on=nxt,
                amount_micros=amount_micros(entry),
                currency=entry.currency,
            )
        )
    out.sort(key=lambda r: (r.renews_on, r.vendor_name, r.description))
    return out
