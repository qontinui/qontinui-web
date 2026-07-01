"""
P4 Dispatcher: Freshness-aware test-host routing.

Routes test execution to fresh app instances (deployed_sha == upstream HEAD).
Used by workflow executor to select optimal runner for test-target execution.
"""


from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_db_session
from app.core.security import get_current_user
from app.models.user import User
from app.schemas.dispatch import (
    DispatchResponseSchema,
    DispatchStrategyEnum,
)

router = APIRouter(
    prefix="/api/v1/dispatch",
    tags=["dispatch"],
)


@router.post(
    "/fresh-host",
    response_model=DispatchResponseSchema,
    status_code=status.HTTP_200_OK,
    summary="Route to fresh host for app",
    description="Find a fresh test host for the given app_id using P4 dispatcher logic",
)
async def dispatch_to_fresh_host(
    app_id: str,
    strategy: DispatchStrategyEnum = DispatchStrategyEnum.BEST_EFFORT,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> DispatchResponseSchema:
    """
    Route test execution to a fresh host for the given app.

    Strategy:
    - fresh_only: Return error if no fresh hosts available
    - best_effort: Fall back to any healthy host if no fresh

    Returns:
    - device_id: UUID of selected runner
    - device_url: HTTP endpoint for the runner
    - freshness_status: 'fresh' or 'acceptable'
    - error (if applicable): Reason dispatch failed

    Raises:
    - 503 ServiceUnavailable: No suitable host found (fresh_only strategy)
    - 404 NotFound: App not registered
    """
    # TODO: P4 implementation
    # 1. Query project.app_deploy_state WHERE app_id=? AND freshness='fresh'
    # 2. Load-balance across available fresh hosts (randomize)
    # 3. If no fresh hosts + best_effort: pick any healthy device with app
    # 4. Look up device URL from coord.devices
    # 5. Return DispatchResponseSchema with device_id + url
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="P4 dispatcher implementation in progress",
    )


@router.get(
    "/dispatch-status/{app_id}",
    response_model=dict,
    summary="Get dispatch status for app",
    description="Check available fresh hosts and fallback options for an app",
)
async def get_dispatch_status(
    app_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    """
    Get dispatch statistics for an app.

    Returns:
    - fresh_hosts_count: Number of fresh hosts
    - available_hosts_count: Number of healthy hosts (fallback)
    - freshness_ratio: Percentage of hosts that are fresh
    - error: If app not registered or no hosts available

    Useful for diagnostics and dashboard display.
    """
    # TODO: P4 implementation
    # Query freshness state and calculate statistics
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="P4 dispatcher status in progress",
    )
