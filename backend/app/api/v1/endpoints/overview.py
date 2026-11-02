"""Project Overview settings — ``/api/v1/overview/settings``.

The settings that say what the money in an estimate means (currency, how
labour is billed, the working-day assumptions) and who may edit the overview
(``editing_roles``). Every other overview resource — the estimate included —
is on the authoring contract (``app.overview.router``, built from
``app.overview.registry``); these two routes predate it and the registry's
``settings`` entry serves their permission beside every other resource's.

Routes
------
``GET  /overview/settings``   the project's settings (defaults when unsaved)
``PUT  /overview/settings``   save them (tenant admin; includes editing_roles)

Invariants
----------
1. **Scoped to the ACTIVE tenant**, resolved from ``X-Qontinui-Active-Tenant``
   through coord's identity door and membership-validated there.
2. **Reads are open to any member; the write is admin-only** — the settings
   include ``editing_roles``, which decides who else may edit — decided by
   :mod:`app.overview.permissions`, the same function the resource catalog
   serves as ``can_edit``. The write appends ``overview.change_log`` in its
   own transaction.
3. **No direct read of coord's schema** (``tests/test_coord_schema_boundary_guard.py``).
4. **Unknown is never zero.** A settings row that was never saved is served as
   the documented defaults with ``is_default: true``.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.crud import overview_settings as crud
from app.models.overview import OverviewSettings
from app.models.user import User as UserModel
from app.overview import change_log
from app.overview.permissions import (
    OverviewAccess,
    OverviewCaller,
    get_overview_caller,
    require_edit,
)
from app.schemas.overview import OverviewSettingsRead, OverviewSettingsWrite

router = APIRouter()


async def get_overview_tenant_id(
    # Resolved FIRST, so a non-Cognito caller (a coord device JWT) is refused
    # here before the caller resolution spends a coord round-trip: these read
    # routes are Cognito-only.
    _user: UserModel = Depends(get_current_active_user_async),
    caller: OverviewCaller = Depends(get_overview_caller),
) -> UUID:
    """The ACTIVE tenant, for any member of it — the read gate.

    ``operations.get_tenant_id`` returns the operator's HOME tenant, which is
    the wrong answer for a surface whose whole subject is "the project I have
    selected". This resolves the effective tenant through the same
    :func:`get_overview_caller` every write uses, so a read and a write in the
    same session can never land in different projects.
    """
    return caller.tenant_id


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
        **change_log.attribution(access, request),
        before=before,
        after=after,
        version_before=before.version if before else None,
        version_after=after.version,
    )
    await db.commit()
    await db.refresh(row)
    return OverviewSettingsRead.model_validate(row)
