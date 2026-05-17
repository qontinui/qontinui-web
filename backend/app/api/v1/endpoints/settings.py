"""Settings API endpoints for Qontinui properties configuration.

NOTE: As of plan-2026-05-17-web-image-slim, every endpoint here returns 503.
The QontinuiProperties pydantic model lives in the qontinui package, which
no longer ships in the web image. The runner-bridge replacement is tracked
under plan-2026-05-17-ws-bridge-for-violating-routers. The Redis key
helpers remain in place because the future runner-bridge can still use
them as-is.
"""

import json
import logging
import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from redis import asyncio as aioredis
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.models.user import User
from app.schemas.settings import QontinuiSettings, QontinuiSettingsUpdate

logger = logging.getLogger(__name__)

router = APIRouter()

# Redis key for storing settings per user
SETTINGS_KEY_PREFIX = "qontinui:settings:user:"

# Matches a standard UUID (hex digits and hyphens only) so that user_id
# values are never interpolated into Redis keys without validation.
_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE
)


def _safe_settings_key(user_id: str) -> str:
    """Return the Redis key for *user_id*, rejecting non-UUID values."""
    if not _UUID_RE.match(user_id):
        raise ValueError(f"user_id is not a valid UUID: {user_id!r}")
    return f"{SETTINGS_KEY_PREFIX}{user_id}"


async def _get_stored_settings(
    redis: aioredis.Redis, user_id: str
) -> dict[str, Any] | None:
    """Get stored settings from Redis for a user."""
    try:
        data = await redis.get(_safe_settings_key(user_id))
        if data:
            return json.loads(data)  # type: ignore[no-any-return]
    except Exception as e:
        logger.warning(f"Failed to load settings from Redis: {e}")
    return None


async def _save_settings(
    redis: aioredis.Redis, user_id: str, settings: dict[str, Any]
) -> bool:
    """Save settings to Redis for a user."""
    try:
        await redis.set(
            _safe_settings_key(user_id),
            json.dumps(settings),
        )
        return True
    except Exception as e:
        logger.error(f"Failed to save settings to Redis: {e}")
        return False


async def _delete_settings(redis: aioredis.Redis, user_id: str) -> bool:
    """Delete stored settings from Redis for a user."""
    try:
        await redis.delete(_safe_settings_key(user_id))
        return True
    except Exception as e:
        logger.warning(f"Failed to delete settings from Redis: {e}")
        return False


def _runner_bridge_503(endpoint: str) -> HTTPException:
    """Build the structured 503 envelope for endpoints that depend on
    qontinui.config.qontinui_properties (now living on the runner)."""
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail={
            "error": "endpoint_requires_runner_bridge",
            "message": (
                "This endpoint depends on qontinui runtime functionality that lives on "
                "the runner. The web - runner WebSocket bridge for this functionality is "
                "not yet implemented. See architectural-decisions.md "
                "'Web - runner WebSocket boundary'."
            ),
            "runner_module": "qontinui.config.qontinui_properties",
            "endpoint": endpoint,
            "tracking": "plan-2026-05-17-ws-bridge-for-violating-routers (TBD)",
        },
    )


@router.get("/", response_model=QontinuiSettings)
async def get_settings(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Get current Qontinui settings.

    Returns 503 until the runner-bridge ships.
    """
    raise _runner_bridge_503("/api/v1/settings/")


@router.put("/", response_model=QontinuiSettings)
async def update_settings(
    *,
    db: AsyncSession = Depends(get_async_db),
    settings_in: QontinuiSettingsUpdate,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Update Qontinui settings.

    Returns 503 until the runner-bridge ships.
    """
    raise _runner_bridge_503("/api/v1/settings/")


@router.post("/reset", response_model=QontinuiSettings)
async def reset_settings(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Reset settings to default values.

    Returns 503 until the runner-bridge ships.
    """
    raise _runner_bridge_503("/api/v1/settings/reset")


@router.get("/export")
async def export_settings(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
    format: str = "yaml",
) -> Any:
    """Export settings to YAML or JSON format.

    Returns 503 until the runner-bridge ships.
    """
    raise _runner_bridge_503("/api/v1/settings/export")


@router.post("/import")
async def import_settings(
    *,
    db: AsyncSession = Depends(get_async_db),
    content: str,
    format: str = "yaml",
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Import settings from YAML or JSON format.

    Returns 503 until the runner-bridge ships.
    """
    raise _runner_bridge_503("/api/v1/settings/import")
