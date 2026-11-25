"""``GET /api/v1/overview/schedule`` — phases, milestones and gates derived from coord.

Plan ``2026-11-25-overview-timeline-and-milestones-derive-from-coord`` D1.
A derived, non-registry route beside the Timeline's own: one envelope, every
figure a ``Resolved`` that says where it came from (see
:mod:`app.schemas.overview_schedule`).

**Permission: any member of the active project may read.** It is not a
``coord_admin`` resource, so ``DEVICE_REFUSALS`` does not apply and an agent
verifying with a device JWT can read what a leader sees. There is no write
verb: nothing here writes coord, ``phase_progress`` or ``milestones``.

**Two doors, chosen by the principal, never crossed.** A person's request
reads coord's operator routes with their own bearer (:class:`OperatorSource`);
a device's reads coord's three ``/coord/agent-*`` read doors with the device
bearer (:class:`DeviceSource`). The tenant is the request's ACTIVE tenant,
resolved once by :func:`get_overview_access` and passed in; the adapter has no
default, and refuses any coord row of another tenant (D7).
"""

from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_async_db
from app.crud import overview_settings
from app.models.overview import Estimate, Milestone
from app.overview.coord_schedule import (
    CoordScheduleSource,
    DeviceSource,
    OperatorSource,
)
from app.overview.permissions import (
    OverviewAccess,
    OverviewPrincipal,
    get_overview_access,
    get_overview_principal,
)
from app.overview.phase_progress import project_estimate
from app.schemas.overview_schedule import ScheduleEnvelope
from app.services.overview_schedule import (
    ScheduleService,
    TypedInputs,
    TypedMilestone,
    TypedPhase,
    resolve_schedule,
)

router = APIRouter()

#: One cache per backend instance (plan D8). A dependency so tests can swap in a
#: service with a fake clock.
_SERVICE = ScheduleService()


def get_schedule_service() -> ScheduleService:
    return _SERVICE


def schedule_source(
    access: OverviewAccess = Depends(get_overview_access),
    principal: OverviewPrincipal = Depends(get_overview_principal),
) -> CoordScheduleSource:
    """The coord door for this principal. A device principal always carries its
    verified bearer; a person's bearer was captured by ``get_overview_caller``."""
    if principal.kind == "device":
        assert principal.token is not None
        return DeviceSource(principal.token)
    return OperatorSource(access.tenant_id)


async def load_typed_inputs(db: AsyncSession, access: OverviewAccess) -> TypedInputs:
    """The project's hand-entered rows, every query filtered on the active
    tenant: its baseline (else newest) estimate's phases and calendar breaks,
    and its milestones."""
    tenant = access.tenant_id
    chosen = await project_estimate(db, tenant, None)
    phases: list[TypedPhase] = []
    breaks: list = []
    if chosen is not None:
        estimate = (
            (
                await db.execute(
                    select(Estimate)
                    .where(Estimate.id == chosen.id, Estimate.tenant_id == tenant)
                    .options(
                        selectinload(Estimate.phases),
                        selectinload(Estimate.calendar_breaks),
                    )
                )
            )
            .scalars()
            .one()
        )
        breaks = list(estimate.calendar_breaks)
        phases = [
            TypedPhase(
                id=str(p.id),
                code=p.code,
                name=p.name,
                sort_order=p.sort_order,
                planned_start=p.planned_start,
                planned_end=p.planned_end,
                actual_start=p.actual_start,
                actual_end=p.actual_end,
                gate_status=p.gate_status,
                gate_criteria=p.gate_criteria,
                updated_by=p.progress_updated_by,
                updated_at=p.progress_updated_at,
            )
            for p in estimate.phases
        ]
    settings = await overview_settings.get_settings(db, tenant_id=tenant)
    if settings is None:
        settings = overview_settings.default_settings_row(tenant)
    rows = (
        (
            await db.execute(
                select(Milestone)
                .where(Milestone.tenant_id == tenant)
                .order_by(Milestone.target_date, Milestone.title)
            )
        )
        .scalars()
        .all()
    )
    return TypedInputs(
        phases=phases,
        breaks=breaks,
        working_day_factor=Decimal(settings.working_day_factor),
        milestones=[
            TypedMilestone(
                id=str(m.id),
                title=m.title,
                target_date=m.target_date,
                status=m.status,
                completed_date=m.completed_date,
                updated_by=m.updated_by,
                updated_at=m.updated_at,
            )
            for m in rows
        ],
    )


@router.get("/schedule", response_model=ScheduleEnvelope)
async def read_schedule(
    access: OverviewAccess = Depends(get_overview_access),
    source: CoordScheduleSource = Depends(schedule_source),
    service: ScheduleService = Depends(get_schedule_service),
    db: AsyncSession = Depends(get_async_db),
) -> ScheduleEnvelope:
    """The project's phases, milestones, decision gates and forecast, derived
    from coord and overlaid with whatever a person has entered.

    A figure coord could not give is ``state: unknown`` with a reason, never an
    empty list or a default. Cached per tenant and door for 60 s; after a coord
    failure the last good read is served ``stale`` for up to 10 minutes."""
    typed = await load_typed_inputs(db, access)
    return await resolve_schedule(service, source, access.tenant_id, typed, db)


__all__ = ["get_schedule_service", "router", "schedule_source"]
