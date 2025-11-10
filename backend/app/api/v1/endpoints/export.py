import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.crud.project import get_project, update_project
from app.models.user import User
from app.schemas.export import ValidationResult
from app.schemas.project import ProjectUpdate
from app.services.export_import import ExportImportService
from app.services.json_validator import JSONConfigValidator

router = APIRouter()


@router.get("/{project_id}/export")
async def export_project_configuration(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: str,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Export a project configuration as JSON.
    Returns the configuration in the response with appropriate headers for file download.
    """
    # Get project
    project = await get_project(db, project_id=project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )

    # Check permissions
    if project.owner_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions"
        )

    # Export configuration
    service = ExportImportService()
    try:
        config = service.export_project(project, current_user)

        # Create filename
        safe_name = "".join(
            c for c in project.name if c.isalnum() or c in (" ", "-", "_")
        ).rstrip()
        filename = f"{safe_name}_config.json"

        # Return as downloadable JSON file
        json_content = json.dumps(config, indent=2)
        return Response(
            content=json_content,
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Export failed: {str(e)}",
        )


@router.post("/{project_id}/import")
async def import_project_configuration(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: str,
    configuration: dict,
    merge: bool = False,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Import a JSON configuration into a project.

    Args:
        configuration: The JSON configuration to import
        merge: If true, merge with existing configuration. If false, replace.
    """
    # Get project
    project = await get_project(db, project_id=project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )

    # Check permissions
    if project.owner_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions"
        )

    # Import configuration
    service = ExportImportService()
    try:
        imported_config = service.import_project(project, configuration, merge)

        # Update project configuration
        project_update = ProjectUpdate(configuration=imported_config)
        updated_project = await update_project(db, project, project_update)

        return {
            "success": True,
            "message": "Configuration imported successfully",
            "project_id": updated_project.id,
        }
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Import failed: {str(e)}",
        )


@router.post("/{project_id}/validate")
async def validate_configuration(
    *, configuration: dict, current_user: User = Depends(get_current_active_user_async)
) -> ValidationResult:
    """
    Validate a JSON configuration without importing it.
    Useful for pre-import validation on the client side.
    """
    validator = JSONConfigValidator()
    return validator.validate_configuration(configuration)


@router.get("/{project_id}/configuration")
async def get_project_configuration(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: str,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Get the raw configuration JSON for a project.
    This is useful for the runner to fetch configurations.
    """
    # Get project
    project = await get_project(db, project_id=project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )

    # Check permissions
    if project.owner_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions"
        )

    # Return configuration
    if not project.configuration:
        # Return default configuration if none exists
        service = ExportImportService()
        return service._get_default_configuration()

    return project.configuration
