"""Settings API endpoints for Qontinui properties configuration."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.models.user import User
from app.schemas.settings import (
    QontinuiSettings,
    QontinuiSettingsUpdate,
)

router = APIRouter()


@router.get("/", response_model=QontinuiSettings)
async def get_settings(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Get current Qontinui settings.

    Returns the settings from the database or default settings if none exist.
    """
    # For now, return default settings
    # TODO: Implement database storage for settings
    from qontinui.config.qontinui_properties import QontinuiProperties

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

    Updates the application settings and persists them to storage.
    """
    from qontinui.config.qontinui_properties import QontinuiProperties

    # Load current settings
    props = QontinuiProperties()

    # Update with new values
    update_data = settings_in.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if hasattr(props, key) and value is not None:
            setattr(props, key, value)

    # TODO: Persist to database
    # For now, just return the updated settings

    return props.model_dump()


@router.post("/reset", response_model=QontinuiSettings)
async def reset_settings(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Reset settings to default values."""
    from qontinui.config.qontinui_properties import QontinuiProperties

    props = QontinuiProperties()

    # TODO: Clear database settings

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
            import json

            data = json.loads(content)
            props = QontinuiProperties(**data)
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported format: {format}",
            )

        # TODO: Persist to database

        return {"success": True, "settings": props.model_dump()}

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to import settings: {str(e)}",
        )
