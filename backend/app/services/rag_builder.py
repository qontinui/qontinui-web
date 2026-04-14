"""Service for managing RAG configuration in projects.

This service provides CRUD operations for RAG elements, states, workflows,
and transitions stored in the project's rag_config JSON field.

This module acts as a facade, delegating to specialized modules:
- entity_crud: Generic CRUD operations for elements, states, transitions
- embedding_processor: Embedding results processing and storage
"""

from collections.abc import Callable
from typing import Any
from uuid import UUID

import structlog
from app.crud.project import get_project, update_project
from app.schemas.project import ProjectUpdate
from app.services.rag.embedding_processor import embedding_processor
from app.services.rag.entity_crud import (element_crud, state_crud,
                                          transition_crud)
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


class RAGBuilderService:
    """
    Service for managing RAG configuration within projects.

    Stores RAG elements, states, workflows, and transitions in the
    project's rag_config JSON field.

    This class acts as a facade, maintaining the public API while
    delegating to specialized modules for implementation.
    """

    def __init__(self) -> None:
        """Initialize the RAG builder service."""
        pass

    # ============================================================================
    # Config Operations
    # ============================================================================

    async def get_rag_config(
        self, db: AsyncSession, project_id: UUID
    ) -> dict[str, Any]:
        """
        Get the RAG configuration from a project.

        Args:
            db: Database session
            project_id: Project ID

        Returns:
            RAG configuration dictionary

        Raises:
            ValueError: If project not found
        """
        project = await get_project(db, project_id)
        if not project:
            raise ValueError("Project not found")

        config_data = project.configuration
        if config_data is None:
            config_data = {}
        config: dict[str, Any] = config_data  # type: ignore[assignment]
        rag_config_result: dict[str, Any] = config.get("rag_config", {})
        return rag_config_result

    async def update_rag_config(
        self, db: AsyncSession, project_id: UUID, rag_config: dict[str, Any]
    ) -> dict[str, Any]:
        """
        Update the RAG configuration in a project.

        Args:
            db: Database session
            project_id: Project ID
            rag_config: New RAG configuration

        Returns:
            Updated RAG configuration

        Raises:
            ValueError: If project not found
        """
        project = await get_project(db, project_id)
        if not project:
            raise ValueError("Project not found")

        config = dict(project.configuration or {})
        config["rag_config"] = rag_config

        project_update = ProjectUpdate(configuration=config)
        await update_project(db, project, project_update)

        return rag_config

    # ============================================================================
    # Element CRUD Operations
    # ============================================================================

    async def create_element(
        self, db: AsyncSession, project_id: UUID, element_data: dict[str, Any]
    ) -> dict[str, Any]:
        """
        Create a new RAG element.

        Args:
            db: Database session
            project_id: Project ID
            element_data: Element data (without ID)

        Returns:
            Created element with generated ID
        """
        return await element_crud.create(
            db, project_id, element_data, self.get_rag_config, self.update_rag_config
        )

    async def get_element(
        self, db: AsyncSession, project_id: UUID, element_id: str
    ) -> dict[str, Any] | None:
        """
        Get a RAG element by ID.

        Args:
            db: Database session
            project_id: Project ID
            element_id: Element ID

        Returns:
            Element data or None if not found
        """
        return await element_crud.get(db, project_id, element_id, self.get_rag_config)

    async def list_elements(
        self, db: AsyncSession, project_id: UUID
    ) -> list[dict[str, Any]]:
        """
        List all RAG elements in a project.

        Args:
            db: Database session
            project_id: Project ID

        Returns:
            List of elements
        """
        return await element_crud.list(db, project_id, self.get_rag_config)

    async def update_element(
        self,
        db: AsyncSession,
        project_id: UUID,
        element_id: str,
        element_data: dict[str, Any],
    ) -> dict[str, Any] | None:
        """
        Update a RAG element.

        Args:
            db: Database session
            project_id: Project ID
            element_id: Element ID
            element_data: Updated element data

        Returns:
            Updated element or None if not found
        """
        return await element_crud.update(
            db,
            project_id,
            element_id,
            element_data,
            self.get_rag_config,
            self.update_rag_config,
        )

    async def delete_element(
        self, db: AsyncSession, project_id: UUID, element_id: str
    ) -> bool:
        """
        Delete a RAG element.

        Args:
            db: Database session
            project_id: Project ID
            element_id: Element ID

        Returns:
            True if deleted, False if not found
        """
        return await element_crud.delete(
            db, project_id, element_id, self.get_rag_config, self.update_rag_config
        )

    # ============================================================================
    # State CRUD Operations
    # ============================================================================

    async def create_state(
        self, db: AsyncSession, project_id: UUID, state_data: dict[str, Any]
    ) -> dict[str, Any]:
        """Create a new RAG state."""
        return await state_crud.create(
            db, project_id, state_data, self.get_rag_config, self.update_rag_config
        )

    async def get_state(
        self, db: AsyncSession, project_id: UUID, state_id: str
    ) -> dict[str, Any] | None:
        """Get a RAG state by ID."""
        return await state_crud.get(db, project_id, state_id, self.get_rag_config)

    async def list_states(
        self, db: AsyncSession, project_id: UUID
    ) -> list[dict[str, Any]]:
        """List all RAG states in a project."""
        return await state_crud.list(db, project_id, self.get_rag_config)

    async def update_state(
        self,
        db: AsyncSession,
        project_id: UUID,
        state_id: str,
        state_data: dict[str, Any],
    ) -> dict[str, Any] | None:
        """Update a RAG state."""
        return await state_crud.update(
            db,
            project_id,
            state_id,
            state_data,
            self.get_rag_config,
            self.update_rag_config,
        )

    async def delete_state(
        self, db: AsyncSession, project_id: UUID, state_id: str
    ) -> bool:
        """Delete a RAG state."""
        return await state_crud.delete(
            db, project_id, state_id, self.get_rag_config, self.update_rag_config
        )

    # ============================================================================
    # Transition CRUD Operations
    # ============================================================================

    async def create_transition(
        self, db: AsyncSession, project_id: UUID, transition_data: dict[str, Any]
    ) -> dict[str, Any]:
        """Create a new RAG transition."""
        return await transition_crud.create(
            db, project_id, transition_data, self.get_rag_config, self.update_rag_config
        )

    async def get_transition(
        self, db: AsyncSession, project_id: UUID, transition_id: str
    ) -> dict[str, Any] | None:
        """Get a RAG transition by ID."""
        return await transition_crud.get(
            db, project_id, transition_id, self.get_rag_config
        )

    async def list_transitions(
        self, db: AsyncSession, project_id: UUID
    ) -> list[dict[str, Any]]:
        """List all RAG transitions in a project."""
        return await transition_crud.list(db, project_id, self.get_rag_config)

    async def update_transition(
        self,
        db: AsyncSession,
        project_id: UUID,
        transition_id: str,
        transition_data: dict[str, Any],
    ) -> dict[str, Any] | None:
        """Update a RAG transition."""
        return await transition_crud.update(
            db,
            project_id,
            transition_id,
            transition_data,
            self.get_rag_config,
            self.update_rag_config,
        )

    async def delete_transition(
        self, db: AsyncSession, project_id: UUID, transition_id: str
    ) -> bool:
        """Delete a RAG transition."""
        return await transition_crud.delete(
            db, project_id, transition_id, self.get_rag_config, self.update_rag_config
        )

    # ============================================================================
    # Search Operations
    # ============================================================================

    async def search_elements(
        self, db: AsyncSession, project_id: UUID, query: str
    ) -> list[dict[str, Any]]:
        """
        Search RAG elements by text description.

        Performs simple case-insensitive substring matching on:
        - ocr_text
        - text_description
        - semantic_role
        - semantic_action

        Args:
            db: Database session
            project_id: Project ID
            query: Search query string

        Returns:
            List of matching elements
        """
        elements = await self.list_elements(db, project_id)
        query_lower = query.lower()

        matching_elements = []
        for element in elements:
            # Check multiple fields for matches
            searchable_fields = [
                element.get("ocr_text", ""),
                element.get("text_description", ""),
                element.get("semantic_role", ""),
                element.get("semantic_action", ""),
            ]

            # Check if query appears in any searchable field
            if any(query_lower in str(field).lower() for field in searchable_fields):
                matching_elements.append(element)

        logger.info(
            "rag_elements_searched",
            project_id=str(project_id),
            query=query,
            result_count=len(matching_elements),
        )

        return matching_elements

    # ============================================================================
    # Embedding Results Processing
    # ============================================================================

    async def process_embedding_results(
        self,
        db: AsyncSession,
        project_id: UUID,
        user_id: UUID,
        results: list[dict[str, Any]],
        total_processed: int,
        successful: int,
        failed: int,
        extract_dimensions_fn: Callable[[str], tuple[int, int] | None] | None = None,
    ) -> dict[str, Any]:
        """
        Process embedding results from the runner and store them.

        This method:
        1. Creates a job record for tracking in the Processing History tab
        2. Applies embeddings to the project configuration
        3. Stores embeddings in the project_embeddings table for RAG Dashboard

        Args:
            db: Database session
            project_id: Project ID
            user_id: User who triggered the processing
            results: List of embedding results from runner
            total_processed: Total count processed by runner
            successful: Successful count from runner
            failed: Failed count from runner
            extract_dimensions_fn: Optional function to extract image dimensions from data URLs

        Returns:
            Dict with applied count, failed count, and stored embeddings count
        """
        return await embedding_processor.process_embedding_results(
            db,
            project_id,
            user_id,
            results,
            total_processed,
            successful,
            failed,
            extract_dimensions_fn,
        )


# Global instance
rag_builder_service = RAGBuilderService()
