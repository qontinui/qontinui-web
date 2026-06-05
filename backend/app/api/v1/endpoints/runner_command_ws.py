"""
WebSocket endpoint for frontend-to-runner command communication.

Allows frontend clients to send commands to a connected desktop runner
identified by ``runner.id`` (UUID) and receive real-time responses and
events. Replaces the legacy ``connection_id``-keyed path.
"""

import asyncio
from datetime import UTC, datetime
from uuid import UUID

import structlog
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, ValidationError
from sqlalchemy import select

from app.api.deps import get_current_user_from_ws
from app.config.redis_config import get_redis
from app.db.session import AsyncSessionLocal
from app.models.device import Device
from app.models.user import User
from app.services.runner_websocket_manager import get_runner_websocket_manager
from app.websockets.safe_send import reject

router = APIRouter()
logger = structlog.get_logger(__name__)


class CommandMessage(BaseModel):
    """Message format for frontend-to-runner commands."""

    type: str
    command: str | None = None
    params: dict = {}


@router.websocket("/{runner_id}/command")
async def websocket_runner_command_endpoint(
    websocket: WebSocket,
    runner_id: UUID,
    token: str | None = None,
) -> None:
    """WebSocket endpoint for frontend → runner command relay.

    URL: ``ws://localhost:8000/api/v1/runners/{runner_id}/command?token=<jwt>``
    """
    await websocket.accept()

    user: User | None = None
    manager = None

    try:
        auth_token: str | None = token or websocket.cookies.get("access_token")
        if not auth_token:
            await reject(
                websocket,
                "Authentication required. Provide token query param or "
                "access_token cookie.",
            )
            return

        try:
            user = await get_current_user_from_ws(auth_token)
        except Exception as e:
            logger.error("runner_command_ws_auth_failed", error=str(e))
            await reject(websocket, "Authentication failed")
            return

        # Verify the runner row exists and is owned by this user.
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
        await manager.connect_frontend(runner_id, websocket, user.id)

        await websocket.send_json(
            {
                "type": "connected",
                "runner_id": str(runner_id),
                "runner_connected": runner_connected,
                "timestamp": datetime.now(UTC).isoformat() + "Z",
            }
        )

        if not runner_connected:
            await websocket.send_json(
                {
                    "type": "warning",
                    "message": (
                        "Runner is not currently connected. Commands will be queued"
                        " until the runner reconnects."
                    ),
                }
            )

        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_json(), timeout=120.0)
                try:
                    message = CommandMessage(**data)
                except ValidationError as e:
                    await websocket.send_json(
                        {"type": "error", "message": f"Invalid message format: {e}"}
                    )
                    continue

                if message.type == "ping":
                    await websocket.send_json(
                        {
                            "type": "pong",
                            "timestamp": datetime.now(UTC).isoformat() + "Z",
                        }
                    )
                elif message.type == "command":
                    command_msg = {
                        "type": "command",
                        "command": message.command,
                        "params": message.params,
                        "timestamp": datetime.now(UTC).isoformat() + "Z",
                    }
                    sent = await manager.send_command(runner_id, command_msg)
                    if sent:
                        await websocket.send_json(
                            {
                                "type": "command_sent",
                                "command": message.command,
                                "timestamp": datetime.now(UTC).isoformat() + "Z",
                            }
                        )
                    else:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "message": "Runner is not connected. Cannot send command.",
                            }
                        )
                else:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": f"Unknown message type: {message.type}",
                        }
                    )
            except TimeoutError:
                try:
                    await websocket.send_json(
                        {
                            "type": "ping",
                            "timestamp": datetime.now(UTC).isoformat() + "Z",
                        }
                    )
                except Exception:
                    break
            except WebSocketDisconnect:
                break
            except Exception as e:
                logger.error(
                    "runner_command_ws_error",
                    runner_id=str(runner_id),
                    error=str(e),
                    error_type=type(e).__name__,
                )
                try:
                    await websocket.send_json(
                        {"type": "error", "message": f"Error: {e}"}
                    )
                except Exception:
                    break
    except Exception as e:
        logger.error(
            "runner_command_ws_fatal",
            runner_id=str(runner_id),
            error=str(e),
            error_type=type(e).__name__,
        )
    finally:
        if manager:
            await manager.disconnect_frontend(runner_id, websocket)
        try:
            await websocket.close()
        except Exception:
            pass
