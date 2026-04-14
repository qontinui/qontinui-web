"""
Base repository class for async SQLAlchemy operations.

Provides a generic repository pattern with common CRUD operations,
designed for use with UUID primary keys and Pydantic v2 schemas.
"""

from typing import Any, cast
from uuid import UUID

from app.db.base import Base
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession


class BaseRepository[ModelType: Base, CreateSchemaType: BaseModel]:
    """
    Generic base repository providing common async CRUD operations.

    This class provides a reusable set of database operations that can be
    inherited by specific entity repositories. It assumes:
    - Models use UUID primary keys (column named 'id')
    - Pydantic v2 schemas for input validation
    - Async SQLAlchemy sessions

    Type Parameters:
        ModelType: The SQLAlchemy model class
        CreateSchemaType: The Pydantic schema used for creating records

    Example:
        class ProjectRepository(BaseRepository[Project, ProjectCreate]):
            def __init__(self):
                super().__init__(Project)

            async def get_by_owner(self, db: AsyncSession, owner_id: UUID) -> list[Project]:
                query = select(self.model).where(self.model.owner_id == owner_id)
                result = await db.execute(query)
                return list(result.scalars().all())
    """

    def __init__(self, model: type[ModelType]) -> None:
        """
        Initialize the repository with a model class.

        Args:
            model: The SQLAlchemy model class this repository manages
        """
        self.model = model

    async def get(self, db: AsyncSession, id: UUID) -> ModelType | None:
        """
        Retrieve a single record by its UUID primary key.

        Args:
            db: Async database session
            id: The UUID of the record to retrieve

        Returns:
            The model instance if found, None otherwise
        """
        query = select(self.model).where(self.model.id == id)
        result = await db.execute(query)
        return result.scalar_one_or_none()

    async def list(
        self,
        db: AsyncSession,
        offset: int = 0,
        limit: int = 100,
        filters: dict[str, Any] | None = None,
    ) -> tuple[list[ModelType], int]:
        """
        Retrieve a paginated list of records with optional filtering.

        Args:
            db: Async database session
            offset: Number of records to skip (for pagination)
            limit: Maximum number of records to return
            filters: Optional dictionary of field-value pairs for filtering.
                     Supports direct equality matching for column values.

        Returns:
            A tuple containing:
                - List of model instances matching the criteria
                - Total count of matching records (before pagination)

        Example:
            # Get first 10 projects for a specific owner
            projects, total = await repo.list(
                db,
                offset=0,
                limit=10,
                filters={"owner_id": owner_uuid}
            )
        """
        # Build base query
        query = select(self.model)

        # Apply filters if provided
        if filters:
            query = self._apply_filters(query, filters)

        # Get total count before pagination
        count_query = select(func.count()).select_from(query.subquery())
        count_result = await db.execute(count_query)
        total = count_result.scalar_one()

        # Apply pagination and execute
        query = query.offset(offset).limit(limit)
        result = await db.execute(query)
        items = list(result.scalars().all())

        return items, total

    async def create(self, db: AsyncSession, obj_in: CreateSchemaType) -> ModelType:
        """
        Create a new record from a Pydantic schema.

        Args:
            db: Async database session
            obj_in: Pydantic schema containing the data for the new record

        Returns:
            The newly created model instance with database-generated fields
            (like id, created_at) populated
        """
        # Convert Pydantic model to dict, excluding unset optional fields
        obj_data = obj_in.model_dump(exclude_unset=True)

        # Create model instance
        db_obj = self.model(**obj_data)

        # Add to session, commit, and refresh
        db.add(db_obj)
        await db.commit()
        await db.refresh(db_obj)

        return cast(ModelType, db_obj)

    async def update(
        self,
        db: AsyncSession,
        id: UUID,
        obj_in: BaseModel | dict[str, Any],
    ) -> ModelType | None:
        """
        Update an existing record by ID.

        Args:
            db: Async database session
            id: The UUID of the record to update
            obj_in: Either a Pydantic schema or dict containing update data.
                    Only provided fields will be updated.

        Returns:
            The updated model instance if found, None if the record doesn't exist
        """
        # Fetch existing record
        db_obj = await self.get(db, id)
        if db_obj is None:
            return None

        # Convert to dict if Pydantic model
        if isinstance(obj_in, BaseModel):
            update_data = obj_in.model_dump(exclude_unset=True)
        else:
            update_data = obj_in

        # Apply updates
        for field, value in update_data.items():
            if hasattr(db_obj, field):
                setattr(db_obj, field, value)

        await db.commit()
        await db.refresh(db_obj)

        return db_obj

    async def delete(self, db: AsyncSession, id: UUID) -> bool:
        """
        Delete a record by its UUID primary key.

        Args:
            db: Async database session
            id: The UUID of the record to delete

        Returns:
            True if the record was deleted, False if it wasn't found
        """
        db_obj = await self.get(db, id)
        if db_obj is None:
            return False

        await db.delete(db_obj)
        await db.commit()

        return True

    async def exists(self, db: AsyncSession, id: UUID) -> bool:
        """
        Check if a record with the given ID exists.

        This is more efficient than get() when you only need to check existence,
        as it uses a COUNT query instead of fetching the full record.

        Args:
            db: Async database session
            id: The UUID to check

        Returns:
            True if a record with the given ID exists, False otherwise
        """
        query = select(func.count()).where(self.model.id == id)
        result = await db.execute(query)
        count = result.scalar_one()
        return count > 0

    def _apply_filters(
        self,
        query: Any,
        filters: dict[str, Any],
    ) -> Any:
        """
        Apply equality filters to a query.

        This method can be overridden in subclasses to provide custom
        filtering logic (e.g., range queries, LIKE patterns, etc.).

        Args:
            query: The SQLAlchemy select query to filter
            filters: Dictionary of field names to values for equality matching

        Returns:
            The modified query with filters applied

        Note:
            Filters with None values are skipped.
            Invalid field names (not present on the model) are silently ignored.
        """
        for field_name, value in filters.items():
            if value is None:
                continue

            if hasattr(self.model, field_name):
                column = getattr(self.model, field_name)
                query = query.where(column == value)

        return query
