"""The Costs page's arithmetic: when a recurring cost falls due, and what the
project has spent — pure functions, no database.

A recurring cost's periods are derived, never stored. Period ``n`` falls due
``n`` cadence steps after ``start_date``, always counted from ``start_date``
itself so a month-end start does not drift (Jan 31 → Feb 28 → Mar 31). A
period with no entry is a **scheduled** charge for a fixed cost (its amount is
known) and **awaiting its amount** for a variable one — which is left out of
every total and counted instead, because an unknown is not a zero.

Currencies are kept apart. There is no exchange rate the page could honestly
apply, so every total is per currency.
"""

from __future__ import annotations

import calendar
from collections import defaultdict
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from datetime import date
from typing import Any
from uuid import UUID

from app.models.overview import CostEntry, RecurringCost

#: Months per period.
CADENCE_MONTHS: dict[str, int] = {"monthly": 1, "quarterly": 3, "annual": 12}

#: A bound on how many periods one recurring cost can yield, so a start date
#: far in the past cannot make a read unbounded (a monthly cost reaches it
#: after 200 years — ProjectDate's whole range).
MAX_PERIODS = 2_400


def add_months(start: date, months: int) -> date:
    """``start`` moved ``months`` calendar months, on the same day of the
    month or the last day of a shorter one."""
    index = start.month - 1 + months
    year, month = start.year + index // 12, index % 12 + 1
    day = min(start.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def due_dates(
    start_date: date, end_date: date | None, cadence: str, until: date
) -> Iterator[date]:
    """Every day the cost falls due, from ``start_date`` up to the earlier of
    ``end_date`` and ``until``, inclusive."""
    step = CADENCE_MONTHS[cadence]
    last = until if end_date is None else min(end_date, until)
    for n in range(MAX_PERIODS):
        due = add_months(start_date, step * n)
        if due > last:
            return
        yield due


def is_due_date(
    start_date: date, end_date: date | None, cadence: str, day: date
) -> bool:
    """Whether ``day`` is one of the cost's due dates (in the past or not)."""
    if day < start_date or (end_date is not None and day > end_date):
        return False
    months = (day.year - start_date.year) * 12 + (day.month - start_date.month)
    step = CADENCE_MONTHS[cadence]
    return months % step == 0 and add_months(start_date, months) == day


def _month(day: date) -> date:
    return day.replace(day=1)


@dataclass
class _Totals:
    spent: int = 0
    scheduled: int = 0
    this_month: int = 0
    awaiting_delivery: int = 0


@dataclass
class _MonthCell:
    recorded: int = 0
    scheduled: int = 0


def summarize(
    entries: Iterable[CostEntry],
    recurring: Iterable[RecurringCost],
    *,
    today: date,
    base_currency: str,
) -> dict[str, object]:
    """The figures ``GET /overview/costs/summary`` serves, as a plain dict
    shaped like :class:`app.schemas.overview_costs.CostSummary`."""
    entries = list(entries)
    totals: dict[str, _Totals] = defaultdict(_Totals)
    months: dict[tuple[date, UUID | None, str], _MonthCell] = defaultdict(_MonthCell)
    this_month = _month(today)
    awaiting_delivery = 0

    for entry in entries:
        t = totals[entry.currency]
        t.spent += entry.amount_micros
        if _month(entry.incurred_on) == this_month:
            t.this_month += entry.amount_micros
        if entry.expects_delivery and entry.received_on is None:
            t.awaiting_delivery += entry.amount_micros
            awaiting_delivery += 1
        cell = months[(_month(entry.incurred_on), entry.category_id, entry.currency)]
        cell.recorded += entry.amount_micros

    recorded = {
        (e.recurring_cost_id, e.period_start): e
        for e in entries
        if e.recurring_cost_id is not None
    }
    periods: list[dict[str, Any]] = []
    awaiting_amount = 0
    for cost in recurring:
        for due in due_dates(cost.start_date, cost.end_date, cost.cadence, today):
            record = recorded.get((cost.id, due))
            if record is not None:
                periods.append(
                    {
                        "recurring_cost_id": cost.id,
                        "period_start": due,
                        "state": "recorded",
                        "entry_id": record.id,
                        "amount_micros": record.amount_micros,
                        "currency": record.currency,
                    }
                )
                continue
            if cost.amount_kind == "fixed" and cost.amount_micros is not None:
                amount = cost.amount_micros
                t = totals[cost.currency]
                t.spent += amount
                t.scheduled += amount
                if _month(due) == this_month:
                    t.this_month += amount
                months[
                    (_month(due), cost.category_id, cost.currency)
                ].scheduled += amount
                state, shown = "scheduled", amount
            else:
                awaiting_amount += 1
                state, shown = "awaiting_amount", None
            periods.append(
                {
                    "recurring_cost_id": cost.id,
                    "period_start": due,
                    "state": state,
                    "entry_id": None,
                    "amount_micros": shown,
                    "currency": cost.currency,
                }
            )

    periods.sort(
        key=lambda p: (p["period_start"], str(p["recurring_cost_id"])), reverse=True
    )
    return {
        "today": today,
        "base_currency": base_currency,
        "currencies": [
            {
                "currency": currency,
                "spent_to_date_micros": t.spent,
                "scheduled_micros": t.scheduled,
                "this_month_micros": t.this_month,
                "awaiting_delivery_micros": t.awaiting_delivery,
            }
            for currency, t in sorted(
                totals.items(), key=lambda kv: (kv[0] != base_currency, kv[0])
            )
        ],
        "months": [
            {
                "month": month,
                "category_id": category_id,
                "currency": currency,
                "recorded_micros": cell.recorded,
                "scheduled_micros": cell.scheduled,
            }
            for (month, category_id, currency), cell in sorted(
                months.items(),
                key=lambda kv: (kv[0][0], str(kv[0][1]), kv[0][2]),
                reverse=True,
            )
        ],
        "periods": periods,
        "awaiting_delivery_count": awaiting_delivery,
        "awaiting_amount_count": awaiting_amount,
    }


__all__ = ["CADENCE_MONTHS", "add_months", "due_dates", "is_due_date", "summarize"]
