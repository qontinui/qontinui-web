"""
API endpoints for runner connection management.

Provides REST API for viewing and managing desktop runner connections.
"""

from datetime import datetime
from typing import Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_superuser, get_async_db, get_current_active_user_async
from app.config.redis_config import get_redis
from app.crud import runner as runner_crud
from app.models.user import User as UserModel
from app.schemas.runner import (
    ConnectionCleanupResponse,
    ExecuteWorkflowRequest,
    ExecuteWorkflowResponse,
    RunnerConnectionHistory,
    RunnerConnectionResponse,
)
from app.services.runner_connection_manager import get_runner_connection_manager

logger = structlog.get_logger(__name__)

router = APIRouter()


@router.get("/connections", response_model=RunnerConnectionHistory)
async def get_connection_history(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
    limit: int = 50,
    offset: int = 0,
) -> Any:
    """
    Get connection history with pagination.

    Args:
        limit: Maximum number of connections to return (default: 50, max: 100)
        offset: Number of connections to skip (for pagination)

    Returns:
        Paginated connection history
    """
    limit = min(limit, 100)

    connections, total = await runner_crud.get_connection_history(
        db=db,
        user_id=current_user.id,
        limit=limit,
        offset=offset,
    )

    active_connections = await runner_crud.get_active_connections(
        db=db,
        user_id=current_user.id,
    )

    return RunnerConnectionHistory(
        connections=[
            RunnerConnectionResponse(
                id=conn.id,
                runner_name=conn.runner_name or "Desktop Runner",
                connected_at=conn.connected_at,
                disconnected_at=conn.disconnected_at,
                duration_seconds=conn.duration_seconds,
                ip_address=conn.ip_address,
                project_id=str(conn.project_id) if conn.project_id else None,
            )
            for conn in connections
        ],
        total=total,
        active_count=len(active_connections),
        limit=limit,
        offset=offset,
    )


@router.get("/connections/active", response_model=list[RunnerConnectionResponse])
async def get_active_connections(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
) -> Any:
    """
    Get currently active runner connections.

    Returns:
        List of active connections with WebSocket connection status
    """
    active_connections = await runner_crud.get_active_connections(
        db=db,
        user_id=current_user.id,
    )

    # Get WebSocket connection status from runner connection manager
    redis_client = await get_redis()
    runner_manager = await get_runner_connection_manager(redis_client)
    ws_connected_ids = set(await runner_manager.get_all_connected_runner_ids_redis())

    return [
        RunnerConnectionResponse(
            id=conn.id,
            runner_name=conn.runner_name or "Desktop Runner",
            connected_at=conn.connected_at,
            disconnected_at=conn.disconnected_at,
            duration_seconds=conn.duration_seconds,
            ip_address=conn.ip_address,
            project_id=str(conn.project_id) if conn.project_id else None,
            ws_connected=conn.id in ws_connected_ids,
        )
        for conn in active_connections
    ]


@router.post(
    "/connections/{connection_id}/disconnect", status_code=status.HTTP_204_NO_CONTENT
)
async def disconnect_runner(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
    connection_id: int,
) -> None:
    """
    Disconnect an active runner connection.

    Args:
        connection_id: The runner connection ID to disconnect

    Raises:
        404: If connection not found or not owned by user
    """
    from sqlalchemy import select

    from app.models.runner_connection import RunnerConnection

    # Verify connection exists and belongs to user
    query = select(RunnerConnection).where(
        RunnerConnection.id == connection_id,
        RunnerConnection.user_id == current_user.id,
        RunnerConnection.disconnected_at.is_(None),
    )
    result = await db.execute(query)
    connection = result.scalar_one_or_none()

    if not connection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Runner connection not found or already disconnected",
        )

    # Close the connection record
    await runner_crud.close_connection_record(
        db=db,
        connection_id=connection_id,
    )

    # Try to disconnect via WebSocket if connected
    try:
        redis_client = await get_redis()
        runner_manager = await get_runner_connection_manager(redis_client)
        await runner_manager.disconnect_runner(connection_id)
    except Exception as e:
        logger.warning(
            "disconnect_websocket_failed",
            connection_id=connection_id,
            error=str(e),
        )

    logger.info(
        "runner_disconnected",
        connection_id=connection_id,
        user_id=str(current_user.id),
    )


@router.post("/connections/cleanup", response_model=ConnectionCleanupResponse)
async def cleanup_stale_connections(
    *,
    current_user: UserModel = Depends(current_superuser),
) -> Any:
    """
    Manually trigger cleanup of stale runner connections.

    This endpoint allows administrators to manually trigger the cleanup process
    that normally runs automatically every 60 seconds in the background.

    **Admin only**: This endpoint requires superuser privileges.

    Returns:
        Cleanup statistics including total active connections, stale found, and cleaned
    """
    from app.tasks.connection_cleanup import cleanup_stale_connections

    logger.info(
        "manual_cleanup_triggered",
        user_id=str(current_user.id),
        username=current_user.username,
    )

    try:
        stats = await cleanup_stale_connections()

        message = (
            f"Cleanup completed successfully. "
            f"Found {stats['total_active']} active connections, "
            f"identified {stats['stale_found']} stale connections, "
            f"cleaned up {stats['cleaned']} connections."
        )

        logger.info(
            "manual_cleanup_completed",
            user_id=str(current_user.id),
            stats=stats,
        )

        return ConnectionCleanupResponse(
            total_active=stats["total_active"],
            stale_found=stats["stale_found"],
            cleaned=stats["cleaned"],
            message=message,
        )
    except Exception as e:
        logger.error(
            "manual_cleanup_error",
            user_id=str(current_user.id),
            error=str(e),
            error_type=type(e).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Cleanup failed: {str(e)}",
        )


@router.post(
    "/connections/{connection_id}/execute",
    response_model=ExecuteWorkflowResponse,
)
async def execute_workflow_on_runner(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: UserModel = Depends(get_current_active_user_async),
    connection_id: int,
    request: ExecuteWorkflowRequest,
) -> Any:
    """
    Send a workflow configuration to a connected runner for execution.

    This endpoint sends the workflow configuration to the specified runner
    via WebSocket command. The runner will receive the configuration and
    begin execution.

    Args:
        connection_id: The runner connection ID to send the workflow to
        request: The workflow execution request containing the configuration

    Returns:
        ExecuteWorkflowResponse with execution_id and status

    Raises:
        404: If connection not found or not owned by user
        400: If runner is not currently connected
    """
    import uuid

    from sqlalchemy import select

    from app.models.runner_connection import RunnerConnection

    # Verify connection exists and belongs to user
    query = select(RunnerConnection).where(
        RunnerConnection.id == connection_id,
        RunnerConnection.user_id == current_user.id,
        RunnerConnection.disconnected_at.is_(None),
    )
    result = await db.execute(query)
    connection = result.scalar_one_or_none()

    if not connection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Runner connection not found or not owned by you",
        )

    # Get runner connection manager and verify runner is connected
    redis_client = await get_redis()
    runner_manager = await get_runner_connection_manager(redis_client)

    if not runner_manager.is_runner_connected(connection_id):
        is_connected = await runner_manager.is_runner_connected_redis(connection_id)
        if not is_connected:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Runner is not currently connected. Please ensure the runner is running and connected.",
            )

    # Generate execution ID
    execution_id = str(uuid.uuid4())

    # Build the execute_workflow command
    command_msg = {
        "type": "command",
        "command": "execute_workflow",
        "params": {
            "execution_id": execution_id,
            "workflow": request.workflow,
            "variables": request.variables or {},
        },
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }

    # Send command to runner
    sent = await runner_manager.send_command_to_runner(connection_id, command_msg)

    if not sent:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to send workflow to runner. Please try again.",
        )

    logger.info(
        "workflow_execution_sent",
        connection_id=connection_id,
        user_id=str(current_user.id),
        execution_id=execution_id,
        workflow_name=request.workflow.get("name", "Unknown"),
    )

    return ExecuteWorkflowResponse(
        execution_id=execution_id,
        status="sent",
        message=f"Workflow sent to runner. Execution ID: {execution_id}",
        connection_id=connection_id,
    )
