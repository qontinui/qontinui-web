"""
Config Testing API Endpoints

Endpoints that serve snapshot-run screenshots. The placeholder mock-execution
endpoint (`POST /integration-testing/execute`), which returned fabricated
execution data, and the PDF report endpoints (`POST /reports/pdf` and
`/reports/pdf/async`) are deleted. None of them had a live caller.

The module keeps its integration_testing.py name, but the feature it serves
is called Config Testing in Qontinui terminology:
- Config Testing = workflow validation against captured snapshot runs
- QA Testing = Real test runs from the runner (see testing.py)
"""

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import current_active_user, get_async_db
from app.models.project import Project
from app.models.snapshot import SnapshotRun
from app.models.user import User
from app.services.object_storage import object_storage

logger = logging.getLogger(__name__)

router = APIRouter()


async def verify_project_access(
    db: AsyncSession, project_id: str, user_id: Any
) -> Project:
    """Verify user has access to the project."""
    from uuid import UUID

    try:
        pid = UUID(project_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid project ID format",
        )

    result = await db.execute(select(Project).filter(Project.id == pid))
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    if project.owner_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to access this project",
        )

    return project


# Snapshot Screenshots Endpoints
@router.get("/snapshots/{run_id}/screenshots")
async def get_state_screenshots(
    run_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
    active_states: str | None = Query(None),
) -> dict[str, Any]:
    """
    Get screenshots for a snapshot run.

    **Authentication:** JWT token required

    Returns screenshots from a snapshot run, optionally filtered by active states.
    """
    logger.info(f"Get screenshots requested for run {run_id} by user {current_user.id}")

    # Get snapshot run and verify ownership
    from uuid import UUID

    try:
        rid = UUID(run_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid run ID format",
        )

    result = await db.execute(
        select(SnapshotRun)
        .options(selectinload(SnapshotRun.screenshots))
        .where(SnapshotRun.run_id == rid)
    )
    snapshot_run = result.scalar_one_or_none()

    if not snapshot_run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Snapshot run not found",
        )

    # Verify project access
    await verify_project_access(db, str(snapshot_run.project_id), current_user.id)

    # Filter screenshots by active states if specified
    screenshots = []
    states_filter = active_states.split(",") if active_states else None

    for screenshot in snapshot_run.screenshots:
        if states_filter:
            if any(state in screenshot.active_states for state in states_filter):
                screenshots.append(
                    {
                        "id": str(screenshot.id),
                        "path": screenshot.screenshot_path,
                        "active_states": screenshot.active_states,
                        "timestamp": (
                            screenshot.timestamp.isoformat()
                            if screenshot.timestamp
                            else None
                        ),
                    }
                )
        else:
            screenshots.append(
                {
                    "id": str(screenshot.id),
                    "path": screenshot.screenshot_path,
                    "active_states": screenshot.active_states,
                    "timestamp": (
                        screenshot.timestamp.isoformat()
                        if screenshot.timestamp
                        else None
                    ),
                }
            )

    # Get unique state combinations
    unique_states = set()
    for s in snapshot_run.screenshots:
        unique_states.add(tuple(sorted(s.active_states)))

    return {
        "screenshots": screenshots,
        "total": len(screenshots),
        "unique_state_combinations": len(unique_states),
    }


@router.get(
    "/snapshots/{run_id}/screenshot/{screenshot_path:path}", response_model=None
)
async def get_screenshot(
    run_id: str,
    screenshot_path: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(current_active_user),
) -> FileResponse | RedirectResponse:
    """
    Get a specific screenshot file.

    **Authentication:** JWT token required

    Returns the screenshot image file from object storage.
    """
    logger.info(
        f"Get screenshot {screenshot_path} requested for run {run_id} "
        f"by user {current_user.id}"
    )

    # Get snapshot run and verify ownership
    from uuid import UUID

    try:
        rid = UUID(run_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid run ID format",
        )

    result = await db.execute(select(SnapshotRun).where(SnapshotRun.run_id == rid))
    snapshot_run = result.scalar_one_or_none()

    if not snapshot_run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Snapshot run not found",
        )

    # Verify project access
    await verify_project_access(db, str(snapshot_run.project_id), current_user.id)

    # Try to get from object storage
    try:
        # Generate presigned URL or download file
        url = object_storage.generate_presigned_url(screenshot_path)
        if url:
            # Redirect to presigned URL
            return RedirectResponse(url=url)
    except Exception as e:
        logger.warning(f"Failed to get screenshot from storage: {e}")

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Screenshot not found",
    )
