"""Generic CRUD operations for RAG entities.

This module provides a generic CRUD class that handles create, get, list, update,
and delete operations for RAG entities (elements, states, transitions).
"""

from collections.abc import Awaitable, Callable
from typing import Any
from uuid import UUID, uuid4

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


class RAGEntityCRUD:
    """
    Generic CRUD operations for RAG entities.

    This class provides a DRY implementation of CRUD operations that can be
    used for elements, states, and transitions - all of which share identical
    patterns.
    """

    def __init__(
        self,
        entity_type: str,
        entity_key: str,
    ) -> None:
        """
        Initialize the entity CRUD handler.

        Args:
            entity_type: Type name for logging (e.g., "element", "state", "transition")
            entity_key: Key in rag_config (e.g., "elements", "states", "transitions")
        """
        self.entity_type = entity_type
        self.entity_key = entity_key

    async def create(
        self,
        db: AsyncSession,
        project_id: UUID,
        entity_data: dict[str, Any],
        get_rag_config: Callable[[AsyncSession, UUID], Awaitable[dict[str, Any]]],
        update_rag_config: Callable[
            [AsyncSession, UUID, dict[str, Any]], Awaitable[dict[str, Any]]
        ],
    ) -> dict[str, Any]:
        """
        Create a new entity.

        Args:
            db: Database session
            project_id: Project ID
            entity_data: Entity data (without ID)
            get_rag_config: Function to get RAG config
            update_rag_config: Function to update RAG config

        Returns:
            Created entity with generated ID
        """
        rag_config = await get_rag_config(db, project_id)

        # Generate ID if not provided
        if "id" not in entity_data:
            entity_data["id"] = str(uuid4())

        # Initialize entity list if not present
        if self.entity_key not in rag_config:
            rag_config[self.entity_key] = []

        rag_config[self.entity_key].append(entity_data)
        await update_rag_config(db, project_id, rag_config)

        logger.info(
            f"rag_{self.entity_type}_created",
            project_id=str(project_id),
            **{f"{self.entity_type}_id": entity_data["id"]},
        )

        return entity_data

    async def get(
        self,
        db: AsyncSession,
        project_id: UUID,
        entity_id: str,
        get_rag_config: Callable[[AsyncSession, UUID], Awaitable[dict[str, Any]]],
    ) -> dict[str, Any] | None:
        """
        Get an entity by ID.

        Args:
            db: Database session
            project_id: Project ID
            entity_id: Entity ID
            get_rag_config: Function to get RAG config

        Returns:
            Entity data or None if not found
        """
        rag_config = await get_rag_config(db, project_id)
        entities = rag_config.get(self.entity_key, [])

        for entity in entities:
            if entity.get("id") == entity_id:
                result: dict[str, Any] = entity
                return result

        return None

    async def list(
        self,
        db: AsyncSession,
        project_id: UUID,
        get_rag_config: Callable[[AsyncSession, UUID], Awaitable[dict[str, Any]]],
    ) -> list[dict[str, Any]]:
        """
        List all entities in a project.

        Args:
            db: Database session
            project_id: Project ID
            get_rag_config: Function to get RAG config

        Returns:
            List of entities
        """
        rag_config = await get_rag_config(db, project_id)
        entities_result: list[dict[str, Any]] = rag_config.get(self.entity_key, [])
        return entities_result

    async def update(
        self,
        db: AsyncSession,
        project_id: UUID,
        entity_id: str,
        entity_data: dict[str, Any],
        get_rag_config: Callable[[AsyncSession, UUID], Awaitable[dict[str, Any]]],
        update_rag_config: Callable[
            [AsyncSession, UUID, dict[str, Any]], Awaitable[dict[str, Any]]
        ],
    ) -> dict[str, Any] | None:
        """
        Update an entity.

        Args:
            db: Database session
            project_id: Project ID
            entity_id: Entity ID
            entity_data: Updated entity data
            get_rag_config: Function to get RAG config
            update_rag_config: Function to update RAG config

        Returns:
            Updated entity or None if not found
        """
        rag_config = await get_rag_config(db, project_id)
        entities = rag_config.get(self.entity_key, [])

        for i, entity in enumerate(entities):
            if entity.get("id") == entity_id:
                # Preserve ID
                entity_data["id"] = entity_id
                entities[i] = entity_data
                await update_rag_config(db, project_id, rag_config)

                logger.info(
                    f"rag_{self.entity_type}_updated",
                    project_id=str(project_id),
                    **{f"{self.entity_type}_id": entity_id},
                )

                return entity_data

        return None

    async def delete(
        self,
        db: AsyncSession,
        project_id: UUID,
        entity_id: str,
        get_rag_config: Callable[[AsyncSession, UUID], Awaitable[dict[str, Any]]],
        update_rag_config: Callable[
            [AsyncSession, UUID, dict[str, Any]], Awaitable[dict[str, Any]]
        ],
    ) -> bool:
        """
        Delete an entity.

        Args:
            db: Database session
            project_id: Project ID
            entity_id: Entity ID
            get_rag_config: Function to get RAG config
            update_rag_config: Function to update RAG config

        Returns:
            True if deleted, False if not found
        """
        rag_config = await get_rag_config(db, project_id)
        entities = rag_config.get(self.entity_key, [])

        for i, entity in enumerate(entities):
            if entity.get("id") == entity_id:
                entities.pop(i)
                await update_rag_config(db, project_id, rag_config)

                logger.info(
                    f"rag_{self.entity_type}_deleted",
                    project_id=str(project_id),
                    **{f"{self.entity_type}_id": entity_id},
                )

                return True

        return False


# Pre-configured instances for each entity type
element_crud = RAGEntityCRUD(entity_type="element", entity_key="elements")
state_crud = RAGEntityCRUD(entity_type="state", entity_key="states")
transition_crud = RAGEntityCRUD(entity_type="transition", entity_key="transitions")
