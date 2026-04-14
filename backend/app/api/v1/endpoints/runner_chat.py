"""
REST API endpoints for runner chat communication.

Provides REST fallback endpoints for sending chat messages to runners
when WebSocket connections are not available.
"""

from typing import Any

import structlog
from app.api.deps import get_async_db, get_current_active_user_async
from app.config.redis_config import get_redis
from app.models.runner_connection import RunnerConnection
from app.models.user import User as UserModel
from app.services.runner_connection_manager import \
    get_runner_connection_manager
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from qontinui_schemas.common import utc_now
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)

router = APIRouter()


class ChatMessageBody(BaseModel):
    """Request body for sending a chat message."""

    content: str
    task_run_id: str


class CreateChatBody(BaseModel):
    """Request body for creating a new chat session."""

    task_name: str = "Mobile Chat"


async def _verify_connection_ownership(
    connection_id: int,
    user: UserModel,
    db: AsyncSession,
) -> RunnerConnection:
    """Verify the connection exists and belongs to the user.

    Args:
        connection_id: Runner connection ID.
        user: Authenticated user.
        db: Database session.

    Returns:
        The runner connection record.

    Raises:
        HTTPException: If connection not found or not owned by user.
    """
    query = select(RunnerConnection).where(
        RunnerConnection.id == connection_id,
        RunnerConnection.user_id == user.id,
        RunnerConnection.disconnected_at.is_(None),
    )
    result = await db.execute(query)
    connection = result.scalar_one_or_none()

    if not connection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Runner connection not found or not owned by you",
        )

    return connection


@router.post("/connections/{connection_id}/chat/message")
async def send_chat_message(
    connection_id: int,
    body: ChatMessageBody,
    current_user: UserModel = Depends(get_current_active_user_async),
    db: AsyncSession = Depends(get_async_db),
) -> dict[str, Any]:
    """
    Send a chat message to a connected runner.

    Args:
        connection_id: Runner connection ID.
        body: Chat message body containing content and task_run_id.

    Returns:
        Acknowledgment with send status.
    """
    await _verify_connection_ownership(connection_id, current_user, db)

    redis_client = await get_redis()
    manager = await get_runner_connection_manager(redis_client)

    chat_msg = {
        "type": "chat_message",
        "task_run_id": body.task_run_id,
        "content": body.content,
        "timestamp": utc_now().isoformat(),
    }

    sent = await manager.send_chat_to_runner(connection_id, chat_msg)

    if not sent:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Runner is not connected",
        )

    logger.info(
        "rest_chat_message_sent",
        connection_id=connection_id,
        task_run_id=body.task_run_id,
        user_id=str(current_user.id),
    )

    return {
        "status": "forwarded",
        "note": "Message forwarded to runner via relay. Delivery is not guaranteed if runner disconnects.",
        "timestamp": utc_now().isoformat(),
    }


@router.get("/connections/{connection_id}/chat/running")
async def list_running_tasks(
    connection_id: int,
    current_user: UserModel = Depends(get_current_active_user_async),
    db: AsyncSession = Depends(get_async_db),
) -> dict[str, Any]:
    """
    Request list of running tasks from a connected runner.

    Note: This sends the request to the runner. The actual list
    will be returned asynchronously via the chat WebSocket connection.

    Args:
        connection_id: Runner connection ID.

    Returns:
        Acknowledgment that the request was sent.
    """
    await _verify_connection_ownership(connection_id, current_user, db)

    redis_client = await get_redis()
    manager = await get_runner_connection_manager(redis_client)

    list_msg = {
        "type": "chat_list_running",
        "timestamp": utc_now().isoformat(),
    }

    sent = await manager.send_chat_to_runner(connection_id, list_msg)

    if not sent:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Runner is not connected",
        )

    logger.info(
        "rest_chat_list_running_sent",
        connection_id=connection_id,
        user_id=str(current_user.id),
    )

    return {
        "status": "request_forwarded",
        "note": "Request forwarded to runner via relay. Delivery is not guaranteed if runner disconnects.",
        "timestamp": utc_now().isoformat(),
    }


@router.post("/connections/{connection_id}/chat/create")
async def create_chat_session(
    connection_id: int,
    body: CreateChatBody,
    current_user: UserModel = Depends(get_current_active_user_async),
    db: AsyncSession = Depends(get_async_db),
) -> dict[str, Any]:
    """
    Create a new chat session on a connected runner.

    Note: This sends the creation request to the runner. The actual
    session details will be returned asynchronously via the chat
    WebSocket connection.

    Args:
        connection_id: Runner connection ID.
        body: Chat creation body containing task_name.

    Returns:
        Acknowledgment that the creation request was sent.
    """
    await _verify_connection_ownership(connection_id, current_user, db)

    redis_client = await get_redis()
    manager = await get_runner_connection_manager(redis_client)

    create_msg = {
        "type": "chat_create",
        "task_name": body.task_name,
        "timestamp": utc_now().isoformat(),
    }

    sent = await manager.send_chat_to_runner(connection_id, create_msg)

    if not sent:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Runner is not connected",
        )

    logger.info(
        "rest_chat_create_sent",
        connection_id=connection_id,
        task_name=body.task_name,
        user_id=str(current_user.id),
    )

    return {
        "status": "request_forwarded",
        "task_name": body.task_name,
        "note": "Request forwarded to runner via relay. Delivery is not guaranteed if runner disconnects.",
        "timestamp": utc_now().isoformat(),
    }
