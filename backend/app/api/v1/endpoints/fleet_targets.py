"""Fleet-fresh P5: app config + test-host designation routes.

Backs the fleet UI's three write/read surfaces (see plan
``2026-06-20-fleet-fresh-test-target-routing.md``):

* **App config** — edit an app's ``update_strategy`` + build/start commands
  (``project.apps`` via :class:`app.models.app_registry.App`).
* **Freshness** — per-(device, app) deployment freshness for badges
  (``project.app_deploy_state``, written by the runner's auto-fresh engine).
* **Designation** — mark a device as a test host for an app + toggle
  ``auto_fresh`` (``coord.test_targets`` via
  :class:`app.models.test_target.TestTarget`).

Reads are scoped to the caller's owned devices (``Device.user_id ==
current_user.id``); the ``coord.test_targets`` write additionally stamps the
caller's coord home tenant (``operations.get_tenant_id``), the same
operator-scoped posture the plan's migration prescribes.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from qontinui_schemas.common import utc_now
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.api.v1.endpoints.operations import get_tenant_id
from app.models.app_deploy_state import AppDeployState
from app.models.app_registry import App
from app.models.device import Device
from app.models.test_target import TestTarget
from app.models.user import User
from app.schemas.fleet_targets import (
    AppConfig,
    AppConfigUpdate,
    FreshnessRow,
    TestTargetDesignation,
    TestTargetRow,
)

router = APIRouter()


# ---------------------------------------------------------------------------
# App config (project.apps)
# ---------------------------------------------------------------------------


@router.get("/apps", response_model=list[AppConfig])
async def list_apps(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> list[AppConfig]:
    """List registered apps + their fleet-fresh config.

    ``project.apps`` is not user-partitioned (it is the runner-local app
    registry mirrored on shared Postgres), so this returns every registered
    app — the fleet UI is an operator surface.
    """
    result = await db.execute(select(App).order_by(App.display_name))
    return [AppConfig.model_validate(row) for row in result.scalars().all()]


@router.patch("/apps/{app_id}", response_model=AppConfig)
async def update_app_config(
    app_id: str,
    body: AppConfigUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> AppConfig:
    """Edit an app's update strategy + build/start commands.

    Fields left ``None`` are unchanged. ``build_command`` / ``start_command``
    can be cleared by sending an empty string.
    """
    app = await db.get(App, app_id)
    if app is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "app_not_found", "message": f"App '{app_id}' not found."},
        )

    if body.update_strategy is not None:
        app.update_strategy = body.update_strategy.value
    if body.build_command is not None:
        app.build_command = body.build_command or None
    if body.start_command is not None:
        app.start_command = body.start_command or None

    await db.commit()
    await db.refresh(app)
    return AppConfig.model_validate(app)


# ---------------------------------------------------------------------------
# Freshness (project.app_deploy_state)
# ---------------------------------------------------------------------------


@router.get("/freshness", response_model=list[FreshnessRow])
async def list_freshness(
    app_id: str | None = None,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> list[FreshnessRow]:
    """Per-(device, app) deployment freshness across the caller's devices.

    Sourced from ``project.app_deploy_state`` (the P4-landed freshness store
    the runner's auto-fresh engine writes). Optionally filtered to one app.
    """
    query = (
        select(AppDeployState, Device)
        .join(Device, Device.device_id == AppDeployState.device_id)
        .where(Device.user_id == current_user.id)
    )
    if app_id is not None:
        query = query.where(AppDeployState.app_id == app_id)

    result = await db.execute(query)
    rows: list[FreshnessRow] = []
    for state, device in result.all():
        rows.append(
            FreshnessRow(
                device_id=device.device_id,
                app_id=state.app_id,
                device_name=device.name,
                hostname=device.hostname,
                freshness=state.freshness,
                deployed_sha=state.deployed_sha,
                deployed_at=state.deployed_at,
                last_error=state.last_error,
                updated_at=state.updated_at,
            )
        )
    return rows


# ---------------------------------------------------------------------------
# Designation (coord.test_targets)
# ---------------------------------------------------------------------------


@router.get("/test-targets", response_model=list[TestTargetRow])
async def list_test_targets(
    app_id: str | None = None,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> list[TestTargetRow]:
    """List test-host designations for the caller's devices.

    Joins ``coord.test_targets`` → ``coord.devices`` (owned by the caller)
    and left-joins ``project.app_deploy_state`` so each row carries the
    device's current freshness for the app. Optionally filtered to one app.
    """
    query = (
        select(TestTarget, Device, AppDeployState)
        .join(Device, Device.device_id == TestTarget.device_id)
        .outerjoin(
            AppDeployState,
            (AppDeployState.device_id == TestTarget.device_id)
            & (AppDeployState.app_id == TestTarget.app_id),
        )
        .where(Device.user_id == current_user.id)
    )
    if app_id is not None:
        query = query.where(TestTarget.app_id == app_id)

    result = await db.execute(query)
    rows: list[TestTargetRow] = []
    for target, device, state in result.all():
        rows.append(
            TestTargetRow(
                device_id=target.device_id,
                app_id=target.app_id,
                auto_fresh=target.auto_fresh,
                device_name=device.name,
                hostname=device.hostname,
                derived_status=device.derived_status,
                freshness=state.freshness if state is not None else None,
                deployed_sha=state.deployed_sha if state is not None else None,
                deployed_at=state.deployed_at if state is not None else None,
                created_at=target.created_at,
                updated_at=target.updated_at,
            )
        )
    return rows


async def _owned_device(db: AsyncSession, device_id: UUID, user_id: UUID) -> Device:
    """Fetch a device and enforce caller ownership (404 otherwise)."""
    device = await db.get(Device, device_id)
    if device is None or device.user_id != user_id:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "device_not_found",
                "message": f"Device {device_id} not found or not owned by caller.",
            },
        )
    return device


@router.put("/test-targets/{device_id}/{app_id}", response_model=TestTargetRow)
async def designate_test_target(
    device_id: UUID,
    app_id: str,
    body: TestTargetDesignation,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
    tenant_id: UUID = Depends(get_tenant_id),
) -> TestTargetRow:
    """Designate ``device_id`` as a test host for ``app_id`` (upsert).

    Writes ``coord.test_targets`` stamped with the caller's coord home
    tenant. Idempotent — re-designating updates ``auto_fresh``. The device
    must be owned by the caller and the app must be registered.
    """
    device = await _owned_device(db, device_id, current_user.id)

    app = await db.get(App, app_id)
    if app is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "app_not_found", "message": f"App '{app_id}' not found."},
        )

    existing = await db.get(TestTarget, (device_id, app_id))
    if existing is None:
        target = TestTarget(
            device_id=device_id,
            app_id=app_id,
            tenant_id=tenant_id,
            auto_fresh=body.auto_fresh,
        )
        db.add(target)
    else:
        existing.auto_fresh = body.auto_fresh
        existing.tenant_id = tenant_id
        existing.updated_at = utc_now()
        target = existing

    await db.commit()
    await db.refresh(target)

    state = await db.get(AppDeployState, (device_id, app_id))
    return TestTargetRow(
        device_id=target.device_id,
        app_id=target.app_id,
        auto_fresh=target.auto_fresh,
        device_name=device.name,
        hostname=device.hostname,
        derived_status=device.derived_status,
        freshness=state.freshness if state is not None else None,
        deployed_sha=state.deployed_sha if state is not None else None,
        deployed_at=state.deployed_at if state is not None else None,
        created_at=target.created_at,
        updated_at=target.updated_at,
    )


@router.delete("/test-targets/{device_id}/{app_id}", status_code=204)
async def undesignate_test_target(
    device_id: UUID,
    app_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> None:
    """Remove a test-host designation (idempotent — 204 even if absent)."""
    await _owned_device(db, device_id, current_user.id)
    target = await db.get(TestTarget, (device_id, app_id))
    if target is not None:
        await db.delete(target)
        await db.commit()
