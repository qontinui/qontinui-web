"""
CRUD operations for custom function management.

Provides database operations for creating, reading, updating, and deleting
custom functions discovered from user code.
"""

from datetime import datetime

import structlog
from app.models.custom_function import CustomFunction
from app.schemas.custom_function import CustomFunctionCreate, CustomFunctionUpdate
from sqlalchemy import and_, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


# ===== Basic CRUD Operations =====


async def create_custom_function(
    db: AsyncSession, project_id: int, function_data: CustomFunctionCreate
) -> CustomFunction:
    """
    Create a new custom function record.

    Args:
        db: Database session
        project_id: Project ID
        function_data: Function creation data

    Returns:
        Created custom function instance
    """
    function = CustomFunction(
        project_id=project_id,
        file_path=function_data.file_path,
        function_name=function_data.function_name,
        display_name=function_data.display_name,
        description=function_data.description,
        category=function_data.category,
        tags=function_data.tags or [],
        parameters=function_data.parameters or [],
        return_type=function_data.return_type,
        inputs=function_data.inputs or {},
        outputs=function_data.outputs or {},
        observable_outputs=function_data.observable_outputs or [],
        source_code=function_data.source_code,
        docstring=function_data.docstring,
        line_start=function_data.line_start,
        line_end=function_data.line_end,
    )

    db.add(function)
    await db.commit()
    await db.refresh(function)

    logger.info(
        "custom_function_created",
        function_id=function.id,
        project_id=project_id,
        function_name=function.function_name,
    )
    return function


async def get_function_by_id(
    db: AsyncSession, function_id: int
) -> CustomFunction | None:
    """Get custom function by ID."""
    result = await db.execute(
        select(CustomFunction).where(CustomFunction.id == function_id)
    )
    return result.scalar_one_or_none()


async def get_function_by_name(
    db: AsyncSession, project_id: int, file_path: str, function_name: str
) -> CustomFunction | None:
    """
    Get custom function by project, file, and name.

    Args:
        db: Database session
        project_id: Project ID
        file_path: File path
        function_name: Function name

    Returns:
        Custom function if found, None otherwise
    """
    result = await db.execute(
        select(CustomFunction).where(
            and_(
                CustomFunction.project_id == project_id,
                CustomFunction.file_path == file_path,
                CustomFunction.function_name == function_name,
            )
        )
    )
    return result.scalar_one_or_none()


async def update_custom_function(
    db: AsyncSession, function: CustomFunction, update_data: CustomFunctionUpdate
) -> CustomFunction:
    """
    Update custom function metadata.

    Args:
        db: Database session
        function: Function instance to update
        update_data: Update data

    Returns:
        Updated function instance
    """
    update_dict = update_data.model_dump(exclude_unset=True)

    for field, value in update_dict.items():
        setattr(function, field, value)

    function.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(function)

    logger.info("custom_function_updated", function_id=function.id)
    return function


async def delete_custom_function(db: AsyncSession, function: CustomFunction) -> bool:
    """
    Delete a custom function.

    Args:
        db: Database session
        function: Function to delete

    Returns:
        True if deleted successfully
    """
    function_id = function.id
    await db.delete(function)
    await db.commit()

    logger.info("custom_function_deleted", function_id=function_id)
    return True


# ===== List and Search Operations =====


async def list_project_functions(
    db: AsyncSession,
    project_id: int,
    skip: int = 0,
    limit: int = 100,
) -> tuple[list[CustomFunction], int]:
    """
    List all custom functions for a project.

    Args:
        db: Database session
        project_id: Project ID
        skip: Number of records to skip
        limit: Maximum number of records to return

    Returns:
        Tuple of (functions list, total count)
    """
    # Get total count
    count_result = await db.execute(
        select(func.count(CustomFunction.id)).where(
            CustomFunction.project_id == project_id
        )
    )
    total = count_result.scalar_one()

    # Get paginated results
    result = await db.execute(
        select(CustomFunction)
        .where(CustomFunction.project_id == project_id)
        .order_by(desc(CustomFunction.created_at))
        .offset(skip)
        .limit(limit)
    )
    functions = list(result.scalars().all())

    return functions, total


async def search_functions(
    db: AsyncSession,
    project_id: int,
    query: str | None = None,
    category: str | None = None,
    tags: list[str] | None = None,
    file_path: str | None = None,
    skip: int = 0,
    limit: int = 100,
) -> tuple[list[CustomFunction], int]:
    """
    Search custom functions with filters.

    Args:
        db: Database session
        project_id: Project ID
        query: Text search (function name, display name, description)
        category: Category filter
        tags: Tag filters
        file_path: File path filter
        skip: Number of records to skip
        limit: Maximum number of records to return

    Returns:
        Tuple of (functions list, total count)
    """
    # Build base query
    conditions = [CustomFunction.project_id == project_id]

    # Text search
    if query:
        search_pattern = f"%{query}%"
        conditions.append(
            or_(
                CustomFunction.function_name.ilike(search_pattern),
                CustomFunction.display_name.ilike(search_pattern),
                CustomFunction.description.ilike(search_pattern),
            )
        )

    # Category filter
    if category:
        conditions.append(CustomFunction.category == category)

    # File path filter
    if file_path:
        conditions.append(CustomFunction.file_path.ilike(f"%{file_path}%"))

    # Tags filter (must contain all specified tags)
    if tags:
        for tag in tags:
            conditions.append(CustomFunction.tags.contains([tag]))

    # Get total count
    count_result = await db.execute(
        select(func.count(CustomFunction.id)).where(and_(*conditions))
    )
    total = count_result.scalar_one()

    # Get paginated results
    result = await db.execute(
        select(CustomFunction)
        .where(and_(*conditions))
        .order_by(desc(CustomFunction.created_at))
        .offset(skip)
        .limit(limit)
    )
    functions = list(result.scalars().all())

    return functions, total


async def get_project_categories(db: AsyncSession, project_id: int) -> list[str]:
    """
    Get all unique categories used in a project.

    Args:
        db: Database session
        project_id: Project ID

    Returns:
        List of unique category names
    """
    result = await db.execute(
        select(CustomFunction.category)
        .where(
            and_(
                CustomFunction.project_id == project_id,
                CustomFunction.category.isnot(None),
            )
        )
        .distinct()
        .order_by(CustomFunction.category)
    )
    return [cat for cat in result.scalars().all() if cat]


async def get_project_tags(db: AsyncSession, project_id: int) -> list[str]:
    """
    Get all unique tags used in a project.

    Args:
        db: Database session
        project_id: Project ID

    Returns:
        List of unique tag names
    """
    # Get all tag arrays
    result = await db.execute(
        select(CustomFunction.tags).where(CustomFunction.project_id == project_id)
    )
    all_tags = result.scalars().all()

    # Flatten and deduplicate
    unique_tags = set()
    for tag_list in all_tags:
        if tag_list:
            unique_tags.update(tag_list)

    return sorted(list(unique_tags))


async def get_functions_by_file(
    db: AsyncSession, project_id: int, file_path: str
) -> list[CustomFunction]:
    """
    Get all functions defined in a specific file.

    Args:
        db: Database session
        project_id: Project ID
        file_path: File path

    Returns:
        List of custom functions
    """
    result = await db.execute(
        select(CustomFunction)
        .where(
            and_(
                CustomFunction.project_id == project_id,
                CustomFunction.file_path == file_path,
            )
        )
        .order_by(CustomFunction.line_start)
    )
    return list(result.scalars().all())


async def delete_functions_by_file(
    db: AsyncSession, project_id: int, file_path: str
) -> int:
    """
    Delete all functions from a specific file.
    Used when a file is deleted or needs to be rescanned.

    Args:
        db: Database session
        project_id: Project ID
        file_path: File path

    Returns:
        Number of functions deleted
    """
    # Get functions to delete
    functions = await get_functions_by_file(db, project_id, file_path)
    count = len(functions)

    # Delete them
    for function in functions:
        await db.delete(function)

    await db.commit()

    logger.info(
        "custom_functions_deleted_by_file",
        project_id=project_id,
        file_path=file_path,
        count=count,
    )
    return count


async def get_project_stats(db: AsyncSession, project_id: int) -> dict:
    """
    Get statistics for custom functions in a project.

    Args:
        db: Database session
        project_id: Project ID

    Returns:
        Dictionary with statistics
    """
    # Total functions
    count_result = await db.execute(
        select(func.count(CustomFunction.id)).where(
            CustomFunction.project_id == project_id
        )
    )
    total_functions = count_result.scalar_one()

    # Unique files with functions
    files_result = await db.execute(
        select(func.count(func.distinct(CustomFunction.file_path))).where(
            CustomFunction.project_id == project_id
        )
    )
    files_with_functions = files_result.scalar_one()

    # Get categories and tags
    categories = await get_project_categories(db, project_id)
    tags = await get_project_tags(db, project_id)

    return {
        "total_functions": total_functions,
        "categories": categories,
        "tags": tags,
        "files_with_functions": files_with_functions,
    }


async def upsert_custom_function(
    db: AsyncSession, project_id: int, function_data: CustomFunctionCreate
) -> CustomFunction:
    """
    Create or update a custom function.
    Updates if a function with same project/file/name exists.

    Args:
        db: Database session
        project_id: Project ID
        function_data: Function data

    Returns:
        Created or updated custom function
    """
    # Check if exists
    existing = await get_function_by_name(
        db, project_id, function_data.file_path, function_data.function_name
    )

    if existing:
        # Update existing function
        for field, value in function_data.model_dump(exclude_unset=True).items():
            setattr(existing, field, value)

        existing.updated_at = datetime.utcnow()
        await db.commit()
        await db.refresh(existing)

        logger.info(
            "custom_function_updated",
            function_id=existing.id,
            project_id=project_id,
        )
        return existing
    else:
        # Create new function
        return await create_custom_function(db, project_id, function_data)
