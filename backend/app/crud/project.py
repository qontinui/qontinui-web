from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project
from app.schemas.project import ProjectCreate, ProjectUpdate
from app.services.stripe_service import StripeService


async def get_project(db: AsyncSession, project_id: str) -> Project | None:
    result = await db.execute(select(Project).filter(Project.id == project_id))
    return result.scalar_one_or_none()


async def get_projects_by_owner(
    db: AsyncSession, owner_id: UUID, skip: int = 0, limit: int = 100
) -> list[Project]:
    result = await db.execute(
        select(Project).filter(Project.owner_id == owner_id).offset(skip).limit(limit)
    )
    return list(result.scalars().all())


async def create_project(
    db: AsyncSession, project: ProjectCreate, owner_id: UUID, subscription_tier: str
) -> Project:
    # Check if user has reached config limit
    count_result = await db.execute(
        select(func.count(Project.id)).filter(Project.owner_id == owner_id)
    )
    config_count = count_result.scalar()

    # Get tier limits
    limits = StripeService.get_tier_limits(subscription_tier)
    max_configs = limits["max_configs"]

    # Check limit (-1 = unlimited)
    if max_configs != -1 and config_count >= max_configs:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Configuration limit reached. Your {subscription_tier} tier allows {max_configs} configurations. Upgrade to create more.",
        )

    db_project = Project(
        name=project.name,
        description=project.description,
        configuration=project.configuration,
        owner_id=owner_id,
    )
    db.add(db_project)
    await db.commit()
    await db.refresh(db_project)
    return db_project


async def update_project(
    db: AsyncSession, project: Project, project_update: ProjectUpdate
) -> Project:
    update_data = project_update.dict(exclude_unset=True)

    for field, value in update_data.items():
        setattr(project, field, value)

    db.add(project)
    await db.commit()
    await db.refresh(project)
    return project


async def delete_project(db: AsyncSession, project_id: str) -> bool:
    project = await get_project(db, project_id)
    if project:
        await db.delete(project)
        await db.commit()
        return True
    return False
