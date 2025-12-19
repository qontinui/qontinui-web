"""
CRUD operations for AI prompt template and sequence management.

Provides database operations for creating, reading, updating, and deleting
AI prompt templates and sequences.
"""

from datetime import datetime
from uuid import UUID

import structlog
from sqlalchemy import and_, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai_prompt import AIPromptTemplate, PromptSequence
from app.schemas.ai_prompt import (
    AIPromptTemplateCreate,
    AIPromptTemplateUpdate,
    PromptSequenceCreate,
    PromptSequenceUpdate,
)

logger = structlog.get_logger(__name__)


# ===== AI Prompt Template CRUD =====


async def create_prompt_template(
    db: AsyncSession,
    project_id: UUID,
    user_id: UUID,
    template_data: AIPromptTemplateCreate,
) -> AIPromptTemplate:
    """
    Create a new AI prompt template.

    Args:
        db: Database session
        project_id: Project ID
        user_id: User ID (creator)
        template_data: Template creation data

    Returns:
        Created template instance
    """
    template = AIPromptTemplate(
        id=template_data.id,
        project_id=project_id,
        created_by=user_id,
        name=template_data.name,
        description=template_data.description,
        category=template_data.category,
        tags=template_data.tags or [],
        prompt=template_data.prompt,
        parameters=template_data.parameters or [],
        default_timeout=template_data.default_timeout,
        default_working_directory=template_data.default_working_directory,
    )

    db.add(template)
    await db.commit()
    await db.refresh(template)

    logger.info(
        "ai_prompt_template_created",
        template_id=template.id,
        project_id=project_id,
        user_id=user_id,
    )
    return template


async def get_template_by_id(
    db: AsyncSession, template_id: str
) -> AIPromptTemplate | None:
    """Get AI prompt template by ID."""
    result = await db.execute(
        select(AIPromptTemplate).where(AIPromptTemplate.id == template_id)
    )
    return result.scalar_one_or_none()


async def get_template_by_project_and_id(
    db: AsyncSession, project_id: UUID, template_id: str
) -> AIPromptTemplate | None:
    """
    Get AI prompt template by project and ID.

    Args:
        db: Database session
        project_id: Project ID
        template_id: Template ID

    Returns:
        Template if found, None otherwise
    """
    result = await db.execute(
        select(AIPromptTemplate).where(
            and_(
                AIPromptTemplate.project_id == project_id,
                AIPromptTemplate.id == template_id,
            )
        )
    )
    return result.scalar_one_or_none()


async def update_prompt_template(
    db: AsyncSession, template: AIPromptTemplate, update_data: AIPromptTemplateUpdate
) -> AIPromptTemplate:
    """
    Update AI prompt template.

    Args:
        db: Database session
        template: Template instance to update
        update_data: Update data

    Returns:
        Updated template instance
    """
    update_dict = update_data.model_dump(exclude_unset=True)

    for field, value in update_dict.items():
        setattr(template, field, value)

    template.updated_at = datetime.utcnow()  # type: ignore[assignment]
    await db.commit()
    await db.refresh(template)

    logger.info("ai_prompt_template_updated", template_id=template.id)
    return template


async def delete_prompt_template(db: AsyncSession, template: AIPromptTemplate) -> bool:
    """
    Delete an AI prompt template.

    Args:
        db: Database session
        template: Template to delete

    Returns:
        True if deleted successfully
    """
    template_id = template.id
    await db.delete(template)
    await db.commit()

    logger.info("ai_prompt_template_deleted", template_id=template_id)
    return True


async def list_project_templates(
    db: AsyncSession,
    project_id: UUID,
    skip: int = 0,
    limit: int = 100,
) -> tuple[list[AIPromptTemplate], int]:
    """
    List all AI prompt templates for a project.

    Args:
        db: Database session
        project_id: Project ID
        skip: Number of records to skip
        limit: Maximum number of records to return

    Returns:
        Tuple of (templates list, total count)
    """
    # Get total count
    count_result = await db.execute(
        select(func.count(AIPromptTemplate.id)).where(
            AIPromptTemplate.project_id == project_id
        )
    )
    total = count_result.scalar_one()

    # Get paginated results
    result = await db.execute(
        select(AIPromptTemplate)
        .where(AIPromptTemplate.project_id == project_id)
        .order_by(desc(AIPromptTemplate.created_at))
        .offset(skip)
        .limit(limit)
    )
    templates = list(result.scalars().all())

    return templates, total


async def search_templates(
    db: AsyncSession,
    project_id: UUID,
    query: str | None = None,
    category: str | None = None,
    tags: list[str] | None = None,
    skip: int = 0,
    limit: int = 100,
) -> tuple[list[AIPromptTemplate], int]:
    """
    Search AI prompt templates with filters.

    Args:
        db: Database session
        project_id: Project ID
        query: Text search (name, description)
        category: Category filter
        tags: Tag filters
        skip: Number of records to skip
        limit: Maximum number of records to return

    Returns:
        Tuple of (templates list, total count)
    """
    # Build base query
    conditions = [AIPromptTemplate.project_id == project_id]

    # Text search
    if query:
        search_pattern = f"%{query}%"
        conditions.append(
            or_(
                AIPromptTemplate.name.ilike(search_pattern),
                AIPromptTemplate.description.ilike(search_pattern),
            )
        )

    # Category filter
    if category:
        conditions.append(AIPromptTemplate.category == category)

    # Tags filter (must contain all specified tags)
    if tags:
        for tag in tags:
            conditions.append(AIPromptTemplate.tags.contains([tag]))

    # Get total count
    count_result = await db.execute(
        select(func.count(AIPromptTemplate.id)).where(and_(*conditions))
    )
    total = count_result.scalar_one()

    # Get paginated results
    result = await db.execute(
        select(AIPromptTemplate)
        .where(and_(*conditions))
        .order_by(desc(AIPromptTemplate.created_at))
        .offset(skip)
        .limit(limit)
    )
    templates = list(result.scalars().all())

    return templates, total


# ===== Prompt Sequence CRUD =====


async def create_prompt_sequence(
    db: AsyncSession,
    project_id: UUID,
    user_id: UUID,
    sequence_data: PromptSequenceCreate,
) -> PromptSequence:
    """
    Create a new prompt sequence.

    Args:
        db: Database session
        project_id: Project ID
        user_id: User ID (creator)
        sequence_data: Sequence creation data

    Returns:
        Created sequence instance
    """
    sequence = PromptSequence(
        id=sequence_data.id,
        project_id=project_id,
        created_by=user_id,
        name=sequence_data.name,
        description=sequence_data.description,
        category=sequence_data.category,
        tags=sequence_data.tags or [],
        steps=sequence_data.steps,
        on_failure=sequence_data.on_failure,
        max_retries=sequence_data.max_retries,
        results_directory=sequence_data.results_directory,
        default_timeout=sequence_data.default_timeout,
    )

    db.add(sequence)
    await db.commit()
    await db.refresh(sequence)

    logger.info(
        "prompt_sequence_created",
        sequence_id=sequence.id,
        project_id=project_id,
        user_id=user_id,
    )
    return sequence


async def get_sequence_by_id(
    db: AsyncSession, sequence_id: str
) -> PromptSequence | None:
    """Get prompt sequence by ID."""
    result = await db.execute(
        select(PromptSequence).where(PromptSequence.id == sequence_id)
    )
    return result.scalar_one_or_none()


async def get_sequence_by_project_and_id(
    db: AsyncSession, project_id: UUID, sequence_id: str
) -> PromptSequence | None:
    """
    Get prompt sequence by project and ID.

    Args:
        db: Database session
        project_id: Project ID
        sequence_id: Sequence ID

    Returns:
        Sequence if found, None otherwise
    """
    result = await db.execute(
        select(PromptSequence).where(
            and_(
                PromptSequence.project_id == project_id,
                PromptSequence.id == sequence_id,
            )
        )
    )
    return result.scalar_one_or_none()


async def update_prompt_sequence(
    db: AsyncSession, sequence: PromptSequence, update_data: PromptSequenceUpdate
) -> PromptSequence:
    """
    Update prompt sequence.

    Args:
        db: Database session
        sequence: Sequence instance to update
        update_data: Update data

    Returns:
        Updated sequence instance
    """
    update_dict = update_data.model_dump(exclude_unset=True)

    for field, value in update_dict.items():
        setattr(sequence, field, value)

    sequence.updated_at = datetime.utcnow()  # type: ignore[assignment]
    await db.commit()
    await db.refresh(sequence)

    logger.info("prompt_sequence_updated", sequence_id=sequence.id)
    return sequence


async def delete_prompt_sequence(db: AsyncSession, sequence: PromptSequence) -> bool:
    """
    Delete a prompt sequence.

    Args:
        db: Database session
        sequence: Sequence to delete

    Returns:
        True if deleted successfully
    """
    sequence_id = sequence.id
    await db.delete(sequence)
    await db.commit()

    logger.info("prompt_sequence_deleted", sequence_id=sequence_id)
    return True


async def list_project_sequences(
    db: AsyncSession,
    project_id: UUID,
    skip: int = 0,
    limit: int = 100,
) -> tuple[list[PromptSequence], int]:
    """
    List all prompt sequences for a project.

    Args:
        db: Database session
        project_id: Project ID
        skip: Number of records to skip
        limit: Maximum number of records to return

    Returns:
        Tuple of (sequences list, total count)
    """
    # Get total count
    count_result = await db.execute(
        select(func.count(PromptSequence.id)).where(
            PromptSequence.project_id == project_id
        )
    )
    total = count_result.scalar_one()

    # Get paginated results
    result = await db.execute(
        select(PromptSequence)
        .where(PromptSequence.project_id == project_id)
        .order_by(desc(PromptSequence.created_at))
        .offset(skip)
        .limit(limit)
    )
    sequences = list(result.scalars().all())

    return sequences, total


async def search_sequences(
    db: AsyncSession,
    project_id: UUID,
    query: str | None = None,
    category: str | None = None,
    tags: list[str] | None = None,
    skip: int = 0,
    limit: int = 100,
) -> tuple[list[PromptSequence], int]:
    """
    Search prompt sequences with filters.

    Args:
        db: Database session
        project_id: Project ID
        query: Text search (name, description)
        category: Category filter
        tags: Tag filters
        skip: Number of records to skip
        limit: Maximum number of records to return

    Returns:
        Tuple of (sequences list, total count)
    """
    # Build base query
    conditions = [PromptSequence.project_id == project_id]

    # Text search
    if query:
        search_pattern = f"%{query}%"
        conditions.append(
            or_(
                PromptSequence.name.ilike(search_pattern),
                PromptSequence.description.ilike(search_pattern),
            )
        )

    # Category filter
    if category:
        conditions.append(PromptSequence.category == category)

    # Tags filter (must contain all specified tags)
    if tags:
        for tag in tags:
            conditions.append(PromptSequence.tags.contains([tag]))

    # Get total count
    count_result = await db.execute(
        select(func.count(PromptSequence.id)).where(and_(*conditions))
    )
    total = count_result.scalar_one()

    # Get paginated results
    result = await db.execute(
        select(PromptSequence)
        .where(and_(*conditions))
        .order_by(desc(PromptSequence.created_at))
        .offset(skip)
        .limit(limit)
    )
    sequences = list(result.scalars().all())

    return sequences, total


# ===== Utility Functions =====


async def get_project_categories(db: AsyncSession, project_id: UUID) -> list[str]:
    """
    Get all unique categories used in a project (templates and sequences).

    Args:
        db: Database session
        project_id: Project ID

    Returns:
        List of unique category names
    """
    # Get template categories
    template_categories = await db.execute(
        select(AIPromptTemplate.category)
        .where(
            and_(
                AIPromptTemplate.project_id == project_id,
                AIPromptTemplate.category.isnot(None),
            )
        )
        .distinct()
    )

    # Get sequence categories
    sequence_categories = await db.execute(
        select(PromptSequence.category)
        .where(
            and_(
                PromptSequence.project_id == project_id,
                PromptSequence.category.isnot(None),
            )
        )
        .distinct()
    )

    # Combine and deduplicate
    all_categories = set()
    all_categories.update(cat for cat in template_categories.scalars().all() if cat)
    all_categories.update(cat for cat in sequence_categories.scalars().all() if cat)

    return sorted(all_categories)


async def get_project_tags(db: AsyncSession, project_id: UUID) -> list[str]:
    """
    Get all unique tags used in a project (templates and sequences).

    Args:
        db: Database session
        project_id: Project ID

    Returns:
        List of unique tag names
    """
    # Get template tags
    template_tags = await db.execute(
        select(AIPromptTemplate.tags).where(AIPromptTemplate.project_id == project_id)
    )

    # Get sequence tags
    sequence_tags = await db.execute(
        select(PromptSequence.tags).where(PromptSequence.project_id == project_id)
    )

    # Flatten and deduplicate
    unique_tags = set()
    for tag_list in template_tags.scalars().all():
        if tag_list:
            unique_tags.update(tag_list)
    for tag_list in sequence_tags.scalars().all():
        if tag_list:
            unique_tags.update(tag_list)

    return sorted(unique_tags)


async def get_project_stats(db: AsyncSession, project_id: UUID) -> dict:
    """
    Get statistics for AI prompt library in a project.

    Args:
        db: Database session
        project_id: Project ID

    Returns:
        Dictionary with statistics
    """
    # Count templates
    template_count = await db.execute(
        select(func.count(AIPromptTemplate.id)).where(
            AIPromptTemplate.project_id == project_id
        )
    )
    total_templates = template_count.scalar_one()

    # Count sequences
    sequence_count = await db.execute(
        select(func.count(PromptSequence.id)).where(
            PromptSequence.project_id == project_id
        )
    )
    total_sequences = sequence_count.scalar_one()

    # Get categories and tags
    categories = await get_project_categories(db, project_id)
    tags = await get_project_tags(db, project_id)

    return {
        "total_templates": total_templates,
        "total_sequences": total_sequences,
        "categories": categories,
        "tags": tags,
    }
