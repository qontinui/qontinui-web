"""Admin endpoints for analytics and user management."""

import logging
from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models.project import Project
from app.models.user import User

router = APIRouter()
logger = logging.getLogger(__name__)


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """Dependency to require admin/superuser access."""
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized. Admin access required.",
        )
    return current_user


@router.get("/stats")
async def get_admin_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> Any:
    """Get overall platform statistics."""

    # Total users
    total_users = db.query(func.count(User.id)).scalar()

    # Users registered in last 7 days
    week_ago = datetime.utcnow() - timedelta(days=7)
    new_users_week = (
        db.query(func.count(User.id)).filter(User.created_at >= week_ago).scalar()
    )

    # Users registered in last 30 days
    month_ago = datetime.utcnow() - timedelta(days=30)
    new_users_month = (
        db.query(func.count(User.id)).filter(User.created_at >= month_ago).scalar()
    )

    # Total projects
    total_projects = db.query(func.count(Project.id)).scalar()

    # Projects created in last 7 days
    projects_week = (
        db.query(func.count(Project.id)).filter(Project.created_at >= week_ago).scalar()
    )

    # Active users (created project in last 30 days)
    active_users = (
        db.query(func.count(func.distinct(Project.owner_id)))
        .filter(Project.created_at >= month_ago)
        .scalar()
    )

    return {
        "total_users": total_users or 0,
        "new_users_week": new_users_week or 0,
        "new_users_month": new_users_month or 0,
        "total_projects": total_projects or 0,
        "projects_week": projects_week or 0,
        "active_users": active_users or 0,
    }


@router.get("/users")
async def get_users_list(
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> Any:
    """Get list of users with basic info."""

    users = (
        db.query(User).order_by(User.created_at.desc()).offset(skip).limit(limit).all()
    )

    # Get project counts for each user
    user_data = []
    for user in users:
        project_count = (
            db.query(func.count(Project.id))
            .filter(Project.owner_id == user.id)
            .scalar()
        )

        user_data.append(
            {
                "id": user.id,
                "email": user.email,
                "username": user.username,
                "full_name": user.full_name,
                "is_active": user.is_active,
                "email_verified": user.email_verified,
                "created_at": user.created_at,
                "project_count": project_count or 0,
            }
        )

    return user_data


@router.get("/users/{user_id}")
async def get_user_details(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> Any:
    """Get detailed info about a specific user."""

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    # Get user's projects
    projects = (
        db.query(Project)
        .filter(Project.owner_id == user_id)
        .order_by(Project.created_at.desc())
        .all()
    )

    return {
        "id": user.id,
        "email": user.email,
        "username": user.username,
        "full_name": user.full_name,
        "is_active": user.is_active,
        "is_superuser": user.is_superuser,
        "email_verified": user.email_verified,
        "created_at": user.created_at,
        "updated_at": user.updated_at,
        "projects": [
            {
                "id": p.id,
                "name": p.name,
                "description": p.description,
                "created_at": p.created_at,
                "updated_at": p.updated_at,
            }
            for p in projects
        ],
    }
