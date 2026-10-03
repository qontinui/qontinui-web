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
    Computed,
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
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, TSVECTOR
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

#: The coord tenant roles a project may grant overview editing to. ``admin``
#: is always among them (``ck_overview_settings_editing_roles``): widening
#: who may edit is the setting's purpose, and it must never be usable to lock
#: the project's own administrators out.
EDITING_ROLES: tuple[str, ...] = ("admin", "agent_supervisor", "operator")

#: Where a write came from. ``ui`` — the overview pages; ``api`` — any other
#: caller, including an unattended agent; ``import`` — a bulk import (CSV
#: paste, mermaid gantt). Enforced by ``ck_overview_change_log_source``.
CHANGE_SOURCES: tuple[str, ...] = ("ui", "api", "import")

#: Enforced by ``ck_overview_change_log_action``.
CHANGE_ACTIONS: tuple[str, ...] = ("create", "update", "delete")

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
        CheckConstraint(
            "editing_roles IS NULL OR ('admin' = ANY(editing_roles) AND "
            "editing_roles <@ '{admin,agent_supervisor,operator}'::text[])",
            name="ck_overview_settings_editing_roles",
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
    #: Which tenant roles may edit this project's overview. Authorization
    #: resolves it per request (``app.overview.permissions``); the same answer
    #: is served on every read so the UI renders controls from what the API
    #: enforces. Resources stored OUTSIDE this database (coord's intent
    #: documents) follow their own store's rule and ignore it.
    #: NULLABLE, and a NULL reads as ``{admin}`` everywhere (see
    #: ``app.overview.permissions``). The column is nullable only so its
    #: migration is provably additive — ``NOT NULL`` on an added column is a
    #: shape coord's migration classifier refuses to land unattended — never
    #: to give NULL a meaning of its own.
    editing_roles: Mapped[list[str] | None] = mapped_column(
        ARRAY(Text),
        nullable=True,
        server_default=text("'{admin}'::text[]"),
        default=lambda: ["admin"],
    )

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
    #: Bumped by every write to this estimate or its content graph. It is the
    #: resource's version on the authoring contract: every write names it in
    #: ``If-Match`` and is refused (409, with the server's copy) when it is
    #: built on a copy the server has moved past.
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


class ChangeLog(Base):
    """One row per write to any overview resource — the audit trail.

    Append-only. ``before`` / ``after`` are the resource's own read shape on
    either side of the write (``null`` for the side that did not exist), so
    "who changed this number, and from what" is answerable without the
    resource keeping versions of its own. ``record_id`` is TEXT because not
    every resource is keyed by a UUID: coord's intent documents are addressed
    ``<kind>:<name>``.

    ``idempotency_key`` makes a create safe to retry: a second create carrying
    the same key finds this row and returns the record it made instead of
    making another (``uq_overview_change_log_idempotency``).
    """

    __tablename__ = "change_log"
    __table_args__ = (
        CheckConstraint(
            "source IN ('ui', 'api', 'import')",
            name="ck_overview_change_log_source",
        ),
        CheckConstraint(
            "action IN ('create', 'update', 'delete')",
            name="ck_overview_change_log_action",
        ),
        Index(
            "ix_overview_change_log_record",
            "tenant_id",
            "resource",
            "record_id",
            "created_at",
        ),
        Index(
            "uq_overview_change_log_idempotency",
            "tenant_id",
            "resource",
            "idempotency_key",
            unique=True,
            postgresql_where=text("idempotency_key IS NOT NULL"),
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
    resource: Mapped[str] = mapped_column(Text, nullable=False)
    record_id: Mapped[str] = mapped_column(Text, nullable=False)
    action: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str] = mapped_column(Text, nullable=False)
    actor: Mapped[str | None] = mapped_column(Text, nullable=True)
    actor_user_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), nullable=True
    )
    version_before: Mapped[int | None] = mapped_column(Integer, nullable=True)
    version_after: Mapped[int | None] = mapped_column(Integer, nullable=True)
    before: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    after: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_now,
        server_default=text("now()"),
    )


# ---------------------------------------------------------------------------
# Documents and wiki (overview_03_documents_and_wiki)
# ---------------------------------------------------------------------------

#: What a page is. ``slides`` is admitted now (a later phase) because widening
#: the CHECK afterwards would need a DROP. Enforced by ``ck_overview_pages_kind``.
PAGE_KINDS: tuple[str, ...] = ("document", "wiki", "slides")

#: Enforced by ``ck_overview_page_links_type``.
PAGE_LINK_TYPES: tuple[str, ...] = ("wiki", "related")


#: The one spelling of the page search vector: the migration's generated
#: column and this model's declare the same expression.
PAGE_SEARCH_VECTOR_SQL = "to_tsvector('simple'::regconfig, title || ' ' || body_md)"


class Page(Base):
    """One markdown page — a document, a wiki page, or (later) a deck.

    ``current_version`` moves on every content write and is the version a
    write must name. Every such write also appends :class:`PageVersion`.
    """

    __tablename__ = "pages"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('document', 'wiki', 'slides')", name="ck_overview_pages_kind"
        ),
        UniqueConstraint("tenant_id", "kind", "slug", name="uq_overview_pages_slug"),
        Index("ix_overview_pages_tenant_kind", "tenant_id", "kind", "title"),
        Index("ix_overview_pages_search", "search_tsv", postgresql_using="gin"),
        {"schema": _SCHEMA},
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )
    tenant_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    slug: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    body_md: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("''"), default=""
    )
    doc_number: Mapped[str | None] = mapped_column(Text, nullable=True)
    doc_status: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner: Mapped[str | None] = mapped_column(Text, nullable=True)
    current_version: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("1"), default=1
    )
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
        server_default=text("now()"),
    )
    #: Postgres keeps this; it is never written and, being up to a body's size,
    #: never loaded unless asked for (search reads it in SQL only).
    search_tsv: Mapped[str] = mapped_column(
        TSVECTOR,
        Computed(PAGE_SEARCH_VECTOR_SQL, persisted=True),
        deferred=True,
    )


class PageVersion(Base):
    """A page as it stood after one content write. Append-only; a revert
    writes a NEW version copying an old one, never rewrites history."""

    __tablename__ = "page_versions"
    __table_args__ = (
        UniqueConstraint("page_id", "version", name="uq_overview_page_versions"),
        {"schema": _SCHEMA},
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )
    tenant_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    page_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(f"{_SCHEMA}.pages.id", ondelete="CASCADE"),
        nullable=False,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    body_md: Mapped[str] = mapped_column(Text, nullable=False)
    doc_number: Mapped[str | None] = mapped_column(Text, nullable=True)
    doc_status: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_now,
        server_default=text("now()"),
    )


class PageLink(Base):
    """What a page points at, by ``(to_kind, to_slug)`` — so a link to a page
    nobody has written yet is still recorded, and is a backlink the moment
    that page exists."""

    __tablename__ = "page_links"
    __table_args__ = (
        CheckConstraint(
            "link_type IN ('wiki', 'related')", name="ck_overview_page_links_type"
        ),
        CheckConstraint(
            "to_kind IN ('document', 'wiki', 'slides')",
            name="ck_overview_page_links_kind",
        ),
        Index("ix_overview_page_links_target", "tenant_id", "to_kind", "to_slug"),
        {"schema": _SCHEMA},
    )

    tenant_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    from_page_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(f"{_SCHEMA}.pages.id", ondelete="CASCADE"),
        primary_key=True,
    )
    to_kind: Mapped[str] = mapped_column(Text, primary_key=True)
    to_slug: Mapped[str] = mapped_column(Text, primary_key=True)
    link_type: Mapped[str] = mapped_column(Text, primary_key=True)


class OverviewFile(Base):
    """An uploaded file's metadata; its bytes live in object storage.

    Named ``OverviewFile`` rather than ``File`` so it cannot be mistaken for
    the builtin or for another upload model in the repo.
    """

    __tablename__ = "files"
    __table_args__ = (
        CheckConstraint("size_bytes >= 0", name="ck_overview_files_size"),
        Index("ix_overview_files_tenant", "tenant_id", "page_id"),
        {"schema": _SCHEMA},
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )
    tenant_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    page_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(f"{_SCHEMA}.pages.id", ondelete="SET NULL"),
        nullable=True,
    )
    filename: Mapped[str] = mapped_column(Text, nullable=False)
    content_type: Mapped[str] = mapped_column(Text, nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(Text, nullable=False)
    storage_key: Mapped[str] = mapped_column(Text, nullable=False)
    uploaded_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_now,
        server_default=text("now()"),
    )


# ---------------------------------------------------------------------------
# Provider-reported spend (overview_05_spend_collection)
#
# Plan ``2026-10-03-provider-reported-spend-collection-alerts-and-mobile``
# Phase 1. Every amount is the PROVIDER'S OWN STATEMENT, copied as reported
# (GitHub ``netAmount``…) or an operator-entered invoice amount (a recurring
# cost). Nothing here is estimated. Money is integer micros + ``currency``.
# ---------------------------------------------------------------------------

#: Enforced by ``ck_overview_vendors_category``.
VENDOR_CATEGORIES: tuple[str, ...] = (
    "ai",
    "cloud",
    "source_hosting",
    "saas",
    "labour",
    "other",
)

#: Every connector key the store admits. Enforced by
#: ``ck_overview_vendors_connector``; the connector REGISTRY
#: (``app.spend.connectors``) declares each one's lag and provenance, and a
#: test pins the two lists together.
SPEND_CONNECTORS: tuple[str, ...] = (
    "github_billing",
    "aws_cost_explorer",
    "vercel_billing",
    "cloudflare_billing",
    "anthropic_cost_report",
    "google_play_earnings",
    "google_workspace_seats",
    "upstash_billing",
)

#: Where a cost entry came from. Enforced by ``ck_overview_cost_entries_source``.
COST_ENTRY_SOURCES: tuple[str, ...] = ("manual", "recurring", "connector")

#: Enforced by ``ck_overview_recurring_costs_cadence``.
RECURRING_CADENCES: tuple[str, ...] = ("monthly", "annual")

#: Enforced by ``ck_overview_spend_alerts_rule``.
SPEND_ALERT_RULES: tuple[str, ...] = ("mtd_threshold", "daily_abs", "spike", "stale")

#: Push delivery state of an alert row. ``accepted`` means Expo took the
#: message (a ticket ``ok``), NOT that a phone showed it; only a receipt moves
#: it to ``delivered``. Enforced by ``ck_overview_spend_alerts_push_status``.
SPEND_PUSH_STATUSES: tuple[str, ...] = (
    "pending",
    "accepted",
    "delivered",
    "failed",
    "unknown_recipients",
    "muted",
)

#: Coord delivery state of an alert row (``POST /coord/spend-alerts``).
#: ``unsupported`` — coord answered 404/501 (the route is not deployed);
#: ``disabled`` — this backend has no coord service credential.
SPEND_COORD_STATUSES: tuple[str, ...] = (
    "pending",
    "sent",
    "failed",
    "unsupported",
    "disabled",
)

_CONNECTOR_CHECK = (
    "connector IS NULL OR connector IN ("
    + ", ".join(f"'{c}'" for c in SPEND_CONNECTORS)
    + ")"
)


class Vendor(_AuditMixin, Base):
    """Someone the project pays. A vendor row carries no money."""

    __tablename__ = "vendors"
    __table_args__ = (
        CheckConstraint(
            "category IN ('ai', 'cloud', 'source_hosting', 'saas', 'labour', 'other')",
            name="ck_overview_vendors_category",
        ),
        CheckConstraint(_CONNECTOR_CHECK, name="ck_overview_vendors_connector"),
        UniqueConstraint("tenant_id", "name", name="uq_overview_vendors_name"),
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
    category: Mapped[str] = mapped_column(Text, nullable=False)
    preset_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    connector: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: NON-SECRET connector settings only (an org name, an account id). A
    #: credential never lands in a database row (plan decision 7).
    connector_config: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb"), default=dict
    )
    version: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("1"), default=1
    )


class CostImportRun(_AuditMixin, Base):
    """One import attempt for one vendor — the freshness signal (decision 5).

    ``granularity``: ``day`` (one UTC day's statement), ``range`` (a pull over
    several days), or ``month`` (a month query read ONLY as a reconciliation
    check — it upserts nothing and never counts toward freshness).
    """

    __tablename__ = "cost_import_runs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('ok', 'failed', 'partial')",
            name="ck_overview_cost_import_runs_status",
        ),
        CheckConstraint(
            "transport IN ('push', 'pull')",
            name="ck_overview_cost_import_runs_transport",
        ),
        CheckConstraint(
            "granularity IN ('day', 'range', 'month')",
            name="ck_overview_cost_import_runs_granularity",
        ),
        Index(
            "ix_overview_cost_import_runs_vendor",
            "tenant_id",
            "vendor_id",
            "finished_at",
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
    vendor_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(f"{_SCHEMA}.vendors.id", ondelete="CASCADE"),
        nullable=False,
    )
    connector: Mapped[str] = mapped_column(Text, nullable=False)
    #: Who sent it: ``import_token:<name>`` or ``session:<actor>``.
    source: Mapped[str | None] = mapped_column(Text, nullable=True)
    transport: Mapped[str] = mapped_column(Text, nullable=False)
    granularity: Mapped[str] = mapped_column(Text, nullable=False)
    provider_endpoint: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    period_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    period_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    rows_upserted: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0"), default=0
    )
    items_seen: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0"), default=0
    )
    #: Month query net − Σ stored day entries for that month (micros). Set on
    #: ``month`` runs only; NULL means "not measured", never "no difference".
    reconcile_delta_micros: Mapped[int | None] = mapped_column(
        BigInteger, nullable=True
    )
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


class CostEntry(_AuditMixin, Base):
    """One provider line item (or a manual entry). Unique per
    ``(tenant_id, vendor_id, source_ref)`` so every import is an upsert."""

    __tablename__ = "cost_entries"
    __table_args__ = (
        CheckConstraint(
            "source IN ('manual', 'recurring', 'connector')",
            name="ck_overview_cost_entries_source",
        ),
        CheckConstraint(
            "period_end >= period_start", name="ck_overview_cost_entries_period"
        ),
        UniqueConstraint(
            "tenant_id",
            "vendor_id",
            "source_ref",
            name="uq_overview_cost_entries_source_ref",
        ),
        Index(
            "ix_overview_cost_entries_vendor_period",
            "tenant_id",
            "vendor_id",
            "period_start",
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
    vendor_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(f"{_SCHEMA}.vendors.id", ondelete="CASCADE"),
        nullable=False,
    )
    category: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("''"), default=""
    )
    #: NET — the billed figure.
    amount_micros: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(CHAR(3), nullable=False)
    fx_rate_to_base: Mapped[Decimal | None] = mapped_column(
        Numeric(18, 8), nullable=True
    )
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    phase_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(f"{_SCHEMA}.phases.id", ondelete="SET NULL"),
        nullable=True,
    )
    source: Mapped[str] = mapped_column(Text, nullable=False)
    source_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: NULL when the provider does not report them — never 0 for "unknown".
    gross_micros: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    discount_micros: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    quantity: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    unit: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: The repo, service or project the line belongs to.
    scope_label: Mapped[str | None] = mapped_column(Text, nullable=True)
    sku: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: The provider's product (GitHub ``actions`` / ``packages``…), which a
    #: rule's ``product_filter`` selects on.
    product: Mapped[str | None] = mapped_column(Text, nullable=True)
    import_run_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(f"{_SCHEMA}.cost_import_runs.id", ondelete="SET NULL"),
        nullable=True,
    )


class SpendRule(_AuditMixin, Base):
    """Alert thresholds for one vendor, or org-wide when ``vendor_id`` is NULL.
    At most one rule per (tenant, vendor) — ``uq_overview_spend_rules_vendor``."""

    __tablename__ = "spend_rules"
    __table_args__ = (
        CheckConstraint(
            "monthly_ceiling_micros IS NULL OR monthly_ceiling_micros > 0",
            name="ck_overview_spend_rules_ceiling",
        ),
        CheckConstraint(
            "daily_abs_micros IS NULL OR daily_abs_micros > 0",
            name="ck_overview_spend_rules_daily_abs",
        ),
        CheckConstraint(
            "spike_multiplier IS NULL OR spike_multiplier > 1",
            name="ck_overview_spend_rules_spike_multiplier",
        ),
        CheckConstraint(
            "median_window_days IS NULL OR "
            "(median_window_days >= 7 AND median_window_days <= 90)",
            name="ck_overview_spend_rules_window",
        ),
        Index(
            "uq_overview_spend_rules_vendor",
            text("tenant_id"),
            text("COALESCE(vendor_id, '00000000-0000-0000-0000-000000000000'::uuid)"),
            unique=True,
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
    vendor_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(f"{_SCHEMA}.vendors.id", ondelete="CASCADE"),
        nullable=True,
    )
    currency: Mapped[str] = mapped_column(
        CHAR(3), nullable=False, server_default=text("'USD'"), default="USD"
    )
    monthly_ceiling_micros: Mapped[int | None] = mapped_column(
        BigInteger, nullable=True
    )
    daily_abs_micros: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    spike_multiplier: Mapped[Decimal | None] = mapped_column(
        Numeric(6, 2), nullable=True
    )
    median_window_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    mtd_thresholds_pct: Mapped[list[int] | None] = mapped_column(
        ARRAY(Integer), nullable=True
    )
    product_filter: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)
    #: Why these values — e.g. the success metric they come from.
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    version: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("1"), default=1
    )


class RecurringCost(_AuditMixin, Base):
    """A provider invoice amount with no billing API, entered once by the
    operator (decision 10). Materialised into periods on READ, never by a cron."""

    __tablename__ = "recurring_costs"
    __table_args__ = (
        CheckConstraint(
            "cadence IN ('monthly', 'annual')",
            name="ck_overview_recurring_costs_cadence",
        ),
        CheckConstraint(
            "unit_amount_micros >= 0", name="ck_overview_recurring_costs_amount"
        ),
        CheckConstraint("quantity > 0", name="ck_overview_recurring_costs_quantity"),
        CheckConstraint(
            "end_date IS NULL OR end_date >= start_date",
            name="ck_overview_recurring_costs_period",
        ),
        Index("ix_overview_recurring_costs_vendor", "tenant_id", "vendor_id"),
        {"schema": _SCHEMA},
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )
    tenant_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    vendor_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(f"{_SCHEMA}.vendors.id", ondelete="CASCADE"),
        nullable=False,
    )
    description: Mapped[str] = mapped_column(Text, nullable=False)
    unit_amount_micros: Mapped[int] = mapped_column(BigInteger, nullable=False)
    quantity: Mapped[Decimal] = mapped_column(
        Numeric(12, 4), nullable=False, server_default=text("1"), default=Decimal("1")
    )
    currency: Mapped[str] = mapped_column(CHAR(3), nullable=False)
    cadence: Mapped[str] = mapped_column(Text, nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    #: The next charge date of an ``annual`` entry. NULL reads as the next
    #: anniversary of ``start_date``. A connector may keep it current.
    renews_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    #: e.g. a domain name, so a connector can find the entry to update.
    external_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: e.g. "Workspace invoice 2026-09, 3 seats".
    source_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    version: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("1"), default=1
    )


class SpendPushDelivery(_AuditMixin, Base):
    """One Expo push send — a single alert's, or a day's digest. Holds the
    per-token tickets so a later tick can poll their receipts."""

    __tablename__ = "spend_push_deliveries"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('single', 'digest')", name="ck_overview_spend_push_kind"
        ),
        CheckConstraint(
            "status IN ('accepted', 'delivered', 'failed')",
            name="ck_overview_spend_push_status",
        ),
        Index(
            "ix_overview_spend_push_deliveries_tenant",
            "tenant_id",
            "kind",
            "digest_day",
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
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    digest_day: Mapped[date | None] = mapped_column(Date, nullable=True)
    collapse_id: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    #: ``[{push_device_id, ticket_id, ticket_status, ticket_error,
    #: receipt_status, receipt_error}]`` — never the push token itself.
    tickets: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb"), default=list
    )
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    sent_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    receipts_checked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class SpendAlert(_AuditMixin, Base):
    """One rule crossing — the durable record (decision 6). Push and coord
    delivery are projections tracked on the row, retried on later ticks.

    Unique per ``(tenant, rule, vendor_key, scope_key, period_key,
    threshold_key)``: one row per crossing. ``vendor_key`` is the vendor id,
    or ``*`` for an org-wide rule (two vendors' ``org`` scopes must not
    collide); ``threshold_key`` is the crossed percentage for
    ``mtd_threshold`` (so 50% and 100% in one month are two crossings) and 0
    for every other rule.
    """

    __tablename__ = "spend_alerts"
    __table_args__ = (
        CheckConstraint(
            "rule IN ('mtd_threshold', 'daily_abs', 'spike', 'stale')",
            name="ck_overview_spend_alerts_rule",
        ),
        CheckConstraint(
            "push_status IN ('pending', 'accepted', 'delivered', 'failed', "
            "'unknown_recipients', 'muted')",
            name="ck_overview_spend_alerts_push_status",
        ),
        CheckConstraint(
            "coord_status IN ('pending', 'sent', 'failed', 'unsupported', 'disabled')",
            name="ck_overview_spend_alerts_coord_status",
        ),
        UniqueConstraint(
            "tenant_id",
            "rule",
            "vendor_key",
            "scope_key",
            "period_key",
            "threshold_key",
            name="uq_overview_spend_alerts_crossing",
        ),
        Index("ix_overview_spend_alerts_tenant_fired", "tenant_id", "fired_at"),
        {"schema": _SCHEMA},
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )
    tenant_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    vendor_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(f"{_SCHEMA}.vendors.id", ondelete="CASCADE"),
        nullable=True,
    )
    vendor_key: Mapped[str] = mapped_column(Text, nullable=False)
    rule: Mapped[str] = mapped_column(Text, nullable=False)
    scope_key: Mapped[str] = mapped_column(Text, nullable=False)
    period_key: Mapped[str] = mapped_column(Text, nullable=False)
    threshold_key: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0"), default=0
    )
    observed_micros: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    threshold_micros: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    currency: Mapped[str] = mapped_column(
        CHAR(3), nullable=False, server_default=text("'USD'"), default="USD"
    )
    #: What the message says (vendor name, median, multiplier, day…).
    detail: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb"), default=dict
    )
    fired_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    push_status: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'pending'"), default="pending"
    )
    push_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: Sends tried for this row (including "no device" attempts). A
    #: pre-acceptance failure is retried until this reaches the cap; a
    #: receipt-level failure sets it to the cap (terminal).
    push_attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0"), default=0
    )
    push_delivery_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(f"{_SCHEMA}.spend_push_deliveries.id", ondelete="SET NULL"),
        nullable=True,
    )
    coord_status: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'pending'"), default="pending"
    )
    coord_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class ImportToken(_AuditMixin, Base):
    """A bearer for the spend ingest endpoint of ONE tenant only. Hashed at
    rest (``token_hash`` = sha256 hex); the value is shown once at creation."""

    __tablename__ = "import_tokens"
    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_overview_import_tokens_hash"),
        Index("ix_overview_import_tokens_tenant", "tenant_id"),
        {"schema": _SCHEMA},
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )
    tenant_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    #: When set, the token may ingest for this vendor only.
    vendor_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey(f"{_SCHEMA}.vendors.id", ondelete="CASCADE"),
        nullable=True,
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    token_hash: Mapped[str] = mapped_column(Text, nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class SpendAlertPreference(_AuditMixin, Base):
    """A recipient's own spend-alert switch. No row = unmuted (the feature
    ships on, served policy ``capability-ships-enabled``)."""

    __tablename__ = "spend_alert_preferences"
    __table_args__ = ({"schema": _SCHEMA},)

    tenant_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    muted: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false"), default=False
    )
