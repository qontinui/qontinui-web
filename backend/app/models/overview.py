"""Project Overview — the estimate baseline (``overview.*``).

Phase 2 of ``2026-09-19-project-overview-for-business-leaders``. Mirrors
alembic revision ``overview_01_estimate_baseline``; read that migration's
docstring for the design rationale (micros money, derived-not-stored figures,
the deliberately independent effort tables).

These are the FIRST ORM models bound to the web-owned ``overview`` schema.
``tests/conftest.py``'s ``test_engine`` derives the schemas to create from
``Base.metadata``, so the bindings below are what make ``overview`` appear in
a freshly-built test database; ``tests/test_overview_estimates_api.py``
asserts the tables really land there rather than trusting that it works.

Scoping: every row carries ``tenant_id`` — the active coord tenant, which is
what "project" means on these pages. There is no FK (coord's tenants live in
coord's deployment), so every query filters on it explicitly. Nothing here
reads or references a ``coord.*`` table.
"""

from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    CHAR,
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

#: How labour is paid for on this project. ``unbilled`` — effort may be
#: recorded, and costs nothing; ``day_rates`` — logged effort × the role's
#: rate is a real cost; ``fixed_fee`` — labour is billed as fee instalments
#: entered as cost entries. Enforced by ``ck_overview_settings_labour_billing``.
LABOUR_BILLING_MODES: tuple[str, ...] = ("unbilled", "day_rates", "fixed_fee")

#: What an estimate IS, which decides every word the pages use about it.
#: ``budget`` — money the project is expected to spend, so actuals are tracked
#: *against* it; ``comparison`` — what conventional delivery would cost, so
#: actuals are shown *beside* it and the difference is a saving; ``forecast``
#: — a projection with no commitment. Enforced by
#: ``ck_overview_estimates_purpose``. The wording each one implies lives in
#: ONE place on the frontend (``components/overview/vocabulary.ts``) so no
#: page can show budget language for a comparison estimate.
ESTIMATE_PURPOSES: tuple[str, ...] = ("budget", "comparison", "forecast")

#: Where an estimate is in its own approval life. Enforced by
#: ``ck_overview_estimates_status``.
ESTIMATE_STATUSES: tuple[str, ...] = (
    "draft",
    "for_decision",
    "approved",
    "superseded",
)

#: Whether a phase's gate has been demonstrated. Enforced by
#: ``ck_overview_phases_gate_status``.
GATE_STATUSES: tuple[str, ...] = ("pending", "passed", "failed", "waived")

#: Enforced by ``ck_overview_phase_tasks_status``.
TASK_STATUSES: tuple[str, ...] = ("planned", "in_progress", "done")

#: Enforced by ``ck_overview_cost_lines_kind``.
COST_LINE_KINDS: tuple[str, ...] = ("build_non_labour", "run_annual")

_SCHEMA = "overview"


def _now() -> datetime:
    return datetime.now(UTC)


class _AuditMixin:
    """``created_by`` / ``updated_by`` / ``created_at`` / ``updated_at`` —
    the four columns every overview table carries."""

    created_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_now,
        server_default=text("now()"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_now,
        onupdate=_now,
        server_default=text("now()"),
    )


class OverviewSettings(_AuditMixin, Base):
    """Per-project settings. One row per tenant, created on first write.

    A project with no row is not a project with no settings — it is a project
    whose settings are the documented defaults, which is what the read
    endpoint returns (never an empty object and never a 404).
    """

    __tablename__ = "settings"
    __table_args__ = (
        CheckConstraint(
            "labour_billing IN ('unbilled', 'day_rates', 'fixed_fee')",
            name="ck_overview_settings_labour_billing",
        ),
        CheckConstraint(
            "hours_per_day > 0 AND hours_per_day <= 24",
            name="ck_overview_settings_hours_per_day",
        ),
        CheckConstraint(
            "working_day_factor > 0 AND working_day_factor <= 1",
            name="ck_overview_settings_working_day_factor",
        ),
        {"schema": _SCHEMA},
    )

    tenant_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)

    base_currency: Mapped[str] = mapped_column(
        CHAR(3), nullable=False, server_default=text("'USD'"), default="USD"
    )
    #: ``{"<CUR>": {"rate": "0.92", "as_of": "2026-01-01", "note": "…"}}`` —
    #: entered by hand (usually the estimate's own stated assumptions). There
    #: is no live FX feed; Phase 4 is what consumes these.
    fx_rates: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb"), default=dict
    )
    labour_billing: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'unbilled'"), default="unbilled"
    )
    hours_per_day: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, server_default=text("8"), default=Decimal("8")
    )
    #: The share of a nominal working day actually available (holidays aside):
    #: 0.9 in the reference delivery plan. Applied to every derived
    #: working-day count.
    working_day_factor: Mapped[Decimal] = mapped_column(
        Numeric(6, 4),
        nullable=False,
        server_default=text("1.0"),
        default=Decimal("1.0"),
    )
    first_value_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    version: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("1"), default=1
    )


class Estimate(_AuditMixin, Base):
    """One estimate — a named, versionable baseline for a project."""

    __tablename__ = "estimates"
    __table_args__ = (
        CheckConstraint(
            "purpose IN ('budget', 'comparison', 'forecast')",
            name="ck_overview_estimates_purpose",
        ),
        CheckConstraint(
            "status IN ('draft', 'for_decision', 'approved', 'superseded')",
            name="ck_overview_estimates_status",
        ),
        CheckConstraint(
            "contingency_pct IS NULL OR contingency_pct >= 0",
            name="ck_overview_estimates_contingency_pct",
        ),
        Index("ix_overview_estimates_tenant", "tenant_id"),
        Index(
            "uq_overview_estimates_baseline",
            "tenant_id",
            unique=True,
            postgresql_where=text("is_baseline"),
        ),
        {"schema": _SCHEMA},
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )
    tenant_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)

    name: Mapped[str] = mapped_column(Text, nullable=False)
    purpose: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'draft'"), default="draft"
    )
    is_baseline: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false"), default=False
    )
    #: Soft link to the delivery-plan document in ``overview.pages`` (Phase 7).
    #: No FK, allowed to dangle.
    source_page_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), nullable=True
    )
    accuracy_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    contingency_pct: Mapped[Decimal | None] = mapped_column(
        Numeric(6, 3), nullable=True
    )
    notes: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("''"), default=""
    )
    #: Bumped by every write to this estimate or its content graph. The
    #: content-replace endpoint takes it as ``expected_version`` and refuses a
    #: write built on a copy the server has moved past.
    version: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("1"), default=1
    )

    phases: Mapped[list["Phase"]] = relationship(
        back_populates="estimate",
        cascade="all, delete-orphan",
        order_by="Phase.sort_order",
    )
    roles: Mapped[list["EstimateRole"]] = relationship(
        back_populates="estimate",
        cascade="all, delete-orphan",
        order_by="EstimateRole.sort_order",
    )
    price_tiers: Mapped[list["PriceTier"]] = relationship(
        back_populates="estimate",
        cascade="all, delete-orphan",
        order_by="PriceTier.sort_order",
    )
    cost_lines: Mapped[list["CostLine"]] = relationship(
        back_populates="estimate",
        cascade="all, delete-orphan",
        order_by="CostLine.sort_order",
    )
    calendar_breaks: Mapped[list["CalendarBreak"]] = relationship(
        back_populates="estimate",
        cascade="all, delete-orphan",
        order_by="CalendarBreak.start_date",
    )


class Phase(_AuditMixin, Base):
    """A delivery phase: dates, a gate to demonstrate, and its tasks."""

    __tablename__ = "phases"
    __table_args__ = (
        CheckConstraint(
            "stated_working_weeks IS NULL OR stated_working_weeks >= 0",
            name="ck_overview_phases_stated_working_weeks",
        ),
        CheckConstraint(
            "gate_status IN ('pending', 'passed', 'failed', 'waived')",
            name="ck_overview_phases_gate_status",
        ),
        CheckConstraint(
            "planned_start IS NULL OR planned_end IS NULL "
            "OR planned_end >= planned_start",
            name="ck_overview_phases_planned_order",
        ),
        CheckConstraint(
            "actual_start IS NULL OR actual_end IS NULL OR actual_end >= actual_start",
            name="ck_overview_phases_actual_order",
        ),
        UniqueConstraint("estimate_id", "code", name="uq_overview_phases_code"),
        Index("ix_overview_phases_tenant", "tenant_id"),
        Index("ix_overview_phases_estimate", "estimate_id", "sort_order"),
        {"schema": _SCHEMA},
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )
    tenant_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    estimate_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(f"{_SCHEMA}.estimates.id", ondelete="CASCADE"),
        nullable=False,
    )

    code: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0"), default=0
    )
    planned_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    planned_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    #: What the SOURCE PLAN said the phase's working weeks were — never a
    #: cache of the derived figure. The rollup reports both, so a
    #: disagreement is visible instead of silently resolved.
    stated_working_weeks: Mapped[Decimal | None] = mapped_column(
        Numeric(8, 2), nullable=True
    )
    gate_criteria: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("''"), default=""
    )
    actual_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    actual_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    gate_status: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'pending'"), default="pending"
    )
    gate_decided_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    gate_notes: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("''"), default=""
    )

    estimate: Mapped[Estimate] = relationship(back_populates="phases")
    tasks: Mapped[list["PhaseTask"]] = relationship(
        back_populates="phase",
        cascade="all, delete-orphan",
        order_by="PhaseTask.sort_order",
    )
    allocations: Mapped[list["PhaseAllocation"]] = relationship(
        back_populates="phase", cascade="all, delete-orphan"
    )


class PhaseTask(_AuditMixin, Base):
    """A numbered task inside a phase."""

    __tablename__ = "phase_tasks"
    __table_args__ = (
        CheckConstraint(
            "status IN ('planned', 'in_progress', 'done')",
            name="ck_overview_phase_tasks_status",
        ),
        CheckConstraint(
            "planned_start IS NULL OR planned_end IS NULL "
            "OR planned_end >= planned_start",
            name="ck_overview_phase_tasks_planned_order",
        ),
        UniqueConstraint("phase_id", "number", name="uq_overview_phase_tasks_number"),
        Index("ix_overview_phase_tasks_tenant", "tenant_id"),
        Index("ix_overview_phase_tasks_phase", "phase_id", "sort_order"),
        {"schema": _SCHEMA},
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )
    tenant_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    phase_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(f"{_SCHEMA}.phases.id", ondelete="CASCADE"),
        nullable=False,
    )

    #: TEXT, not an integer: delivery plans number tasks ``1``, ``2.1``,
    #: ``A0-3``. It is an identifier, not an ordinal — ``sort_order`` is what
    #: orders them.
    number: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    requirement_refs: Mapped[str | None] = mapped_column(Text, nullable=True)
    planned_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    planned_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_critical: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false"), default=False
    )
    status: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'planned'"), default="planned"
    )
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0"), default=0
    )

    phase: Mapped[Phase] = relationship(back_populates="tasks")
    efforts: Mapped[list["TaskEffort"]] = relationship(
        back_populates="task", cascade="all, delete-orphan"
    )


class EstimateRole(_AuditMixin, Base):
    """A role the estimate prices (or, client-side, deliberately does not).

    Named ``EstimateRole`` rather than ``Role``: the repo already has several
    unrelated "role" concepts (coord tenant roles, auth roles) and an
    unqualified import would read as one of those.
    """

    __tablename__ = "roles"
    __table_args__ = (
        CheckConstraint(
            "day_rate_micros IS NULL OR day_rate_micros >= 0",
            name="ck_overview_roles_day_rate_non_negative",
        ),
        CheckConstraint(
            "(day_rate_micros IS NULL) = (currency IS NULL)",
            name="ck_overview_roles_rate_has_currency",
        ),
        UniqueConstraint("estimate_id", "code", name="uq_overview_roles_code"),
        Index("ix_overview_roles_tenant", "tenant_id"),
        Index("ix_overview_roles_estimate", "estimate_id", "sort_order"),
        {"schema": _SCHEMA},
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )
    tenant_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    estimate_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(f"{_SCHEMA}.estimates.id", ondelete="CASCADE"),
        nullable=False,
    )

    code: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    responsibility: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("''"), default=""
    )
    #: 1e-6 of one currency unit. NULL means "not priced" — which is the
    #: normal state of a ``client_side`` role and is never rendered as 0.
    #: BIGINT — a four-figure day rate is ~1e9 micros, past a 32-bit int.
    day_rate_micros: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    currency: Mapped[str | None] = mapped_column(CHAR(3), nullable=True)
    client_side: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false"), default=False
    )
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0"), default=0
    )

    estimate: Mapped[Estimate] = relationship(back_populates="roles")


class TaskEffort(_AuditMixin, Base):
    """Person-days of one role on one task. The ONLY source of person-days.

    Phase and estimate person-day totals are sums of this table. The FTE
    matrix (:class:`PhaseAllocation`) is never used to derive effort — that
    is the double-count the rollup tests exist to catch.
    """

    __tablename__ = "task_efforts"
    __table_args__ = (
        CheckConstraint(
            "planned_person_days >= 0",
            name="ck_overview_task_efforts_non_negative",
        ),
        UniqueConstraint("task_id", "role_id", name="uq_overview_task_efforts"),
        Index("ix_overview_task_efforts_tenant", "tenant_id"),
        Index("ix_overview_task_efforts_role", "role_id"),
        {"schema": _SCHEMA},
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )
    tenant_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    task_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(f"{_SCHEMA}.phase_tasks.id", ondelete="CASCADE"),
        nullable=False,
    )
    role_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(f"{_SCHEMA}.roles.id", ondelete="CASCADE"),
        nullable=False,
    )
    planned_person_days: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)

    task: Mapped[PhaseTask] = relationship(back_populates="efforts")
    role: Mapped[EstimateRole] = relationship()


class PhaseAllocation(_AuditMixin, Base):
    """The FTE matrix cell: how much of a role a phase needs.

    Kept independent of :class:`TaskEffort` on purpose — delivery plans state
    the two separately and they need not reconcile exactly. Team size (average
    and peak FTE) comes from here; person-days never do.
    """

    __tablename__ = "phase_allocations"
    __table_args__ = (
        CheckConstraint("fte >= 0", name="ck_overview_phase_allocations_non_negative"),
        UniqueConstraint("phase_id", "role_id", name="uq_overview_phase_allocations"),
        Index("ix_overview_phase_allocations_tenant", "tenant_id"),
        Index("ix_overview_phase_allocations_role", "role_id"),
        {"schema": _SCHEMA},
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )
    tenant_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    phase_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(f"{_SCHEMA}.phases.id", ondelete="CASCADE"),
        nullable=False,
    )
    role_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(f"{_SCHEMA}.roles.id", ondelete="CASCADE"),
        nullable=False,
    )
    fte: Mapped[Decimal] = mapped_column(Numeric(8, 3), nullable=False)

    phase: Mapped[Phase] = relationship(back_populates="allocations")
    role: Mapped[EstimateRole] = relationship()


class PriceTier(_AuditMixin, Base):
    """An optional pricing tier — "Low" / "Midpoint" / "High".

    Zero rows means one price (the rates as entered). The primary tier is the
    rates as entered; every other tier is a ratio of it.
    """

    __tablename__ = "price_tiers"
    __table_args__ = (
        CheckConstraint("multiplier > 0", name="ck_overview_price_tiers_multiplier"),
        UniqueConstraint("estimate_id", "name", name="uq_overview_price_tiers_name"),
        Index("ix_overview_price_tiers_tenant", "tenant_id"),
        Index(
            "uq_overview_price_tiers_primary",
            "estimate_id",
            unique=True,
            postgresql_where=text("is_primary"),
        ),
        {"schema": _SCHEMA},
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )
    tenant_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    estimate_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(f"{_SCHEMA}.estimates.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    multiplier: Mapped[Decimal] = mapped_column(Numeric(8, 4), nullable=False)
    is_primary: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false"), default=False
    )
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0"), default=0
    )

    estimate: Mapped[Estimate] = relationship(back_populates="price_tiers")


class CostLine(_AuditMixin, Base):
    """A non-labour cost the estimate carries: a build item or an annual run
    cost, each a low–high band with a stated basis."""

    __tablename__ = "cost_lines"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('build_non_labour', 'run_annual')",
            name="ck_overview_cost_lines_kind",
        ),
        CheckConstraint(
            "low_micros IS NULL OR low_micros >= 0",
            name="ck_overview_cost_lines_low_non_negative",
        ),
        CheckConstraint(
            "high_micros IS NULL OR high_micros >= 0",
            name="ck_overview_cost_lines_high_non_negative",
        ),
        CheckConstraint(
            "low_micros IS NULL OR high_micros IS NULL OR high_micros >= low_micros",
            name="ck_overview_cost_lines_band",
        ),
        CheckConstraint(
            "(low_micros IS NULL AND high_micros IS NULL) = (currency IS NULL)",
            name="ck_overview_cost_lines_amount_has_currency",
        ),
        Index("ix_overview_cost_lines_tenant", "tenant_id"),
        Index("ix_overview_cost_lines_estimate", "estimate_id", "kind", "sort_order"),
        {"schema": _SCHEMA},
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )
    tenant_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    estimate_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(f"{_SCHEMA}.estimates.id", ondelete="CASCADE"),
        nullable=False,
    )
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    label: Mapped[str] = mapped_column(Text, nullable=False)
    basis: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("''"), default=""
    )
    low_micros: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    high_micros: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    currency: Mapped[str | None] = mapped_column(CHAR(3), nullable=True)
    phase_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(f"{_SCHEMA}.phases.id", ondelete="SET NULL"),
        nullable=True,
    )
    #: Free text, e.g. "managed service" / "in-house" — the reference plan
    #: prices run cost under two competing models.
    run_model: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0"), default=0
    )

    estimate: Mapped[Estimate] = relationship(back_populates="cost_lines")


class CalendarBreak(_AuditMixin, Base):
    """A holiday or shutdown that removes working days from every phase it
    overlaps."""

    __tablename__ = "calendar_breaks"
    __table_args__ = (
        CheckConstraint(
            "end_date >= start_date", name="ck_overview_calendar_breaks_order"
        ),
        Index("ix_overview_calendar_breaks_tenant", "tenant_id"),
        Index("ix_overview_calendar_breaks_estimate", "estimate_id", "start_date"),
        {"schema": _SCHEMA},
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )
    tenant_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    estimate_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(f"{_SCHEMA}.estimates.id", ondelete="CASCADE"),
        nullable=False,
    )
    label: Mapped[str] = mapped_column(Text, nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)

    estimate: Mapped[Estimate] = relationship(back_populates="calendar_breaks")
