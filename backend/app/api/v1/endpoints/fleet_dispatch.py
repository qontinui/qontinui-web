"""Fleet-fresh P4: freshness-aware test-host routing endpoints.

Thin HTTP layer over :func:`app.services.workflow_dispatcher.dispatch_to_fresh_host`
— resolve an owned, healthy runner whose deployed build of ``app_id`` matches
upstream HEAD (per ``project.app_deploy_state``, written by the runner's
auto-fresh engine).
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.models.app_deploy_state import AppDeploymentFreshness, AppDeployState
from app.models.device import Device
from app.models.user import User
from app.schemas.dispatch import (
    DispatchStatusResponse,
    DispatchStrategyEnum,
    FreshHostResponse,
)
from app.services.workflow_dispatcher import dispatch_to_fresh_host

router = APIRouter()


@router.post("/fresh-host", response_model=FreshHostResponse)
async def resolve_fresh_host(
    app_id: str,
    strategy: DispatchStrategyEnum = DispatchStrategyEnum.BEST_EFFORT,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> FreshHostResponse:
    """Resolve a test host for ``app_id``.

    ``fresh_only`` → 503 when no fresh host qualifies. ``best_effort`` →
    falls back to any healthy owned runner; 503 only when none exists.
    """
    device = await dispatch_to_fresh_host(
        db, current_user.id, app_id, strategy=strategy.value
    )
    if device is None:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "no_fresh_host_available",
                "message": f"No {'fresh' if strategy == DispatchStrategyEnum.FRESH_ONLY else 'healthy'} "
                f"host available for app '{app_id}'",
                "strategy": strategy.value,
            },
        )

    # Distinguish a genuinely-fresh resolution from a best_effort fallback.
    fresh_row = await db.execute(
        select(AppDeployState).where(
            AppDeployState.device_id == device.device_id,
            AppDeployState.app_id == app_id,
            AppDeployState.freshness == AppDeploymentFreshness.FRESH.value,
        )
    )
    is_fresh = fresh_row.scalar_one_or_none() is not None

    return FreshHostResponse(
        device_id=device.device_id,
        device_name=device.name,
        hostname=device.hostname,
        port=device.port,
        freshness_status="fresh" if is_fresh else "fallback",
    )


@router.get("/status/{app_id}", response_model=DispatchStatusResponse)
async def dispatch_status(
    app_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> DispatchStatusResponse:
    """Count owned fresh hosts for ``app_id`` (dashboard / preflight check)."""
    count_result = await db.execute(
        select(func.count())
        .select_from(AppDeployState)
        .join(Device, Device.device_id == AppDeployState.device_id)
        .where(
            Device.user_id == current_user.id,
            AppDeployState.app_id == app_id,
            AppDeployState.freshness == AppDeploymentFreshness.FRESH.value,
        )
    )
    fresh_count = int(count_result.scalar_one())
    return DispatchStatusResponse(
        app_id=app_id,
        fresh_hosts_count=fresh_count,
        can_dispatch_fresh=fresh_count > 0,
    )
