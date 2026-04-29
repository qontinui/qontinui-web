"""
WebSocket endpoint for mobile-to-runner terminal communication.

Allows mobile clients to send terminal I/O to a runner identified by
``runner.id`` (UUID) and receive real-time terminal output.
"""

from uuid import UUID

import structlog
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, Field, ValidationError
from qontinui_schemas.common import utc_now
from sqlalchemy import select

from app.api.deps import get_current_user_from_ws
from app.config.redis_config import get_redis
from app.db.session import AsyncSessionLocal
from app.models.runner import Runner
from app.models.user import User
from app.services.runner_websocket_manager import get_runner_websocket_manager

router = APIRouter()
logger = structlog.get_logger(__name__)


class TerminalMessage(BaseModel):
    """Message format for mobile-to-runner terminal communication."""

    type: str
    terminal_id: str | None = None
    data: str | None = None  # base64 encoded terminal input
    cols: int | None = None
    rows: int | None = None
    title: str | None = None
    working_dir: str | None = None
    request_id: str | None = None
    params: dict = Field(default_factory=dict)


@router.websocket("/{runner_id}/terminal")
async def websocket_runner_terminal_endpoint(
    websocket: WebSocket,
    runner_id: UUID,
    token: str | None = None,
) -> None:
    """WebSocket endpoint for mobile → runner terminal relay.

    URL: ``ws://localhost:8000/api/v1/runners/{runner_id}/terminal?token=<jwt>``
    """
    await websocket.accept()

    user: User | None = None
    manager = None

    try:
        auth_token: str | None = token or websocket.cookies.get("access_token")
        if not auth_token:
            await websocket.send_json(
                {"type": "error", "message": "Authentication required."}
            )
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        try:
            user = await get_current_user_from_ws(auth_token)
        except Exception as e:
            logger.error("runner_terminal_ws_auth_failed", error=str(e))
            await websocket.send_json(
                {"type": "error", "message": "Authentication failed"}
            )
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        async with AsyncSessionLocal() as db:
            query = select(Runner).where(
                Runner.id == runner_id, Runner.user_id == user.id
            )
            result = await db.execute(query)
            runner = result.scalar_one_or_none()

        if not runner:
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "Runner not found or not owned by you",
                }
            )
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        redis = await get_redis()
        manager = await get_runner_websocket_manager(redis)
        runner_connected = await manager.connect_mobile_terminal(
            runner_id, websocket, user.id
        )

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
                        "Runner is not currently connected. Terminal commands"
                        " cannot be delivered until the runner reconnects."
                    ),
                }
            )

        while True:
            try:
                data = await websocket.receive_json()
                try:
                    message = TerminalMessage(**data)
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

                # Forward typed terminal messages to the runner verbatim.
                msg_to_runner: dict = {
                    "type": message.type,
                    "terminal_id": message.terminal_id,
                    "data": message.data,
                    "cols": message.cols,
                    "rows": message.rows,
                    "title": message.title,
                    "working_dir": message.working_dir,
                    "request_id": message.request_id,
                    "timestamp": utc_now().isoformat(),
                }
                sent = await manager.send_terminal(runner_id, msg_to_runner)
                if not sent:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": "Runner is not connected.",
                            "request_id": message.request_id,
                        }
                    )
            except WebSocketDisconnect:
                break
            except Exception as e:
                logger.error(
                    "runner_terminal_ws_error",
                    runner_id=str(runner_id),
                    error=str(e),
                )
                try:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": "Internal server error processing terminal message",
                        }
                    )
                except Exception:
                    break
    except Exception as e:
        logger.error(
            "runner_terminal_ws_fatal",
            runner_id=str(runner_id),
            error=str(e),
        )
    finally:
        if manager:
            await manager.disconnect_mobile_terminal(runner_id, websocket)
        try:
            await websocket.close()
        except Exception:
            pass
