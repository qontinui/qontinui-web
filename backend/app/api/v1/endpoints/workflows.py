"""Workflow mirror endpoints.

Backs ``/build/workflows`` in the dashboard with a runner-authored mirror
so the page can render workflow definitions when no runner is online.

* ``GET  /api/v1/workflows``          — list (no definition)
* ``GET  /api/v1/workflows/{id}``     — detail (with definition)
* ``POST /api/v1/workflows/sync``     — runner write-through (device JWT)

The runner is the source of truth for **execution**; this mirror is the
source of truth for **browsing**. See Phase 3 of
``D:/qontinui-root/plans/2026-05-22-mtc-iter3-remediation-web-dashboard.md``.
"""

from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    DeviceTokenContext,
    current_active_user,
    get_async_db,
    get_authenticated_device,
)
from app.models.user import User
from app.models.workflow_mirror import WorkflowMirror
from app.schemas.workflow_mirror import (
    WorkflowMirrorRead,
    WorkflowMirrorReadFull,
    WorkflowMirrorSyncIn,
)
from app.services.coord_operator_resolver import resolve_tenant_for_user

logger = structlog.get_logger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# List + detail (operator JWT)
# ---------------------------------------------------------------------------


@router.get(
    "",
    response_model=list[WorkflowMirrorRead],
    summary="List mirrored workflows for the current operator",
)
async def list_workflow_mirror(
    category: str | None = Query(None, description="Filter by category"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> list[WorkflowMirrorRead]:
    tenant_id = await resolve_tenant_for_user(current_user, db)
    stmt = (
        select(WorkflowMirror)
        .where(WorkflowMirror.tenant_id == tenant_id)
        .where(WorkflowMirror.owner_user_id == current_user.id)
        .order_by(WorkflowMirror.runner_updated_at.desc())
    )
    if category is not None:
        stmt = stmt.where(WorkflowMirror.category == category)
    rows = (await db.execute(stmt)).scalars().all()
    return [WorkflowMirrorRead.model_validate(r) for r in rows]


@router.get(
    "/{workflow_id}",
    response_model=WorkflowMirrorReadFull,
    summary="Get a mirrored workflow including its definition",
)
async def get_workflow_mirror(
    workflow_id: UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> WorkflowMirrorReadFull:
    tenant_id = await resolve_tenant_for_user(current_user, db)
    stmt = (
        select(WorkflowMirror)
        .where(WorkflowMirror.id == workflow_id)
        .where(WorkflowMirror.tenant_id == tenant_id)
        .where(WorkflowMirror.owner_user_id == current_user.id)
    )
    row = (await db.execute(stmt)).scalar_one_or_none()
    if row is None:
        # 404 — and we deliberately don't differentiate "doesn't exist" from
        # "exists but isn't yours" to avoid leaking row existence.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow not found: {workflow_id}",
        )
    return WorkflowMirrorReadFull.model_validate(row)


# ---------------------------------------------------------------------------
# Sync write-through (device JWT)
# ---------------------------------------------------------------------------


@router.post(
    "/sync",
    response_model=WorkflowMirrorRead,
    summary="Runner write-through — upsert (or delete) a mirror row",
)
async def sync_workflow_mirror(
    payload: WorkflowMirrorSyncIn,
    db: AsyncSession = Depends(get_async_db),
    device: DeviceTokenContext = Depends(get_authenticated_device),
) -> WorkflowMirrorRead:
    """Upsert a mirror row from a runner's local SQLite mutation.

    The JWT must be a coord-issued device-token. ``tenant_id`` and
    ``owner_user_id`` are taken from the JWT, never from the body.

    When ``deleted=true`` the row is removed if present (idempotent — 200
    either way as long as the device is authorised for the row's
    ``owner_user_id``).

    Last-write-wins: if a stored row exists with a newer
    ``runner_updated_at``, the incoming write is rejected as 409 Conflict.
    """
    tenant_id = await resolve_tenant_for_user(device.user, db)
    device_id = device.claims.get("device_id")
    device_uuid = None
    if device_id:
        try:
            device_uuid = UUID(str(device_id))
        except (TypeError, ValueError):
            device_uuid = None

    stmt = select(WorkflowMirror).where(WorkflowMirror.id == payload.id)
    existing = (await db.execute(stmt)).scalar_one_or_none()

    if payload.deleted:
        if existing is None:
            # Idempotent — runner already-deleted local + mirror missing is
            # the converged state.
            logger.info(
                "workflow_mirror_delete_noop",
                workflow_id=str(payload.id),
                user_id=str(device.user.id),
            )
        else:
            if (
                existing.owner_user_id != device.user.id
                or existing.tenant_id != tenant_id
            ):
                # Don't disclose existence — return 404.
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Workflow not found: {payload.id}",
                )
            await db.delete(existing)
            await db.commit()
            logger.info(
                "workflow_mirror_deleted",
                workflow_id=str(payload.id),
                user_id=str(device.user.id),
            )
        return WorkflowMirrorRead(
            id=payload.id,
            name=payload.name,
            category=payload.category,
            runner_updated_at=payload.runner_updated_at,
            mirrored_at=payload.runner_updated_at,
        )

    # Upsert path.
    from datetime import UTC as _UTC
    from datetime import datetime as _dt_module

    if existing is None:
        row = WorkflowMirror(
            id=payload.id,
            tenant_id=tenant_id,
            device_id=device_uuid,
            owner_user_id=device.user.id,
            name=payload.name,
            category=payload.category,
            definition=payload.definition,
            runner_updated_at=payload.runner_updated_at,
            mirrored_at=_dt_module.now(_UTC),
        )
        db.add(row)
        await db.commit()
        await db.refresh(row)
        logger.info(
            "workflow_mirror_inserted",
            workflow_id=str(payload.id),
            user_id=str(device.user.id),
        )
        return WorkflowMirrorRead.model_validate(row)

    # Update path. Reject if the caller doesn't own the row.
    if existing.owner_user_id != device.user.id or existing.tenant_id != tenant_id:
        # Don't disclose existence — return 404.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow not found: {payload.id}",
        )

    if payload.runner_updated_at < existing.runner_updated_at:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Stale write — incoming runner_updated_at "
                f"({payload.runner_updated_at.isoformat()}) is older than "
                f"stored ({existing.runner_updated_at.isoformat()})."
            ),
        )

    existing.name = payload.name
    existing.category = payload.category
    existing.definition = payload.definition
    existing.runner_updated_at = payload.runner_updated_at
    if device_uuid is not None:
        existing.device_id = device_uuid
    existing.mirrored_at = _dt_module.now(_UTC)
    await db.commit()
    await db.refresh(existing)
    logger.info(
        "workflow_mirror_updated",
        workflow_id=str(payload.id),
        user_id=str(device.user.id),
    )
    return WorkflowMirrorRead.model_validate(existing)
