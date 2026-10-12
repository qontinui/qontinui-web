"""Wire shapes for the Project Overview settings and the ``estimates`` resource.

The estimate is a resource on the overview authoring contract (plan
``2026-09-20-overview-authoring-layer``, Phase 3): :class:`EstimateRead` is its
read shape, :class:`EstimateCreate` / :class:`EstimateUpdate` its write shapes,
and ``app.overview.estimates`` its store. These models are the single source of
truth — the resource catalog serves them as JSON Schemas to the editing kit.

Two conventions run through every model here:

* **Money is an integer count of micros plus an ISO 4217 currency.** One
  micro is 1e-6 of a currency unit, so 19.28 EUR is ``19280000`` with
  ``"EUR"``. There is no float anywhere in the money path, on the wire or in
  the database.

* **Children are addressed by their own CODE, not by a database id.** A
  ``task_efforts`` row names ``role_code``; an allocation names
  ``phase_code`` and ``role_code``. A content write replaces an estimate's
  whole graph in one transaction, so ids the client has never seen would be
  noise — and a code is what the source delivery plan, the CSV paste and the
  mermaid import all actually carry.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.overview.precision import numeric

LabourBilling = Literal["unbilled", "day_rates", "fixed_fee"]
EstimatePurpose = Literal["budget", "comparison", "forecast"]
EstimateStatus = Literal["draft", "for_decision", "approved", "superseded"]
GateStatus = Literal["pending", "passed", "failed", "waived"]
TaskStatus = Literal["planned", "in_progress", "done"]
CostLineKind = Literal["build_non_labour", "run_annual"]
EditingRole = Literal["admin", "agent_supervisor", "operator"]


def _default_editing_roles() -> list[EditingRole]:
    return ["admin"]


# Every decimal below is bounded to the ``NUMERIC(p, s)`` column it is stored
# in (``app.models.overview``), so an oversized value is a 422 naming the
# field rather than a database overflow. See ``app.overview.precision``.
HoursPerDay = Annotated[Decimal, numeric(5, 2, gt=0, le=24)]
WorkingDayFactor = Annotated[Decimal, numeric(6, 4, gt=0, le=1)]
ContingencyPct = Annotated[Decimal, numeric(6, 3, ge=0)]
WorkingWeeks = Annotated[Decimal, numeric(8, 2, ge=0)]
PersonDays = Annotated[Decimal, numeric(10, 2, ge=0)]
Fte = Annotated[Decimal, numeric(8, 3, ge=0)]
TierMultiplier = Annotated[Decimal, numeric(8, 4, gt=0)]

#: The largest amount of micros the API accepts. The columns are ``BIGINT``
#: (2^63 - 1), but the figure also has to survive a JSON reader that holds
#: numbers as doubles — the overview's own frontend — so the bound is the
#: largest integer a double holds exactly: 9 007 199 254.740991 currency units.
MAX_MICROS = 2**53 - 1
Micros = Annotated[int, Field(ge=0, le=MAX_MICROS)]


class _WriteModel(BaseModel):
    """Base of every overview write body: refuses a NUL character in any of
    its text, which Postgres ``text`` and ``jsonb`` (the change log) cannot
    store — without this it reaches the database and comes back a 500, not a
    422. Each nested model checks its own fields."""

    @model_validator(mode="before")
    @classmethod
    def _no_nul(cls, data: Any) -> Any:
        if isinstance(data, dict):
            for name, value in data.items():
                if isinstance(value, str) and "\x00" in value:
                    raise ValueError(f"{name} contains a NUL character")
        return data


def _normalize_currency(value: str | None) -> str | None:
    if value is None:
        return None
    code = value.strip().upper()
    if len(code) != 3 or not (code.isascii() and code.isalpha()):
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
    editing_roles: list[EditingRole] = Field(default_factory=_default_editing_roles)

    @field_validator("editing_roles", mode="before")
    @classmethod
    def _null_reads_as_admins(cls, v: object) -> object:
        # The column is nullable only so its migration is provably additive;
        # a NULL means the default, never "nobody".
        return _default_editing_roles() if v is None else v

    version: int
    is_default: bool = False
    updated_at: datetime | None = None
    updated_by: str | None = None


class OverviewSettingsWrite(_WriteModel):
    base_currency: str = "USD"
    fx_rates: dict[str, Any] = Field(default_factory=dict)
    labour_billing: LabourBilling = "unbilled"
    hours_per_day: HoursPerDay = Decimal("8")
    working_day_factor: WorkingDayFactor = Decimal("1.0")
    first_value_date: date | None = None
    #: Which tenant roles may edit the overview. ``None`` (the default) leaves
    #: the stored set alone — this PUT otherwise replaces every field, and a
    #: client that predates the setting must not silently reset it. ``admin``
    #: must be in any set given.
    editing_roles: list[EditingRole] | None = None
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

    @field_validator("editing_roles")
    @classmethod
    def _editing_roles(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return None
        if "admin" not in v:
            raise ValueError(
                "editing_roles must include admin — the setting widens who "
                "may edit, it cannot lock the project's administrators out"
            )
        return sorted(set(v))


# ---------------------------------------------------------------------------
# The content graph — phases, tasks, efforts, roles, tiers, cost lines, breaks
# ---------------------------------------------------------------------------
#
# Every list is capped. The caps are far above anything a delivery plan holds;
# they exist so one request cannot ask the database to insert a million rows
# in a single transaction.

MAX_ROLES = 500
MAX_PHASES = 500
MAX_TASKS_PER_PHASE = 1_000
MAX_EFFORTS_PER_TASK = 500
MAX_ALLOCATIONS = 20_000
MAX_PRICE_TIERS = 50
MAX_COST_LINES = 2_000
MAX_CALENDAR_BREAKS = 1_000


class TaskEffortWrite(_WriteModel):
    role_code: str = Field(min_length=1, max_length=50)
    planned_person_days: PersonDays


class PhaseTaskWrite(_WriteModel):
    number: str = Field(min_length=1, max_length=50)
    title: str = Field(min_length=1, max_length=400)
    requirement_refs: str | None = None
    planned_start: date | None = None
    planned_end: date | None = None
    is_critical: bool = False
    status: TaskStatus = "planned"
    efforts: list[TaskEffortWrite] = Field(
        default_factory=list, max_length=MAX_EFFORTS_PER_TASK
    )

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


#: A phase's PROGRESS — what actually happened, recorded on the Timeline
#: through the ``phase_progress`` resource. A content write does not carry
#: these: it owns the plan, and a phase it keeps (by code) keeps its progress.
PHASE_PROGRESS_FIELDS: tuple[str, ...] = (
    "actual_start",
    "actual_end",
    "gate_status",
    "gate_decided_at",
    "gate_notes",
)


class PhaseWrite(_WriteModel):
    """A phase as the PLAN states it.

    Progress (actual dates, the gate's outcome) is not part of it: it is
    written through ``phase_progress``, with its own version, so the estimate
    editor and the Timeline can never overwrite each other's fields. A content
    write naming a progress field is refused rather than half-applied.
    """

    code: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=200)
    planned_start: date | None = None
    planned_end: date | None = None
    #: What the SOURCE plan stated. The rollup computes its own figure and
    #: reports both, so a disagreement is visible rather than overwritten.
    stated_working_weeks: WorkingWeeks | None = None
    gate_criteria: str = ""
    tasks: list[PhaseTaskWrite] = Field(
        default_factory=list, max_length=MAX_TASKS_PER_PHASE
    )

    @model_validator(mode="before")
    @classmethod
    def _no_progress_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            named = [f for f in PHASE_PROGRESS_FIELDS if f in data]
            if named:
                raise ValueError(
                    f"phase {data.get('code', '?')}: {', '.join(named)} "
                    "describe what happened, not the plan — record them "
                    "through /phase-progress"
                )
        return data

    @model_validator(mode="after")
    def _dates_and_tasks(self) -> PhaseWrite:
        if (
            self.planned_start
            and self.planned_end
            and self.planned_end < self.planned_start
        ):
            raise ValueError(f"phase {self.code}: planned_end is before planned_start")
        numbers = [t.number for t in self.tasks]
        if len(numbers) != len(set(numbers)):
            raise ValueError(f"phase {self.code}: two tasks share a number")
        return self


class RoleWrite(_WriteModel):
    code: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=200)
    responsibility: str = ""
    day_rate_micros: Micros | None = None
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


class AllocationWrite(_WriteModel):
    phase_code: str = Field(min_length=1, max_length=50)
    role_code: str = Field(min_length=1, max_length=50)
    fte: Fte


class PriceTierWrite(_WriteModel):
    name: str = Field(min_length=1, max_length=100)
    multiplier: TierMultiplier
    is_primary: bool = False


class CostLineWrite(_WriteModel):
    kind: CostLineKind
    label: str = Field(min_length=1, max_length=200)
    basis: str = ""
    low_micros: Micros | None = None
    high_micros: Micros | None = None
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


class CalendarBreakWrite(_WriteModel):
    label: str = Field(min_length=1, max_length=200)
    start_date: date
    end_date: date

    @model_validator(mode="after")
    def _order(self) -> CalendarBreakWrite:
        if self.end_date < self.start_date:
            raise ValueError(f"break {self.label}: end_date is before start_date")
        return self


class EstimateContentWrite(_WriteModel):
    """The estimate's whole content graph, replaced in one transaction.

    Replace-the-whole-graph rather than per-row CRUD, because that is the
    shape every source actually has: a CSV paste is a whole table, a mermaid
    ``gantt`` block is a whole schedule, and the editor shows the result for
    confirmation before anything is saved. It also means an import can never
    half-land. It travels as the ``content`` field of an estimate create or
    update, so it shares that write's ``If-Match``, audit row and version.
    """

    roles: list[RoleWrite] = Field(default_factory=list, max_length=MAX_ROLES)
    phases: list[PhaseWrite] = Field(default_factory=list, max_length=MAX_PHASES)
    allocations: list[AllocationWrite] = Field(
        default_factory=list, max_length=MAX_ALLOCATIONS
    )
    price_tiers: list[PriceTierWrite] = Field(
        default_factory=list, max_length=MAX_PRICE_TIERS
    )
    cost_lines: list[CostLineWrite] = Field(
        default_factory=list, max_length=MAX_COST_LINES
    )
    calendar_breaks: list[CalendarBreakWrite] = Field(
        default_factory=list, max_length=MAX_CALENDAR_BREAKS
    )

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
# The estimate's write shapes
# ---------------------------------------------------------------------------


class EstimateCreate(_WriteModel):
    name: str = Field(min_length=1, max_length=200)
    purpose: EstimatePurpose
    status: EstimateStatus = "draft"
    #: Marking it the baseline un-marks whichever estimate held that flag.
    is_baseline: bool = False
    #: The delivery-plan DOCUMENT of this project it was built from. Anything
    #: else (a wiki page, another project's document, an unknown id) is a 422.
    source_page_id: UUID | None = None
    accuracy_note: str | None = None
    contingency_pct: ContingencyPct | None = None
    notes: str = ""
    #: The content graph to start from, so an import can create a complete
    #: estimate in one request. Absent: an empty estimate.
    content: EstimateContentWrite | None = None


class EstimateUpdate(_WriteModel):
    """Every field optional — an absent field is left alone.

    ``None`` is a real value for the nullable fields (it clears them), so the
    store distinguishes "absent" from "null" with ``exclude_unset``. ``content``
    replaces the whole graph; it and the head fields land in ONE version, so a
    save that also records its source document cannot half-land.
    """

    name: str | None = Field(default=None, min_length=1, max_length=200)
    purpose: EstimatePurpose | None = None
    status: EstimateStatus | None = None
    is_baseline: bool | None = None
    source_page_id: UUID | None = None
    accuracy_note: str | None = None
    contingency_pct: ContingencyPct | None = None
    notes: str | None = None
    content: EstimateContentWrite | None = None

    #: Fields whose column is NOT NULL (and ``content``, which has no "none").
    #: Every field here is typed `X | None` so that ABSENT can be told from
    #: null, which means an explicit null reaches the store looking exactly
    #: like a value — and would land as an IntegrityError 500 rather than a
    #: 422. Each one is rejected as the 422 it is.
    _NOT_NULLABLE = ("name", "purpose", "status", "is_baseline", "notes", "content")

    @model_validator(mode="after")
    def _no_explicit_nulls_on_required_fields(self) -> EstimateUpdate:
        if not self.model_fields_set:
            raise ValueError("give at least one field to change")
        nulled = [
            field
            for field in self._NOT_NULLABLE
            if field in self.model_fields_set and getattr(self, field) is None
        ]
        if nulled:
            raise ValueError(
                "these cannot be cleared, only changed: " + ", ".join(nulled)
            )
        return self


# ---------------------------------------------------------------------------
# The estimate's read shape
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


class EstimateContent(BaseModel):
    """The whole content graph as read back, every cross-reference resolved to
    its CODE as well as its id."""

    roles: list[RoleRead]
    phases: list[PhaseRead]
    allocations: list[AllocationRead]
    price_tiers: list[PriceTierRead]
    cost_lines: list[CostLineRead]
    calendar_breaks: list[CalendarBreakRead]


class EstimateRead(BaseModel):
    """One estimate: its head row and, on a single-record read, its content."""

    id: str
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
    #: The content graph. ``None`` on a LIST read — graphs are not sent in
    #: bulk — never an empty graph standing in for "not loaded".
    content: EstimateContent | None


# ---------------------------------------------------------------------------
# The Timeline: phase progress and milestones
# ---------------------------------------------------------------------------
#
# Dates a person records about the project are bounded to a range a project
# can plausibly have, in the schema rather than the form — a mistyped year
# (``0226``, ``20226``) is a 422 naming the field, never a bar drawn eighteen
# centuries off the chart. The bound is published as ``formatMinimum`` /
# ``formatMaximum`` on the field's JSON Schema, which the editing kit checks.

EARLIEST_DATE = date(1970, 1, 1)
LATEST_DATE = date(2200, 12, 31)
ProjectDate = Annotated[
    date,
    Field(
        ge=EARLIEST_DATE,
        le=LATEST_DATE,
        json_schema_extra={
            "formatMinimum": EARLIEST_DATE.isoformat(),
            "formatMaximum": LATEST_DATE.isoformat(),
        },
    ),
]

MilestoneKind = Literal["milestone", "pilot", "first_value", "other"]
MilestoneStatus = Literal["planned", "in_progress", "done", "at_risk"]

MAX_NOTES = 4_000
MAX_MILESTONE_TITLE = 200


class PhaseProgressRead(BaseModel):
    """What actually happened in one phase: its actual dates and its gate's
    outcome — the ``phase_progress`` resource. ``id`` is the phase's id.

    The plan fields beside them (code, name, planned dates, the gate's
    criteria) are the estimate's, served here so a reader of progress needs
    no second request. They are read-only on this resource and ``version``
    does not cover them: it moves when PROGRESS is written, never when the
    estimate's plan is.
    """

    id: str
    estimate_id: UUID
    code: str
    name: str
    sort_order: int
    planned_start: date | None
    planned_end: date | None
    gate_criteria: str
    actual_start: date | None
    actual_end: date | None
    gate_status: GateStatus
    gate_decided_at: date | None
    gate_notes: str
    version: int
    #: Who last recorded progress, and when — ``None`` until somebody has.
    #: An edit to the estimate's plan does not move these.
    updated_at: datetime | None
    updated_by: str | None


class PhaseProgressUpdate(_WriteModel):
    """Every field optional — an absent field is left alone; ``null`` clears a
    date. The rules (a phase ends on or after it starts, and only once it has
    started; a gate has a decision date exactly when it has been decided) are
    checked on the phase AS IT WILL BE, so a write may change one field
    without restating the others."""

    actual_start: ProjectDate | None = None
    actual_end: ProjectDate | None = None
    gate_status: GateStatus | None = None
    gate_decided_at: ProjectDate | None = None
    gate_notes: str | None = Field(default=None, max_length=MAX_NOTES)

    _NOT_NULLABLE = ("gate_status", "gate_notes")

    @model_validator(mode="after")
    def _something_and_no_cleared_required(self) -> PhaseProgressUpdate:
        if not self.model_fields_set:
            raise ValueError("give at least one field to change")
        nulled = [
            f
            for f in self._NOT_NULLABLE
            if f in self.model_fields_set and getattr(self, f) is None
        ]
        if nulled:
            raise ValueError(
                "these cannot be cleared, only changed: " + ", ".join(nulled)
            )
        return self


def phase_progress_problem(
    *,
    actual_start: date | None,
    actual_end: date | None,
    gate_status: str,
    gate_decided_at: date | None,
) -> str | None:
    """Why a phase's progress, as it would stand, is not a coherent record —
    or ``None``. Enforced by the API only: the database checks just the
    actual-date order (``ck_overview_phases_actual_order``), so a row written
    before this rule existed can break it, and its next progress write is
    refused with this sentence until the record is made coherent."""
    if actual_end is not None and actual_start is None:
        return "a phase cannot have finished without having started — give actual_start"
    if actual_start and actual_end and actual_end < actual_start:
        return "actual_end is before actual_start"
    if gate_status == "pending" and gate_decided_at is not None:
        return "a pending gate has no decision date — clear gate_decided_at"
    if gate_status != "pending" and gate_decided_at is None:
        return f"a {gate_status} gate needs the date it was decided (gate_decided_at)"
    return None


class MilestoneRead(BaseModel):
    """One milestone on the Timeline. Gates are phases, not milestones, so they
    are never duplicated here."""

    id: str
    title: str
    description: str
    kind: MilestoneKind
    #: The phase it belongs to, if any — set to null when that phase is
    #: removed from the estimate (a write of its own, in the change log).
    phase_id: UUID | None
    #: That phase's code, resolved for display; null with ``phase_id``.
    phase_code: str | None
    target_date: date
    completed_date: date | None
    status: MilestoneStatus
    version: int
    created_at: datetime
    updated_at: datetime
    created_by: str | None
    updated_by: str | None


def milestone_problem(*, status: str, completed_date: date | None) -> str | None:
    """A milestone is done exactly when it has the date it was completed."""
    if status == "done" and completed_date is None:
        return "a done milestone needs the date it was completed (completed_date)"
    if status != "done" and completed_date is not None:
        return "only a done milestone has a completed_date — mark it done or clear the date"
    return None


class MilestoneCreate(_WriteModel):
    title: str = Field(min_length=1, max_length=MAX_MILESTONE_TITLE)
    description: str = Field(default="", max_length=MAX_NOTES)
    kind: MilestoneKind = "milestone"
    #: A phase of this project's estimates, or nothing. Anything else is a
    #: 422 ``phase_not_found``.
    phase_id: UUID | None = None
    target_date: ProjectDate
    completed_date: ProjectDate | None = None
    status: MilestoneStatus = "planned"

    @field_validator("title")
    @classmethod
    def _title(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("title cannot be blank")
        return v

    @model_validator(mode="after")
    def _done_has_a_date(self) -> MilestoneCreate:
        problem = milestone_problem(
            status=self.status, completed_date=self.completed_date
        )
        if problem:
            raise ValueError(problem)
        return self


class MilestoneUpdate(_WriteModel):
    """Every field optional — an absent field is left alone. The done/date rule
    is checked on the milestone as it will be (by the store)."""

    title: str | None = Field(
        default=None, min_length=1, max_length=MAX_MILESTONE_TITLE
    )
    description: str | None = Field(default=None, max_length=MAX_NOTES)
    kind: MilestoneKind | None = None
    phase_id: UUID | None = None
    target_date: ProjectDate | None = None
    completed_date: ProjectDate | None = None
    status: MilestoneStatus | None = None

    _NOT_NULLABLE = ("title", "description", "kind", "target_date", "status")

    @field_validator("title")
    @classmethod
    def _title(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not v:
            raise ValueError("title cannot be blank")
        return v

    @model_validator(mode="after")
    def _something_and_no_cleared_required(self) -> MilestoneUpdate:
        if not self.model_fields_set:
            raise ValueError("give at least one field to change")
        nulled = [
            f
            for f in self._NOT_NULLABLE
            if f in self.model_fields_set and getattr(self, f) is None
        ]
        if nulled:
            raise ValueError(
                "these cannot be cleared, only changed: " + ", ".join(nulled)
            )
        return self


# ---------------------------------------------------------------------------
# The Timeline's derived figures (GET /estimates/{id}/forecast)
# ---------------------------------------------------------------------------

PhaseState = Literal["not_started", "in_progress", "done"]
SchedulePosition = Literal[
    "no_phases", "not_started", "in_progress", "between_phases", "finished"
]


class PhaseRef(BaseModel):
    id: UUID
    code: str
    name: str


class GateRef(PhaseRef):
    criteria: str


class PhaseForecast(PhaseRef):
    state: PhaseState
    #: For a done phase, what happened; otherwise the forecast. ``None`` when
    #: the phase has no planned dates to forecast from.
    forecast_start: date | None
    forecast_end: date | None
    #: Calendar days later (positive) or earlier (negative) than planned.
    start_slip_days: int | None
    finish_slip_days: int | None


class ForecastUnavailable(BaseModel):
    figure: str
    reason: str
    detail: str


class TimelineForecast(BaseModel):
    """Where an estimate's delivery stands against its plan, computed on read
    (``app.services.overview_forecast`` documents the model). A figure the
    forecast cannot produce is ``None`` and named in ``unavailable`` — never 0.
    """

    estimate_id: UUID
    #: The estimate version the figures were computed from.
    estimate_version: int
    #: The day the server took as today (UTC).
    today: date
    planned_start: date | None
    planned_finish: date | None
    #: Strings, like every derived decimal on the overview.
    calendar_weeks: str | None
    working_weeks: str | None
    position: SchedulePosition
    current_phase: PhaseRef | None
    next_phase: PhaseRef | None
    #: The first phase, in plan order, whose gate is still pending.
    next_gate: GateRef | None
    forecast_finish: date | None
    #: Calendar days the forecast finish is later (positive) or earlier
    #: (negative) than the planned finish. Never shown as a bare negative: the
    #: page words it as "late" or "early".
    slip_days: int | None
    phases: list[PhaseForecast]
    unavailable: list[ForecastUnavailable]
