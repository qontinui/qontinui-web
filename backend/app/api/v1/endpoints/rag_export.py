"""API endpoints for RAG-optimized configuration export.

These endpoints provide RAG export functionality for projects,
optimized for vector database indexing and LLM-based automation.
"""

import json
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.crud.project import get_project
from app.models.user import User
from app.schemas.rag_export import RAGExportRequest, RAGExportResponse
from app.services.rag_export import RAGExportService

router = APIRouter()


@router.post("/{project_id}/export")
async def export_project_as_rag(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    request: RAGExportRequest = RAGExportRequest(),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Export a project configuration in RAG-optimized format.

    This endpoint exports the project in a format suitable for:
    - Vector database indexing (Chroma, Pinecone, Weaviate)
    - Semantic search over UI elements and states
    - LLM-based automation with retrieval augmentation

    The RAG format structures elements as individual documents that can be
    embedded and retrieved based on semantic similarity.
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

    # Export as RAG format
    service = RAGExportService()
    try:
        rag_config = await service.export_project_as_rag(project, current_user, request)

        # Calculate export size
        json_content = json.dumps(rag_config.model_dump(mode="json"), indent=2)
        export_size = len(json_content.encode("utf-8"))

        return RAGExportResponse(
            success=True,
            message="RAG export completed successfully",
            config=rag_config,
            export_size_bytes=export_size,
            element_count=len(rag_config.elements),
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"RAG export failed: {str(e)}",
        )


@router.post("/{project_id}/export/download")
async def download_rag_export(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    request: RAGExportRequest = RAGExportRequest(),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Export project as RAG format and download as JSON file.

    Same as the export endpoint, but returns a downloadable file instead of JSON response.
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

    # Export as RAG format
    service = RAGExportService()
    try:
        rag_config = await service.export_project_as_rag(project, current_user, request)

        # Create filename
        project_name: str = str(project.name)
        safe_name = "".join(
            c for c in project_name if c.isalnum() or c in (" ", "-", "_")
        ).rstrip()
        filename = f"{safe_name}_rag_config.json"

        # Return as downloadable JSON file
        json_content = json.dumps(rag_config.model_dump(mode="json"), indent=2)
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
            detail=f"RAG export failed: {str(e)}",
        )


@router.post("/{project_id}/transfer")
async def transfer_rag_to_runner(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    runner_url: str,
    request: RAGExportRequest = RAGExportRequest(),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Export project as RAG format and transfer to a connected runner.

    This endpoint:
    1. Exports the project in RAG-optimized format
    2. Sends the configuration to the specified runner via HTTP
    3. Returns the export and transfer status

    Args:
        runner_url: The HTTP endpoint of the runner (e.g., http://localhost:9876)
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

    # Export as RAG format
    service = RAGExportService()
    try:
        rag_config = await service.export_project_as_rag(project, current_user, request)

        # Transfer to runner
        transfer_status = await service.transfer_to_runner(
            str(project_id), runner_url, rag_config
        )

        # Calculate export size
        json_content = json.dumps(rag_config.model_dump(mode="json"), indent=2)
        export_size = len(json_content.encode("utf-8"))

        return RAGExportResponse(
            success=transfer_status.success,
            message=f"Export successful. Transfer: {transfer_status.message}",
            config=rag_config if transfer_status.success else None,
            transfer_status=transfer_status,
            export_size_bytes=export_size,
            element_count=len(rag_config.elements),
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"RAG export/transfer failed: {str(e)}",
        )


@router.get("/{project_id}/status")
async def get_rag_export_status(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Get RAG export status and metadata for a project.

    Returns information about the project's RAG export capabilities,
    including element count, state count, and workflow count.
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

    # Get project configuration stats
    config_data = project.configuration
    if config_data is None:
        config_data = {}
    config: dict[str, Any] = config_data  # type: ignore[assignment]

    return {
        "project_id": str(project.id),
        "project_name": project.name,
        "rag_exportable": True,
        "stats": {
            "element_count": len(config.get("images", [])),
            "state_count": len(config.get("states", [])),
            "workflow_count": len(config.get("workflows", [])),
            "transition_count": len(config.get("transitions", [])),
        },
        "metadata": {
            "created_at": project.created_at.isoformat(),
            "updated_at": project.updated_at.isoformat(),
            "version": project.version,
        },
    }
