"""Project Overview API — ``/api/v1/overview``.

Phase 2 of ``2026-09-19-project-overview-for-business-leaders``: the estimate
a business leader approves a project against — its phases, tasks, roles,
price tiers and cost lines — plus the project settings that say what the
money in it means.

Routes
------
``GET  /overview/settings``                  the project's settings (defaults when unsaved)
``PUT  /overview/settings``                  save them (tenant admin; includes editing_roles)
``GET  /overview/estimates``                 list this project's estimates
``POST /overview/estimates``                 create one (editing roles)
``GET  /overview/estimates/{id}``            head row + whole content graph
``PATCH /overview/estimates/{id}``           edit the head row (editing roles)
``DELETE /overview/estimates/{id}``          delete it and its content (editing roles)
``PUT  /overview/estimates/{id}/content``    replace the content graph (editing roles)
``GET  /overview/estimates/{id}/rollup``     every derived planned figure

Invariants this module is responsible for
-----------------------------------------
1. **Every row is scoped to the ACTIVE tenant**, resolved from
   ``X-Qontinui-Active-Tenant`` through coord's identity door and
   membership-validated there (``_effective_tenant_id`` degrades a
   non-member selection to the operator's home tenant — it never widens).
   A tenant's estimate is invisible to every other tenant, and an id from
   another tenant reads as 404, not 403: existence is itself information.

2. **Reads are open to any member; writes follow the project's
   ``editing_roles``** (default: admins), decided by
   :mod:`app.overview.permissions` — the same function the resource catalog
   serves as ``can_edit``, so the Team page shows an edit control exactly when
   this API would accept the edit. Settings — which include ``editing_roles``
   itself — are admin-only. Reads deliberately do NOT require admin.

   Every write appends ``overview.change_log`` in the same transaction
   (plan ``2026-09-20-overview-authoring-layer`` §1).

3. **No direct read of coord's schema.** The tenant comes from coord over
   HTTP (``operations.get_coord_identity``), exactly like every other
   tenant-scoped surface here. Enforced by
   ``tests/test_coord_schema_boundary_guard.py``.

4. **The frontend does no money arithmetic.** ``…/rollup`` returns every
   derived figure the plan's "Derived values" table names, already summed, so
   two surfaces cannot disagree about a total. Money is integer micros;
   every other derived number is serialized as a decimal STRING, never a
   float — see :func:`app.services.overview_rollup.stringify_decimals`.

5. **Unknown is never zero.** A settings row that was never saved is served
   as the documented defaults with ``is_default: true``; a figure the rollup
   cannot produce is ``null`` with a reason in ``unavailable``.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.crud import overview_estimate as crud
from app.models.overview import Estimate, EstimateRole, OverviewSettings, Phase
from app.models.user import User as UserModel
from app.overview import change_log
from app.overview.permissions import (
    OverviewAccess,
    OverviewCaller,
    get_overview_caller,
    require_edit,
)
from app.schemas.overview import (
    AllocationRead,
    CalendarBreakRead,
    CostLineRead,
    EstimateContentWrite,
    EstimateCreate,
    EstimateDetail,
    EstimateListResponse,
    EstimateSummary,
    EstimateUpdate,
    OverviewSettingsRead,
    OverviewSettingsWrite,
    PhaseRead,
    PhaseTaskRead,
    PriceTierRead,
    RoleRead,
    TaskEffortRead,
)
from app.services.overview_rollup import compute_rollup, stringify_decimals

logger = structlog.get_logger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Tenant resolution
# ---------------------------------------------------------------------------


async def get_overview_tenant_id(
    caller: OverviewCaller = Depends(get_overview_caller),
    _user: UserModel = Depends(get_current_active_user_async),
) -> UUID:
    """The ACTIVE tenant, for any member of it — the read gate.

    ``operations.get_tenant_id`` returns the operator's HOME tenant, which is
    the wrong answer for a surface whose whole subject is "the project I have
    selected": an operator who switched to another project would read their
    home project's estimate under the other project's name. This resolves the
    effective tenant through the same :func:`get_overview_caller` every write
    uses, so a read and a write in the same session can never land in
    different projects.
    """
    return caller.tenant_id


async def _require_estimate(
    db: AsyncSession, tenant_id: UUID, estimate_id: UUID, *, lock: bool = False
) -> Estimate:
    row = await crud.get_estimate(
        db, tenant_id=tenant_id, estimate_id=estimate_id, lock=lock
    )
    if row is None:
        # 404, not 403: whether an id exists in ANOTHER tenant is itself
        # information this tenant is not entitled to.
        raise HTTPException(status_code=404, detail="estimate_not_found")
    return row


def _version_conflict(exc: crud.VersionConflict) -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={
            "error": "version_conflict",
            "current_version": exc.current_version,
            "message": (
                "Somebody else saved this since you loaded it. Reload to see "
                "their version before saving yours."
            ),
        },
    )


async def _log_estimate(
    db: AsyncSession,
    request: Request,
    access: OverviewAccess,
    estimate_id: UUID,
    action: change_log.ChangeAction,
    *,
    before: EstimateSummary | EstimateDetail | None,
    after: EstimateSummary | EstimateDetail | None,
) -> None:
    """One ``overview.change_log`` row for an estimate write, in the write's
    own transaction. A content replace logs the whole graph on both sides."""

    def version(value: EstimateSummary | EstimateDetail | None) -> int | None:
        if value is None:
            return None
        head = value.estimate if isinstance(value, EstimateDetail) else value
        return head.version

    await change_log.record(
        db,
        tenant_id=access.tenant_id,
        resource="estimates",
        record_id=str(estimate_id),
        action=action,
        source=change_log.change_source(request),
        actor=access.actor,
        actor_user_id=access.user_id,
        before=before,
        after=after,
        version_before=version(before),
        version_after=version(after),
    )


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------


@router.get("/settings", response_model=OverviewSettingsRead)
async def read_settings(
    tenant_id: UUID = Depends(get_overview_tenant_id),
    db: AsyncSession = Depends(get_async_db),
) -> OverviewSettingsRead:
    """The project's settings, or the documented defaults when none are saved.

    Never 404 and never ``{}``: a project with no saved settings still HAS
    settings, and ``is_default`` is what tells the reader nobody has chosen
    them yet.
    """
    row = await crud.get_settings(db, tenant_id=tenant_id)
    if row is None:
        return OverviewSettingsRead(
            **crud.DEFAULT_SETTINGS,  # type: ignore[arg-type]
            is_default=True,
        )
    return OverviewSettingsRead.model_validate(row)


@router.put("/settings", response_model=OverviewSettingsRead)
async def write_settings(
    payload: OverviewSettingsWrite,
    request: Request,
    access: OverviewAccess = Depends(require_edit("project_admin")),
    db: AsyncSession = Depends(get_async_db),
) -> OverviewSettingsRead:
    """Save the project's settings. Tenant admin only — they include
    ``editing_roles``, which decides who else may edit."""
    tenant_id = access.tenant_id
    # Lock first, so the audit row's "before" is the row this write replaces,
    # not a copy a concurrent save has already moved past.
    existing = await db.get(
        OverviewSettings, tenant_id, with_for_update=True, populate_existing=True
    )
    before = OverviewSettingsRead.model_validate(existing) if existing else None
    try:
        row = await crud.upsert_settings(
            db,
            tenant_id=tenant_id,
            actor=access.actor,
            base_currency=payload.base_currency,
            fx_rates=payload.fx_rates,
            labour_billing=payload.labour_billing,
            hours_per_day=payload.hours_per_day,
            working_day_factor=payload.working_day_factor,
            first_value_date=payload.first_value_date,
            expected_version=payload.expected_version,
            editing_roles=payload.editing_roles,
        )
    except crud.VersionConflict as exc:
        raise _version_conflict(exc) from exc
    after = OverviewSettingsRead.model_validate(row)
    await change_log.record(
        db,
        tenant_id=tenant_id,
        resource="settings",
        record_id=str(tenant_id),
        action="create" if before is None else "update",
        source=change_log.change_source(request),
        actor=access.actor,
        actor_user_id=access.user_id,
        before=before,
        after=after,
        version_before=before.version if before else None,
        version_after=after.version,
    )
    await db.commit()
    await db.refresh(row)
    return OverviewSettingsRead.model_validate(row)


# ---------------------------------------------------------------------------
# Estimates
# ---------------------------------------------------------------------------


@router.get("/estimates", response_model=EstimateListResponse)
async def list_estimates(
    tenant_id: UUID = Depends(get_overview_tenant_id),
    db: AsyncSession = Depends(get_async_db),
) -> EstimateListResponse:
    """This project's estimates, baseline first then newest."""
    rows = await crud.list_estimates(db, tenant_id=tenant_id)
    return EstimateListResponse(
        estimates=[EstimateSummary.model_validate(r) for r in rows],
        total=len(rows),
    )


@router.post(
    "/estimates",
    response_model=EstimateSummary,
    status_code=status.HTTP_201_CREATED,
)
async def create_estimate(
    payload: EstimateCreate,
    request: Request,
    access: OverviewAccess = Depends(require_edit("editing_roles")),
    db: AsyncSession = Depends(get_async_db),
) -> EstimateSummary:
    """Create an estimate. The project's ``editing_roles`` only.

    Marking it the baseline un-marks whichever estimate held that flag — a
    re-baseline is the normal reason to create one, and the partial unique
    index would otherwise reject it.
    """
    tenant_id = access.tenant_id
    row = await crud.create_estimate(
        db,
        tenant_id=tenant_id,
        actor=access.actor,
        name=payload.name,
        purpose=payload.purpose,
        status=payload.status,
        is_baseline=payload.is_baseline,
        source_page_id=payload.source_page_id,
        accuracy_note=payload.accuracy_note,
        contingency_pct=payload.contingency_pct,
        notes=payload.notes,
    )
    created = EstimateSummary.model_validate(row)
    await _log_estimate(
        db, request, access, row.id, "create", before=None, after=created
    )
    await db.commit()
    await db.refresh(row)
    return EstimateSummary.model_validate(row)


@router.get("/estimates/{estimate_id}", response_model=EstimateDetail)
async def read_estimate(
    estimate_id: UUID,
    tenant_id: UUID = Depends(get_overview_tenant_id),
    db: AsyncSession = Depends(get_async_db),
) -> EstimateDetail:
    """The head row plus the whole content graph — what the editor loads."""
    row = await crud.load_estimate_graph(
        db, tenant_id=tenant_id, estimate_id=estimate_id
    )
    if row is None:
        raise HTTPException(status_code=404, detail="estimate_not_found")
    return _detail(row)


@router.patch("/estimates/{estimate_id}", response_model=EstimateSummary)
async def patch_estimate(
    estimate_id: UUID,
    payload: EstimateUpdate,
    request: Request,
    access: OverviewAccess = Depends(require_edit("editing_roles")),
    db: AsyncSession = Depends(get_async_db),
) -> EstimateSummary:
    """Edit the head row. The project's ``editing_roles`` only.

    Absent fields are left alone; an explicit ``null`` clears a nullable one.
    """
    row = await _require_estimate(db, access.tenant_id, estimate_id, lock=True)
    before = EstimateSummary.model_validate(row)
    changes = payload.model_dump(exclude_unset=True, exclude={"expected_version"})
    try:
        row = await crud.update_estimate(
            db,
            estimate=row,
            actor=access.actor,
            changes=changes,
            expected_version=payload.expected_version,
        )
    except crud.VersionConflict as exc:
        raise _version_conflict(exc) from exc
    await _log_estimate(
        db,
        request,
        access,
        row.id,
        "update",
        before=before,
        after=EstimateSummary.model_validate(row),
    )
    await db.commit()
    await db.refresh(row)
    return EstimateSummary.model_validate(row)


@router.delete("/estimates/{estimate_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_estimate(
    estimate_id: UUID,
    request: Request,
    access: OverviewAccess = Depends(require_edit("editing_roles")),
    db: AsyncSession = Depends(get_async_db),
) -> Response:
    """Delete an estimate and everything under it. The project's
    ``editing_roles`` only.

    The change-log row keeps the whole graph as it was, so a deleted estimate
    is still answerable ("what did it say, and who removed it").
    """
    graph = await crud.load_estimate_graph(
        db, tenant_id=access.tenant_id, estimate_id=estimate_id, lock=True
    )
    if graph is None:
        raise HTTPException(status_code=404, detail="estimate_not_found")
    before = _detail(graph)
    await crud.delete_estimate(db, estimate=graph)
    await _log_estimate(
        db, request, access, estimate_id, "delete", before=before, after=None
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/estimates/{estimate_id}/content", response_model=EstimateDetail)
async def replace_estimate_content(
    estimate_id: UUID,
    payload: EstimateContentWrite,
    request: Request,
    access: OverviewAccess = Depends(require_edit("editing_roles")),
    db: AsyncSession = Depends(get_async_db),
) -> EstimateDetail:
    """Replace the estimate's whole content graph. The project's
    ``editing_roles`` only.

    One transaction, one payload: the CSV paste, the mermaid-``gantt`` import
    and the inline editor all produce a complete description of the estimate,
    and a half-applied import is worse than a rejected one. Send
    ``expected_version`` (from the last read) to be refused with 409 rather
    than silently overwrite somebody else's save.
    """
    tenant_id = access.tenant_id
    graph = await crud.load_estimate_graph(
        db, tenant_id=tenant_id, estimate_id=estimate_id, lock=True
    )
    if graph is None:
        # 404, not 403: whether an id exists in ANOTHER tenant is itself
        # information this tenant is not entitled to.
        raise HTTPException(status_code=404, detail="estimate_not_found")
    before = _detail(graph)
    try:
        await crud.replace_content(
            db, estimate=graph, actor=access.actor, content=payload
        )
    except crud.VersionConflict as exc:
        raise _version_conflict(exc) from exc
    # The replace deletes children through Core statements, so the loaded
    # collections still hold the old rows; the loader's `populate_existing`
    # re-reads them.
    fresh = await crud.load_estimate_graph(
        db, tenant_id=tenant_id, estimate_id=estimate_id
    )
    if fresh is None:  # pragma: no cover — it was just written in this session
        raise HTTPException(status_code=404, detail="estimate_not_found")
    after = _detail(fresh)
    await _log_estimate(
        db, request, access, estimate_id, "update", before=before, after=after
    )
    await db.commit()
    return after


@router.get("/estimates/{estimate_id}/rollup")
async def read_rollup(
    estimate_id: UUID,
    tenant_id: UUID = Depends(get_overview_tenant_id),
    db: AsyncSession = Depends(get_async_db),
) -> dict[str, Any]:
    """Every derived planned figure, computed on read.

    The shape is documented on
    :func:`app.services.overview_rollup.compute_rollup`. Money is an integer
    count of micros; every other decimal is a STRING, so nothing in the money
    or effort path ever passes through a float. Figures whose inputs are
    missing are ``null`` and appear in ``unavailable`` with a machine
    ``reason`` and a sentence — never 0.
    """
    row = await crud.load_estimate_graph(
        db, tenant_id=tenant_id, estimate_id=estimate_id
    )
    if row is None:
        raise HTTPException(status_code=404, detail="estimate_not_found")
    settings = await crud.get_settings(db, tenant_id=tenant_id)
    if settings is None:
        settings = crud.default_settings_row(tenant_id)
    rollup = compute_rollup(row, settings, generated_at=datetime.now(UTC))
    serialized: dict[str, Any] = stringify_decimals(rollup)
    return serialized


# ---------------------------------------------------------------------------
# Read projection
# ---------------------------------------------------------------------------


def _detail(row: Estimate) -> EstimateDetail:
    """Project a loaded estimate graph onto the wire shape.

    Children come back in a stable order (``sort_order``, then code) so a
    round trip through the editor does not reshuffle a table, and every
    cross-reference is resolved to its CODE as well as its id — the code is
    what the CSV paste and the gantt import speak.
    """
    roles: list[EstimateRole] = sorted(row.roles, key=lambda r: (r.sort_order, r.code))
    role_code = {r.id: r.code for r in roles}
    phases: list[Phase] = sorted(row.phases, key=lambda p: (p.sort_order, p.code))
    phase_code = {p.id: p.code for p in phases}

    return EstimateDetail(
        estimate=EstimateSummary.model_validate(row),
        roles=[
            RoleRead(
                id=r.id,
                code=r.code,
                name=r.name,
                responsibility=r.responsibility,
                day_rate_micros=r.day_rate_micros,
                currency=r.currency,
                client_side=r.client_side,
                sort_order=r.sort_order,
            )
            for r in roles
        ],
        phases=[
            PhaseRead(
                id=p.id,
                code=p.code,
                name=p.name,
                sort_order=p.sort_order,
                planned_start=p.planned_start,
                planned_end=p.planned_end,
                stated_working_weeks=p.stated_working_weeks,
                gate_criteria=p.gate_criteria,
                actual_start=p.actual_start,
                actual_end=p.actual_end,
                gate_status=p.gate_status,  # type: ignore[arg-type]
                gate_decided_at=p.gate_decided_at,
                gate_notes=p.gate_notes,
                tasks=[
                    PhaseTaskRead(
                        id=t.id,
                        number=t.number,
                        title=t.title,
                        requirement_refs=t.requirement_refs,
                        planned_start=t.planned_start,
                        planned_end=t.planned_end,
                        is_critical=t.is_critical,
                        status=t.status,  # type: ignore[arg-type]
                        sort_order=t.sort_order,
                        efforts=[
                            TaskEffortRead(
                                role_id=e.role_id,
                                role_code=role_code.get(e.role_id, ""),
                                planned_person_days=Decimal(e.planned_person_days),
                            )
                            for e in sorted(
                                t.efforts,
                                key=lambda e: role_code.get(e.role_id, ""),
                            )
                        ],
                    )
                    for t in sorted(p.tasks, key=lambda t: (t.sort_order, t.number))
                ],
            )
            for p in phases
        ],
        allocations=[
            AllocationRead(
                phase_id=a.phase_id,
                phase_code=phase_code.get(a.phase_id, ""),
                role_id=a.role_id,
                role_code=role_code.get(a.role_id, ""),
                fte=Decimal(a.fte),
            )
            for p in phases
            for a in sorted(p.allocations, key=lambda a: role_code.get(a.role_id, ""))
        ],
        price_tiers=[
            PriceTierRead(
                id=t.id,
                name=t.name,
                multiplier=Decimal(t.multiplier),
                is_primary=t.is_primary,
                sort_order=t.sort_order,
            )
            for t in sorted(row.price_tiers, key=lambda t: (t.sort_order, t.name))
        ],
        cost_lines=[
            CostLineRead(
                id=c.id,
                kind=c.kind,  # type: ignore[arg-type]
                label=c.label,
                basis=c.basis,
                low_micros=c.low_micros,
                high_micros=c.high_micros,
                currency=c.currency,
                phase_id=c.phase_id,
                phase_code=phase_code.get(c.phase_id) if c.phase_id else None,
                run_model=c.run_model,
                sort_order=c.sort_order,
            )
            for c in sorted(
                row.cost_lines, key=lambda c: (c.kind, c.sort_order, c.label)
            )
        ],
        calendar_breaks=[
            CalendarBreakRead(
                id=b.id,
                label=b.label,
                start_date=b.start_date,
                end_date=b.end_date,
            )
            for b in sorted(row.calendar_breaks, key=lambda b: b.start_date)
        ],
    )
