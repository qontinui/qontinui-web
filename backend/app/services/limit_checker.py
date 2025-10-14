"""Service to check subscription limits and enforce read-only mode"""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project
from app.models.storage_usage import StorageUsage
from app.models.subscription import Subscription
from app.services.stripe_service import StripeService


class LimitChecker:
    """Check if user has exceeded their subscription limits"""

    @staticmethod
    async def get_user_usage(db: AsyncSession, user_id: int) -> dict:
        """
        Get current usage for a user.

        Returns:
            Dict with current usage stats
        """
        # Count projects
        result = await db.execute(
            select(func.count(Project.id)).filter(Project.owner_id == user_id)
        )
        project_count = result.scalar()

        # Count images (assuming images are stored in configuration JSON)
        # For now, we'll just count storage files
        result = await db.execute(
            select(
                func.count(StorageUsage.id).label("file_count"),
                func.sum(StorageUsage.file_size).label("total_bytes"),
            ).filter(StorageUsage.user_id == user_id)
        )
        storage_result = result.one_or_none()

        return {
            "project_count": project_count or 0,
            "file_count": storage_result.file_count if storage_result else 0,
            "storage_bytes": int(storage_result.total_bytes or 0)
            if storage_result
            else 0,
            "storage_mb": round((storage_result.total_bytes or 0) / (1024 * 1024), 2)
            if storage_result
            else 0.0,
        }

    @staticmethod
    async def check_can_create_project(
        db: AsyncSession, user_id: int, subscription_tier: str
    ) -> tuple[bool, str]:
        """
        Check if user can create a new project.

        Returns:
            Tuple of (can_create: bool, reason: str)
        """
        usage = await LimitChecker.get_user_usage(db, user_id)
        limits = StripeService.get_tier_limits(subscription_tier)

        max_configs = limits["max_configs"]

        # -1 means unlimited
        if max_configs == -1:
            return True, ""

        if usage["project_count"] >= max_configs:
            return (
                False,
                f"Project limit reached ({usage['project_count']}/{max_configs}). "
                f"Upgrade your plan to create more projects.",
            )

        return True, ""

    @staticmethod
    async def check_can_upload_file(
        db: AsyncSession, user_id: int, subscription_tier: str, file_size_bytes: int
    ) -> tuple[bool, str]:
        """
        Check if user can upload a file.

        Returns:
            Tuple of (can_upload: bool, reason: str)
        """
        usage = await LimitChecker.get_user_usage(db, user_id)
        limits = StripeService.get_tier_limits(subscription_tier)

        max_storage_bytes = limits["max_storage_mb"] * 1024 * 1024
        new_total = usage["storage_bytes"] + file_size_bytes

        if new_total > max_storage_bytes:
            return (
                False,
                f"Storage limit exceeded. Using {usage['storage_mb']:.2f}MB of "
                f"{limits['max_storage_mb']}MB. Upgrade your plan for more storage.",
            )

        return True, ""

    @staticmethod
    async def is_read_only(
        db: AsyncSession, user_id: int, subscription_tier: str
    ) -> tuple[bool, str]:
        """
        Check if user should be in read-only mode.

        Returns:
            Tuple of (is_read_only: bool, reason: str)

        User is read-only if they've downgraded/canceled and are over limits.
        """
        # If user is on a paid plan and active, they're not read-only
        result = await db.execute(select(Subscription).filter_by(user_id=user_id))
        subscription = result.scalar_one_or_none()

        if (
            subscription
            and subscription.tier != "free"
            and subscription.status == "active"
        ):
            # Paid and active = can edit
            return False, ""

        # Free tier or inactive subscription - check if over limits
        usage = await LimitChecker.get_user_usage(db, user_id)
        limits = StripeService.get_tier_limits(subscription_tier)

        over_project_limit = (
            limits["max_configs"] != -1
            and usage["project_count"] > limits["max_configs"]
        )
        over_storage_limit = usage["storage_bytes"] > (
            limits["max_storage_mb"] * 1024 * 1024
        )

        if over_project_limit or over_storage_limit:
            reasons = []
            if over_project_limit:
                reasons.append(
                    f"You have {usage['project_count']} projects but your {subscription_tier} "
                    f"plan allows {limits['max_configs']}"
                )
            if over_storage_limit:
                reasons.append(
                    f"You're using {usage['storage_mb']:.2f}MB but your {subscription_tier} "
                    f"plan allows {limits['max_storage_mb']}MB"
                )

            return True, " | ".join(reasons)

        return False, ""

    @staticmethod
    async def get_usage_summary(
        db: AsyncSession, user_id: int, subscription_tier: str
    ) -> dict:
        """
        Get a complete usage summary with limits.

        Returns:
            Dict with usage, limits, and percentages
        """
        usage = await LimitChecker.get_user_usage(db, user_id)
        limits = StripeService.get_tier_limits(subscription_tier)

        max_configs = limits["max_configs"]
        max_storage_mb = limits["max_storage_mb"]

        return {
            "usage": usage,
            "limits": limits,
            "project_percentage": (
                round((usage["project_count"] / max_configs) * 100, 1)
                if max_configs != -1
                else 0
            ),
            "storage_percentage": round(
                (usage["storage_mb"] / max_storage_mb) * 100, 1
            ),
            "over_limits": {
                "projects": max_configs != -1 and usage["project_count"] > max_configs,
                "storage": usage["storage_mb"] > max_storage_mb,
            },
        }
