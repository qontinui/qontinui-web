"""Admin cleanup endpoints."""

from typing import Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, status

from app.api.v1.endpoints.admin.dependencies import require_admin
from app.models.user import User

router = APIRouter()
logger = structlog.get_logger(__name__)


@router.post("/cleanup/run")
async def run_cleanup_manually(
    current_user: User = Depends(require_admin),
) -> Any:
    """
    Manually trigger cleanup of expired sessions and old data.

    This endpoint allows admins to run cleanup tasks on-demand without
    waiting for the scheduled cron job. Useful for testing or immediate cleanup needs.
    """
    logger.info(
        "manual_cleanup_triggered",
        user_id=str(current_user.id),
        user_email=current_user.email,
    )

    try:
        from app.worker.scheduler import run_all_cleanup_tasks

        ctx: dict[str, Any] = {}
        results = await run_all_cleanup_tasks(ctx)

        logger.info(
            "manual_cleanup_completed",
            user_id=str(current_user.id),
            status=results.get("status"),
            total_deleted=results.get("total_deleted", 0),
        )

        return results

    except Exception as e:
        logger.exception(
            "manual_cleanup_failed",
            user_id=str(current_user.id),
            error=str(e),
            error_type=type(e).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Cleanup failed: {str(e)}",
        )
