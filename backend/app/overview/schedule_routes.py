"""``GET /api/v1/overview/schedule`` — phases, milestones and gates derived from coord.

Plan ``2026-11-25-overview-timeline-and-milestones-derive-from-coord`` D1.
A derived, non-registry route beside the Timeline's own: one envelope, every
figure a ``Resolved`` that says where it came from (see
:mod:`app.schemas.overview_schedule`).

**Permission: any member of the active project may read.** It is not a
``coord_admin`` resource, so ``DEVICE_REFUSALS`` does not apply and an agent
verifying with a device JWT can read what a leader sees. There is no write
verb: nothing here writes coord, ``phase_progress`` or ``milestones``, and
nothing here reads them either: the schedule is derived only from coord.

**Two doors, chosen by the principal, never crossed.** A person's request
reads coord's operator routes with their own bearer (:class:`OperatorSource`);
a device's reads coord's three ``/coord/agent-*`` read doors with the device
bearer (:class:`DeviceSource`). The tenant is the request's ACTIVE tenant,
resolved once by :func:`get_overview_access` and passed in; the adapter has no
default, and refuses any coord row of another tenant (D7).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db
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
from app.schemas.overview_schedule import ScheduleEnvelope
from app.services.overview_schedule import (
    ScheduleService,
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
        if principal.token is None:
            raise RuntimeError("a device principal reached the schedule with no bearer")
        return DeviceSource(principal.token)
    return OperatorSource(access.tenant_id)


@router.get("/schedule", response_model=ScheduleEnvelope)
async def read_schedule(
    access: OverviewAccess = Depends(get_overview_access),
    source: CoordScheduleSource = Depends(schedule_source),
    service: ScheduleService = Depends(get_schedule_service),
    db: AsyncSession = Depends(get_async_db),
) -> ScheduleEnvelope:
    """The project's phases, milestones, decision gates and forecast, derived
    from coord and nothing else: no typed row is read (plan D5).

    A figure coord could not give is ``state: unknown`` with a reason, never an
    empty list or a default. Cached per tenant and door for 60 s; after a coord
    failure the last good read is served ``stale`` for up to 10 minutes."""
    return await resolve_schedule(service, source, access.tenant_id, db)


__all__ = ["get_schedule_service", "router", "schedule_source"]
