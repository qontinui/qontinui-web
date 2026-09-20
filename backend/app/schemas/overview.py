"""Wire shapes for the Project Overview estimate API.

Phase 2 of ``2026-09-19-project-overview-for-business-leaders``.

Two conventions run through every model here:

* **Money is an integer count of micros plus an ISO 4217 currency.** One
  micro is 1e-6 of a currency unit, so 19.28 EUR is ``19280000`` with
  ``"EUR"``. There is no float anywhere in the money path, on the wire or in
  the database.

* **Children are addressed by their own CODE, not by a database id.** A
  ``task_efforts`` row names ``role_code``; an allocation names
  ``phase_code`` and ``role_code``. The content endpoint replaces an
  estimate's whole graph in one transaction, so ids the client has never seen
  would be noise — and a code is what the source delivery plan, the CSV paste
  and the mermaid import all actually carry.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

LabourBilling = Literal["unbilled", "day_rates", "fixed_fee"]
EstimatePurpose = Literal["budget", "comparison", "forecast"]
EstimateStatus = Literal["draft", "for_decision", "approved", "superseded"]
GateStatus = Literal["pending", "passed", "failed", "waived"]
TaskStatus = Literal["planned", "in_progress", "done"]
CostLineKind = Literal["build_non_labour", "run_annual"]


def _normalize_currency(value: str | None) -> str | None:
    if value is None:
        return None
    code = value.strip().upper()
    if len(code) != 3 or not code.isalpha():
        raise ValueError("currency must be a 3-letter ISO 4217 code, e.g. EUR")
    return code


# ---------------------------------------------------------------------------
# Project settings
# ---------------------------------------------------------------------------


class OverviewSettingsRead(BaseModel):
    """The project's settings.

    A project that has never saved settings is served the documented defaults
    with ``is_default: true`` — never a 404 and never an empty object, so a
    reader can tell "nobody has set this" from "this is set to the default".
    """

    model_config = ConfigDict(from_attributes=True)

    base_currency: str
    fx_rates: dict[str, Any]
    labour_billing: LabourBilling
    hours_per_day: Decimal
    working_day_factor: Decimal
    first_value_date: date | None
    version: int
    is_default: bool = False
    updated_at: datetime | None = None
    updated_by: str | None = None


class OverviewSettingsWrite(BaseModel):
    base_currency: str = "USD"
    fx_rates: dict[str, Any] = Field(default_factory=dict)
    labour_billing: LabourBilling = "unbilled"
    hours_per_day: Decimal = Decimal("8")
    working_day_factor: Decimal = Decimal("1.0")
    first_value_date: date | None = None
    #: Optimistic concurrency. When given, the write is refused with 409 if
    #: the stored row has moved past it. Absent means "I did not read a
    #: version" — which is accepted, because the alternative is that a first
    #: write can never happen.
    expected_version: int | None = None

    @field_validator("base_currency")
    @classmethod
    def _currency(cls, v: str) -> str:
        normalized = _normalize_currency(v)
        assert normalized is not None
        return normalized

    @field_validator("hours_per_day")
    @classmethod
    def _hours(cls, v: Decimal) -> Decimal:
        if v <= 0 or v > 24:
            raise ValueError("hours_per_day must be between 0 and 24")
        return v

    @field_validator("working_day_factor")
    @classmethod
    def _factor(cls, v: Decimal) -> Decimal:
        if v <= 0 or v > 1:
            raise ValueError(
                "working_day_factor is the share of a nominal day actually "
                "worked, so it is above 0 and at most 1"
            )
        return v


# ---------------------------------------------------------------------------
# The estimate head row
# ---------------------------------------------------------------------------


class EstimateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    purpose: EstimatePurpose
    status: EstimateStatus = "draft"
    is_baseline: bool = False
    source_page_id: UUID | None = None
    accuracy_note: str | None = None
    contingency_pct: Decimal | None = None
    notes: str = ""

    @field_validator("contingency_pct")
    @classmethod
    def _contingency(cls, v: Decimal | None) -> Decimal | None:
        if v is not None and v < 0:
            raise ValueError("contingency_pct cannot be negative")
        return v


class EstimateUpdate(BaseModel):
    """Every field optional — an absent field is left alone.

    ``None`` is a real value for the nullable fields (it clears them), so the
    handler distinguishes "absent" from "null" with
    ``model_fields_set``/``exclude_unset``.
    """

    name: str | None = Field(default=None, min_length=1, max_length=200)
    purpose: EstimatePurpose | None = None
    status: EstimateStatus | None = None
    is_baseline: bool | None = None
    source_page_id: UUID | None = None
    accuracy_note: str | None = None
    contingency_pct: Decimal | None = None
    notes: str | None = None
    expected_version: int | None = None


class EstimateSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    purpose: EstimatePurpose
    status: EstimateStatus
    is_baseline: bool
    source_page_id: UUID | None
    accuracy_note: str | None
    contingency_pct: Decimal | None
    notes: str
    version: int
    created_at: datetime
    updated_at: datetime
    created_by: str | None
    updated_by: str | None


class EstimateListResponse(BaseModel):
    estimates: list[EstimateSummary]
    total: int


# ---------------------------------------------------------------------------
# The content graph — phases, tasks, efforts, roles, tiers, cost lines, breaks
# ---------------------------------------------------------------------------


class TaskEffortWrite(BaseModel):
    role_code: str = Field(min_length=1, max_length=50)
    planned_person_days: Decimal = Field(ge=0)


class PhaseTaskWrite(BaseModel):
    number: str = Field(min_length=1, max_length=50)
    title: str = Field(min_length=1, max_length=400)
    requirement_refs: str | None = None
    planned_start: date | None = None
    planned_end: date | None = None
    is_critical: bool = False
    status: TaskStatus = "planned"
    efforts: list[TaskEffortWrite] = Field(default_factory=list)

    @model_validator(mode="after")
    def _dates_and_roles(self) -> PhaseTaskWrite:
        if (
            self.planned_start
            and self.planned_end
            and self.planned_end < self.planned_start
        ):
            raise ValueError(f"task {self.number}: planned_end is before planned_start")
        seen = set()
        for effort in self.efforts:
            if effort.role_code in seen:
                raise ValueError(
                    f"task {self.number}: role {effort.role_code} appears twice"
                )
            seen.add(effort.role_code)
        return self


class PhaseWrite(BaseModel):
    code: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=200)
    planned_start: date | None = None
    planned_end: date | None = None
    #: What the SOURCE plan stated. The rollup computes its own figure and
    #: reports both, so a disagreement is visible rather than overwritten.
    stated_working_weeks: Decimal | None = Field(default=None, ge=0)
    gate_criteria: str = ""
    actual_start: date | None = None
    actual_end: date | None = None
    gate_status: GateStatus = "pending"
    gate_decided_at: date | None = None
    gate_notes: str = ""
    tasks: list[PhaseTaskWrite] = Field(default_factory=list)

    @model_validator(mode="after")
    def _dates_and_tasks(self) -> PhaseWrite:
        if (
            self.planned_start
            and self.planned_end
            and self.planned_end < self.planned_start
        ):
            raise ValueError(f"phase {self.code}: planned_end is before planned_start")
        if (
            self.actual_start
            and self.actual_end
            and self.actual_end < self.actual_start
        ):
            raise ValueError(f"phase {self.code}: actual_end is before actual_start")
        numbers = [t.number for t in self.tasks]
        if len(numbers) != len(set(numbers)):
            raise ValueError(f"phase {self.code}: two tasks share a number")
        return self


class RoleWrite(BaseModel):
    code: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=200)
    responsibility: str = ""
    day_rate_micros: int | None = Field(default=None, ge=0)
    currency: str | None = None
    client_side: bool = False

    @field_validator("currency")
    @classmethod
    def _currency(cls, v: str | None) -> str | None:
        return _normalize_currency(v)

    @model_validator(mode="after")
    def _rate_has_currency(self) -> RoleWrite:
        if (self.day_rate_micros is None) != (self.currency is None):
            raise ValueError(
                f"role {self.code}: a day rate and its currency travel "
                "together — give both or neither"
            )
        return self


class AllocationWrite(BaseModel):
    phase_code: str = Field(min_length=1, max_length=50)
    role_code: str = Field(min_length=1, max_length=50)
    fte: Decimal = Field(ge=0)


class PriceTierWrite(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    multiplier: Decimal = Field(gt=0)
    is_primary: bool = False


class CostLineWrite(BaseModel):
    kind: CostLineKind
    label: str = Field(min_length=1, max_length=200)
    basis: str = ""
    low_micros: int | None = Field(default=None, ge=0)
    high_micros: int | None = Field(default=None, ge=0)
    currency: str | None = None
    phase_code: str | None = None
    run_model: str | None = None

    @field_validator("currency")
    @classmethod
    def _currency(cls, v: str | None) -> str | None:
        return _normalize_currency(v)

    @model_validator(mode="after")
    def _band(self) -> CostLineWrite:
        if (
            self.low_micros is not None
            and self.high_micros is not None
            and self.high_micros < self.low_micros
        ):
            raise ValueError(f"cost line {self.label}: high is below low")
        has_amount = self.low_micros is not None or self.high_micros is not None
        if has_amount != (self.currency is not None):
            raise ValueError(
                f"cost line {self.label}: an amount and its currency travel "
                "together — give both or neither"
            )
        return self


class CalendarBreakWrite(BaseModel):
    label: str = Field(min_length=1, max_length=200)
    start_date: date
    end_date: date

    @model_validator(mode="after")
    def _order(self) -> CalendarBreakWrite:
        if self.end_date < self.start_date:
            raise ValueError(f"break {self.label}: end_date is before start_date")
        return self


class EstimateContentWrite(BaseModel):
    """The estimate's whole content graph, replaced in one transaction.

    Replace-the-whole-graph rather than per-row CRUD, because that is the
    shape every source actually has: a CSV paste is a whole table, a mermaid
    ``gantt`` block is a whole schedule, and the editor shows the result for
    confirmation before anything is saved. It also means an import can never
    half-land.
    """

    roles: list[RoleWrite] = Field(default_factory=list)
    phases: list[PhaseWrite] = Field(default_factory=list)
    allocations: list[AllocationWrite] = Field(default_factory=list)
    price_tiers: list[PriceTierWrite] = Field(default_factory=list)
    cost_lines: list[CostLineWrite] = Field(default_factory=list)
    calendar_breaks: list[CalendarBreakWrite] = Field(default_factory=list)
    expected_version: int | None = None

    @model_validator(mode="after")
    def _referential_integrity(self) -> EstimateContentWrite:
        role_codes = [r.code for r in self.roles]
        if len(role_codes) != len(set(role_codes)):
            raise ValueError("two roles share a code")
        phase_codes = [p.code for p in self.phases]
        if len(phase_codes) != len(set(phase_codes)):
            raise ValueError("two phases share a code")
        tier_names = [t.name for t in self.price_tiers]
        if len(tier_names) != len(set(tier_names)):
            raise ValueError("two price tiers share a name")
        if self.price_tiers and sum(1 for t in self.price_tiers if t.is_primary) != 1:
            raise ValueError(
                "exactly one price tier is the primary one (the rates as "
                "entered); the others are ratios of it"
            )

        known_roles = set(role_codes)
        known_phases = set(phase_codes)
        for phase in self.phases:
            for task in phase.tasks:
                for effort in task.efforts:
                    if effort.role_code not in known_roles:
                        raise ValueError(
                            f"phase {phase.code} task {task.number}: role "
                            f"{effort.role_code} is not in this estimate"
                        )
        seen_alloc: set[tuple[str, str]] = set()
        for alloc in self.allocations:
            if alloc.phase_code not in known_phases:
                raise ValueError(
                    f"allocation names phase {alloc.phase_code}, which is not "
                    "in this estimate"
                )
            if alloc.role_code not in known_roles:
                raise ValueError(
                    f"allocation names role {alloc.role_code}, which is not "
                    "in this estimate"
                )
            key = (alloc.phase_code, alloc.role_code)
            if key in seen_alloc:
                raise ValueError(
                    f"phase {alloc.phase_code} allocates role {alloc.role_code} twice"
                )
            seen_alloc.add(key)
        for line in self.cost_lines:
            if line.phase_code is not None and line.phase_code not in known_phases:
                raise ValueError(
                    f"cost line {line.label} names phase {line.phase_code}, "
                    "which is not in this estimate"
                )
        return self


# ---------------------------------------------------------------------------
# Reads of the content graph
# ---------------------------------------------------------------------------


class TaskEffortRead(BaseModel):
    role_id: UUID
    role_code: str
    planned_person_days: Decimal


class PhaseTaskRead(BaseModel):
    id: UUID
    number: str
    title: str
    requirement_refs: str | None
    planned_start: date | None
    planned_end: date | None
    is_critical: bool
    status: TaskStatus
    sort_order: int
    efforts: list[TaskEffortRead]


class PhaseRead(BaseModel):
    id: UUID
    code: str
    name: str
    sort_order: int
    planned_start: date | None
    planned_end: date | None
    stated_working_weeks: Decimal | None
    gate_criteria: str
    actual_start: date | None
    actual_end: date | None
    gate_status: GateStatus
    gate_decided_at: date | None
    gate_notes: str
    tasks: list[PhaseTaskRead]


class RoleRead(BaseModel):
    id: UUID
    code: str
    name: str
    responsibility: str
    day_rate_micros: int | None
    currency: str | None
    client_side: bool
    sort_order: int


class AllocationRead(BaseModel):
    phase_id: UUID
    phase_code: str
    role_id: UUID
    role_code: str
    fte: Decimal


class PriceTierRead(BaseModel):
    id: UUID
    name: str
    multiplier: Decimal
    is_primary: bool
    sort_order: int


class CostLineRead(BaseModel):
    id: UUID
    kind: CostLineKind
    label: str
    basis: str
    low_micros: int | None
    high_micros: int | None
    currency: str | None
    phase_id: UUID | None
    phase_code: str | None
    run_model: str | None
    sort_order: int


class CalendarBreakRead(BaseModel):
    id: UUID
    label: str
    start_date: date
    end_date: date


class EstimateDetail(BaseModel):
    """The head row plus its whole content graph — what the editor loads."""

    estimate: EstimateSummary
    roles: list[RoleRead]
    phases: list[PhaseRead]
    allocations: list[AllocationRead]
    price_tiers: list[PriceTierRead]
    cost_lines: list[CostLineRead]
    calendar_breaks: list[CalendarBreakRead]
