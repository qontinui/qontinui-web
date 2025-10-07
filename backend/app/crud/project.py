from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.project import Project
from app.schemas.project import ProjectCreate, ProjectUpdate
from app.services.stripe_service import StripeService


def get_project(db: Session, project_id: int) -> Project | None:
    return db.query(Project).filter(Project.id == project_id).first()


def get_projects_by_owner(
    db: Session, owner_id: int, skip: int = 0, limit: int = 100
) -> list[Project]:
    return (
        db.query(Project)
        .filter(Project.owner_id == owner_id)
        .offset(skip)
        .limit(limit)
        .all()
    )


def create_project(
    db: Session, project: ProjectCreate, owner_id: int, subscription_tier: str
) -> Project:
    # Check if user has reached config limit
    config_count = (
        db.query(func.count(Project.id)).filter(Project.owner_id == owner_id).scalar()
    )

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
    db.commit()
    db.refresh(db_project)
    return db_project


def update_project(
    db: Session, project: Project, project_update: ProjectUpdate
) -> Project:
    update_data = project_update.dict(exclude_unset=True)

    for field, value in update_data.items():
        setattr(project, field, value)

    db.add(project)
    db.commit()
    db.refresh(project)
    return project


def delete_project(db: Session, project_id: int) -> bool:
    project = get_project(db, project_id)
    if project:
        db.delete(project)
        db.commit()
        return True
    return False
