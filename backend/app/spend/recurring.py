"""Recurring costs, materialised into days on READ (plan decisions 10 and 12).

A recurring entry is the operator's statement of an invoice: an amount
(``unit_amount_micros × quantity``), a cadence and a start date. It is never
written into ``cost_entries`` by a cron; every read derives its periods here.

Two honest views of the same charges:

* ``charged`` — the whole amount lands on its charge date (what the card
  statement shows).
* ``amortized`` — the amount is spread evenly, per day, over the period the
  charge covers (a month, or a year for an ``annual`` entry), so daily bars and
  month totals agree. The split is exact in integer micros: the per-day parts
  sum to the charge.

Charge dates: a ``monthly`` entry charges on ``start_date``'s day of the month
(clamped to the month's length). An ``annual`` entry charges on the
anniversaries of ``renews_on`` when one is set (a connector may keep it
current), else of ``start_date``. No charge falls before ``start_date`` or
after ``end_date``.
"""

from __future__ import annotations

import calendar
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Literal

View = Literal["amortized", "charged"]


@dataclass(frozen=True)
class RecurringDay:
    day: date
    micros: int
    charge_date: date


def amount_micros(row: Any) -> int:
    """One charge: ``unit_amount_micros × quantity``, rounded half up."""
    total = Decimal(row.unit_amount_micros) * Decimal(row.quantity)
    return int(total.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def _clamp(year: int, month: int, day: int) -> date:
    return date(year, month, min(day, calendar.monthrange(year, month)[1]))


def _add_months(anchor_day: int, year: int, month: int, n: int) -> date:
    index = year * 12 + (month - 1) + n
    return _clamp(index // 12, index % 12 + 1, anchor_day)


def _anchor(row: Any) -> date:
    anchor: date = (
        row.renews_on
        if row.cadence == "annual" and row.renews_on is not None
        else row.start_date
    )
    return anchor


def _nth_charge(row: Any, n: int) -> date:
    """The charge ``n`` periods after the anchor (``n`` may be negative)."""
    anchor = _anchor(row)
    if row.cadence == "annual":
        return _clamp(anchor.year + n, anchor.month, anchor.day)
    return _add_months(anchor.day, anchor.year, anchor.month, n)


def _periods_between(row: Any, day: date) -> int:
    """An index ``n`` with ``_nth_charge(n) <= day`` — close to the last one."""
    anchor = _anchor(row)
    if row.cadence == "annual":
        return day.year - anchor.year - 1
    return (day.year - anchor.year) * 12 + (day.month - anchor.month) - 1


def charges(row: Any, start: date, end: date) -> Iterator[tuple[date, date]]:
    """``(charge_date, next_charge_date)`` for every charge whose COVERED
    period overlaps ``[start, end]``, honouring ``start_date``/``end_date``."""
    n = _periods_between(row, start) - 1
    while True:
        charge = _nth_charge(row, n)
        following = _nth_charge(row, n + 1)
        n += 1
        if charge > end:
            return
        if following <= start:
            continue
        if charge < row.start_date:
            continue
        if row.end_date is not None and charge > row.end_date:
            return
        yield charge, following


def materialise(row: Any, start: date, end: date, view: View) -> list[RecurringDay]:
    """The entry's figures for each day in ``[start, end]`` under ``view``.

    Days with no figure are absent (not zero rows)."""
    amount = amount_micros(row)
    out: list[RecurringDay] = []
    for charge, following in charges(row, start, end):
        if view == "charged":
            if start <= charge <= end:
                out.append(RecurringDay(charge, amount, charge))
            continue
        days = (following - charge).days
        first = max(charge, start)
        last = min(following - timedelta(days=1), end)
        current = first
        while current <= last:
            i = (current - charge).days
            part = amount * (i + 1) // days - amount * i // days
            out.append(RecurringDay(current, part, charge))
            current += timedelta(days=1)
    return out


def next_charge_on(row: Any, today: date) -> date | None:
    """The first charge on or after ``today``, or ``None`` once ended."""
    horizon = today + timedelta(days=400)
    for charge, _ in charges(row, today, horizon):
        if charge >= today:
            return charge
    return None


def charge_dates(row: Any, start: date, end: date) -> list[date]:
    return [c for c, _ in charges(row, start, end) if start <= c <= end]
