"""Settings API endpoints for Qontinui properties configuration."""

import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from redis import asyncio as aioredis
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.config.redis_config import get_redis
from app.models.user import User
from app.schemas.settings import QontinuiSettings, QontinuiSettingsUpdate

logger = logging.getLogger(__name__)

router = APIRouter()

# Redis key for storing settings per user
SETTINGS_KEY_PREFIX = "qontinui:settings:user:"


async def _get_stored_settings(
    redis: aioredis.Redis, user_id: str
) -> dict[str, Any] | None:
    """Get stored settings from Redis for a user."""
    try:
        data = await redis.get(f"{SETTINGS_KEY_PREFIX}{user_id}")
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
            f"{SETTINGS_KEY_PREFIX}{user_id}",
            json.dumps(settings),
        )
        return True
    except Exception as e:
        logger.error(f"Failed to save settings to Redis: {e}")
        return False


async def _delete_settings(redis: aioredis.Redis, user_id: str) -> bool:
    """Delete stored settings from Redis for a user."""
    try:
        await redis.delete(f"{SETTINGS_KEY_PREFIX}{user_id}")
        return True
    except Exception as e:
        logger.warning(f"Failed to delete settings from Redis: {e}")
        return False


@router.get("/", response_model=QontinuiSettings)
async def get_settings(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Get current Qontinui settings.

    Returns the settings from Redis or default settings if none exist.
    """
    from qontinui.config.qontinui_properties import (
        QontinuiProperties,  # type: ignore[import-not-found]
    )

    # Try to load from Redis
    try:
        redis = await get_redis()
        stored = await _get_stored_settings(redis, str(current_user.id))
        if stored:
            # Merge with defaults (in case new settings were added)
            props = QontinuiProperties()
            default_dict = props.model_dump()
            default_dict.update(stored)
            return default_dict
    except Exception as e:
        logger.warning(f"Redis unavailable, using defaults: {e}")

    # Return defaults
    props = QontinuiProperties()
    return props.model_dump()


@router.put("/", response_model=QontinuiSettings)
async def update_settings(
    *,
    db: AsyncSession = Depends(get_async_db),
    settings_in: QontinuiSettingsUpdate,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Update Qontinui settings.

    Updates the application settings and persists them to Redis.
    """
    from qontinui.config.qontinui_properties import QontinuiProperties

    # Load current settings (from Redis or defaults)
    props = QontinuiProperties()
    current_settings = props.model_dump()

    try:
        redis = await get_redis()
        stored = await _get_stored_settings(redis, str(current_user.id))
        if stored:
            current_settings.update(stored)
    except Exception as e:
        logger.warning(f"Redis unavailable, starting from defaults: {e}")

    # Update with new values
    update_data = settings_in.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if value is not None:
            current_settings[key] = value

    # Persist to Redis
    try:
        redis = await get_redis()
        await _save_settings(redis, str(current_user.id), current_settings)
        logger.info(f"Settings saved for user {current_user.id}")
    except Exception as e:
        logger.error(f"Failed to persist settings: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save settings",
        )

    return current_settings


@router.post("/reset", response_model=QontinuiSettings)
async def reset_settings(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Reset settings to default values."""
    from qontinui.config.qontinui_properties import QontinuiProperties

    props = QontinuiProperties()

    # Clear stored settings from Redis
    try:
        redis = await get_redis()
        await _delete_settings(redis, str(current_user.id))
        logger.info(f"Settings reset for user {current_user.id}")
    except Exception as e:
        logger.warning(f"Failed to clear stored settings: {e}")

    return props.model_dump()


@router.get("/export")
async def export_settings(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
    format: str = "yaml",
) -> Any:
    """Export settings to YAML or JSON format."""
    from qontinui.config.qontinui_properties import QontinuiProperties

    props = QontinuiProperties()

    if format == "yaml":
        yaml_str = props.to_yaml()
        return {"format": "yaml", "content": yaml_str}
    elif format == "json":
        return {"format": "json", "content": props.model_dump()}
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported format: {format}",
        )


@router.post("/import")
async def import_settings(
    *,
    db: AsyncSession = Depends(get_async_db),
    content: str,
    format: str = "yaml",
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Import settings from YAML or JSON format."""
    import tempfile
    from pathlib import Path

    from qontinui.config.qontinui_properties import QontinuiProperties

    try:
        if format == "yaml":
            # Write to temp file and load
            with tempfile.NamedTemporaryFile(
                mode="w", suffix=".yaml", delete=False
            ) as f:
                f.write(content)
                temp_path = Path(f.name)

            props = QontinuiProperties.from_yaml(temp_path)
            temp_path.unlink()
        elif format == "json":
            data = json.loads(content)
            props = QontinuiProperties(**data)
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported format: {format}",
            )

        # Persist to Redis
        try:
            redis = await get_redis()
            await _save_settings(redis, str(current_user.id), props.model_dump())
            logger.info(f"Settings imported for user {current_user.id}")
        except Exception as e:
            logger.error(f"Failed to persist imported settings: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to save imported settings",
            )

        return {"success": True, "settings": props.model_dump()}

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to import settings: {str(e)}",
        )
