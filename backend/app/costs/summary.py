"""The costs read: ``GET /overview/costs/summary`` (authoring-layer Phase 5).

Business-leaders plan, Phase 4 "Costs": every figure in the project's BASE
currency, labour costed per ``labour_billing``, every conversion listed, and
the baseline estimate compared with what was actually spent.

What a figure is
================

**Actual cost = vendor costs + labour cost as the billing setting defines it**
(:mod:`app.costs.labour`). Vendor costs are the stored cost entries (connector
and manual; a multi-day manual entry spread per day under ``amortized``) plus
the recurring costs materialised on read (:mod:`app.spend.recurring`). Labour
is one series, ``labour``: priced effort under ``day_rates``, the ``labour``
cost entries under ``fixed_fee``, and nothing under ``unbilled``. A ``labour``
cost entry is counted in exactly one place — never in a vendor's bar AND the
labour line.

**Unknown is null with a reason, never 0.** Every figure is an
:class:`CostAmount`: ``micros`` (base-currency micros), ``partial`` and the list
of what it does not contain. A SERIES' figure over a window (one vendor, or
labour) is either known or unknown as a whole, the same rule the spend read
uses (:func:`app.spend.summary._window`):

* a connector vendor is unknown over a window holding a day no ok import
  fetched (a day nobody fetched is not $0) — yesterday and earlier must be
  fetched, today counts as far as it is;
* a vendor without a money connector is unknown until something is entered
  for it (no recurring cost and no manual entry: "not linked");
* an amount no FX rate converts (:mod:`app.costs.fx`) makes its series
  unknown — it is never converted 1:1;
* labour under ``day_rates`` is unknown where time was logged without a
  price, or where no time was logged at all ("not recorded" is not "free");
  under ``fixed_fee`` it follows the coverage of the vendors that bill it.

A figure over several series sums the known ones and is ``partial`` when any
is unknown, naming each; it is ``null`` only when no series is known.

Phase attribution
=================

A figure is attributed to a phase of the comparison estimate (``estimate_id``,
else the baseline) by the row's own ``phase_id`` when it names one of that
estimate's phases; a row naming a phase of ANOTHER estimate is unphased; a row
naming none is DERIVED from its day — the one phase whose span (actual dates
where recorded, else planned; a started, unfinished phase runs to today)
contains it, else unphased.
"""

from __future__ import annotations

import bisect
import calendar
from collections import defaultdict
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.costs.fx import FxApplied, FxBook, FxMissing
from app.costs.labour import (
    LABOUR_CATEGORY,
    EffortRow,
    effort_row,
    is_labour,
    labour_entries_count_as_cost,
)
from app.crud import overview_settings as settings_crud
from app.models.overview import (
    CostEntry,
    EffortEntry,
    Estimate,
    OverviewSettings,
    Phase,
    RecurringCost,
    SpendRule,
    Vendor,
)
from app.overview.estimates import load_estimate_graph
from app.services.overview_rollup import compute_rollup
from app.spend.connectors import connector_spec
from app.spend.freshness import Freshness, vendor_freshness
from app.spend.recurring import View, materialise
from app.spend.summary import entry_days, in_window, is_spread, not_spread

GroupBy = Literal["month", "vendor", "category", "phase"]

#: The series key of labour (vendor series are keyed by vendor id).
LABOUR = "labour"
#: The phase key of everything no phase of the estimate holds.
UNPHASED = "unphased"
#: The longest history a read loads. Older figures are not read, and every
#: all-time figure says so.
MAX_HISTORY_DAYS = 3700
#: A run rate annualises a trailing year.
RUN_RATE_DAYS = 365


# ---------------------------------------------------------------------------
# Wire shapes
# ---------------------------------------------------------------------------


class CostUnknown(BaseModel):
    """One part a figure does not contain, and why."""

    #: ``vendor`` — a vendor's figures; ``labour``; ``fx`` — an amount no rate
    #: converts; ``history`` — figures older than the read loads; ``nothing``
    #: — no source records costs at all.
    part: Literal["vendor", "labour", "fx", "history", "nothing"]
    #: The vendor id, the currency, or ``null``.
    key: str | None = None
    reason: str
    detail: str


class CostAmount(BaseModel):
    """A figure in the base currency. ``micros`` is ``null`` when nothing it
    covers is known; ``partial`` when some of it is not (``unknown`` names
    each part left out)."""

    micros: int | None
    partial: bool = False
    unknown: list[CostUnknown] = Field(default_factory=list)


class CostVendorRef(BaseModel):
    id: str
    name: str
    category: str
    connector: str | None
    #: ``ok|stale|failed|never|manual|not_linked`` — as the spend read says.
    status: str
    status_reason: str | None


class CostPhaseRef(BaseModel):
    id: str
    code: str
    name: str
    sort_order: int
    #: The span figures are derived into: actual dates where recorded, else
    #: planned. ``null`` ends mean the phase derives nothing.
    span_start: date | None
    span_end: date | None


class CostSeriesPoint(BaseModel):
    """One bar segment: ``series`` (a vendor id, or ``labour``) under ``key``
    (a ``YYYY-MM`` month, a vendor id, a category, or a phase id /
    ``unphased``)."""

    key: str
    series: str
    micros: int | None
    partial: bool
    unknown: list[CostUnknown]


class CostRunRate(BaseModel):
    """Trailing-twelve-month actual cost, annualised. With less history than a
    year, annualised from the days there are (``short_history``)."""

    annual_micros: int | None
    partial: bool
    unknown: list[CostUnknown]
    basis_from: date | None
    basis_to: date
    basis_days: int | None
    short_history: bool


class CostKpis(BaseModel):
    this_month: CostAmount
    last_month: CostAmount
    total_to_date: CostAmount
    run_rate: CostRunRate


class CostLimitLine(BaseModel):
    """The project's monthly spend limit — the org-wide spend rule's
    ``monthly_ceiling_micros`` — in the base currency. Its CURRENT value: a
    limit changed mid-history is drawn at today's figure."""

    rule_id: str
    monthly_micros: int | None
    rule_currency: str
    rule_micros: int
    #: The rate that converted it (``null`` when it is in the base currency
    #: or no rate converts it). Stated here rather than in ``fx.applied``,
    #: which counts the cost figures' conversions only.
    rate: Decimal | None = None
    rate_source: Literal["entry", "settings"] | None = None
    detail: str | None = None


class ExcludedLabourEntries(BaseModel):
    """``labour`` cost entries the billing setting leaves out of actual cost
    (under ``unbilled`` and ``day_rates``) — reported, never silently
    dropped."""

    rows: int
    base_micros: int | None
    detail: str


class LabourSummary(BaseModel):
    billing: Literal["unbilled", "day_rates", "fixed_fee"]
    #: ``not_billed`` — labour costs nothing here (the line reads "not
    #: billed", never a silent 0); ``day_rates``; ``fixed_fee``.
    status: Literal["not_billed", "day_rates", "fixed_fee"]
    detail: str
    #: Labour cost over the window; ``null`` under ``unbilled``.
    cost: CostAmount | None
    #: Time logged in the window. ``null`` when none was — "not recorded",
    #: never 0.
    hours: Decimal | None
    person_days: Decimal | None
    people: int | None
    #: ``day_rates``: entries in the window logged without a price.
    unpriced_entries: int
    excluded_cost_entries: ExcludedLabourEntries | None


class FxReport(BaseModel):
    """Every conversion this read applied, and every currency it could not
    convert. Covers every figure in the response (the all-time ones too)."""

    base_currency: str
    applied: list[FxApplied]
    missing: list[FxMissing]
    #: Settings rates that could not be read, by currency.
    unreadable: dict[str, str]


class CostEstimateFigure(BaseModel):
    """An estimated amount in the base currency: the primary tier, with the
    low–high band across tiers when the estimate has more than one."""

    micros: int | None
    low_micros: int | None
    high_micros: int | None


class CostPhaseEstimate(BaseModel):
    labour: CostEstimateFigure
    contingency: CostEstimateFigure
    #: Non-labour build items assigned to the phase: their low–high band.
    non_labour_low_micros: int | None
    non_labour_high_micros: int | None
    #: Labour + contingency + non-labour (low end for the primary figure).
    cost: CostEstimateFigure
    person_days: Decimal
    allocated_fte: Decimal
    planned_start: date | None
    planned_end: date | None


class CostPhaseActual(BaseModel):
    cost: CostAmount
    #: Logged hours ÷ hours per day; ``null`` — "not recorded".
    person_days: Decimal | None
    #: Distinct people who logged time; ``null`` — "not recorded".
    people: int | None
    actual_start: date | None
    actual_end: date | None
    #: First and last day any cost or time is attributed to it.
    first_activity: date | None
    last_activity: date | None


class CostPhaseComparison(BaseModel):
    phase_id: str
    code: str
    name: str
    sort_order: int
    estimate: CostPhaseEstimate
    actual: CostPhaseActual
    #: Estimate (primary) − actual, when both are known and the actual is not
    #: partial. Positive: below the estimate. The words for it come from the
    #: estimate's purpose (frontend ``vocabulary.ts``).
    difference_micros: int | None


class CostUnphasedActual(BaseModel):
    cost: CostAmount
    person_days: Decimal | None
    #: Non-labour build items the estimate assigns to no phase.
    estimate_non_labour_low_micros: int | None
    estimate_non_labour_high_micros: int | None


class RunCostLine(BaseModel):
    label: str
    run_model: str | None
    basis: str
    low_micros: int | None
    high_micros: int | None
    #: The line's own currency, before conversion.
    currency: str | None


class CostComparisonTotals(BaseModel):
    estimate: CostEstimateFigure
    actual: CostAmount
    difference_micros: int | None


class CostComparison(BaseModel):
    """The estimate beside what was actually spent. Actuals cover EVERY
    figure to date (``actual_from`` to ``actual_to``), not the summary
    window: an estimate is for the whole project."""

    estimate_id: str
    name: str
    purpose: Literal["budget", "comparison", "forecast"]
    status: str
    is_baseline: bool
    #: The currency the estimate is priced in, before conversion.
    estimate_currency: str | None
    contingency_pct: Decimal | None
    actual_from: date | None
    actual_to: date
    phases: list[CostPhaseComparison]
    unphased: CostUnphasedActual
    totals: CostComparisonTotals
    contingency: CostEstimateFigure
    non_labour_estimate_low_micros: int | None
    non_labour_estimate_high_micros: int | None
    #: Vendor costs to date (labour excluded) beside the non-labour estimate.
    non_labour_actual: CostAmount
    run_cost_lines: list[RunCostLine]
    run_rate: CostRunRate
    #: The estimate's own unavailable figures, as its rollup reports them.
    unavailable: list[dict[str, str]]


class CostsSummary(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    base_currency: str
    labour_billing: Literal["unbilled", "day_rates", "fixed_fee"]
    view: View
    group_by: GroupBy
    from_: date = Field(alias="from")
    to: date
    today: date
    generated_at: datetime
    #: The first day any cost or time is recorded; ``null`` — nothing is.
    data_from: date | None
    vendors: list[CostVendorRef]
    #: The phases figures are attributed to (the comparison estimate's).
    phases: list[CostPhaseRef]
    series: list[CostSeriesPoint]
    totals: CostAmount
    kpis: CostKpis
    limit: CostLimitLine | None
    labour: LabourSummary
    fx: FxReport
    comparison: CostComparison | None
    #: Why there is no comparison (no estimate yet), when there is none.
    comparison_unavailable: CostUnknown | None


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Part:
    """One day's figure of one series, converted to the base currency."""

    day: date
    series: str
    #: The vendor whose coverage decides whether the figure is known
    #: (``None`` for priced effort).
    vendor_id: UUID | None
    category: str
    phase_id: UUID | None
    #: ``None`` when it could not be converted (``missing`` says why).
    base: int | None
    currency: str
    product: str | None
    missing: Literal["fx", "unpriced"] | None = None


@dataclass
class Loaded:
    parts: list[Part]
    #: ``labour`` cost entries the billing setting leaves out.
    excluded_labour: list[Part]
    effort: list[EffortRow]


async def load_settings(db: AsyncSession, tenant_id: UUID) -> OverviewSettings:
    row = await settings_crud.get_settings(db, tenant_id=tenant_id)
    return row or settings_crud.default_settings_row(tenant_id)


async def load_parts(
    db: AsyncSession,
    tenant_id: UUID,
    vendors: dict[UUID, Vendor],
    start: date,
    end: date,
    view: View,
    settings: OverviewSettings,
    fx: FxBook,
) -> Loaded:
    """Every figure in ``[start, end]``, converted, classified vendor/labour.

    One-day cost entries are summed in SQL per (vendor, day, category, phase,
    currency, rate, product, source); spread manual entries and recurring
    costs are expanded here."""
    billing = settings.labour_billing
    parts: list[Part] = []
    excluded: list[Part] = []
    ids = list(vendors)

    def add(
        *,
        day: date,
        vendor_id: UUID,
        category: str | None,
        phase_id: UUID | None,
        micros: int,
        currency: str,
        rate: Decimal | None,
        product: str | None,
        rows: int,
    ) -> None:
        vendor = vendors[vendor_id]
        labour = is_labour(category, vendor.category)
        counted = not labour or labour_entries_count_as_cost(billing)
        base = fx.to_base(micros, currency, rate, rows=rows, record=True)
        part = Part(
            day=day,
            series=LABOUR if labour else str(vendor_id),
            vendor_id=vendor_id,
            category=LABOUR if labour else (category or vendor.category),
            phase_id=phase_id,
            base=base,
            currency=currency,
            product=product,
            missing="fx" if base is None else None,
        )
        (parts if counted else excluded).append(part)

    if ids:
        grouped = (
            select(
                CostEntry.vendor_id,
                CostEntry.period_start,
                CostEntry.category,
                CostEntry.phase_id,
                CostEntry.currency,
                CostEntry.fx_rate_to_base,
                CostEntry.product,
                func.sum(CostEntry.amount_micros),
                func.count(),
            )
            .where(
                CostEntry.tenant_id == tenant_id,
                CostEntry.vendor_id.in_(ids),
                CostEntry.period_start >= start,
                CostEntry.period_start <= end,
                not_spread(),
            )
            .group_by(
                CostEntry.vendor_id,
                CostEntry.period_start,
                CostEntry.category,
                CostEntry.phase_id,
                CostEntry.currency,
                CostEntry.fx_rate_to_base,
                CostEntry.product,
            )
        )
        for vid, day, cat, phase, cur, rate, product, net, n in (
            await db.execute(grouped)
        ).all():
            add(
                day=day,
                vendor_id=vid,
                category=cat,
                phase_id=phase,
                micros=int(net),
                currency=cur,
                rate=rate,
                product=product,
                rows=int(n),
            )
        spread_entries = (
            await db.execute(
                select(CostEntry).where(
                    CostEntry.tenant_id == tenant_id,
                    CostEntry.vendor_id.in_(ids),
                    is_spread(),
                    in_window(start, end),
                )
            )
        ).scalars()
        for e in spread_entries:
            for day, micros in entry_days(e, start, end, view):
                add(
                    day=day,
                    vendor_id=e.vendor_id,
                    category=e.category,
                    phase_id=e.phase_id,
                    micros=micros,
                    currency=e.currency,
                    rate=e.fx_rate_to_base,
                    product=e.product,
                    rows=1,
                )
        recurring = (
            await db.execute(
                select(RecurringCost).where(
                    RecurringCost.tenant_id == tenant_id,
                    RecurringCost.vendor_id.in_(ids),
                )
            )
        ).scalars()
        for r in recurring:
            for piece in materialise(r, start, end, view):
                add(
                    day=piece.day,
                    vendor_id=r.vendor_id,
                    category=None,
                    phase_id=None,
                    micros=piece.micros,
                    currency=r.currency,
                    rate=None,
                    product=None,
                    rows=1,
                )

    effort = [
        effort_row(e, Decimal(settings.hours_per_day))
        for e in (
            await db.execute(
                select(EffortEntry).where(
                    EffortEntry.tenant_id == tenant_id,
                    EffortEntry.work_date >= start,
                    EffortEntry.work_date <= end,
                )
            )
        ).scalars()
    ]
    if billing == "day_rates":
        for row in effort:
            base: int | None = None
            missing: Literal["fx", "unpriced"] | None = "unpriced"
            if row.cost_micros is not None and row.currency is not None:
                base = fx.to_base(row.cost_micros, row.currency, record=True)
                missing = None if base is not None else "fx"
            parts.append(
                Part(
                    day=row.day,
                    series=LABOUR,
                    vendor_id=None,
                    category=LABOUR_CATEGORY,
                    phase_id=row.phase_id,
                    base=base,
                    currency=row.currency or "",
                    product=None,
                    missing=missing,
                )
            )
    return Loaded(parts=parts, excluded_labour=excluded, effort=effort)


async def first_recorded_day(db: AsyncSession, tenant_id: UUID) -> date | None:
    """The first day any cost or time is recorded for the project."""
    candidates = [
        await db.scalar(
            select(func.min(CostEntry.period_start)).where(
                CostEntry.tenant_id == tenant_id
            )
        ),
        await db.scalar(
            select(func.min(RecurringCost.start_date)).where(
                RecurringCost.tenant_id == tenant_id
            )
        ),
        await db.scalar(
            select(func.min(EffortEntry.work_date)).where(
                EffortEntry.tenant_id == tenant_id
            )
        ),
    ]
    found = [c for c in candidates if c is not None]
    return min(found) if found else None


# ---------------------------------------------------------------------------
# Phase attribution
# ---------------------------------------------------------------------------


def phase_span(phase: Phase, today: date) -> tuple[date | None, date | None]:
    start = phase.actual_start or phase.planned_start
    if phase.actual_end is not None:
        end: date | None = phase.actual_end
    elif phase.actual_start is not None:
        # Started and not finished: it is still running.
        end = max(phase.planned_end or today, today)
    else:
        end = phase.planned_end
    return start, end


@dataclass
class PhaseIndex:
    phases: list[Phase]
    today: date
    _spans: list[tuple[UUID, date, date]] = field(default_factory=list)
    _cache: dict[date, str] = field(default_factory=dict)
    ids: set[UUID] = field(default_factory=set)

    def __post_init__(self) -> None:
        for p in self.phases:
            start, end = phase_span(p, self.today)
            if start is not None and end is not None and start <= end:
                self._spans.append((p.id, start, end))
        self.ids = {p.id for p in self.phases}

    def of_day(self, day: date) -> str:
        cached = self._cache.get(day)
        if cached is not None:
            return cached
        hits = [pid for pid, lo, hi in self._spans if lo <= day <= hi]
        key = str(hits[0]) if len(hits) == 1 else UNPHASED
        self._cache[day] = key
        return key

    def attribute(self, day: date, phase_id: UUID | None) -> str:
        if phase_id is not None:
            return str(phase_id) if phase_id in self.ids else UNPHASED
        return self.of_day(day)


# ---------------------------------------------------------------------------
# The engine: figures over windows
# ---------------------------------------------------------------------------


def _days(lo: date, hi: date) -> Iterable[date]:
    day = lo
    while day <= hi:
        yield day
        day += timedelta(days=1)


@dataclass
class Coverage:
    """When a vendor's figures are unknown."""

    #: Every day unknown (``None`` when nothing is: a known manual vendor).
    days: list[date] | None
    reason: str
    detail: str
    #: UNKNOWN over ANY window (a vendor with nothing entered).
    always: bool = False


class Book:
    """The loaded figures, and every figure the response derives from them."""

    def __init__(
        self,
        *,
        loaded: Loaded,
        vendors: dict[UUID, Vendor],
        coverage: dict[UUID, Coverage],
        billing: str,
        phases: PhaseIndex,
        today: date,
    ) -> None:
        self.vendors = vendors
        self.coverage = coverage
        self.billing = billing
        self.phases = phases
        self.today = today
        self.parts_by_day: dict[date, list[Part]] = defaultdict(list)
        for part in loaded.parts:
            self.parts_by_day[part.day].append(part)
        self.effort = loaded.effort
        self.excluded = loaded.excluded_labour
        #: Vendors that bill labour: a ``labour`` vendor, or one with a
        #: ``labour`` entry. Their coverage is labour's under ``fixed_fee``.
        self.labour_vendors = {
            v.id for v in vendors.values() if v.category == LABOUR_CATEGORY
        } | {p.vendor_id for p in loaded.parts if p.series == LABOUR and p.vendor_id}
        self.vendor_categories: dict[UUID, set[str]] = defaultdict(set)
        for v in vendors.values():
            self.vendor_categories[v.id].add(v.category)
        for p in loaded.parts:
            if p.vendor_id is not None and p.series != LABOUR:
                self.vendor_categories[p.vendor_id].add(p.category)

    # -- which series a figure covers ------------------------------------

    @property
    def labour_billed(self) -> bool:
        return self.billing in ("day_rates", "fixed_fee")

    def all_series(self) -> list[str]:
        keys = [
            str(v) for v in sorted(self.vendors, key=lambda i: self.vendors[i].name)
        ]
        if self.labour_billed:
            keys.append(LABOUR)
        return keys

    def series_for_category(self, category: str) -> list[str]:
        keys = [
            str(vid)
            for vid in sorted(self.vendors, key=lambda i: self.vendors[i].name)
            if category in self.vendor_categories[vid]
        ]
        if category == LABOUR_CATEGORY and self.labour_billed:
            keys.append(LABOUR)
        return keys

    def categories(self) -> list[str]:
        out: set[str] = set()
        for cats in self.vendor_categories.values():
            out |= cats
        if self.labour_billed:
            out.add(LABOUR_CATEGORY)
        return sorted(out)

    # -- coverage ----------------------------------------------------------

    def _vendor_unknown(
        self, vid: UUID, lo: date, hi: date, day_ok: Callable[[date], bool] | None
    ) -> CostUnknown | None:
        cov = self.coverage.get(vid)
        if cov is None:
            return None
        vendor = self.vendors[vid]
        hit = cov.always
        if not hit and cov.days:
            start = bisect.bisect_left(cov.days, lo)
            stop = bisect.bisect_right(cov.days, hi)
            hit = any(day_ok is None or day_ok(d) for d in cov.days[start:stop])
        if not hit:
            return None
        return CostUnknown(
            part="vendor",
            key=str(vid),
            reason=cov.reason,
            detail=f"{vendor.name}: {cov.detail}",
        )

    def _labour_unknown(
        self,
        lo: date,
        hi: date,
        part_ok: Callable[[Part], bool] | None,
        day_ok: Callable[[date], bool] | None,
        matched: list[Part],
    ) -> list[CostUnknown]:
        if self.billing == "day_rates":
            if not matched:
                return [
                    CostUnknown(
                        part="labour",
                        reason="effort_not_recorded",
                        detail=(
                            "Labour is billed by day rate and no time is logged "
                            "here, so its cost is not known (not zero)."
                        ),
                    )
                ]
            unpriced = sum(1 for p in matched if p.missing == "unpriced")
            if unpriced:
                return [
                    CostUnknown(
                        part="labour",
                        reason="effort_not_priced",
                        detail=(
                            f"{unpriced} time entr{'y' if unpriced == 1 else 'ies'} "
                            "carry no day rate (logged before day rates applied, or "
                            "without a role); edit them to price them."
                        ),
                    )
                ]
            return []
        if self.billing == "fixed_fee":
            if not self.labour_vendors:
                return [
                    CostUnknown(
                        part="labour",
                        reason="no_fee_entries",
                        detail=(
                            "Labour is billed as a fixed fee, and no labour vendor "
                            "or labour cost entry exists to record it."
                        ),
                    )
                ]
            out: list[CostUnknown] = []
            for vid in sorted(self.labour_vendors, key=str):
                unknown = self._vendor_unknown(vid, lo, hi, day_ok)
                if unknown is not None:
                    out.append(unknown.model_copy(update={"part": "labour"}))
            return out
        return []

    def figure(
        self,
        lo: date,
        hi: date,
        series: list[str],
        *,
        part_ok: Callable[[Part], bool] | None = None,
        day_ok: Callable[[date], bool] | None = None,
    ) -> CostAmount:
        """The figure over ``[lo, hi]`` for ``series``: each series known or
        unknown as a whole; known ones summed."""
        if not series:
            return CostAmount(
                micros=None,
                unknown=[
                    CostUnknown(
                        part="nothing",
                        reason="no_sources",
                        detail=(
                            "Nothing records costs here: no vendor, and labour is "
                            "not billed."
                        ),
                    )
                ],
            )
        wanted = set(series)
        matched: dict[str, list[Part]] = defaultdict(list)
        if hi >= lo:
            for day in _days(lo, hi):
                for part in self.parts_by_day.get(day, ()):
                    if part.series in wanted and (part_ok is None or part_ok(part)):
                        matched[part.series].append(part)
        total = 0
        known = 0
        unknown: list[CostUnknown] = []
        for key in series:
            got = matched.get(key, [])
            if key == LABOUR:
                problems = self._labour_unknown(lo, hi, part_ok, day_ok, got)
            else:
                vendor_problem = self._vendor_unknown(UUID(key), lo, hi, day_ok)
                problems = [vendor_problem] if vendor_problem else []
            currencies = sorted({p.currency for p in got if p.missing == "fx"})
            for cur in currencies:
                problems.append(
                    CostUnknown(
                        part="fx",
                        key=cur,
                        reason="fx_missing",
                        detail=(
                            f"{self._series_name(key)} has amounts in {cur} that no "
                            "rate converts to the base currency."
                        ),
                    )
                )
            if problems:
                unknown.extend(problems)
                continue
            total += sum(p.base or 0 for p in got)
            known += 1
        if known == 0:
            return CostAmount(micros=None, partial=False, unknown=unknown)
        return CostAmount(micros=total, partial=bool(unknown), unknown=unknown)

    def _series_name(self, key: str) -> str:
        if key == LABOUR:
            return "Labour"
        return self.vendors[UUID(key)].name

    # -- effort --------------------------------------------------------------

    def effort_in(
        self, lo: date, hi: date, phase_key: str | None = None
    ) -> list[EffortRow]:
        return [
            e
            for e in self.effort
            if lo <= e.day <= hi
            and (
                phase_key is None
                or self.phases.attribute(e.day, e.phase_id) == phase_key
            )
        ]


def _q2(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def person_days(rows: list[EffortRow]) -> Decimal | None:
    if not rows:
        return None
    return _q2(sum((r.hours / r.hours_per_day for r in rows), Decimal("0")))


def month_bounds(day: date) -> tuple[date, date]:
    return day.replace(day=1), day.replace(
        day=calendar.monthrange(day.year, day.month)[1]
    )


def _coverage(
    vendors: list[Vendor],
    fresh: dict[UUID, Freshness],
    with_entries: set[UUID],
    start: date,
    today: date,
) -> dict[UUID, Coverage]:
    """When each vendor's figures are unknown, over ``[start, today]``."""
    out: dict[UUID, Coverage] = {}
    for vendor in vendors:
        spec = connector_spec(vendor.connector)
        if spec is None or not spec.produces_money:
            if vendor.id not in with_entries:
                out[vendor.id] = Coverage(
                    days=None,
                    reason="not_linked",
                    detail="no recurring cost and no cost entry is entered",
                    always=True,
                )
            continue
        f = fresh[vendor.id]
        # Yesterday and earlier must have been fetched; today counts as far
        # as it has been (the spend read's rule).
        last = today - timedelta(days=1)
        missing = [d for d in _days(start, last) if d not in f.covered_days]
        if missing:
            out[vendor.id] = Coverage(
                days=missing,
                reason="not_fetched" if f.status != "never" else "never_imported",
                detail=(
                    "no import has run"
                    if f.status == "never"
                    else f"{len(missing)} day(s) here were never fetched "
                    f"(first {missing[0].isoformat()}); a day nobody fetched is "
                    "not $0"
                ),
            )
    return out


async def _with_entries(db: AsyncSession, tenant_id: UUID) -> set[UUID]:
    manual = set(
        (
            await db.execute(
                select(CostEntry.vendor_id)
                .where(CostEntry.tenant_id == tenant_id, CostEntry.source == "manual")
                .distinct()
            )
        ).scalars()
    )
    recurring = set(
        (
            await db.execute(
                select(RecurringCost.vendor_id)
                .where(RecurringCost.tenant_id == tenant_id)
                .distinct()
            )
        ).scalars()
    )
    return manual | recurring


# ---------------------------------------------------------------------------
# Building the response
# ---------------------------------------------------------------------------


def _months(lo: date, hi: date) -> list[tuple[str, date, date]]:
    out: list[tuple[str, date, date]] = []
    first, _ = month_bounds(lo)
    current = first
    while current <= hi:
        start, end = month_bounds(current)
        out.append((current.strftime("%Y-%m"), max(start, lo), min(end, hi)))
        current = end + timedelta(days=1)
    return out


def _point(key: str, series: str, amount: CostAmount) -> CostSeriesPoint:
    return CostSeriesPoint(
        key=key,
        series=series,
        micros=amount.micros,
        partial=amount.partial,
        unknown=amount.unknown,
    )


def _series(book: Book, lo: date, hi: date, group_by: GroupBy) -> list[CostSeriesPoint]:
    points: list[CostSeriesPoint] = []
    if group_by == "month":
        for key, m_lo, m_hi in _months(lo, hi):
            for s in book.all_series():
                points.append(_point(key, s, book.figure(m_lo, m_hi, [s])))
    elif group_by == "vendor":
        for s in book.all_series():
            points.append(_point(s, s, book.figure(lo, hi, [s])))
    elif group_by == "category":
        for cat in book.categories():
            for s in book.series_for_category(cat):
                points.append(
                    _point(
                        cat,
                        s,
                        book.figure(
                            lo,
                            hi,
                            [s],
                            part_ok=lambda p, c=cat: p.category == c,  # type: ignore[misc]
                        ),
                    )
                )
    else:
        keys = [str(p.id) for p in book.phases.phases] + [UNPHASED]
        for key in keys:
            for s in book.all_series():
                points.append(
                    _point(
                        key,
                        s,
                        book.figure(
                            lo,
                            hi,
                            [s],
                            part_ok=lambda p, k=key: (  # type: ignore[misc]
                                book.phases.attribute(p.day, p.phase_id) == k
                            ),
                            day_ok=lambda d, k=key: book.phases.of_day(d) == k,  # type: ignore[misc]
                        ),
                    )
                )
    return points


def _run_rate(book: Book, data_from: date | None, today: date) -> CostRunRate:
    if data_from is None or data_from > today:
        return CostRunRate(
            annual_micros=None,
            partial=False,
            unknown=[
                CostUnknown(
                    part="nothing",
                    reason="nothing_recorded",
                    detail="No cost is recorded yet.",
                )
            ],
            basis_from=None,
            basis_to=today,
            basis_days=None,
            short_history=False,
        )
    lo = max(data_from, today - timedelta(days=RUN_RATE_DAYS - 1))
    days = (today - lo).days + 1
    amount = book.figure(lo, today, book.all_series())
    annual = (
        int(
            (Decimal(amount.micros) * RUN_RATE_DAYS / Decimal(days)).quantize(
                Decimal(1), rounding=ROUND_HALF_UP
            )
        )
        if amount.micros is not None
        else None
    )
    return CostRunRate(
        annual_micros=annual,
        partial=amount.partial,
        unknown=amount.unknown,
        basis_from=lo,
        basis_to=today,
        basis_days=days,
        short_history=days < RUN_RATE_DAYS,
    )


def _labour_summary(
    book: Book, lo: date, hi: date, settings: OverviewSettings
) -> LabourSummary:
    billing = settings.labour_billing
    effort = book.effort_in(lo, hi)
    hours = _q2(sum((e.hours for e in effort), Decimal("0"))) if effort else None
    excluded = [p for p in book.excluded if lo <= p.day <= hi]
    excluded_report: ExcludedLabourEntries | None = None
    if excluded:
        base = (
            None
            if any(p.base is None for p in excluded)
            else sum(p.base or 0 for p in excluded)
        )
        excluded_report = ExcludedLabourEntries(
            rows=len(excluded),
            base_micros=base,
            detail=(
                "Labour cost entries are not part of actual cost here: labour is "
                + (
                    "not billed on this project."
                    if billing == "unbilled"
                    else "priced from logged time, and counting these as well "
                    "would count the same work twice."
                )
            ),
        )
    if billing == "unbilled":
        status: Literal["not_billed", "day_rates", "fixed_fee"] = "not_billed"
        detail = (
            "Labour is not billed on this project: logged time is recorded, "
            "and carries no cost."
        )
        cost = None
    elif billing == "day_rates":
        status = "day_rates"
        detail = (
            "Labour is billed by day rate: each logged entry × the rate of its "
            "role when it was logged."
        )
        cost = book.figure(lo, hi, [LABOUR])
    else:
        status = "fixed_fee"
        detail = (
            "Labour is billed as a fixed fee: the labour cost entries (fee "
            "instalments) are its cost; logged time carries none."
        )
        cost = book.figure(lo, hi, [LABOUR])
    return LabourSummary(
        billing=billing,  # type: ignore[arg-type]
        status=status,
        detail=detail,
        cost=cost,
        hours=hours,
        person_days=person_days(effort),
        people=len({e.person_key for e in effort}) if effort else None,
        unpriced_entries=(
            sum(1 for e in effort if e.cost_micros is None)
            if billing == "day_rates"
            else 0
        ),
        excluded_cost_entries=excluded_report,
    )


async def _limit(db: AsyncSession, tenant_id: UUID, fx: FxBook) -> CostLimitLine | None:
    rule = (
        (
            await db.execute(
                select(SpendRule).where(
                    SpendRule.tenant_id == tenant_id, SpendRule.vendor_id.is_(None)
                )
            )
        )
        .scalars()
        .first()
    )
    if rule is None or rule.monthly_ceiling_micros is None:
        return None
    converted = fx.to_base(rule.monthly_ceiling_micros, rule.currency, record=False)
    found = fx.rate_for(rule.currency) if rule.currency != fx.base_currency else None
    return CostLimitLine(
        rule_id=str(rule.id),
        monthly_micros=converted,
        rule_currency=rule.currency,
        rule_micros=rule.monthly_ceiling_micros,
        rate=found[0] if found else None,
        rate_source=found[1] if found else None,
        detail=(
            None
            if converted is not None
            else f"The limit is in {rule.currency} and no rate converts it to "
            f"{fx.base_currency}."
        ),
    )


# -- the estimate comparison ---------------------------------------------------


def _conv(fx: FxBook, micros: int | None, currency: str | None) -> int | None:
    if micros is None or currency is None:
        return None
    return fx.to_base(micros, currency, record=True)


def _band(values: list[int | None]) -> tuple[int | None, int | None]:
    if not values or any(v is None for v in values):
        return None, None
    known = [v for v in values if v is not None]
    return min(known), max(known)


def _sum_lines(
    fx: FxBook, lines: list[dict[str, Any]]
) -> tuple[int | None, int | None]:
    """A set of cost lines in the base currency: (low, high). A line with no
    low end has no lower bound, so the band is withdrawn (the rollup's rule)."""
    priced = [
        ln
        for ln in lines
        if ln["low_micros"] is not None or ln["high_micros"] is not None
    ]
    if not priced:
        return 0, 0
    low = 0
    high = 0
    for ln in priced:
        if ln["low_micros"] is None:
            return None, None
        lo_b = _conv(fx, ln["low_micros"], ln["currency"])
        hi_b = _conv(
            fx,
            ln["high_micros"] if ln["high_micros"] is not None else ln["low_micros"],
            ln["currency"],
        )
        if lo_b is None or hi_b is None:
            return None, None
        low += lo_b
        high += hi_b
    return low, high


def _add(*values: int | None) -> int | None:
    if any(v is None for v in values):
        return None
    return sum(v for v in values if v is not None)


def _difference(estimate: int | None, actual: CostAmount) -> int | None:
    if estimate is None or actual.micros is None or actual.partial:
        return None
    return estimate - actual.micros


def _comparison(
    *,
    estimate: Estimate,
    settings: OverviewSettings,
    book: Book,
    fx: FxBook,
    data_from: date | None,
    today: date,
    run_rate: CostRunRate,
    now: datetime,
) -> CostComparison:
    rollup = compute_rollup(estimate, settings, generated_at=now)
    money = rollup["money"]
    est_currency: str | None = money["currency"]
    pct: Decimal | None = money["contingency_pct"]
    tier_keys = [str(t["id"]) if t["id"] else "" for t in money["tiers"]]
    primary_id = money["primary_tier_id"]
    primary_key = str(primary_id) if primary_id else ""
    many = len(tier_keys) > 1

    def contingency(labour: int | None) -> int | None:
        """Contingency is a percentage OF THE LABOUR FEES (the rollup's
        ``contingency_basis``), rounded once, in the estimate's currency."""
        if labour is None or pct is None:
            return None
        return int(
            (Decimal(labour) * pct / Decimal(100)).quantize(
                Decimal(1), rounding=ROUND_HALF_UP
            )
        )

    def tiered(values: dict[str, int | None], served: bool) -> CostEstimateFigure:
        low, high = _band(list(values.values()))
        return CostEstimateFigure(
            micros=values.get(primary_key),
            low_micros=low if served and many else None,
            high_micros=high if served and many else None,
        )

    build_lines = money["build_non_labour"]["lines"]
    phase_ids = {p.id for p in book.phases.phases}
    lo = data_from or today
    series = book.all_series()

    rows: list[CostPhaseComparison] = []
    # Per tier, in the base currency: Σ over phases of labour + contingency.
    tier_totals: dict[str, int | None] = dict.fromkeys(tier_keys, 0)
    contingency_totals: dict[str, int | None] = dict.fromkeys(tier_keys, 0)
    for ph in rollup["phases"]:
        key = str(ph["id"])
        fees = ph["fees_micros"]
        labour = {
            k: _conv(fx, fees.get(k) if fees is not None else None, est_currency)
            for k in tier_keys
        }
        cont = {
            k: _conv(
                fx,
                contingency(fees.get(k) if fees is not None else None),
                est_currency,
            )
            for k in tier_keys
        }
        # A missing contingency PERCENTAGE is "no contingency", which adds
        # nothing; a missing FEE is unknown and withdraws the cost.
        with_cont = {
            k: _add(labour[k], cont[k] if pct is not None else 0) for k in tier_keys
        }
        nl_low, nl_high = _sum_lines(
            fx, [ln for ln in build_lines if ln["phase_id"] == ph["id"]]
        )
        cost_low, cost_high = _band(list(with_cont.values()))
        for k in tier_keys:
            tier_totals[k] = _add(tier_totals[k], with_cont[k])
            contingency_totals[k] = _add(
                contingency_totals[k], cont[k] if pct is not None else 0
            )
        cost_primary = _add(with_cont.get(primary_key), nl_low)
        actual = _phase_actual(book, key, lo, today, series, ph, data_from is None)
        rows.append(
            CostPhaseComparison(
                phase_id=key,
                code=ph["code"],
                name=ph["name"],
                sort_order=ph["sort_order"],
                estimate=CostPhaseEstimate(
                    labour=tiered(labour, served=True),
                    contingency=(
                        tiered(cont, served=True)
                        if pct is not None
                        else CostEstimateFigure(
                            micros=None, low_micros=None, high_micros=None
                        )
                    ),
                    non_labour_low_micros=nl_low,
                    non_labour_high_micros=nl_high,
                    cost=CostEstimateFigure(
                        micros=cost_primary,
                        low_micros=_add(cost_low, nl_low),
                        high_micros=_add(cost_high, nl_high),
                    ),
                    person_days=ph["person_days"],
                    allocated_fte=ph["allocated_fte"],
                    planned_start=ph["planned_start"],
                    planned_end=ph["planned_end"],
                ),
                actual=actual,
                difference_micros=_difference(cost_primary, actual.cost),
            )
        )

    unassigned = [
        ln
        for ln in build_lines
        if ln["phase_id"] is None or ln["phase_id"] not in phase_ids
    ]
    un_low, un_high = _sum_lines(fx, unassigned)
    all_low, all_high = _sum_lines(fx, build_lines)
    total_low, total_high = _band(list(tier_totals.values()))
    estimate_total = _add(tier_totals.get(primary_key), all_low)

    if data_from is None:
        unphased_cost = _nothing_recorded()
        actual_total = _nothing_recorded()
        non_labour_actual = _nothing_recorded()
    else:
        unphased_cost = book.figure(
            lo,
            today,
            series,
            part_ok=lambda p: book.phases.attribute(p.day, p.phase_id) == UNPHASED,
            day_ok=lambda d: book.phases.of_day(d) == UNPHASED,
        )
        actual_total = book.figure(lo, today, series)
        non_labour_actual = book.figure(lo, today, [s for s in series if s != LABOUR])
    return CostComparison(
        estimate_id=str(estimate.id),
        name=estimate.name,
        purpose=estimate.purpose,  # type: ignore[arg-type]
        status=estimate.status,
        is_baseline=estimate.is_baseline,
        estimate_currency=est_currency,
        contingency_pct=pct,
        actual_from=data_from,
        actual_to=today,
        phases=rows,
        unphased=CostUnphasedActual(
            cost=unphased_cost,
            person_days=person_days(book.effort_in(lo, today, UNPHASED)),
            estimate_non_labour_low_micros=un_low,
            estimate_non_labour_high_micros=un_high,
        ),
        totals=CostComparisonTotals(
            estimate=CostEstimateFigure(
                micros=estimate_total,
                low_micros=_add(total_low, all_low),
                high_micros=_add(total_high, all_high),
            ),
            actual=actual_total,
            difference_micros=_difference(estimate_total, actual_total),
        ),
        contingency=(
            tiered(contingency_totals, served=True)
            if pct is not None
            else CostEstimateFigure(micros=None, low_micros=None, high_micros=None)
        ),
        non_labour_estimate_low_micros=all_low,
        non_labour_estimate_high_micros=all_high,
        non_labour_actual=non_labour_actual,
        run_cost_lines=[
            RunCostLine(
                label=ln["label"],
                run_model=ln["run_model"],
                basis=ln["basis"],
                low_micros=_conv(fx, ln["low_micros"], ln["currency"]),
                high_micros=_conv(fx, ln["high_micros"], ln["currency"]),
                currency=ln["currency"],
            )
            for ln in money["run_annual"]["lines"]
        ],
        run_rate=run_rate,
        unavailable=[dict(u) for u in rollup["unavailable"]],
    )


def _nothing_recorded() -> CostAmount:
    return CostAmount(
        micros=None,
        unknown=[
            CostUnknown(
                part="nothing",
                reason="nothing_recorded",
                detail="No cost is recorded yet.",
            )
        ],
    )


def _phase_actual(
    book: Book,
    key: str,
    lo: date,
    today: date,
    series: list[str],
    ph: dict[str, Any],
    nothing_recorded: bool,
) -> CostPhaseActual:
    effort = book.effort_in(lo, today, key)
    cost = (
        _nothing_recorded()
        if nothing_recorded
        else book.figure(
            lo,
            today,
            series,
            part_ok=lambda p: book.phases.attribute(p.day, p.phase_id) == key,
            day_ok=lambda d: book.phases.of_day(d) == key,
        )
    )
    days = [
        p.day
        for d in _days(lo, today)
        for p in book.parts_by_day.get(d, ())
        if book.phases.attribute(p.day, p.phase_id) == key
    ] + [e.day for e in effort]
    return CostPhaseActual(
        cost=cost,
        person_days=person_days(effort),
        people=len({e.person_key for e in effort}) if effort else None,
        actual_start=ph["actual_start"],
        actual_end=ph["actual_end"],
        first_activity=min(days) if days else None,
        last_activity=max(days) if days else None,
    )


async def _comparison_estimate(
    db: AsyncSession, tenant_id: UUID, estimate_id: UUID | None
) -> Estimate | None:
    if estimate_id is None:
        estimate_id = await db.scalar(
            select(Estimate.id).where(
                Estimate.tenant_id == tenant_id, Estimate.is_baseline.is_(True)
            )
        )
        if estimate_id is None:
            return None
    return await load_estimate_graph(db, tenant_id=tenant_id, estimate_id=estimate_id)


class EstimateNotFound(Exception):
    """``estimate_id`` names no estimate of this project."""


async def build_costs_summary(
    db: AsyncSession,
    tenant_id: UUID,
    *,
    start: date,
    end: date,
    group_by: GroupBy,
    view: View,
    estimate_id: UUID | None,
    now: datetime,
) -> CostsSummary:
    today = now.astimezone(UTC).date()
    settings = await load_settings(db, tenant_id)
    fx = FxBook.for_settings(settings.base_currency, settings.fx_rates)
    vendor_rows = list(
        (
            await db.execute(
                select(Vendor)
                .where(Vendor.tenant_id == tenant_id)
                .order_by(Vendor.name)
            )
        ).scalars()
    )
    vendors = {v.id: v for v in vendor_rows}

    data_from = await first_recorded_day(db, tenant_id)
    month_start, _ = month_bounds(today)
    last_start, last_end = month_bounds(month_start - timedelta(days=1))
    hi = max(end, today)
    # The window, last month (a KPI) and every recorded day (the all-time
    # figures and the comparison).
    lo = min(start, last_start, data_from or start)
    history_cut: date | None = None
    if (hi - lo).days > MAX_HISTORY_DAYS:
        history_cut = hi - timedelta(days=MAX_HISTORY_DAYS)
        lo = max(lo, history_cut)

    estimate = await _comparison_estimate(db, tenant_id, estimate_id)
    if estimate_id is not None and estimate is None:
        raise EstimateNotFound(str(estimate_id))
    phases = sorted(
        estimate.phases if estimate is not None else [],
        key=lambda p: (p.sort_order, p.code),
    )
    phase_index = PhaseIndex(phases=phases, today=today)

    loaded = await load_parts(db, tenant_id, vendors, lo, hi, view, settings, fx)
    fresh = await vendor_freshness(db, tenant_id, vendor_rows, now, since=lo)
    coverage = _coverage(
        vendor_rows, fresh, await _with_entries(db, tenant_id), lo, today
    )
    book = Book(
        loaded=loaded,
        vendors=vendors,
        coverage=coverage,
        billing=settings.labour_billing,
        phases=phase_index,
        today=today,
    )

    series_all = book.all_series()
    if data_from is None:
        total_to_date = _nothing_recorded()
    else:
        total_to_date = book.figure(max(data_from, lo), today, series_all)
        if history_cut is not None and data_from < history_cut:
            total_to_date = total_to_date.model_copy(
                update={
                    "partial": True,
                    "unknown": [
                        *total_to_date.unknown,
                        CostUnknown(
                            part="history",
                            reason="history_not_read",
                            detail=(
                                f"Figures before {history_cut.isoformat()} are "
                                "older than this read loads."
                            ),
                        ),
                    ],
                }
            )
    run_rate = _run_rate(book, max(data_from, lo) if data_from else None, today)

    comparison: CostComparison | None = None
    comparison_unavailable: CostUnknown | None = None
    if estimate is None:
        comparison_unavailable = CostUnknown(
            part="nothing",
            reason="no_estimate",
            detail=(
                "There is no estimate to compare with yet. Create one (and mark it "
                "the baseline) on the Estimate page."
            ),
        )
    else:
        comparison = _comparison(
            estimate=estimate,
            settings=settings,
            book=book,
            fx=fx,
            data_from=max(data_from, lo) if data_from else None,
            today=today,
            run_rate=run_rate,
            now=now,
        )

    vendor_refs = []
    for v in vendor_rows:
        f = fresh[v.id]
        cov = coverage.get(v.id)
        spec = connector_spec(v.connector)
        if cov is not None and cov.always:
            status, reason = "not_linked", cov.detail
        elif spec is None or not spec.produces_money:
            status, reason = "manual", None
        else:
            status, reason = f.status, f.reason
        vendor_refs.append(
            CostVendorRef(
                id=str(v.id),
                name=v.name,
                category=v.category,
                connector=v.connector,
                status=status,
                status_reason=reason,
            )
        )

    return CostsSummary(
        base_currency=settings.base_currency,
        labour_billing=settings.labour_billing,  # type: ignore[arg-type]
        view=view,
        group_by=group_by,
        **{"from": start},
        to=end,
        today=today,
        generated_at=now,
        data_from=data_from,
        vendors=vendor_refs,
        phases=[
            CostPhaseRef(
                id=str(p.id),
                code=p.code,
                name=p.name,
                sort_order=p.sort_order,
                span_start=phase_span(p, today)[0],
                span_end=phase_span(p, today)[1],
            )
            for p in phases
        ],
        series=_series(book, start, end, group_by),
        totals=book.figure(start, end, series_all),
        kpis=CostKpis(
            this_month=book.figure(month_start, today, series_all),
            last_month=book.figure(last_start, last_end, series_all),
            total_to_date=total_to_date,
            run_rate=run_rate,
        ),
        limit=await _limit(db, tenant_id, fx),
        labour=_labour_summary(book, start, end, settings),
        fx=FxReport(
            base_currency=fx.base_currency,
            applied=fx.applied(),
            missing=fx.missing(),
            unreadable=fx.unreadable,
        ),
        comparison=comparison,
        comparison_unavailable=comparison_unavailable,
    )


# ---------------------------------------------------------------------------
# The org-wide spend limit's month to date (``app.spend.evaluate``)
# ---------------------------------------------------------------------------


@dataclass
class MonthToDate:
    """Actual cost this month in the base currency, as the costs summary
    defines it, or the reasons it cannot be summed."""

    base_currency: str
    micros: int
    unknown: list[str]
    fx: FxBook


async def month_to_date(
    db: AsyncSession,
    tenant_id: UUID,
    today: date,
    *,
    product_filter: list[str] | None,
) -> MonthToDate:
    """The org-wide rule's basis: every vendor's figures this month (the
    amortized view) plus priced labour, converted to the base currency.

    ``product_filter`` narrows it to connector products, which labour and
    entered figures carry none of. Nothing unconvertible is ever summed: each
    such part is named in ``unknown`` and the caller decides (the evaluator
    skips the rule rather than alert on a total missing a part)."""
    settings = await load_settings(db, tenant_id)
    fx = FxBook.for_settings(settings.base_currency, settings.fx_rates)
    vendors = {
        v.id: v
        for v in (
            await db.execute(select(Vendor).where(Vendor.tenant_id == tenant_id))
        ).scalars()
    }
    month_start, _ = month_bounds(today)
    loaded = await load_parts(
        db, tenant_id, vendors, month_start, today, "amortized", settings, fx
    )
    total = 0
    unknown: set[str] = set()
    for part in loaded.parts:
        if product_filter and (
            part.product is None or part.product not in product_filter
        ):
            continue
        if part.base is None:
            unknown.add(
                f"unpriced time on {part.day.isoformat()}"
                if part.missing == "unpriced"
                else f"no {part.currency}→{settings.base_currency} rate"
            )
            continue
        total += part.base
    return MonthToDate(
        base_currency=settings.base_currency,
        micros=total,
        unknown=sorted(unknown),
        fx=fx,
    )
