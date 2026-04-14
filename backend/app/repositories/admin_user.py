"""
Repository for admin user management operations.

Provides optimized queries for listing and viewing user data in the admin dashboard.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import structlog
from app.models.project import Project
from app.models.user import User
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


class AdminUserRepository:
    """
    Repository for admin user management operations.

    Provides specialized queries for:
    - Listing users with project counts
    - User details with associated projects
    - Platform user statistics
    """

    async def list_users_with_project_counts(
        self,
        db: AsyncSession,
        skip: int = 0,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """
        List users with their project counts for admin dashboard.

        Uses a subquery to efficiently count projects per user.

        Args:
            db: Async database session
            skip: Number of records to skip for pagination
            limit: Maximum number of records to return

        Returns:
            List of user dicts with project_count included
        """
        # Subquery for project counts per user
        project_counts = (
            select(
                Project.owner_id,
                func.count(Project.id).label("project_count"),
            )
            .group_by(Project.owner_id)
            .subquery()
        )

        # Main query with left join for users without projects
        query = (
            select(
                User,
                func.coalesce(project_counts.c.project_count, 0).label("project_count"),
            )
            .outerjoin(project_counts, User.id == project_counts.c.owner_id)  # type: ignore[arg-type]
            .order_by(User.created_at.desc())
            .offset(skip)
            .limit(limit)
        )

        result = await db.execute(query)
        rows = result.all()

        users_data = []
        for row in rows:
            user = row[0]
            project_count = row[1]

            users_data.append(
                {
                    "id": str(user.id),
                    "email": user.email,
                    "username": user.username,
                    "full_name": user.full_name,
                    "is_active": user.is_active,
                    "is_verified": user.is_verified,
                    "email_verified": user.is_verified,  # Alias for frontend
                    "created_at": (
                        user.created_at.isoformat() if user.created_at else None
                    ),
                    "project_count": project_count,
                    "subscription_tier": user.subscription_tier,
                    "last_login": None,  # Future: add last_login tracking
                }
            )

        logger.debug(
            "list_users_with_project_counts_completed",
            user_count=len(users_data),
            skip=skip,
            limit=limit,
        )

        return users_data

    async def get_user_with_projects(
        self,
        db: AsyncSession,
        user_id: uuid.UUID,
    ) -> dict[str, Any] | None:
        """
        Get detailed user information with their projects.

        Args:
            db: Async database session
            user_id: UUID of the user to retrieve

        Returns:
            User dict with projects list, or None if not found
        """
        # Get user
        user_result = await db.execute(
            select(User).where(User.id == user_id)  # type: ignore[arg-type]
        )
        user = user_result.scalar_one_or_none()

        if not user:
            return None

        # Get user's projects
        projects_result = await db.execute(
            select(Project)
            .where(Project.owner_id == user_id)
            .order_by(Project.created_at.desc())
        )
        projects = projects_result.scalars().all()

        return {
            "id": user.id,
            "email": user.email,
            "username": user.username,
            "full_name": user.full_name,
            "is_active": user.is_active,
            "is_superuser": user.is_superuser,
            "is_verified": user.is_verified,
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

    async def get_platform_stats(
        self,
        db: AsyncSession,
    ) -> dict[str, int]:
        """
        Get overall platform user and project statistics.

        Returns counts for:
        - Total users
        - New users (last 7 days)
        - New users (last 30 days)
        - Total projects
        - New projects (last 7 days)
        - Active users (created project in last 30 days)

        Args:
            db: Async database session

        Returns:
            Dict with platform statistics
        """
        now = datetime.now(UTC)
        week_ago = now - timedelta(days=7)
        month_ago = now - timedelta(days=30)

        # Total users
        total_users_result = await db.execute(
            select(func.count(User.id))  # type: ignore[arg-type]
        )
        total_users = total_users_result.scalar() or 0

        # New users in last 7 days
        new_users_week_result = await db.execute(
            select(func.count(User.id)).where(User.created_at >= week_ago)  # type: ignore[arg-type]
        )
        new_users_week = new_users_week_result.scalar() or 0

        # New users in last 30 days
        new_users_month_result = await db.execute(
            select(func.count(User.id)).where(User.created_at >= month_ago)  # type: ignore[arg-type]
        )
        new_users_month = new_users_month_result.scalar() or 0

        # Total projects
        total_projects_result = await db.execute(select(func.count(Project.id)))
        total_projects = total_projects_result.scalar() or 0

        # New projects in last 7 days
        projects_week_result = await db.execute(
            select(func.count(Project.id)).where(Project.created_at >= week_ago)
        )
        projects_week = projects_week_result.scalar() or 0

        # Active users (created project in last 30 days)
        active_users_result = await db.execute(
            select(func.count(func.distinct(Project.owner_id))).where(
                Project.created_at >= month_ago
            )
        )
        active_users = active_users_result.scalar() or 0

        return {
            "total_users": total_users,
            "new_users_week": new_users_week,
            "new_users_month": new_users_month,
            "total_projects": total_projects,
            "projects_week": projects_week,
            "active_users": active_users,
        }

    async def get_user_activity_metrics(
        self,
        db: AsyncSession,
    ) -> dict[str, Any]:
        """
        Get user activity metrics (DAU, WAU, MAU, retention).

        Args:
            db: Async database session

        Returns:
            Dict with activity metrics
        """
        now = datetime.now(UTC)
        day_ago = now - timedelta(days=1)
        week_ago = now - timedelta(days=7)
        month_ago = now - timedelta(days=30)

        # DAU: Users with project updates in last 24h
        dau_result = await db.execute(
            select(func.count(func.distinct(Project.owner_id))).where(
                Project.updated_at >= day_ago
            )
        )
        dau = dau_result.scalar() or 0

        # WAU: Users with project updates in last 7 days
        wau_result = await db.execute(
            select(func.count(func.distinct(Project.owner_id))).where(
                Project.updated_at >= week_ago
            )
        )
        wau = wau_result.scalar() or 0

        # MAU: Users with project updates in last 30 days
        mau_result = await db.execute(
            select(func.count(func.distinct(Project.owner_id))).where(
                Project.updated_at >= month_ago
            )
        )
        mau = mau_result.scalar() or 0

        # New users today/week/month
        new_users_today_result = await db.execute(
            select(func.count(User.id)).where(User.created_at >= day_ago)  # type: ignore[arg-type]
        )
        new_users_today = new_users_today_result.scalar() or 0

        new_users_week_result = await db.execute(
            select(func.count(User.id)).where(User.created_at >= week_ago)  # type: ignore[arg-type]
        )
        new_users_week = new_users_week_result.scalar() or 0

        new_users_month_result = await db.execute(
            select(func.count(User.id)).where(User.created_at >= month_ago)  # type: ignore[arg-type]
        )
        new_users_month = new_users_month_result.scalar() or 0

        # Active projects in last week
        active_projects_result = await db.execute(
            select(func.count(Project.id)).where(Project.updated_at >= week_ago)
        )
        active_projects_week = active_projects_result.scalar() or 0

        # 7-day retention calculation
        users_7days_old_result = await db.execute(
            select(func.count(User.id))  # type: ignore[arg-type]
            .where(User.created_at <= week_ago)
            .where(User.created_at >= month_ago)
        )
        users_7days_old = users_7days_old_result.scalar() or 1

        retained_7day_result = await db.execute(
            select(func.count(func.distinct(User.id)))
            .join(Project, User.id == Project.owner_id)  # type: ignore[arg-type]
            .where(User.created_at <= week_ago)
            .where(User.created_at >= month_ago)
            .where(Project.updated_at >= day_ago)
        )
        retained_7day_users = retained_7day_result.scalar() or 0
        retention_7day = (
            (retained_7day_users / users_7days_old * 100)
            if users_7days_old > 0
            else 0.0
        )

        # 30-day retention calculation
        users_30days_old_result = await db.execute(
            select(func.count(User.id)).where(User.created_at <= month_ago)  # type: ignore[arg-type]
        )
        users_30days_old = users_30days_old_result.scalar() or 1

        retained_30day_result = await db.execute(
            select(func.count(func.distinct(User.id)))
            .join(Project, User.id == Project.owner_id)  # type: ignore[arg-type]
            .where(User.created_at <= month_ago)
            .where(Project.updated_at >= day_ago)
        )
        retained_30day_users = retained_30day_result.scalar() or 0
        retention_30day = (
            (retained_30day_users / users_30days_old * 100)
            if users_30days_old > 0
            else 0.0
        )

        # Total users for conversion rate placeholder
        total_users_result = await db.execute(select(func.count(User.id)))  # type: ignore[arg-type]
        total_users = total_users_result.scalar() or 1

        return {
            "dau": dau,
            "wau": wau,
            "mau": mau,
            "retention_7day": retention_7day,
            "retention_30day": retention_30day,
            "avg_session_duration": 45,  # Placeholder
            "new_users_today": new_users_today,
            "new_users_week": new_users_week,
            "new_users_month": new_users_month,
            "active_projects_week": active_projects_week,
            "total_sessions_today": dau * 2,  # Rough estimate
            "conversion_rate": (total_users / max(total_users * 1.5, 1)) * 100,
        }

    async def check_admin_exists(
        self,
        db: AsyncSession,
    ) -> User | None:
        """
        Check if any admin user exists.

        Args:
            db: Async database session

        Returns:
            First admin user if exists, None otherwise
        """
        result = await db.execute(
            select(User).where(User.is_superuser == True)  # type: ignore[arg-type] # noqa: E712
        )
        return result.scalar_one_or_none()

    async def get_user_by_email(
        self,
        db: AsyncSession,
        email: str,
    ) -> User | None:
        """
        Get user by email address.

        Args:
            db: Async database session
            email: Email address to search

        Returns:
            User if found, None otherwise
        """
        result = await db.execute(
            select(User).where(User.email == email)  # type: ignore[arg-type]
        )
        return result.scalar_one_or_none()

    async def make_user_admin(
        self,
        db: AsyncSession,
        user: User,
    ) -> User:
        """
        Make a user an admin (superuser).

        Args:
            db: Async database session
            user: User to promote

        Returns:
            Updated user
        """
        user.is_superuser = True
        await db.commit()
        await db.refresh(user)

        logger.info("user_promoted_to_admin", user_email=user.email)

        return user


# Singleton instance
admin_user_repository = AdminUserRepository()
