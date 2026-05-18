"""
REST API endpoints for runner chat communication.

Provides REST fallback endpoints for sending chat messages to a runner
identified by ``runner.id`` (UUID) when WebSocket connections are not
available.
"""

from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from qontinui_schemas.common import utc_now
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.config.redis_config import get_redis
from app.models.device import Device
from app.models.user import User as UserModel
from app.services.runner_websocket_manager import get_runner_websocket_manager

logger = structlog.get_logger(__name__)

router = APIRouter()


class ChatMessageBody(BaseModel):
    """Request body for sending a chat message."""

    content: str
    task_run_id: str


class CreateChatBody(BaseModel):
    """Request body for creating a new chat session."""

    task_name: str = "Mobile Chat"


async def _verify_runner_ownership(
    runner_id: UUID,
    user: UserModel,
    db: AsyncSession,
) -> Device:
    """Verify the device exists and belongs to the user."""
    query = select(Device).where(
        Device.device_id == runner_id, Device.user_id == user.id
    )
    result = await db.execute(query)
    runner = result.scalar_one_or_none()

    if not runner:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Runner not found or not owned by you",
        )
    return runner


@router.post("/{runner_id}/chat/message")
async def send_chat_message(
    runner_id: UUID,
    body: ChatMessageBody,
    current_user: UserModel = Depends(get_current_active_user_async),
    db: AsyncSession = Depends(get_async_db),
) -> dict[str, Any]:
    """Send a chat message to a connected runner."""
    await _verify_runner_ownership(runner_id, current_user, db)

    redis_client = await get_redis()
    manager = await get_runner_websocket_manager(redis_client)

    chat_msg = {
        "type": "chat_message",
        "task_run_id": body.task_run_id,
        "content": body.content,
        "timestamp": utc_now().isoformat(),
    }

    sent = await manager.send_chat(runner_id, chat_msg)

    if not sent:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Runner is not connected",
        )

    logger.info(
        "rest_chat_message_sent",
        runner_id=str(runner_id),
        task_run_id=body.task_run_id,
        user_id=str(current_user.id),
    )
    return {
        "status": "forwarded",
        "note": (
            "Message forwarded to runner via relay. Delivery is not guaranteed if"
            " runner disconnects."
        ),
        "timestamp": utc_now().isoformat(),
    }


@router.get("/{runner_id}/chat/running")
async def list_running_tasks(
    runner_id: UUID,
    current_user: UserModel = Depends(get_current_active_user_async),
    db: AsyncSession = Depends(get_async_db),
) -> dict[str, Any]:
    """Request list of running tasks from a connected runner."""
    await _verify_runner_ownership(runner_id, current_user, db)

    redis_client = await get_redis()
    manager = await get_runner_websocket_manager(redis_client)

    list_msg = {"type": "chat_list_running", "timestamp": utc_now().isoformat()}
    sent = await manager.send_chat(runner_id, list_msg)
    if not sent:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Runner is not connected",
        )

    logger.info(
        "rest_chat_list_running_sent",
        runner_id=str(runner_id),
        user_id=str(current_user.id),
    )
    return {
        "status": "request_forwarded",
        "note": (
            "Request forwarded to runner via relay. Delivery is not guaranteed if"
            " runner disconnects."
        ),
        "timestamp": utc_now().isoformat(),
    }


@router.post("/{runner_id}/chat/create")
async def create_chat_session(
    runner_id: UUID,
    body: CreateChatBody,
    current_user: UserModel = Depends(get_current_active_user_async),
    db: AsyncSession = Depends(get_async_db),
) -> dict[str, Any]:
    """Create a new chat session on a connected runner."""
    await _verify_runner_ownership(runner_id, current_user, db)

    redis_client = await get_redis()
    manager = await get_runner_websocket_manager(redis_client)

    create_msg = {
        "type": "chat_create",
        "task_name": body.task_name,
        "timestamp": utc_now().isoformat(),
    }
    sent = await manager.send_chat(runner_id, create_msg)
    if not sent:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Runner is not connected",
        )

    logger.info(
        "rest_chat_create_sent",
        runner_id=str(runner_id),
        task_name=body.task_name,
        user_id=str(current_user.id),
    )
    return {
        "status": "request_forwarded",
        "task_name": body.task_name,
        "note": (
            "Request forwarded to runner via relay. Delivery is not guaranteed if"
            " runner disconnects."
        ),
        "timestamp": utc_now().isoformat(),
    }
