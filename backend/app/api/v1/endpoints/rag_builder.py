"""API endpoints for RAG Builder - Build RAG configurations interactively.

These endpoints provide CRUD operations for RAG elements, states, workflows,
and transitions stored in project rag_config.
"""

from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.crud.project import get_project
from app.crud.runner import get_active_connection_for_project
from app.middleware.error_handler import not_found_error
from app.models.organization import PermissionLevel
from app.models.user import User
from app.services.permission_service import permission_service
from app.services.rag_builder import RAGBuilderService

logger = structlog.get_logger(__name__)

router = APIRouter()


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
    bounding_box: dict[str, int]  # {x, y, width, height}
    use_runner: bool = False


# ============================================================================
# Helper Functions
# ============================================================================


async def check_project_access(
    db: AsyncSession, project_id: UUID, user: User, level: PermissionLevel
) -> None:
    """
    Check if user has access to project.

    Raises 404 if project not found or user lacks permission.
    """
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
    """
    Create a new RAG element in the project.

    Requires EDIT permission on the project.
    """
    await check_project_access(db, project_id, current_user, PermissionLevel.EDIT)

    service = RAGBuilderService()
    element = await service.create_element(db, project_id, request.element_data)

    return {"success": True, "element": element}


@router.get("/{project_id}/elements")
async def list_elements(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    List all RAG elements in the project.

    Requires VIEW permission on the project.
    """
    await check_project_access(db, project_id, current_user, PermissionLevel.VIEW)

    service = RAGBuilderService()
    elements = await service.list_elements(db, project_id)

    return {"success": True, "elements": elements, "count": len(elements)}


@router.get("/{project_id}/elements/{element_id}")
async def get_element(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    element_id: str,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Get a specific RAG element by ID.

    Requires VIEW permission on the project.
    """
    await check_project_access(db, project_id, current_user, PermissionLevel.VIEW)

    service = RAGBuilderService()
    element = await service.get_element(db, project_id, element_id)

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
    """
    Update a RAG element.

    Requires EDIT permission on the project.
    """
    await check_project_access(db, project_id, current_user, PermissionLevel.EDIT)

    service = RAGBuilderService()
    element = await service.update_element(
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
    """
    Delete a RAG element.

    Requires EDIT permission on the project.
    """
    await check_project_access(db, project_id, current_user, PermissionLevel.EDIT)

    service = RAGBuilderService()
    deleted = await service.delete_element(db, project_id, element_id)

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
    """
    Create a new RAG state in the project.

    Requires EDIT permission on the project.
    """
    await check_project_access(db, project_id, current_user, PermissionLevel.EDIT)

    service = RAGBuilderService()
    state = await service.create_state(db, project_id, request.state_data)

    return {"success": True, "state": state}


@router.get("/{project_id}/states")
async def list_states(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    List all RAG states in the project.

    Requires VIEW permission on the project.
    """
    await check_project_access(db, project_id, current_user, PermissionLevel.VIEW)

    service = RAGBuilderService()
    states = await service.list_states(db, project_id)

    return {"success": True, "states": states, "count": len(states)}


@router.get("/{project_id}/states/{state_id}")
async def get_state(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    state_id: str,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Get a specific RAG state by ID.

    Requires VIEW permission on the project.
    """
    await check_project_access(db, project_id, current_user, PermissionLevel.VIEW)

    service = RAGBuilderService()
    state = await service.get_state(db, project_id, state_id)

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
    """
    Update a RAG state.

    Requires EDIT permission on the project.
    """
    await check_project_access(db, project_id, current_user, PermissionLevel.EDIT)

    service = RAGBuilderService()
    state = await service.update_state(db, project_id, state_id, request.state_data)

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
    """
    Delete a RAG state.

    Requires EDIT permission on the project.
    """
    await check_project_access(db, project_id, current_user, PermissionLevel.EDIT)

    service = RAGBuilderService()
    deleted = await service.delete_state(db, project_id, state_id)

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
    """
    Create a new RAG transition in the project.

    Requires EDIT permission on the project.
    """
    await check_project_access(db, project_id, current_user, PermissionLevel.EDIT)

    service = RAGBuilderService()
    transition = await service.create_transition(
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
    """
    List all RAG transitions in the project.

    Requires VIEW permission on the project.
    """
    await check_project_access(db, project_id, current_user, PermissionLevel.VIEW)

    service = RAGBuilderService()
    transitions = await service.list_transitions(db, project_id)

    return {"success": True, "transitions": transitions, "count": len(transitions)}


@router.get("/{project_id}/transitions/{transition_id}")
async def get_transition(
    *,
    db: AsyncSession = Depends(get_async_db),
    project_id: UUID,
    transition_id: str,
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """
    Get a specific RAG transition by ID.

    Requires VIEW permission on the project.
    """
    await check_project_access(db, project_id, current_user, PermissionLevel.VIEW)

    service = RAGBuilderService()
    transition = await service.get_transition(db, project_id, transition_id)

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
    """
    Update a RAG transition.

    Requires EDIT permission on the project.
    """
    await check_project_access(db, project_id, current_user, PermissionLevel.EDIT)

    service = RAGBuilderService()
    transition = await service.update_transition(
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
    """
    Delete a RAG transition.

    Requires EDIT permission on the project.
    """
    await check_project_access(db, project_id, current_user, PermissionLevel.EDIT)

    service = RAGBuilderService()
    deleted = await service.delete_transition(db, project_id, transition_id)

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
    """
    Search RAG elements by text description.

    Performs case-insensitive substring matching on element text fields.
    Requires VIEW permission on the project.
    """
    await check_project_access(db, project_id, current_user, PermissionLevel.VIEW)

    service = RAGBuilderService()
    elements = await service.search_elements(db, project_id, request.query)

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
    """
    Generate LLM-based description for an element region.

    This endpoint accepts a screenshot and bounding box, then:
    - If use_runner=true and a runner is connected: forwards to runner's AI
    - Otherwise: returns a placeholder message

    Future integration with OpenAI/Anthropic API keys can be added here.

    Requires EDIT permission on the project.
    """
    await check_project_access(db, project_id, current_user, PermissionLevel.EDIT)

    # If use_runner is true, attempt to forward to connected runner
    if request.use_runner:
        # Check if a runner is connected for this project
        runner_connection = await get_active_connection_for_project(db, project_id)

        if not runner_connection:
            logger.info(
                "rag_generate_description_no_runner",
                project_id=str(project_id),
                user_id=str(current_user.id),
            )
            return {
                "success": False,
                "message": "No active runner connected for this project. Please connect a runner to use AI-powered description generation.",
                "description": None,
            }

        # Runner is connected, but we need to implement the actual forwarding
        # This requires:
        # 1. Runner to expose an LLM vision endpoint (e.g., /api/vision/describe)
        # 2. Fetch the screenshot image from storage
        # 3. Crop the image using bounding_box coordinates
        # 4. Send the cropped image to the runner's LLM endpoint via HTTP or WebSocket
        # 5. Wait for the response and return the description
        #
        # For now, we return a more informative message
        logger.info(
            "rag_generate_description_runner_available",
            project_id=str(project_id),
            runner_connection_id=runner_connection.id,
            runner_name=runner_connection.runner_name,
        )
        return {
            "success": False,
            "message": f"Runner '{runner_connection.runner_name or 'Unnamed'}' is connected, but vision API forwarding is not yet implemented. This feature requires the runner to expose an LLM vision endpoint.",
            "description": None,
            "runner_connected": True,
            "runner_name": runner_connection.runner_name,
        }

    # Placeholder for direct LLM integration (OpenAI/Anthropic API key)
    # This would require:
    # 1. User API key storage in the database (encrypted)
    # 2. API key selection/configuration in the UI
    # 3. Fetch the screenshot image from storage
    # 4. Crop the image using bounding_box coordinates
    # 5. Send the cropped image to OpenAI Vision API or Anthropic Vision API
    # 6. Return the generated description
    #
    # Implementation notes:
    # - Use OpenAI's GPT-4 Vision or Anthropic's Claude Vision
    # - Handle rate limits and API errors gracefully
    # - Store API usage for billing/quota tracking
    logger.info(
        "rag_generate_description_no_api_key",
        project_id=str(project_id),
        user_id=str(current_user.id),
    )
    return {
        "success": False,
        "message": "LLM description generation requires either a connected runner with AI capabilities or an OpenAI/Anthropic API key. API key integration is coming soon.",
        "description": None,
    }


# ============================================================================
# Runner Embedding Results Endpoint
# ============================================================================


class EmbeddingResultItem(BaseModel):
    """Single embedding result from runner."""

    state_image_id: str
    success: bool
    image_embedding: list[float] | None = None
    text_embedding: list[float] | None = None
    ocr_text: str | None = None
    ocr_confidence: float | None = None
    error: str | None = None


class EmbeddingResultsRequest(BaseModel):
    """Request containing embedding results from runner."""

    project_id: str
    results: list[EmbeddingResultItem]
    total_processed: int
    successful: int
    failed: int


class EmbeddingResultsResponse(BaseModel):
    """Response after applying embedding results."""

    success: bool
    message: str
    applied: int
    failed: int
    not_found: int


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
    for RAG-enabled StateImages. The embeddings are applied to the project
    configuration and saved to the database.

    Args:
        project_id: The project ID
        request: The embedding results from the runner

    Returns:
        Statistics about applied results
    """
    from app.crud.project import update_project
    from app.schemas.project import ProjectUpdate
    from app.services.embedding_service import apply_embedding_results_to_config

    # Verify project exists and user has access
    project = await get_project(db, project_id=project_id)
    if not project:
        raise not_found_error("Project", str(project_id))

    # Check permissions
    if project.owner_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions to update this project",
        )

    # Get current configuration
    config: dict[str, Any] = project.configuration or {}  # type: ignore[assignment]

    # Convert results to dict format
    results_dicts = [
        {
            "state_image_id": r.state_image_id,
            "success": r.success,
            "image_embedding": r.image_embedding,
            "text_embedding": r.text_embedding,
            "ocr_text": r.ocr_text,
            "ocr_confidence": r.ocr_confidence,
        }
        for r in request.results
    ]

    # Apply embedding results to config
    apply_result = apply_embedding_results_to_config(config, results_dicts)

    # Update project configuration in database
    project_update = ProjectUpdate(configuration=config)
    await update_project(db, project, project_update)

    logger.info(
        "embedding_results_received",
        project_id=str(project_id),
        total_received=len(request.results),
        applied=apply_result["successful"],
        failed=apply_result["failed"],
        not_found=apply_result["not_found"],
    )

    return EmbeddingResultsResponse(
        success=True,
        message=f"Applied {apply_result['successful']} embedding results",
        applied=apply_result["successful"],
        failed=apply_result["failed"],
        not_found=apply_result["not_found"],
    )
