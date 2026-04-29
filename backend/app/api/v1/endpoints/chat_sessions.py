"""
REST endpoints for chat session management.

Provides session listing by proxying to a connected runner. Picks the
user's first WS-connected runner; returns an empty session list with
``runner_connected=False`` if none.
"""

import structlog
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_active_user, get_db
from app.config.redis_config import get_redis
from app.models.runner import Runner
from app.models.user import User
from app.services.runner_websocket_manager import get_runner_websocket_manager

router = APIRouter()
logger = structlog.get_logger(__name__)


@router.get("/chat/sessions")
async def list_chat_sessions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(current_active_user),
):
    """List chat sessions from connected runners."""
    # Pick the first WS-connected runner owned by this user.
    query = select(Runner).where(
        Runner.user_id == current_user.id,
        Runner.ws_session_id.is_not(None),
    )
    result = await db.execute(query)
    runner = result.scalars().first()

    if not runner:
        return {"sessions": [], "runner_connected": False}

    redis_client = await get_redis()
    manager = await get_runner_websocket_manager(redis_client)

    if not manager.is_connected(runner.id):
        return {"sessions": [], "runner_connected": False}

    sent = await manager.send_chat(runner.id, {"type": "chat_list_running"})
    if not sent:
        return {
            "sessions": [],
            "runner_connected": True,
            "error": "Failed to query runner",
        }

    return {
        "sessions": [],
        "runner_connected": True,
        "message": "Query sent to runner. Sessions will arrive via WebSocket.",
    }
