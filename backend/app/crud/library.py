"""Generic CRUD operations for library models."""

from typing import Any, TypeVar, cast
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import Base

T = TypeVar("T", bound=Base)


async def list_items[
    T: Base
](
    db: AsyncSession,
    model: type[T],
    user_id: UUID,
    *,
    project_id: UUID | None = None,
    search: str | None = None,
    tags: list[str] | None = None,
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[T], int]:
    """List items with filtering and pagination."""
    query = select(model).where(model.created_by_user_id == user_id)  # type: ignore[attr-defined]

    if project_id is not None:
        query = query.where(model.project_id == project_id)  # type: ignore[attr-defined]

    if search:
        query = query.where(model.name.ilike(f"%{search}%"))  # type: ignore[attr-defined]

    if tags:
        # JSONB contains any of the specified tags
        for tag in tags:
            query = query.where(model.tags.contains([tag]))  # type: ignore[attr-defined]

    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar_one()

    query = query.order_by(model.created_at.desc()).offset(offset).limit(limit)  # type: ignore[attr-defined]
    result = await db.execute(query)
    return list(result.scalars().all()), total


async def get_item[
    T: Base
](db: AsyncSession, model: type[T], item_id: UUID, user_id: UUID,) -> T | None:
    """Get a single item by ID, scoped to user."""
    result = await db.execute(
        select(model).where(
            model.id == item_id,  # type: ignore[attr-defined]
            model.created_by_user_id == user_id,  # type: ignore[attr-defined]
        )
    )
    return result.scalar_one_or_none()


async def create_item[
    T: Base
](db: AsyncSession, model: type[T], user_id: UUID, data: dict[str, Any],) -> T:
    """Create a new item."""
    item = cast(T, model(created_by_user_id=user_id, **data))  # type: ignore[call-arg]
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


async def update_item[
    T: Base
](db: AsyncSession, item: T, data: dict[str, Any],) -> T:
    """Update an existing item with non-None fields."""
    for key, value in data.items():
        if value is not None:
            setattr(item, key, value)
    await db.commit()
    await db.refresh(item)
    return item


async def delete_item[
    T: Base
](db: AsyncSession, item: T,) -> None:
    """Delete an item."""
    await db.delete(item)
    await db.commit()
