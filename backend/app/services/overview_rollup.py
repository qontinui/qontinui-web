"""Every derived figure an estimate has — computed on read, never stored.

Phase 2 of ``2026-09-19-project-overview-for-business-leaders``. The plan's
"Derived values" table says these are computed on read; this module is the one
place that computes them, so the frontend does no money or calendar
arithmetic and two surfaces can never disagree about a total.

The function is **pure**: it takes loaded ORM rows and settings, touches no
database, no clock beyond an injected ``generated_at``, and no request
context. That is what makes the fixture test — an estimate whose own stated
totals the rollup has to reproduce — a real test rather than a re-run of the
implementation.

Three rules it exists to enforce
================================

1. **Person-days come from ``task_efforts``, never from the FTE matrix.**
   Team size (average and peak FTE) comes from ``phase_allocations``, never
   from person-days. Delivery plans state the two independently and they need
   not reconcile; deriving either from the other double-counts, which is the
   specific defect the plan asks the rollup tests to catch.

2. **Unknown is never zero.** A figure whose inputs are missing comes back
   ``None`` with a reason in the matching ``unavailable`` list — never 0, and
   never silently omitted. A project with no priced role has no fee; it does
   not have a fee of zero.

3. **Money is integer micros and rounds ONCE, per effort row.** A fee is
   rounded where person-days meet a rate (``round(person_days × day_rate ×
   tier multiplier)``), and every larger figure is a sum of those same
   integers. That is what makes task → phase → estimate and role → estimate
   add up exactly, in both directions, with no rounding drift to reconcile.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any
from uuid import UUID

from app.models.overview import (
    CalendarBreak,
    CostLine,
    Estimate,
    EstimateRole,
    OverviewSettings,
    Phase,
    PriceTier,
)

#: Working days in a nominal week, before holidays and the working-day
#: factor. Monday–Friday.
WORKING_DAYS_PER_WEEK = Decimal("5")

#: Days in a calendar week.
CALENDAR_DAYS_PER_WEEK = Decimal("7")

_TWO_PLACES = Decimal("0.01")
_THREE_PLACES = Decimal("0.001")


def _q2(value: Decimal) -> Decimal:
    return value.quantize(_TWO_PLACES, rounding=ROUND_HALF_UP)


def _q3(value: Decimal) -> Decimal:
    return value.quantize(_THREE_PLACES, rounding=ROUND_HALF_UP)


def _micros(value: Decimal) -> int:
    """Round a micro-denominated amount to a whole micro. The ONLY rounding
    step in the money path — see rule 3 in the module docstring."""
    return int(value.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


@dataclass(frozen=True)
class Unavailable:
    """A figure this rollup could not produce, and why.

    ``figure`` is the field a reader was looking for; ``reason`` is a stable
    machine token the frontend switches on; ``detail`` is the human sentence.
    """

    figure: str
    reason: str
    detail: str


def _business_days(start: date, end: date) -> int:
    """Monday–Friday days in the inclusive range ``[start, end]``."""
    if end < start:
        return 0
    total = 0
    cursor = start
    while cursor <= end:
        if cursor.weekday() < 5:
            total += 1
        cursor += timedelta(days=1)
    return total


def _break_business_days(start: date, end: date, breaks: list[CalendarBreak]) -> int:
    """Monday–Friday days inside ``[start, end]`` that a calendar break
    removes. Overlapping breaks are counted once — a day is either worked or
    it is not, and two holidays on the same day do not remove two days."""
    if end < start:
        return 0
    removed: set[date] = set()
    for brk in breaks:
        lo = max(start, brk.start_date)
        hi = min(end, brk.end_date)
        cursor = lo
        while cursor <= hi:
            if cursor.weekday() < 5:
                removed.add(cursor)
            cursor += timedelta(days=1)
    return len(removed)


def calendar_weeks(start: date, end: date) -> Decimal:
    """Calendar weeks spanned by the inclusive range ``[start, end]``."""
    days = Decimal((end - start).days + 1)
    return _q2(days / CALENDAR_DAYS_PER_WEEK)


def working_days(
    start: date,
    end: date,
    breaks: list[CalendarBreak],
    working_day_factor: Decimal,
) -> Decimal:
    """Working days in ``[start, end]``: business days, minus the business
    days calendar breaks remove, times the project's working-day factor."""
    gross = _business_days(start, end) - _break_business_days(start, end, breaks)
    return _q2(Decimal(max(gross, 0)) * working_day_factor)


def working_weeks(days: Decimal) -> Decimal:
    return _q2(days / WORKING_DAYS_PER_WEEK)


@dataclass
class _RoleTotals:
    person_days: Decimal = Decimal("0")
    #: tier id (or ``None`` for the implicit single price) → fee in micros.
    fees: dict[UUID | None, int] = field(default_factory=dict)


def _effective_tiers(
    tiers: list[PriceTier],
) -> list[tuple[UUID | None, str, Decimal, bool]]:
    """``(id, name, multiplier, is_primary)`` per tier.

    Zero tier rows is not "no price" — it is ONE price, the rates as entered.
    That implicit tier has a ``None`` id so a caller can tell it from a tier
    the tenant actually created.
    """
    if not tiers:
        return [(None, "As entered", Decimal("1"), True)]
    ordered = sorted(tiers, key=lambda t: (t.sort_order, t.name))
    return [(t.id, t.name, Decimal(t.multiplier), t.is_primary) for t in ordered]


def _primary_tier_key(
    tiers: list[tuple[UUID | None, str, Decimal, bool]],
) -> UUID | None:
    for key, _name, _mult, is_primary in tiers:
        if is_primary:
            return key
    return tiers[0][0]


def compute_rollup(
    estimate: Estimate,
    settings: OverviewSettings,
    *,
    generated_at: datetime,
) -> dict:
    """Every planned figure the plan's "Derived values" table names.

    ``estimate`` must have its phases (with tasks and allocations), roles,
    price tiers, cost lines and calendar breaks loaded; this function issues
    no queries.
    """
    unavailable: list[Unavailable] = []

    factor = Decimal(settings.working_day_factor)
    breaks = sorted(estimate.calendar_breaks, key=lambda b: b.start_date)
    roles: list[EstimateRole] = sorted(
        estimate.roles, key=lambda r: (r.sort_order, r.code)
    )
    roles_by_id = {r.id: r for r in roles}
    phases: list[Phase] = sorted(estimate.phases, key=lambda p: (p.sort_order, p.code))

    tiers = _effective_tiers(estimate.price_tiers)
    tier_keys = [key for key, _n, _m, _p in tiers]
    primary_key = _primary_tier_key(tiers)

    # ── Money is only meaningful in ONE currency ────────────────────────
    # Phase 4 is what introduces FX conversion. Until then a mixed-currency
    # estimate has no total, and says so rather than adding euros to dollars.
    priced_roles = [r for r in roles if r.day_rate_micros is not None]
    labour_currencies = {r.currency for r in priced_roles if r.currency}
    labour_currency: str | None = None
    if len(labour_currencies) == 1:
        labour_currency = next(iter(labour_currencies))
    elif len(labour_currencies) > 1:
        unavailable.append(
            Unavailable(
                figure="labour_fees",
                reason="mixed_currencies",
                detail=(
                    "Roles are priced in more than one currency ("
                    + ", ".join(sorted(labour_currencies))
                    + "). Converting between them needs the project's FX "
                    "rates, which this page does not yet apply."
                ),
            )
        )

    unpriced_delivery = [
        r for r in roles if r.day_rate_micros is None and not r.client_side
    ]
    if unpriced_delivery:
        unavailable.append(
            Unavailable(
                figure="labour_fees",
                reason="role_has_no_rate",
                detail=(
                    "No day rate is set for "
                    + ", ".join(f"{r.code} ({r.name})" for r in unpriced_delivery)
                    + ", so their effort is counted but not priced."
                ),
            )
        )

    can_price = labour_currency is not None and len(labour_currencies) <= 1

    # ── Effort and fees, rolled up from the ONE source of person-days ───
    role_totals: dict[UUID, _RoleTotals] = {r.id: _RoleTotals() for r in roles}
    phase_rows: list[dict] = []
    estimate_fees: dict[UUID | None, int] = dict.fromkeys(tier_keys, 0)
    total_person_days = Decimal("0")
    orphan_effort_role_ids: set[UUID] = set()

    for phase in phases:
        phase_person_days = Decimal("0")
        phase_fees: dict[UUID | None, int] = dict.fromkeys(tier_keys, 0)
        phase_role_days: dict[UUID, Decimal] = {}
        critical = 0
        tasks = sorted(phase.tasks, key=lambda t: (t.sort_order, t.number))
        for task in tasks:
            if task.is_critical:
                critical += 1
            for effort in task.efforts:
                role = roles_by_id.get(effort.role_id)
                if role is None:
                    # A role from another estimate cannot be reached through
                    # this API, but a hand-written row could. Count the days
                    # and name the anomaly rather than dropping it silently.
                    orphan_effort_role_ids.add(effort.role_id)
                    continue
                days = Decimal(effort.planned_person_days)
                phase_person_days += days
                phase_role_days[role.id] = (
                    phase_role_days.get(role.id, Decimal("0")) + days
                )
                role_totals[role.id].person_days += days
                if can_price and role.day_rate_micros is not None:
                    rate = Decimal(role.day_rate_micros)
                    for key, _name, multiplier, _p in tiers:
                        fee = _micros(days * rate * multiplier)
                        phase_fees[key] += fee
                        role_totals[role.id].fees[key] = (
                            role_totals[role.id].fees.get(key, 0) + fee
                        )

        total_person_days += phase_person_days
        for key in tier_keys:
            estimate_fees[key] += phase_fees[key]

        allocated_fte = sum((Decimal(a.fte) for a in phase.allocations), Decimal("0"))

        derived_days: Decimal | None = None
        derived_weeks: Decimal | None = None
        cal_weeks: Decimal | None = None
        if phase.planned_start and phase.planned_end:
            cal_weeks = calendar_weeks(phase.planned_start, phase.planned_end)
            derived_days = working_days(
                phase.planned_start, phase.planned_end, breaks, factor
            )
            derived_weeks = working_weeks(derived_days)

        stated = (
            Decimal(phase.stated_working_weeks)
            if phase.stated_working_weeks is not None
            else None
        )
        matches_stated: bool | None = None
        if stated is not None and derived_weeks is not None:
            matches_stated = _q2(stated) == derived_weeks

        phase_rows.append(
            {
                "id": phase.id,
                "code": phase.code,
                "name": phase.name,
                "sort_order": phase.sort_order,
                "planned_start": phase.planned_start,
                "planned_end": phase.planned_end,
                "actual_start": phase.actual_start,
                "actual_end": phase.actual_end,
                "gate_status": phase.gate_status,
                "gate_criteria": phase.gate_criteria,
                "calendar_weeks": cal_weeks,
                "working_days": derived_days,
                "working_weeks": derived_weeks,
                "stated_working_weeks": stated,
                "working_weeks_matches_stated": matches_stated,
                "person_days": _q2(phase_person_days),
                "allocated_fte": _q3(allocated_fte),
                "task_count": len(tasks),
                "critical_task_count": critical,
                "fees_micros": (
                    {str(k) if k else "": v for k, v in phase_fees.items()}
                    if can_price
                    else None
                ),
                "roles": [
                    {
                        "role_id": rid,
                        "person_days": _q2(days),
                    }
                    for rid, days in sorted(
                        phase_role_days.items(),
                        key=lambda kv: roles_by_id[kv[0]].sort_order,
                    )
                ],
            }
        )

    if orphan_effort_role_ids:
        unavailable.append(
            Unavailable(
                figure="effort",
                reason="effort_role_outside_estimate",
                detail=(
                    f"{len(orphan_effort_role_ids)} effort row(s) name a role "
                    "that is not part of this estimate. Their days are not "
                    "counted."
                ),
            )
        )

    # ── Schedule over the whole estimate ────────────────────────────────
    starts = [p.planned_start for p in phases if p.planned_start]
    ends = [p.planned_end for p in phases if p.planned_end]
    planned_start = min(starts) if starts else None
    planned_end = max(ends) if ends else None
    total_cal_weeks: Decimal | None = None
    total_working_days: Decimal | None = None
    total_working_weeks: Decimal | None = None
    if planned_start and planned_end:
        total_cal_weeks = calendar_weeks(planned_start, planned_end)
        total_working_days = working_days(planned_start, planned_end, breaks, factor)
        total_working_weeks = working_weeks(total_working_days)
    elif phases:
        unavailable.append(
            Unavailable(
                figure="schedule",
                reason="phase_dates_missing",
                detail="No phase carries both a planned start and a planned end.",
            )
        )
    else:
        unavailable.append(
            Unavailable(
                figure="schedule",
                reason="no_phases",
                detail="This estimate has no phases yet.",
            )
        )

    # ── Team size: the FTE matrix alone ─────────────────────────────────
    allocated = [
        (row["code"], row["allocated_fte"], row["working_days"])
        for row in phase_rows
        if row["allocated_fte"] > 0
    ]
    peak_fte: Decimal | None = None
    peak_phase_code: str | None = None
    average_fte: Decimal | None = None
    if allocated:
        peak_phase_code, peak_fte, _ = max(allocated, key=lambda t: t[1])
        weighted = [(fte, days) for _c, fte, days in allocated if days]
        if weighted:
            weight_total = sum((d for _f, d in weighted), Decimal("0"))
            if weight_total > 0:
                average_fte = _q3(
                    sum((f * d for f, d in weighted), Decimal("0")) / weight_total
                )
        if average_fte is None:
            # No phase has both an allocation and a duration, so a
            # duration-weighted average is not available. A plain mean of
            # phases of unknown length would be a different figure wearing
            # the same label, so it is not offered.
            unavailable.append(
                Unavailable(
                    figure="average_fte",
                    reason="phase_durations_missing",
                    detail=(
                        "Average team size is weighted by how long each phase "
                        "runs, and no allocated phase has both a planned start "
                        "and end."
                    ),
                )
            )
    else:
        unavailable.append(
            Unavailable(
                figure="team_size",
                reason="no_allocations",
                detail=(
                    "No phase × role allocation has been entered, so team size "
                    "is not known. It is not the same as a team of none."
                ),
            )
        )

    # ── Cost lines ──────────────────────────────────────────────────────
    cost_lines = sorted(
        estimate.cost_lines, key=lambda c: (c.kind, c.sort_order, c.label)
    )
    build_lines = [c for c in cost_lines if c.kind == "build_non_labour"]
    run_lines = [c for c in cost_lines if c.kind == "run_annual"]
    build_low, build_high, build_currency, build_mixed = _sum_band(build_lines)
    if build_mixed:
        unavailable.append(
            Unavailable(
                figure="build_non_labour",
                reason="mixed_currencies",
                detail=(
                    "Non-labour build items are priced in more than one "
                    "currency, so they have no single total here."
                ),
            )
        )

    # ── Contingency and grand totals, per tier ──────────────────────────
    contingency_pct = (
        Decimal(estimate.contingency_pct)
        if estimate.contingency_pct is not None
        else None
    )
    totals_currency: str | None = None
    if can_price:
        totals_currency = labour_currency
        if build_low is not None and build_currency != labour_currency:
            totals_currency = None
            unavailable.append(
                Unavailable(
                    figure="grand_total",
                    reason="mixed_currencies",
                    detail=(
                        "Labour is priced in "
                        f"{labour_currency} and the non-labour build items in "
                        f"{build_currency or 'another currency'}, so they have "
                        "no combined total until FX rates are applied."
                    ),
                )
            )

    tier_rows: list[dict] = []
    for key, name, multiplier, is_primary in tiers:
        labour = estimate_fees[key] if can_price else None
        contingency = (
            _micros(Decimal(labour) * contingency_pct / Decimal(100))
            if labour is not None and contingency_pct is not None
            else None
        )
        total_low: int | None = None
        total_high: int | None = None
        if labour is not None and totals_currency is not None:
            base = labour + (contingency or 0)
            total_low = base + (build_low or 0)
            total_high = base + (
                build_high if build_high is not None else (build_low or 0)
            )
        tier_rows.append(
            {
                "id": key,
                "name": name,
                "multiplier": multiplier,
                "is_primary": is_primary,
                "labour_micros": labour,
                "contingency_micros": contingency,
                "total_low_micros": total_low,
                "total_high_micros": total_high,
            }
        )

    # ── Roles, with their share of the whole ────────────────────────────
    delivery_days = sum(
        (role_totals[r.id].person_days for r in roles if not r.client_side),
        Decimal("0"),
    )
    client_days = sum(
        (role_totals[r.id].person_days for r in roles if r.client_side),
        Decimal("0"),
    )
    primary_fee_total: int = estimate_fees.get(primary_key, 0) if can_price else 0

    role_rows: list[dict] = []
    for role in roles:
        totals = role_totals[role.id]
        primary_fee: int | None = totals.fees.get(primary_key) if can_price else None
        role_rows.append(
            {
                "id": role.id,
                "code": role.code,
                "name": role.name,
                "responsibility": role.responsibility,
                "day_rate_micros": role.day_rate_micros,
                "currency": role.currency,
                "client_side": role.client_side,
                "sort_order": role.sort_order,
                "person_days": _q2(totals.person_days),
                "person_days_share_pct": (
                    _q2(totals.person_days * Decimal(100) / total_person_days)
                    if total_person_days > 0
                    else None
                ),
                "fee_micros": primary_fee,
                "fee_share_pct": (
                    _q2(
                        Decimal(primary_fee) * Decimal(100) / Decimal(primary_fee_total)
                    )
                    if primary_fee is not None and primary_fee_total > 0
                    else None
                ),
                "fees_micros": (
                    {str(k) if k else "": totals.fees.get(k, 0) for k in tier_keys}
                    if can_price and role.day_rate_micros is not None
                    else None
                ),
            }
        )

    return {
        "estimate_id": estimate.id,
        "name": estimate.name,
        "purpose": estimate.purpose,
        "status": estimate.status,
        "is_baseline": estimate.is_baseline,
        "accuracy_note": estimate.accuracy_note,
        "version": estimate.version,
        "generated_at": generated_at,
        "settings": {
            "base_currency": settings.base_currency,
            "labour_billing": settings.labour_billing,
            "hours_per_day": _q2(Decimal(settings.hours_per_day)),
            "working_day_factor": Decimal(settings.working_day_factor),
        },
        "schedule": {
            "planned_start": planned_start,
            "planned_end": planned_end,
            "calendar_weeks": total_cal_weeks,
            "working_days": total_working_days,
            "working_weeks": total_working_weeks,
        },
        "effort": {
            "total_person_days": _q2(total_person_days),
            "delivery_person_days": _q2(delivery_days),
            "client_side_person_days": _q2(client_days),
        },
        "team": {
            "average_fte": average_fte,
            "peak_fte": peak_fte,
            "peak_phase_code": peak_phase_code,
        },
        "money": {
            "currency": labour_currency,
            "totals_currency": totals_currency,
            "contingency_pct": contingency_pct,
            #: Spelled out so the reading is explicit rather than inferred:
            #: contingency is a percentage OF THE LABOUR FEES. Non-labour
            #: build items carry their own low–high band and express their own
            #: uncertainty that way.
            "contingency_basis": "labour_fees",
            "primary_tier_id": primary_key,
            "tiers": tier_rows,
            "build_non_labour": {
                "low_micros": build_low,
                "high_micros": build_high,
                "currency": build_currency,
                "lines": [_cost_line_row(c) for c in build_lines],
            },
            "run_annual": {
                "lines": [_cost_line_row(c) for c in run_lines],
            },
        },
        "phases": phase_rows,
        "roles": role_rows,
        "calendar_breaks": [
            {
                "id": b.id,
                "label": b.label,
                "start_date": b.start_date,
                "end_date": b.end_date,
            }
            for b in breaks
        ],
        "unavailable": [
            {"figure": u.figure, "reason": u.reason, "detail": u.detail}
            for u in unavailable
        ],
    }


def _cost_line_row(line: CostLine) -> dict:
    return {
        "id": line.id,
        "kind": line.kind,
        "label": line.label,
        "basis": line.basis,
        "low_micros": line.low_micros,
        "high_micros": line.high_micros,
        "currency": line.currency,
        "phase_id": line.phase_id,
        "run_model": line.run_model,
    }


def _sum_band(
    lines: list[CostLine],
) -> tuple[int | None, int | None, str | None, bool]:
    """Total a set of cost lines. Returns ``(low, high, currency, mixed)``.

    ``mixed`` is True when the lines name more than one currency, in which
    case the totals are ``None`` — adding two currencies is not a sum. A line
    whose ``high`` is absent contributes its ``low`` to both ends, which is
    what a single-point estimate means.
    """
    priced = [line for line in lines if line.low_micros is not None]
    if not priced:
        return None, None, None, False
    currencies = {line.currency for line in priced if line.currency}
    if len(currencies) > 1:
        return None, None, None, True
    currency = next(iter(currencies)) if currencies else None
    low = sum(int(line.low_micros or 0) for line in priced)
    high = sum(
        int(
            line.high_micros if line.high_micros is not None else (line.low_micros or 0)
        )
        for line in priced
    )
    return low, high, currency, False


def stringify_decimals(value: Any) -> Any:
    """Recursively turn every ``Decimal`` into its exact decimal STRING.

    FastAPI's ``jsonable_encoder`` maps ``Decimal`` to ``float``, which is the
    one thing the money and effort path must never touch. Money is already an
    integer count of micros; this is what keeps person-days, weeks, FTE and
    percentages exact on the wire too. The frontend reads them with
    ``Number(...)`` where it needs arithmetic and renders the string where it
    does not.
    """
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, dict):
        return {k: stringify_decimals(v) for k, v in value.items()}
    if isinstance(value, list):
        return [stringify_decimals(v) for v in value]
    return value
