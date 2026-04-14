"""
REST endpoints for chat session management.

Provides session listing and management by proxying to connected runners.
"""

import structlog
from app.api.deps import current_active_user, get_db
from app.config.redis_config import get_redis
from app.models.runner_connection import RunnerConnection
from app.models.user import User
from app.services.runner_connection_manager import \
    get_runner_connection_manager
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter()
logger = structlog.get_logger(__name__)


@router.get("/chat/sessions")
async def list_chat_sessions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(current_active_user),
):
    """
    List chat sessions from connected runners.

    Finds the user's active runner connection and queries it for
    task runs with workflow_type='chat'.
    """
    # Find user's active runner connection
    query = select(RunnerConnection).where(
        RunnerConnection.user_id == current_user.id,
        RunnerConnection.disconnected_at.is_(None),
    )
    result = await db.execute(query)
    connection = result.scalar_one_or_none()

    if not connection:
        return {"sessions": [], "runner_connected": False}

    # Get runner connection manager and query for chat sessions
    redis_client = await get_redis()
    manager = await get_runner_connection_manager(redis_client)

    if not manager.is_runner_connected(connection.id):
        return {"sessions": [], "runner_connected": False}

    # Send request to runner and get response
    import asyncio

    response_future = asyncio.get_event_loop().create_future()

    async def capture_response(msg):
        if msg.get("type") == "chat_running_tasks" and not response_future.done():
            response_future.set_result(msg)

    # Register temporary listener
    sent = await manager.send_chat_to_runner(
        connection.id, {"type": "chat_list_running"}
    )

    if not sent:
        return {
            "sessions": [],
            "runner_connected": True,
            "error": "Failed to query runner",
        }

    # For now, return runner_connected status - the actual sessions
    # will come through the WebSocket as chat_running_tasks
    return {
        "sessions": [],
        "runner_connected": True,
        "message": "Query sent to runner. Sessions will arrive via WebSocket.",
    }
