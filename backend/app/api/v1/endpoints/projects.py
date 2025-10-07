from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user, get_db
from app.crud.project import (
    create_project,
    delete_project,
    get_project,
    get_projects_by_owner,
    update_project,
)
from app.models.user import User
from app.schemas.project import Project, ProjectCreate, ProjectUpdate
from app.services.limit_checker import LimitChecker

router = APIRouter()


@router.get("/", response_model=list[Project])
def read_projects(
    db: Session = Depends(get_db),
    skip: int = 0,
    limit: int = 100,
    current_user: User = Depends(get_current_active_user),
) -> Any:
    projects = get_projects_by_owner(
        db, owner_id=current_user.id, skip=skip, limit=limit
    )
    return projects


@router.post("/", response_model=Project)
def create_new_project(
    *,
    db: Session = Depends(get_db),
    project_in: ProjectCreate,
    current_user: User = Depends(get_current_active_user),
) -> Any:
    project = create_project(
        db,
        project_in,
        owner_id=current_user.id,
        subscription_tier=current_user.subscription_tier,
    )
    return project


@router.get("/{project_id}", response_model=Project)
def read_project(
    *,
    db: Session = Depends(get_db),
    project_id: int,
    current_user: User = Depends(get_current_active_user),
) -> Any:
    project = get_project(db, project_id=project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )
    if project.owner_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions"
        )
    return project


@router.put("/{project_id}", response_model=Project)
def update_existing_project(
    *,
    db: Session = Depends(get_db),
    project_id: int,
    project_update: ProjectUpdate,
    current_user: User = Depends(get_current_active_user),
) -> Any:
    # Check if user is in read-only mode
    is_read_only, reason = LimitChecker.is_read_only(
        db, current_user.id, current_user.subscription_tier
    )
    if is_read_only:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Account is in read-only mode. {reason}. Upgrade your plan to continue editing.",
        )

    project = get_project(db, project_id=project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )
    if project.owner_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions"
        )
    project = update_project(db, project, project_update)
    return project


@router.delete("/{project_id}")
def delete_existing_project(
    *,
    db: Session = Depends(get_db),
    project_id: int,
    current_user: User = Depends(get_current_active_user),
) -> Any:
    # Check if user is in read-only mode
    is_read_only, reason = LimitChecker.is_read_only(
        db, current_user.id, current_user.subscription_tier
    )
    if is_read_only:
        # Allow deletion even in read-only mode (helps users get back under limits)
        pass

    project = get_project(db, project_id=project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        )
    if project.owner_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions"
        )
    success = delete_project(db, project_id=project_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete project",
        )
    return {"message": "Project deleted successfully"}
