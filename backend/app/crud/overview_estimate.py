"""Database access for the Project Overview estimate baseline.

Phase 2 of ``2026-09-19-project-overview-for-business-leaders``.

Every function here takes ``tenant_id`` and filters on it. That is the whole
isolation story for these tables: there is no row-level security, no
tenant-scoped session, and no FK to lean on, so a query that forgets the
predicate is a cross-tenant read. ``tests/test_overview_estimates_api.py``
pins each route against a second tenant's data for exactly that reason.

Nothing in this module touches a ``coord.*`` table. The tenant is resolved
over coord's HTTP API by the endpoint layer and arrives here as a plain UUID.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.overview import (
    CalendarBreak,
    CostLine,
    Estimate,
    EstimateRole,
    OverviewSettings,
    Phase,
    PhaseAllocation,
    PhaseTask,
    PriceTier,
    TaskEffort,
)
from app.schemas.overview import EstimateContentWrite


class VersionConflict(Exception):
    """A write was built on a copy the server has moved past.

    Carries the CURRENT version so the endpoint can tell the caller what to
    re-read, rather than only that it failed.
    """

    def __init__(self, current_version: int) -> None:
        super().__init__(f"version is now {current_version}")
        self.current_version = current_version


#: The settings a project has before anybody saves any. Served as-is (with
#: ``is_default: true``) rather than 404 or ``{}``, so "nobody has set this"
#: is distinguishable from "this is set to the default".
DEFAULT_SETTINGS = {
    "base_currency": "USD",
    "fx_rates": {},
    "labour_billing": "unbilled",
    "hours_per_day": Decimal("8"),
    "working_day_factor": Decimal("1.0"),
    "first_value_date": None,
    "version": 0,
}


def _now() -> datetime:
    return datetime.now(UTC)


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------


async def get_settings(db: AsyncSession, *, tenant_id: UUID) -> OverviewSettings | None:
    return await db.get(OverviewSettings, tenant_id)


def default_settings_row(tenant_id: UUID) -> OverviewSettings:
    """An UNSAVED settings row carrying the documented defaults.

    Used by the rollup so a project that has never opened the settings page
    still gets an honest working-day factor rather than a crash — and by the
    read endpoint, which marks it ``is_default``.
    """
    return OverviewSettings(tenant_id=tenant_id, **DEFAULT_SETTINGS)


async def upsert_settings(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    actor: str | None,
    base_currency: str,
    fx_rates: dict,
    labour_billing: str,
    hours_per_day: Decimal,
    working_day_factor: Decimal,
    first_value_date,
    expected_version: int | None,
) -> OverviewSettings:
    row = await db.get(OverviewSettings, tenant_id)
    if row is None:
        if expected_version not in (None, 0):
            raise VersionConflict(0)
        row = OverviewSettings(tenant_id=tenant_id, created_by=actor, version=0)
        db.add(row)
    elif expected_version is not None and expected_version != row.version:
        raise VersionConflict(row.version)

    row.base_currency = base_currency
    row.fx_rates = fx_rates
    row.labour_billing = labour_billing
    row.hours_per_day = hours_per_day
    row.working_day_factor = working_day_factor
    row.first_value_date = first_value_date
    row.updated_by = actor
    row.updated_at = _now()
    row.version = (row.version or 0) + 1
    await db.flush()
    await db.refresh(row)
    return row


# ---------------------------------------------------------------------------
# Estimates
# ---------------------------------------------------------------------------


async def list_estimates(db: AsyncSession, *, tenant_id: UUID) -> list[Estimate]:
    stmt = (
        select(Estimate)
        .where(Estimate.tenant_id == tenant_id)
        # Baseline first, then newest — the order a reader wants, and the
        # order the Team page relies on when no baseline is marked.
        .order_by(Estimate.is_baseline.desc(), Estimate.created_at.desc())
    )
    return list((await db.execute(stmt)).scalars().all())


async def get_estimate(
    db: AsyncSession, *, tenant_id: UUID, estimate_id: UUID
) -> Estimate | None:
    stmt = select(Estimate).where(
        Estimate.id == estimate_id, Estimate.tenant_id == tenant_id
    )
    return (await db.execute(stmt)).scalars().first()


async def load_estimate_graph(
    db: AsyncSession, *, tenant_id: UUID, estimate_id: UUID
) -> Estimate | None:
    """The estimate with every child eagerly loaded.

    The rollup is a pure function over loaded rows, so it must not lazy-load
    inside an async session (which raises). This is the one loader that feeds
    it.
    """
    stmt = (
        select(Estimate)
        .where(Estimate.id == estimate_id, Estimate.tenant_id == tenant_id)
        .options(
            selectinload(Estimate.roles),
            selectinload(Estimate.price_tiers),
            selectinload(Estimate.cost_lines),
            selectinload(Estimate.calendar_breaks),
            selectinload(Estimate.phases).selectinload(Phase.allocations),
            selectinload(Estimate.phases)
            .selectinload(Phase.tasks)
            .selectinload(PhaseTask.efforts),
        )
    )
    return (await db.execute(stmt)).scalars().first()


async def _clear_other_baselines(
    db: AsyncSession, *, tenant_id: UUID, keep_id: UUID | None
) -> None:
    """A tenant has at most one baseline. The partial unique index enforces
    it; this is what stops a legitimate re-baseline from tripping over it."""
    stmt = (
        update(Estimate)
        .where(Estimate.tenant_id == tenant_id, Estimate.is_baseline.is_(True))
        .values(is_baseline=False)
    )
    if keep_id is not None:
        stmt = stmt.where(Estimate.id != keep_id)
    await db.execute(stmt)


async def create_estimate(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    actor: str | None,
    name: str,
    purpose: str,
    status: str,
    is_baseline: bool,
    source_page_id: UUID | None,
    accuracy_note: str | None,
    contingency_pct: Decimal | None,
    notes: str,
) -> Estimate:
    if is_baseline:
        await _clear_other_baselines(db, tenant_id=tenant_id, keep_id=None)
    row = Estimate(
        tenant_id=tenant_id,
        name=name,
        purpose=purpose,
        status=status,
        is_baseline=is_baseline,
        source_page_id=source_page_id,
        accuracy_note=accuracy_note,
        contingency_pct=contingency_pct,
        notes=notes,
        version=1,
        created_by=actor,
        updated_by=actor,
    )
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return row


async def update_estimate(
    db: AsyncSession,
    *,
    estimate: Estimate,
    actor: str | None,
    changes: dict,
    expected_version: int | None,
) -> Estimate:
    if expected_version is not None and expected_version != estimate.version:
        raise VersionConflict(estimate.version)
    if changes.get("is_baseline") is True:
        await _clear_other_baselines(
            db, tenant_id=estimate.tenant_id, keep_id=estimate.id
        )
    for key, value in changes.items():
        setattr(estimate, key, value)
    estimate.updated_by = actor
    estimate.updated_at = _now()
    estimate.version += 1
    await db.flush()
    await db.refresh(estimate)
    return estimate


async def delete_estimate(db: AsyncSession, *, estimate: Estimate) -> None:
    # The children cascade in Postgres (ON DELETE CASCADE) and in the ORM
    # (delete-orphan), so one delete is enough.
    await db.delete(estimate)
    await db.flush()


# ---------------------------------------------------------------------------
# The content graph
# ---------------------------------------------------------------------------


async def replace_content(
    db: AsyncSession,
    *,
    estimate: Estimate,
    actor: str | None,
    content: EstimateContentWrite,
) -> Estimate:
    """Replace an estimate's whole content graph in one transaction.

    Delete-then-insert rather than a diff: the payload is a complete
    description of the estimate, every child is identified by a code the
    client owns, and a half-applied import is worse than a rejected one.
    Referential integrity between the parts is already guaranteed by
    ``EstimateContentWrite``'s validator, so nothing here has to re-check it.
    """
    if (
        content.expected_version is not None
        and content.expected_version != estimate.version
    ):
        raise VersionConflict(estimate.version)

    tenant_id = estimate.tenant_id
    now = _now()

    # Order matters only for the tables Postgres would otherwise refuse:
    # everything hangs off phases/roles, both of which cascade.
    await db.execute(delete(Phase).where(Phase.estimate_id == estimate.id))
    await db.execute(
        delete(EstimateRole).where(EstimateRole.estimate_id == estimate.id)
    )
    await db.execute(delete(PriceTier).where(PriceTier.estimate_id == estimate.id))
    await db.execute(delete(CostLine).where(CostLine.estimate_id == estimate.id))
    await db.execute(
        delete(CalendarBreak).where(CalendarBreak.estimate_id == estimate.id)
    )
    await db.flush()

    audit = {
        "created_by": actor,
        "updated_by": actor,
        "created_at": now,
        "updated_at": now,
    }

    roles_by_code: dict[str, EstimateRole] = {}
    for index, role in enumerate(content.roles):
        row = EstimateRole(
            tenant_id=tenant_id,
            estimate_id=estimate.id,
            code=role.code,
            name=role.name,
            responsibility=role.responsibility,
            day_rate_micros=role.day_rate_micros,
            currency=role.currency,
            client_side=role.client_side,
            sort_order=index,
            **audit,
        )
        db.add(row)
        roles_by_code[role.code] = row

    phases_by_code: dict[str, Phase] = {}
    for index, phase in enumerate(content.phases):
        prow = Phase(
            tenant_id=tenant_id,
            estimate_id=estimate.id,
            code=phase.code,
            name=phase.name,
            sort_order=index,
            planned_start=phase.planned_start,
            planned_end=phase.planned_end,
            stated_working_weeks=phase.stated_working_weeks,
            gate_criteria=phase.gate_criteria,
            actual_start=phase.actual_start,
            actual_end=phase.actual_end,
            gate_status=phase.gate_status,
            gate_decided_at=phase.gate_decided_at,
            gate_notes=phase.gate_notes,
            **audit,
        )
        db.add(prow)
        phases_by_code[phase.code] = prow
    await db.flush()

    for phase in content.phases:
        prow = phases_by_code[phase.code]
        for t_index, task in enumerate(phase.tasks):
            trow = PhaseTask(
                tenant_id=tenant_id,
                phase_id=prow.id,
                number=task.number,
                title=task.title,
                requirement_refs=task.requirement_refs,
                planned_start=task.planned_start,
                planned_end=task.planned_end,
                is_critical=task.is_critical,
                status=task.status,
                sort_order=t_index,
                **audit,
            )
            db.add(trow)
            await db.flush()
            for effort in task.efforts:
                db.add(
                    TaskEffort(
                        tenant_id=tenant_id,
                        task_id=trow.id,
                        role_id=roles_by_code[effort.role_code].id,
                        planned_person_days=effort.planned_person_days,
                        **audit,
                    )
                )

    for alloc in content.allocations:
        db.add(
            PhaseAllocation(
                tenant_id=tenant_id,
                phase_id=phases_by_code[alloc.phase_code].id,
                role_id=roles_by_code[alloc.role_code].id,
                fte=alloc.fte,
                **audit,
            )
        )

    for index, tier in enumerate(content.price_tiers):
        db.add(
            PriceTier(
                tenant_id=tenant_id,
                estimate_id=estimate.id,
                name=tier.name,
                multiplier=tier.multiplier,
                is_primary=tier.is_primary,
                sort_order=index,
                **audit,
            )
        )

    for index, line in enumerate(content.cost_lines):
        db.add(
            CostLine(
                tenant_id=tenant_id,
                estimate_id=estimate.id,
                kind=line.kind,
                label=line.label,
                basis=line.basis,
                low_micros=line.low_micros,
                high_micros=line.high_micros,
                currency=line.currency,
                phase_id=(
                    phases_by_code[line.phase_code].id
                    if line.phase_code is not None
                    else None
                ),
                run_model=line.run_model,
                sort_order=index,
                **audit,
            )
        )

    for brk in content.calendar_breaks:
        db.add(
            CalendarBreak(
                tenant_id=tenant_id,
                estimate_id=estimate.id,
                label=brk.label,
                start_date=brk.start_date,
                end_date=brk.end_date,
                **audit,
            )
        )

    estimate.updated_by = actor
    estimate.updated_at = now
    estimate.version += 1
    await db.flush()
    return estimate
