"""Service for managing RAG configuration in projects.

This service provides CRUD operations for RAG elements, states, workflows,
and transitions stored in the project's rag_config JSON field.
"""

from typing import Any
from uuid import UUID, uuid4

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud.project import get_project, update_project
from app.schemas.project import ProjectUpdate

logger = structlog.get_logger(__name__)


class RAGBuilderService:
    """
    Service for managing RAG configuration within projects.

    Stores RAG elements, states, workflows, and transitions in the
    project's rag_config JSON field.
    """

    def __init__(self) -> None:
        """Initialize the RAG builder service."""
        pass

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
        rag_config = await self.get_rag_config(db, project_id)

        # Generate ID if not provided
        if "id" not in element_data:
            element_data["id"] = str(uuid4())

        # Initialize elements list if not present
        if "elements" not in rag_config:
            rag_config["elements"] = []

        rag_config["elements"].append(element_data)
        await self.update_rag_config(db, project_id, rag_config)

        logger.info(
            "rag_element_created",
            project_id=str(project_id),
            element_id=element_data["id"],
        )

        return element_data

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
        rag_config = await self.get_rag_config(db, project_id)
        elements = rag_config.get("elements", [])

        for element in elements:
            if element.get("id") == element_id:
                result: dict[str, Any] = element
                return result

        return None

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
        rag_config = await self.get_rag_config(db, project_id)
        elements_result: list[dict[str, Any]] = rag_config.get("elements", [])
        return elements_result

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
        rag_config = await self.get_rag_config(db, project_id)
        elements = rag_config.get("elements", [])

        for i, element in enumerate(elements):
            if element.get("id") == element_id:
                # Preserve ID
                element_data["id"] = element_id
                elements[i] = element_data
                await self.update_rag_config(db, project_id, rag_config)

                logger.info(
                    "rag_element_updated",
                    project_id=str(project_id),
                    element_id=element_id,
                )

                return element_data

        return None

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
        rag_config = await self.get_rag_config(db, project_id)
        elements = rag_config.get("elements", [])

        for i, element in enumerate(elements):
            if element.get("id") == element_id:
                elements.pop(i)
                await self.update_rag_config(db, project_id, rag_config)

                logger.info(
                    "rag_element_deleted",
                    project_id=str(project_id),
                    element_id=element_id,
                )

                return True

        return False

    # ============================================================================
    # State CRUD Operations
    # ============================================================================

    async def create_state(
        self, db: AsyncSession, project_id: UUID, state_data: dict[str, Any]
    ) -> dict[str, Any]:
        """Create a new RAG state."""
        rag_config = await self.get_rag_config(db, project_id)

        if "id" not in state_data:
            state_data["id"] = str(uuid4())

        if "states" not in rag_config:
            rag_config["states"] = []

        rag_config["states"].append(state_data)
        await self.update_rag_config(db, project_id, rag_config)

        logger.info(
            "rag_state_created", project_id=str(project_id), state_id=state_data["id"]
        )

        return state_data

    async def get_state(
        self, db: AsyncSession, project_id: UUID, state_id: str
    ) -> dict[str, Any] | None:
        """Get a RAG state by ID."""
        rag_config = await self.get_rag_config(db, project_id)
        states = rag_config.get("states", [])

        for state in states:
            if state.get("id") == state_id:
                result: dict[str, Any] = state
                return result

        return None

    async def list_states(
        self, db: AsyncSession, project_id: UUID
    ) -> list[dict[str, Any]]:
        """List all RAG states in a project."""
        rag_config = await self.get_rag_config(db, project_id)
        states_result: list[dict[str, Any]] = rag_config.get("states", [])
        return states_result

    async def update_state(
        self,
        db: AsyncSession,
        project_id: UUID,
        state_id: str,
        state_data: dict[str, Any],
    ) -> dict[str, Any] | None:
        """Update a RAG state."""
        rag_config = await self.get_rag_config(db, project_id)
        states = rag_config.get("states", [])

        for i, state in enumerate(states):
            if state.get("id") == state_id:
                state_data["id"] = state_id
                states[i] = state_data
                await self.update_rag_config(db, project_id, rag_config)

                logger.info(
                    "rag_state_updated", project_id=str(project_id), state_id=state_id
                )

                return state_data

        return None

    async def delete_state(
        self, db: AsyncSession, project_id: UUID, state_id: str
    ) -> bool:
        """Delete a RAG state."""
        rag_config = await self.get_rag_config(db, project_id)
        states = rag_config.get("states", [])

        for i, state in enumerate(states):
            if state.get("id") == state_id:
                states.pop(i)
                await self.update_rag_config(db, project_id, rag_config)

                logger.info(
                    "rag_state_deleted", project_id=str(project_id), state_id=state_id
                )

                return True

        return False

    # ============================================================================
    # Transition CRUD Operations
    # ============================================================================

    async def create_transition(
        self, db: AsyncSession, project_id: UUID, transition_data: dict[str, Any]
    ) -> dict[str, Any]:
        """Create a new RAG transition."""
        rag_config = await self.get_rag_config(db, project_id)

        if "id" not in transition_data:
            transition_data["id"] = str(uuid4())

        if "transitions" not in rag_config:
            rag_config["transitions"] = []

        rag_config["transitions"].append(transition_data)
        await self.update_rag_config(db, project_id, rag_config)

        logger.info(
            "rag_transition_created",
            project_id=str(project_id),
            transition_id=transition_data["id"],
        )

        return transition_data

    async def get_transition(
        self, db: AsyncSession, project_id: UUID, transition_id: str
    ) -> dict[str, Any] | None:
        """Get a RAG transition by ID."""
        rag_config = await self.get_rag_config(db, project_id)
        transitions = rag_config.get("transitions", [])

        for transition in transitions:
            if transition.get("id") == transition_id:
                result: dict[str, Any] = transition
                return result

        return None

    async def list_transitions(
        self, db: AsyncSession, project_id: UUID
    ) -> list[dict[str, Any]]:
        """List all RAG transitions in a project."""
        rag_config = await self.get_rag_config(db, project_id)
        transitions_result: list[dict[str, Any]] = rag_config.get("transitions", [])
        return transitions_result

    async def update_transition(
        self,
        db: AsyncSession,
        project_id: UUID,
        transition_id: str,
        transition_data: dict[str, Any],
    ) -> dict[str, Any] | None:
        """Update a RAG transition."""
        rag_config = await self.get_rag_config(db, project_id)
        transitions = rag_config.get("transitions", [])

        for i, transition in enumerate(transitions):
            if transition.get("id") == transition_id:
                transition_data["id"] = transition_id
                transitions[i] = transition_data
                await self.update_rag_config(db, project_id, rag_config)

                logger.info(
                    "rag_transition_updated",
                    project_id=str(project_id),
                    transition_id=transition_id,
                )

                return transition_data

        return None

    async def delete_transition(
        self, db: AsyncSession, project_id: UUID, transition_id: str
    ) -> bool:
        """Delete a RAG transition."""
        rag_config = await self.get_rag_config(db, project_id)
        transitions = rag_config.get("transitions", [])

        for i, transition in enumerate(transitions):
            if transition.get("id") == transition_id:
                transitions.pop(i)
                await self.update_rag_config(db, project_id, rag_config)

                logger.info(
                    "rag_transition_deleted",
                    project_id=str(project_id),
                    transition_id=transition_id,
                )

                return True

        return False

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
