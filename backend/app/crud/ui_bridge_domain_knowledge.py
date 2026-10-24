"""CRUD operations for UI Bridge domain knowledge.

A knowledge row is either project-scoped (``project_id`` set) or global
(``project_id`` NULL). A project can read both, but can only edit or
delete its own; the two getters below encode that split.
"""

from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ui_bridge_state import DomainKnowledge
from app.schemas.ui_bridge_state import DomainKnowledgeCreate, DomainKnowledgeUpdate


async def list_knowledge(
    db: AsyncSession, project_id: UUID, *, include_global: bool
) -> Sequence[DomainKnowledge]:
    """List a project's knowledge by title, optionally with global rows."""
    query = select(DomainKnowledge)
    if include_global:
        query = query.where(
            (DomainKnowledge.project_id == project_id)
            | (DomainKnowledge.project_id.is_(None))
        )
    else:
        query = query.where(DomainKnowledge.project_id == project_id)

    query = query.order_by(DomainKnowledge.title)
    result = await db.execute(query)
    return result.scalars().all()


async def get_visible_knowledge(
    db: AsyncSession, project_id: UUID, knowledge_id: UUID
) -> DomainKnowledge | None:
    """Get a knowledge row the project can read: its own, or a global one."""
    result = await db.execute(
        select(DomainKnowledge).where(
            DomainKnowledge.id == knowledge_id,
            (DomainKnowledge.project_id == project_id)
            | (DomainKnowledge.project_id.is_(None)),
        )
    )
    return result.scalar_one_or_none()


async def get_project_knowledge(
    db: AsyncSession, project_id: UUID, knowledge_id: UUID
) -> DomainKnowledge | None:
    """Get a knowledge row the project owns (global rows excluded)."""
    result = await db.execute(
        select(DomainKnowledge).where(
            DomainKnowledge.id == knowledge_id,
            DomainKnowledge.project_id == project_id,
        )
    )
    return result.scalar_one_or_none()


async def create_knowledge(
    db: AsyncSession, project_id: UUID, data: DomainKnowledgeCreate
) -> DomainKnowledge:
    """Create a project-scoped knowledge row. Commits, then refreshes it."""
    knowledge = DomainKnowledge(
        project_id=project_id,
        title=data.title,
        content=data.content,
        tags=data.tags,
    )
    db.add(knowledge)
    await db.commit()
    await db.refresh(knowledge)
    return knowledge


async def update_knowledge(
    db: AsyncSession, knowledge: DomainKnowledge, data: DomainKnowledgeUpdate
) -> DomainKnowledge:
    """Apply the non-``None`` fields. Commits, then refreshes the row."""
    if data.title is not None:
        knowledge.title = data.title
    if data.content is not None:
        knowledge.content = data.content
    if data.tags is not None:
        knowledge.tags = data.tags

    await db.commit()
    await db.refresh(knowledge)
    return knowledge


async def delete_knowledge(db: AsyncSession, knowledge: DomainKnowledge) -> None:
    """Delete a knowledge row (and, by ORM cascade, its state links). Commits."""
    await db.delete(knowledge)
    await db.commit()
