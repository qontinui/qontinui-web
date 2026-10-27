"""Wire shapes for the Costs page: cost categories, recurring costs, cost
entries, and the derived summary (``GET /overview/costs/summary``).

The three record kinds are resources on the overview authoring contract
(``app.overview.registry``); these models are their single source of truth,
served to the editing kit as JSON Schemas. The conventions of
``app.schemas.overview`` hold here too: money is integer micros beside an ISO
4217 currency, and a figure that is not known is ``null``, never 0.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.overview import (
    MAX_MICROS,
    MAX_NOTES,
    Micros,
    ProjectDate,
    _normalize_currency,
    _WriteModel,
)

Cadence = Literal["monthly", "quarterly", "annual"]
AmountKind = Literal["fixed", "variable"]

#: A cost entry's amount may be negative: a refund, a returned part.
SignedMicros = Annotated[int, Field(ge=-MAX_MICROS, le=MAX_MICROS)]
Quantity = Annotated[int, Field(ge=1, le=1_000_000)]

MAX_NAME = 200
MAX_REF = 500


def _required_text(v: str | None, field: str) -> str | None:
    if v is None:
        return None
    v = v.strip()
    if not v:
        raise ValueError(f"{field} cannot be blank")
    return v


def _currency(v: str | None) -> str | None:
    return _normalize_currency(v)


def _refuse_cleared(model: BaseModel, fields: tuple[str, ...]) -> None:
    if not model.model_fields_set:
        raise ValueError("give at least one field to change")
    nulled = [
        f for f in fields if f in model.model_fields_set and getattr(model, f) is None
    ]
    if nulled:
        raise ValueError("these cannot be cleared, only changed: " + ", ".join(nulled))


class _Audit(BaseModel):
    version: int
    created_at: datetime
    updated_at: datetime
    created_by: str | None
    updated_by: str | None


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------


class CostCategoryRead(_Audit):
    id: str
    name: str
    description: str
    sort_order: int


class CostCategoryCreate(_WriteModel):
    #: Unique in the project, ignoring case: a second "Hardware" is a 409
    #: ``name_taken``.
    name: str = Field(min_length=1, max_length=MAX_NAME)
    description: str = Field(default="", max_length=MAX_NOTES)
    sort_order: int = Field(default=0, ge=-1_000_000, le=1_000_000)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        return _required_text(v, "name") or v


class CostCategoryUpdate(_WriteModel):
    name: str | None = Field(default=None, min_length=1, max_length=MAX_NAME)
    description: str | None = Field(default=None, max_length=MAX_NOTES)
    sort_order: int | None = Field(default=None, ge=-1_000_000, le=1_000_000)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str | None) -> str | None:
        return _required_text(v, "name")

    @model_validator(mode="after")
    def _something(self) -> CostCategoryUpdate:
        _refuse_cleared(self, ("name", "description", "sort_order"))
        return self


# ---------------------------------------------------------------------------
# Recurring costs
# ---------------------------------------------------------------------------


def recurring_problem(
    *,
    amount_kind: str,
    amount_micros: int | None,
    start_date: date,
    end_date: date | None,
) -> str | None:
    """The cross-field rules, checked on create and on the record as a partial
    update would leave it."""
    if amount_kind == "fixed" and amount_micros is None:
        return "a fixed recurring cost needs its amount per period (amount_micros)"
    if end_date is not None and end_date < start_date:
        return "a recurring cost cannot end before it starts"
    return None


class RecurringCostRead(_Audit):
    id: str
    name: str
    vendor: str
    category_id: UUID | None
    cadence: Cadence
    #: ``fixed`` charges ``amount_micros`` every period; ``variable`` needs
    #: each period's amount recorded, and ``amount_micros`` is only a typical
    #: figure shown as a guide.
    amount_kind: AmountKind
    amount_micros: int | None
    currency: str
    start_date: date
    #: The last day it can fall due; ``null`` while it is still running.
    end_date: date | None
    notes: str


class RecurringCostCreate(_WriteModel):
    name: str = Field(min_length=1, max_length=MAX_NAME)
    vendor: str = Field(default="", max_length=MAX_NAME)
    category_id: UUID | None = None
    cadence: Cadence = "monthly"
    amount_kind: AmountKind = "fixed"
    amount_micros: Micros | None = None
    currency: str = Field(min_length=3, max_length=3)
    #: The first day it falls due; every later period falls due on the same
    #: day of the month (the last day, in a shorter month).
    start_date: ProjectDate
    end_date: ProjectDate | None = None
    notes: str = Field(default="", max_length=MAX_NOTES)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        return _required_text(v, "name") or v

    @field_validator("currency")
    @classmethod
    def _cur(cls, v: str) -> str:
        return _currency(v) or v

    @model_validator(mode="after")
    def _rules(self) -> RecurringCostCreate:
        problem = recurring_problem(
            amount_kind=self.amount_kind,
            amount_micros=self.amount_micros,
            start_date=self.start_date,
            end_date=self.end_date,
        )
        if problem:
            raise ValueError(problem)
        return self


class RecurringCostUpdate(_WriteModel):
    """Every field optional; ``null`` clears ``category_id``, ``amount_micros``
    or ``end_date``. The cross-field rules are checked by the store on the
    record as it will stand."""

    name: str | None = Field(default=None, min_length=1, max_length=MAX_NAME)
    vendor: str | None = Field(default=None, max_length=MAX_NAME)
    category_id: UUID | None = None
    cadence: Cadence | None = None
    amount_kind: AmountKind | None = None
    amount_micros: Micros | None = None
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    start_date: ProjectDate | None = None
    end_date: ProjectDate | None = None
    notes: str | None = Field(default=None, max_length=MAX_NOTES)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str | None) -> str | None:
        return _required_text(v, "name")

    @field_validator("currency")
    @classmethod
    def _cur(cls, v: str | None) -> str | None:
        return _currency(v)

    @model_validator(mode="after")
    def _something(self) -> RecurringCostUpdate:
        _refuse_cleared(
            self,
            (
                "name",
                "vendor",
                "cadence",
                "amount_kind",
                "currency",
                "start_date",
                "notes",
            ),
        )
        return self


# ---------------------------------------------------------------------------
# Cost entries
# ---------------------------------------------------------------------------


def entry_problem(*, expects_delivery: bool, received_on: date | None) -> str | None:
    if received_on is not None and not expects_delivery:
        return (
            "only an item that is delivered has a received date — mark it as "
            "awaiting delivery (expects_delivery) or clear the date"
        )
    return None


class CostEntryRead(_Audit):
    id: str
    #: The day the money was spent (ordered, paid, or billed).
    incurred_on: date
    description: str
    vendor: str
    category_id: UUID | None
    #: The total paid, for all ``quantity`` items. Negative is a refund.
    amount_micros: int
    currency: str
    quantity: int
    #: A physical item that has to arrive; ``received_on`` is when it did.
    expects_delivery: bool
    received_on: date | None
    order_ref: str
    notes: str
    #: Set together when this entry is one period of a recurring cost.
    recurring_cost_id: UUID | None
    period_start: date | None


class CostEntryCreate(_WriteModel):
    incurred_on: ProjectDate
    description: str = Field(min_length=1, max_length=MAX_NAME)
    vendor: str = Field(default="", max_length=MAX_NAME)
    category_id: UUID | None = None
    amount_micros: SignedMicros
    currency: str = Field(min_length=3, max_length=3)
    quantity: Quantity = 1
    expects_delivery: bool = False
    received_on: ProjectDate | None = None
    order_ref: str = Field(default="", max_length=MAX_REF)
    notes: str = Field(default="", max_length=MAX_NOTES)
    #: To record one period of a recurring cost, name it and the period's
    #: first day (one of its due dates). At most one entry per period: a
    #: second is a 409 ``period_already_recorded``.
    recurring_cost_id: UUID | None = None
    period_start: ProjectDate | None = None

    @field_validator("description")
    @classmethod
    def _description(cls, v: str) -> str:
        return _required_text(v, "description") or v

    @field_validator("currency")
    @classmethod
    def _cur(cls, v: str) -> str:
        return _currency(v) or v

    @model_validator(mode="after")
    def _rules(self) -> CostEntryCreate:
        problem = entry_problem(
            expects_delivery=self.expects_delivery, received_on=self.received_on
        )
        if problem:
            raise ValueError(problem)
        if (self.recurring_cost_id is None) != (self.period_start is None):
            raise ValueError(
                "recurring_cost_id and period_start are given together, or neither"
            )
        return self


class CostEntryUpdate(_WriteModel):
    """Every field optional; ``null`` clears ``category_id`` or
    ``received_on``. Which recurring period an entry records is fixed when it
    is created."""

    incurred_on: ProjectDate | None = None
    description: str | None = Field(default=None, min_length=1, max_length=MAX_NAME)
    vendor: str | None = Field(default=None, max_length=MAX_NAME)
    category_id: UUID | None = None
    amount_micros: SignedMicros | None = None
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    quantity: Quantity | None = None
    expects_delivery: bool | None = None
    received_on: ProjectDate | None = None
    order_ref: str | None = Field(default=None, max_length=MAX_REF)
    notes: str | None = Field(default=None, max_length=MAX_NOTES)

    @field_validator("description")
    @classmethod
    def _description(cls, v: str | None) -> str | None:
        return _required_text(v, "description")

    @field_validator("currency")
    @classmethod
    def _cur(cls, v: str | None) -> str | None:
        return _currency(v)

    @model_validator(mode="after")
    def _something(self) -> CostEntryUpdate:
        _refuse_cleared(
            self,
            (
                "incurred_on",
                "description",
                "vendor",
                "amount_micros",
                "currency",
                "quantity",
                "expects_delivery",
                "order_ref",
                "notes",
            ),
        )
        return self


# ---------------------------------------------------------------------------
# The summary (GET /overview/costs/summary)
# ---------------------------------------------------------------------------

PeriodState = Literal["recorded", "scheduled", "awaiting_amount"]


class CurrencyTotals(BaseModel):
    """Every figure in one currency. Currencies are never added together:
    there is no exchange rate the page could honestly apply."""

    currency: str
    #: Recorded entries plus the scheduled charges of fixed recurring costs
    #: that have fallen due and have no entry. Excludes the variable periods
    #: still awaiting an amount (counted in ``awaiting_amount_count``).
    spent_to_date_micros: int
    #: The part of ``spent_to_date_micros`` that is scheduled, not recorded.
    scheduled_micros: int
    #: Spent in the calendar month of ``today``, on the same terms.
    this_month_micros: int
    #: What has been paid for items not yet received.
    awaiting_delivery_micros: int


class MonthCategoryTotal(BaseModel):
    #: The first day of the calendar month.
    month: date
    category_id: UUID | None
    currency: str
    recorded_micros: int
    scheduled_micros: int


class RecurringPeriod(BaseModel):
    """One period of a recurring cost that has fallen due (``period_start``
    on or before ``today``)."""

    recurring_cost_id: UUID
    period_start: date
    state: PeriodState
    #: The entry that records it, when ``recorded``.
    entry_id: UUID | None
    #: The recorded amount, or a fixed cost's scheduled one; ``null`` while
    #: awaiting an amount.
    amount_micros: int | None
    currency: str


class CostSummary(BaseModel):
    today: date
    #: The project's base currency (its settings), the default for new costs.
    base_currency: str
    currencies: list[CurrencyTotals]
    months: list[MonthCategoryTotal]
    #: Newest first.
    periods: list[RecurringPeriod]
    awaiting_delivery_count: int
    awaiting_amount_count: int
