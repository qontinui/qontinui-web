"""API endpoints for RAG Builder - Build RAG configurations interactively.

These endpoints provide CRUD operations for RAG elements, states, workflows,
and transitions stored in project rag_config.
"""

import base64
import io
from typing import Any
from uuid import UUID

import structlog
from app.api.deps import get_async_db, get_current_active_user_async
from app.crud.project import get_project
from app.crud.runner import get_active_connection_for_project
from app.middleware.error_handler import not_found_error
from app.models.organization import PermissionLevel
from app.models.user import User
from app.services.permission_service import permission_service
from app.services.rag_builder import rag_builder_service
from fastapi import APIRouter, Depends, HTTPException, status
from PIL import Image
from pydantic import BaseModel
from qontinui_schemas.api.rag import EmbeddingResultsRequest, EmbeddingResultsResponse
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)

router = APIRouter()


def extract_dimensions_from_data_url(data_url: str) -> tuple[int, int] | None:
    """Extract width and height from a base64 data URL image."""
    if not data_url or not data_url.startswith("data:"):
        return None

    try:
        header, encoded = data_url.split(",", 1)
        if ";base64" not in header:
            return None

        image_data = base64.b64decode(encoded)
        with Image.open(io.BytesIO(image_data)) as img:
            return (img.size[0], img.size[1])
    except Exception as e:
        logger.debug(
            "failed_to_extract_image_dimensions",
            error=str(e),
            data_url_prefix=data_url[:50] if data_url else None,
        )
        return None


# ============================================================================
# Request/Response Schemas
# ============================================================================


class ElementCreateRequest(BaseModel):
    """Request to create a RAG element."""

    element_data: dict[str, Any]


class ElementUpdateRequest(BaseModel):
    """Request to update a RAG element."""

    element_data: dict[str, Any]


class StateCreateRequest(BaseModel):
    """Request to create a RAG state."""

    state_data: dict[str, Any]


class StateUpdateRequest(BaseModel):
    """Request to update a RAG state."""

    state_data: dict[str, Any]


class TransitionCreateRequest(BaseModel):
    """Request to create a RAG transition."""

    transition_data: dict[str, Any]


class TransitionUpdateRequest(BaseModel):
    """Request to update a RAG transition."""

    transition_data: dict[str, Any]


class SearchRequest(BaseModel):
    """Request to search RAG elements."""

    query: str


class GenerateDescriptionRequest(BaseModel):
    """Request to generate LLM description for an element region."""

    screenshot_id: str
    bounding_box: dict[str, int]
    use_runner: bool = False


# ============================================================================
# Helper Functions
# ============================================================================


async def check_project_access(
    db: AsyncSession, project_id: UUID, user: User, level: PermissionLevel
) -> None:
    """Check if user has access to project."""
    project = await get_project(db, project_id=project_id)
    if not project:
        raise not_found_error("Project", "project")

    has_access = await permission_service.can_user_access_project(
        db, user.id, project_id, level
    )
    if not has_access:
        raise not_found_error("Project", "project")


# ============================================================================
# RAG Element Endpoints
# ============================================================================


@router.post("/{project_id}/elements", status_code=status.HTTP_201_CREATED)
async def create_element(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    request: ElementCreateRequest,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Create a new RAG element in the project."""
    await check_project_access(db, project_id, current_user, PermissionLevel.EDIT)
    element = await rag_builder_service.create_element(
        db, project_id, request.element_data
    )
    return {"success": True, "element": element}


@router.get("/{project_id}/elements")
async def list_elements(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """List all RAG elements in the project."""
    await check_project_access(db, project_id, current_user, PermissionLevel.VIEW)
    elements = await rag_builder_service.list_elements(db, project_id)
    return {"success": True, "elements": elements, "count": len(elements)}


@router.get("/{project_id}/elements/{element_id}")
async def get_element(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    element_id: str,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Get a specific RAG element by ID."""
    await check_project_access(db, project_id, current_user, PermissionLevel.VIEW)
    element = await rag_builder_service.get_element(db, project_id, element_id)
    if not element:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Element not found"
        )
    return {"success": True, "element": element}


@router.put("/{project_id}/elements/{element_id}")
async def update_element(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    element_id: str,
    request: ElementUpdateRequest,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Update a RAG element."""
    await check_project_access(db, project_id, current_user, PermissionLevel.EDIT)
    element = await rag_builder_service.update_element(
        db, project_id, element_id, request.element_data
    )
    if not element:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Element not found"
        )
    return {"success": True, "element": element}


@router.delete("/{project_id}/elements/{element_id}")
async def delete_element(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    element_id: str,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Delete a RAG element."""
    await check_project_access(db, project_id, current_user, PermissionLevel.EDIT)
    deleted = await rag_builder_service.delete_element(db, project_id, element_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Element not found"
        )
    return {"success": True, "message": "Element deleted successfully"}


# ============================================================================
# RAG State Endpoints
# ============================================================================


@router.post("/{project_id}/states", status_code=status.HTTP_201_CREATED)
async def create_state(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    request: StateCreateRequest,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Create a new RAG state in the project."""
    await check_project_access(db, project_id, current_user, PermissionLevel.EDIT)
    state = await rag_builder_service.create_state(db, project_id, request.state_data)
    return {"success": True, "state": state}


@router.get("/{project_id}/states")
async def list_states(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """List all RAG states in the project."""
    await check_project_access(db, project_id, current_user, PermissionLevel.VIEW)
    states = await rag_builder_service.list_states(db, project_id)
    return {"success": True, "states": states, "count": len(states)}


@router.get("/{project_id}/states/{state_id}")
async def get_state(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    state_id: str,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Get a specific RAG state by ID."""
    await check_project_access(db, project_id, current_user, PermissionLevel.VIEW)
    state = await rag_builder_service.get_state(db, project_id, state_id)
    if not state:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="State not found"
        )
    return {"success": True, "state": state}


@router.put("/{project_id}/states/{state_id}")
async def update_state(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    state_id: str,
    request: StateUpdateRequest,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Update a RAG state."""
    await check_project_access(db, project_id, current_user, PermissionLevel.EDIT)
    state = await rag_builder_service.update_state(
        db, project_id, state_id, request.state_data
    )
    if not state:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="State not found"
        )
    return {"success": True, "state": state}


@router.delete("/{project_id}/states/{state_id}")
async def delete_state(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    state_id: str,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Delete a RAG state."""
    await check_project_access(db, project_id, current_user, PermissionLevel.EDIT)
    deleted = await rag_builder_service.delete_state(db, project_id, state_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="State not found"
        )
    return {"success": True, "message": "State deleted successfully"}


# ============================================================================
# RAG Transition Endpoints
# ============================================================================


@router.post("/{project_id}/transitions", status_code=status.HTTP_201_CREATED)
async def create_transition(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    request: TransitionCreateRequest,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Create a new RAG transition in the project."""
    await check_project_access(db, project_id, current_user, PermissionLevel.EDIT)
    transition = await rag_builder_service.create_transition(
        db, project_id, request.transition_data
    )
    return {"success": True, "transition": transition}


@router.get("/{project_id}/transitions")
async def list_transitions(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """List all RAG transitions in the project."""
    await check_project_access(db, project_id, current_user, PermissionLevel.VIEW)
    transitions = await rag_builder_service.list_transitions(db, project_id)
    return {"success": True, "transitions": transitions, "count": len(transitions)}


@router.get("/{project_id}/transitions/{transition_id}")
async def get_transition(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    transition_id: str,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Get a specific RAG transition by ID."""
    await check_project_access(db, project_id, current_user, PermissionLevel.VIEW)
    transition = await rag_builder_service.get_transition(db, project_id, transition_id)
    if not transition:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Transition not found"
        )
    return {"success": True, "transition": transition}


@router.put("/{project_id}/transitions/{transition_id}")
async def update_transition(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    transition_id: str,
    request: TransitionUpdateRequest,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Update a RAG transition."""
    await check_project_access(db, project_id, current_user, PermissionLevel.EDIT)
    transition = await rag_builder_service.update_transition(
        db, project_id, transition_id, request.transition_data
    )
    if not transition:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Transition not found"
        )
    return {"success": True, "transition": transition}


@router.delete("/{project_id}/transitions/{transition_id}")
async def delete_transition(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    transition_id: str,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Delete a RAG transition."""
    await check_project_access(db, project_id, current_user, PermissionLevel.EDIT)
    deleted = await rag_builder_service.delete_transition(db, project_id, transition_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Transition not found"
        )
    return {"success": True, "message": "Transition deleted successfully"}


# ============================================================================
# Search and Utility Endpoints
# ============================================================================


@router.post("/{project_id}/search")
async def search_elements(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    request: SearchRequest,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Search RAG elements by text description."""
    await check_project_access(db, project_id, current_user, PermissionLevel.VIEW)
    elements = await rag_builder_service.search_elements(db, project_id, request.query)
    return {
        "success": True,
        "query": request.query,
        "results": elements,
        "count": len(elements),
    }


@router.post("/{project_id}/generate-description")
async def generate_description(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    request: GenerateDescriptionRequest,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Generate LLM-based description for an element region."""
    await check_project_access(db, project_id, current_user, PermissionLevel.EDIT)

    if request.use_runner:
        runner_connection = await get_active_connection_for_project(db, project_id)

        if not runner_connection:
            return {
                "success": False,
                "message": "No active runner connected for this project.",
                "description": None,
            }

        return {
            "success": False,
            "message": f"Runner '{runner_connection.runner_name or 'Unnamed'}' is connected, but vision API forwarding is not yet implemented.",
            "description": None,
            "runner_connected": True,
            "runner_name": runner_connection.runner_name,
        }

    return {
        "success": False,
        "message": "LLM description generation requires either a connected runner or an API key.",
        "description": None,
    }


# ============================================================================
# Runner Embedding Results Endpoint
# ============================================================================


@router.post(
    "/{project_id}/embedding-results",
    response_model=EmbeddingResultsResponse,
)
async def receive_embedding_results(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    request: EmbeddingResultsRequest,
    current_user: User = Depends(get_current_active_user_async),
) -> EmbeddingResultsResponse:
    """
    Receive embedding results from the runner.

    This endpoint is called by the runner after it has computed embeddings
    for RAG-enabled StateImages.
    """
    # Verify project exists and user has access
    project = await get_project(db, project_id=project_id)
    if not project:
        raise not_found_error("Project", str(project_id))

    if project.owner_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions to update this project",
        )

    # Convert request results to dict format
    results_dicts = [
        {
            "state_image_id": r.state_image_id,
            "success": r.success,
            "image_embedding": r.image_embedding,
            "text_embedding": r.text_embedding,
            "text_description": r.text_description,
            "ocr_text": r.ocr_text,
            "ocr_confidence": r.ocr_confidence,
        }
        for r in request.results
    ]

    # Process embedding results using the service
    result = await rag_builder_service.process_embedding_results(
        db=db,
        project_id=project_id,
        user_id=current_user.id,
        results=results_dicts,
        total_processed=request.total_processed,
        successful=request.successful,
        failed=request.failed,
        extract_dimensions_fn=extract_dimensions_from_data_url,
    )

    logger.info(
        "embedding_results_received",
        project_id=str(project_id),
        total_received=len(request.results),
        applied=result["applied"],
        failed=result["failed"],
        not_found=result["not_found"],
        embeddings_stored=result["embeddings_stored"],
    )

    return EmbeddingResultsResponse(
        success=True,
        message=f"Applied {result['applied']} embedding results, stored {result['embeddings_stored']} embeddings",
        applied=result["applied"],
        failed=result["failed"],
        not_found=result["not_found"],
    )
