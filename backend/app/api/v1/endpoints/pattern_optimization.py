import structlog
from fastapi import APIRouter, HTTPException

# DEPRECATED: CV-heavy services removed - functionality moved to qontinui library

logger = structlog.get_logger(__name__)

router = APIRouter()


@router.post("/optimize-pattern", status_code=410)
async def optimize_pattern():
    """
    DEPRECATED: Pattern optimization functionality has been removed.

    This endpoint has been deprecated and removed. Pattern optimization should be
    implemented in the qontinui library for local execution.
    """
    raise HTTPException(
        status_code=410,
        detail="Pattern optimization functionality has been removed. Use qontinui library for local execution.",
    )


@router.post("/create-state-image", status_code=410)
async def create_state_image():
    """
    DEPRECATED: StateImage creation functionality has been removed.

    This endpoint has been deprecated and removed. StateImage creation should be
    implemented in the qontinui library for local execution.
    """
    raise HTTPException(
        status_code=410,
        detail="StateImage creation functionality has been removed. Use qontinui library for local execution.",
    )
