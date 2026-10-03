"""What labour costs, per the project's ``labour_billing`` setting.

Business-leaders plan, "Estimate purpose / Labour billing": actual cost =
vendor costs + labour cost **as the project's billing setting defines it**,
and labour is counted in exactly ONE place:

* ``unbilled`` — effort may be logged and costs nothing. The labour line says
  "not billed"; it is never a silent 0. A cost entry of category ``labour``
  contradicts the setting, so it is left out of every total and reported.
* ``day_rates`` — logged effort × the rate snapshotted when it was logged
  (``effort_entries.rate_micros_used``) is the labour cost. A ``labour`` cost
  entry would count the same work twice, so it is left out and reported.
* ``fixed_fee`` — labour is billed as fee instalments, entered as cost
  entries of category ``labour``; THOSE are the labour cost. Logged effort
  still counts as time (person-days) and never as money.

A cost entry is ``labour`` when its own category is, or — naming none — when
its vendor's is.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal
from uuid import UUID

from app.models.overview import EffortEntry

LabourBilling = Literal["unbilled", "day_rates", "fixed_fee"]

LABOUR_CATEGORY = "labour"


def is_labour(entry_category: str | None, vendor_category: str | None) -> bool:
    return (entry_category or vendor_category) == LABOUR_CATEGORY


def labour_entries_count_as_cost(billing: str) -> bool:
    """Whether a ``labour`` cost entry is part of actual cost under
    ``billing`` (only under ``fixed_fee``)."""
    return billing == "fixed_fee"


def entry_cost_micros(hours: Decimal, rate_micros: int, hours_per_day: Decimal) -> int:
    """One effort entry's cost in its rate's currency: ``hours ÷ hours per day
    × day rate``, rounded ONCE, half up — the same single rounding step the
    estimate rollup takes per effort row."""
    value = Decimal(hours) * Decimal(rate_micros) / Decimal(hours_per_day)
    return int(value.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def person_key(person_user_id: UUID | None, person: str) -> str:
    """Who an entry is FOR, as one key: the qontinui user when there is one,
    else the name as written (case- and space-insensitive)."""
    if person_user_id is not None:
        return f"user:{person_user_id}"
    return "name:" + " ".join(person.split()).casefold()


@dataclass(frozen=True)
class EffortRow:
    """One effort entry as the costs summary reads it."""

    id: UUID
    day: date
    phase_id: UUID | None
    person_key: str
    hours: Decimal
    #: The hours that made a day for THIS entry: its snapshot, else the
    #: project's current setting.
    hours_per_day: Decimal
    #: Cost in ``currency`` under ``day_rates`` (from the snapshot); ``None``
    #: when the entry carries no snapshot.
    cost_micros: int | None
    currency: str | None


def effort_row(entry: EffortEntry, settings_hours_per_day: Decimal) -> EffortRow:
    priced = (
        entry.rate_micros_used is not None
        and entry.rate_currency is not None
        and entry.hours_per_day_used is not None
    )
    return EffortRow(
        id=entry.id,
        day=entry.work_date,
        phase_id=entry.phase_id,
        person_key=person_key(entry.person_user_id, entry.person),
        hours=Decimal(entry.hours),
        hours_per_day=Decimal(
            entry.hours_per_day_used
            if entry.hours_per_day_used is not None
            else settings_hours_per_day
        ),
        cost_micros=(
            entry_cost_micros(
                Decimal(entry.hours),
                int(entry.rate_micros_used),  # type: ignore[arg-type]
                Decimal(entry.hours_per_day_used),  # type: ignore[arg-type]
            )
            if priced
            else None
        ),
        currency=entry.rate_currency if priced else None,
    )
