from typing import List, Optional
from sqlalchemy.orm import Session
from app.models.project import Project
from app.schemas.project import ProjectCreate, ProjectUpdate


def get_project(db: Session, project_id: int) -> Optional[Project]:
    return db.query(Project).filter(Project.id == project_id).first()


def get_projects_by_owner(
    db: Session, owner_id: int, skip: int = 0, limit: int = 100
) -> List[Project]:
    return (
        db.query(Project)
        .filter(Project.owner_id == owner_id)
        .offset(skip)
        .limit(limit)
        .all()
    )


def create_project(db: Session, project: ProjectCreate, owner_id: int) -> Project:
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