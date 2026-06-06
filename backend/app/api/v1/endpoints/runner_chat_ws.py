"""
WebSocket endpoint for mobile-to-runner chat communication.

Allows mobile clients to send chat messages to a runner identified by
``runner.id`` (UUID) and receive real-time chat responses.
"""

from uuid import UUID

import structlog
from fastapi import APIRouter, WebSocket
from pydantic import BaseModel, ValidationError
from qontinui_schemas.common import utc_now
from sqlalchemy import select

from app.api.deps import get_current_user_from_ws
from app.config.redis_config import get_redis
from app.db.session import AsyncSessionLocal
from app.models.device import Device
from app.models.user import User
from app.services.runner_websocket_manager import get_runner_websocket_manager
from app.websockets.safe_send import BENIGN_SEND_EXCEPTIONS, reject

router = APIRouter()
logger = structlog.get_logger(__name__)


class ChatMessage(BaseModel):
    """Message format for mobile-to-runner chat."""

    type: str
    content: str | None = None
    task_run_id: str | None = None
    params: dict = {}


@router.websocket("/{runner_id}/chat")
async def websocket_runner_chat_endpoint(
    websocket: WebSocket,
    runner_id: UUID,
    token: str | None = None,
) -> None:
    """WebSocket endpoint for mobile → runner chat relay.

    URL: ``ws://localhost:8000/api/v1/runners/{runner_id}/chat?token=<jwt>``
    """
    await websocket.accept()

    user: User | None = None
    manager = None

    try:
        auth_token: str | None = token or websocket.cookies.get("access_token")
        if not auth_token:
            await reject(websocket, "Authentication required.")
            return

        try:
            user = await get_current_user_from_ws(auth_token)
        except Exception as e:
            logger.error("runner_chat_ws_auth_failed", error=str(e))
            await reject(websocket, "Authentication failed")
            return

        async with AsyncSessionLocal() as db:
            query = select(Device).where(
                Device.device_id == runner_id, Device.user_id == user.id
            )
            result = await db.execute(query)
            runner = result.scalar_one_or_none()

        if not runner:
            await reject(websocket, "Runner not found or not owned by you")
            return

        redis = await get_redis()
        manager = await get_runner_websocket_manager(redis)
        runner_connected = manager.is_connected(runner_id)
        await manager.connect_mobile_chat(runner_id, websocket, user.id)

        await websocket.send_json(
            {
                "type": "connected",
                "runner_id": str(runner_id),
                "runner_connected": runner_connected,
                "timestamp": utc_now().isoformat(),
            }
        )

        if not runner_connected:
            await websocket.send_json(
                {
                    "type": "warning",
                    "message": (
                        "Runner is not currently connected. Messages cannot be"
                        " delivered until the runner reconnects."
                    ),
                }
            )

        while True:
            try:
                data = await websocket.receive_json()
                try:
                    message = ChatMessage(**data)
                except ValidationError as e:
                    await websocket.send_json(
                        {"type": "error", "message": f"Invalid message format: {e}"}
                    )
                    continue

                if message.type == "ping":
                    await websocket.send_json(
                        {"type": "pong", "timestamp": utc_now().isoformat()}
                    )
                    continue

                # Forward typed chat messages to the runner verbatim.
                msg_to_runner: dict = {
                    "type": message.type,
                    "task_run_id": (
                        message.params.get("task_run_id") or message.task_run_id
                    ),
                    "params": message.params,
                    "content": message.content,
                    "timestamp": utc_now().isoformat(),
                }
                sent = await manager.send_chat(runner_id, msg_to_runner)
                if sent:
                    await websocket.send_json(
                        {
                            "type": f"{message.type}_sent",
                            "timestamp": utc_now().isoformat(),
                        }
                    )
                else:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": "Runner is not connected.",
                        }
                    )
            except BENIGN_SEND_EXCEPTIONS:
                break
            except Exception as e:
                logger.error(
                    "runner_chat_ws_error",
                    runner_id=str(runner_id),
                    error=str(e),
                )
                try:
                    await websocket.send_json(
                        {"type": "error", "message": f"Error: {e}"}
                    )
                except Exception:
                    break
    except Exception as e:
        logger.error(
            "runner_chat_ws_fatal",
            runner_id=str(runner_id),
            error=str(e),
        )
    finally:
        if manager:
            await manager.disconnect_mobile_chat(runner_id, websocket)
        try:
            await websocket.close()
        except Exception:
            pass
