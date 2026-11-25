"""Wire shapes of ``GET /api/v1/overview/schedule``.

Plan ``2026-11-25-overview-timeline-and-milestones-derive-from-coord`` D1/D4:
one derived envelope, every figure a :class:`Resolved` that says whether it is
known or unknown, where it came from, and when it was read.

``UnknownReason`` is the closed set D4 names, extended by the three reasons the
forecast already uses (``phase_dates_missing``, ``no_phases``, ``no_calendar``)
and by ``truncated`` (a bounded read that hit its bound, D8): a figure coord
could not give is NEVER rendered as a default, so each of those has to be nameable.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, PrivateAttr

UnknownReason = Literal[
    "coord_unreachable",
    "coord_denied",
    "coord_stale",
    "no_programme",
    "ambiguous_programme",
    "not_declared",
    "not_recorded",
    "ship_retracted",
    "tenant_mismatch",
    "unparseable",
    "truncated",
    "phase_dates_missing",
    "no_phases",
    "no_calendar",
]
ResolvedState = Literal["known", "unknown"]
SourceKind = Literal[
    "coord_work_unit",
    "coord_delivery",
    "coord_document",
    "coord_gates",
    "derived",
]
Door = Literal["operator", "device"]
PhaseState = Literal["planned", "in_progress", "done", "not_confirmed"]
MilestoneStatus = Literal["met", "not_met", "not_confirmed"]
GateVerdict = Literal["pending", "passed", "failed"]


class ResolvedSource(BaseModel):
    kind: SourceKind
    label: str
    version: int | None = None


class Resolved[T](BaseModel):
    """One figure with its provenance (plan D1/D4/D5).

    ``state == "known"``: ``value`` is coord's. ``"unknown"``: ``value`` is
    null and ``unknown_reason`` says why. There is no third state: the overview
    is derived only from coord (plan D5). ``stale`` is true only on a figure served from the
    last good read after a coord failure; its ``observed_at`` is the old read's.
    """

    value: T | None = None
    state: ResolvedState
    source: ResolvedSource
    observed_at: datetime
    unknown_since: datetime | None = None
    unknown_reason: UnknownReason | None = None
    stale: bool = False


class UnitRef(BaseModel):
    slug: str
    title: str | None = None


class ReadExtent(BaseModel):
    """How much of a bounded read was made (D8): never a silent cap."""

    read: int
    total: int | None = None
    truncated: bool = False


class PhaseView(BaseModel):
    index: int
    code: str
    name: str
    #: Whether any work unit is linked to this phase (D2 "Phase links").
    linked: bool
    state: Resolved[PhaseState]
    actual_start: Resolved[date]
    actual_end: Resolved[date]
    planned_end: Resolved[date]
    milestone_id: str | None = None


class MilestoneView(BaseModel):
    id: str | None = None
    name: str
    shown_by: str = ""
    target_date: Resolved[date]
    status: Resolved[MilestoneStatus]
    met_at: Resolved[date]
    #: ``decision_record/<name>`` the milestone cites, with the version read.
    decision_record: str | None = None
    decision_record_version: int | None = None


class MilestonesSection(BaseModel):
    items: Resolved[list[MilestoneView]]
    #: Rows coord holds that could not be read, verbatim (never dropped).
    unreadable_rows: list[str] = Field(default_factory=list)


class GateView(BaseModel):
    id: str
    #: The gate's anchor name (``phase_name``), the tenant's own words.
    title: str
    verdict: GateVerdict
    decided_at: datetime | None = None
    unit_slug: str | None = None


class OtherChecks(BaseModel):
    """Gates that are execution plumbing, counted so the omission is visible."""

    total: int
    truncated: bool = False


class GatesSection(BaseModel):
    items: Resolved[list[GateView]]
    other_checks_not_shown: OtherChecks
    withdrawn_not_shown: int = 0
    read: ReadExtent


class SchedulePhaseRef(BaseModel):
    code: str
    name: str


class ForecastValue(BaseModel):
    planned_finish: date | None = None
    forecast_finish: date | None = None
    slip_days: int | None = None
    position: str
    current_phase: SchedulePhaseRef | None = None
    next_phase: SchedulePhaseRef | None = None


class InitiativeView(BaseModel):
    name: str
    version: int | None = None
    starts: Resolved[date]
    ends: Resolved[date]


class SourceStamp(BaseModel):
    kind: SourceKind
    label: str
    version: int | None = None
    observed_at: datetime


class ScheduleEnvelope(BaseModel):
    tenant_id: UUID
    door: Door
    observed_at: datetime
    #: True when served from the last good read after a coord failure (D8).
    stale: bool = False
    programme: Resolved[UnitRef]
    initiative: InitiativeView
    phases: Resolved[list[PhaseView]]
    #: Phase entries coord holds that could not be read, verbatim.
    unreadable_phases: list[str] = Field(default_factory=list)
    milestones: MilestonesSection
    gates: GatesSection
    forecast: Resolved[ForecastValue]
    work_units: ReadExtent
    sources: list[SourceStamp] = Field(default_factory=list)
    #: Whether the initiative document declared a readable ``calendar:`` (plan
    #: Phase 7). Not part of the wire shape: it only decides which reason the
    #: forecast gives for being unknown.
    _calendar_declared: bool = PrivateAttr(default=False)


#: Sentinel so a ``Resolved`` JSON dump can be recognised when marking staleness.
RESOLVED_KEYS = frozenset({"state", "source", "observed_at"})


def is_resolved_dict(value: Any) -> bool:
    return isinstance(value, dict) and RESOLVED_KEYS <= value.keys()
