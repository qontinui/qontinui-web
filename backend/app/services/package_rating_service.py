"""
Package rating service.

Provides business logic for rating and reviewing code packages.
Extracted from crud/code_package.py for SRP compliance.
"""

from datetime import UTC, datetime
from uuid import UUID

import structlog
from sqlalchemy import and_, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.code_package import CodePackage, PackageRating

logger = structlog.get_logger(__name__)


class PackageRatingService:
    """
    Service for managing package ratings and reviews.

    Handles:
    - Creating and updating ratings
    - Calculating average ratings
    - Retrieving ratings with pagination
    """

    async def rate(
        self,
        db: AsyncSession,
        user_id: UUID,
        package_id: int,
        rating: int,
        review_text: str | None = None,
    ) -> PackageRating:
        """
        Rate a package (create or update rating).

        If the user has already rated the package, updates the existing rating.
        Automatically recalculates the package's average rating.

        Args:
            db: Database session
            user_id: User submitting the rating
            package_id: Package being rated
            rating: Rating value (1-5)
            review_text: Optional review text

        Returns:
            Rating record

        Raises:
            ValueError: If rating is not between 1 and 5
        """
        if not 1 <= rating <= 5:
            raise ValueError("Rating must be between 1 and 5")

        # Check if user already rated this package
        existing = await self._get_user_rating(db, user_id, package_id)

        if existing:
            result = await self._update_rating(db, existing, rating, review_text)
        else:
            result = await self._create_rating(
                db, user_id, package_id, rating, review_text
            )

        # Recalculate average rating
        await self._update_average_rating(db, package_id)

        return result

    async def get_package_ratings(
        self,
        db: AsyncSession,
        package_id: int,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[PackageRating], int]:
        """
        Get ratings for a package with pagination.

        Args:
            db: Database session
            package_id: Package ID
            limit: Maximum number of results
            offset: Pagination offset

        Returns:
            Tuple of (ratings, total_count)
        """
        # Get total count
        count_result = await db.execute(
            select(func.count())
            .select_from(PackageRating)
            .where(PackageRating.package_id == package_id)
        )
        total = count_result.scalar() or 0

        # Get ratings
        result = await db.execute(
            select(PackageRating)
            .where(PackageRating.package_id == package_id)
            .options(selectinload(PackageRating.user))
            .order_by(desc(PackageRating.created_at))
            .offset(offset)
            .limit(limit)
        )
        ratings = list(result.scalars().all())

        return ratings, total

    async def get_user_rating(
        self,
        db: AsyncSession,
        user_id: UUID,
        package_id: int,
    ) -> PackageRating | None:
        """
        Get a user's rating for a specific package.

        Args:
            db: Database session
            user_id: User ID
            package_id: Package ID

        Returns:
            Rating record or None
        """
        return await self._get_user_rating(db, user_id, package_id)

    async def delete_rating(
        self,
        db: AsyncSession,
        user_id: UUID,
        package_id: int,
    ) -> bool:
        """
        Delete a user's rating for a package.

        Args:
            db: Database session
            user_id: User ID
            package_id: Package ID

        Returns:
            True if deleted, False if not found
        """
        rating = await self._get_user_rating(db, user_id, package_id)
        if not rating:
            return False

        await db.delete(rating)
        await db.commit()

        # Recalculate average
        await self._update_average_rating(db, package_id)

        logger.info(
            "rating_deleted",
            user_id=str(user_id),
            package_id=package_id,
        )
        return True

    async def get_rating_summary(
        self,
        db: AsyncSession,
        package_id: int,
    ) -> dict:
        """
        Get rating summary for a package.

        Args:
            db: Database session
            package_id: Package ID

        Returns:
            Dictionary with average, count, and distribution
        """
        # Get rating distribution
        result = await db.execute(
            select(PackageRating.rating, func.count(PackageRating.id))
            .where(PackageRating.package_id == package_id)
            .group_by(PackageRating.rating)
        )
        distribution = dict.fromkeys(range(1, 6), 0)
        for rating_value, count in result.all():
            distribution[rating_value] = count

        total = sum(distribution.values())
        avg = sum(k * v for k, v in distribution.items()) / total if total > 0 else 0.0

        return {
            "average": round(avg, 2),
            "total": total,
            "distribution": distribution,
        }

    async def _get_user_rating(
        self,
        db: AsyncSession,
        user_id: UUID,
        package_id: int,
    ) -> PackageRating | None:
        """Get existing rating by user for package."""
        result = await db.execute(
            select(PackageRating).where(
                and_(
                    PackageRating.user_id == user_id,
                    PackageRating.package_id == package_id,
                )
            )
        )
        return result.scalar_one_or_none()

    async def _create_rating(
        self,
        db: AsyncSession,
        user_id: UUID,
        package_id: int,
        rating: int,
        review_text: str | None,
    ) -> PackageRating:
        """Create a new rating."""
        new_rating = PackageRating(
            user_id=user_id,
            package_id=package_id,
            rating=rating,
            review_text=review_text,
        )
        db.add(new_rating)
        await db.commit()
        await db.refresh(new_rating)

        logger.info(
            "rating_created",
            rating_id=new_rating.id,
            user_id=str(user_id),
            package_id=package_id,
            rating=rating,
        )
        return new_rating

    async def _update_rating(
        self,
        db: AsyncSession,
        rating: PackageRating,
        new_rating: int,
        review_text: str | None,
    ) -> PackageRating:
        """Update an existing rating."""
        rating.rating = new_rating  # type: ignore[assignment]
        rating.review_text = review_text  # type: ignore[assignment]
        rating.updated_at = datetime.now(UTC)  # type: ignore[assignment]

        await db.commit()
        await db.refresh(rating)

        logger.info(
            "rating_updated",
            rating_id=rating.id,
            package_id=rating.package_id,
            rating=new_rating,
        )
        return rating

    async def _update_average_rating(
        self,
        db: AsyncSession,
        package_id: int,
    ) -> None:
        """Recalculate and update the package's average rating."""
        result = await db.execute(
            select(func.avg(PackageRating.rating), func.count(PackageRating.id)).where(
                PackageRating.package_id == package_id
            )
        )
        row = result.one()
        avg_rating = float(row[0]) if row[0] else 0.0
        rating_count = row[1] or 0

        # Update package
        package_result = await db.execute(
            select(CodePackage).where(CodePackage.id == package_id)
        )
        package = package_result.scalar_one_or_none()
        if package:
            package.avg_rating = round(avg_rating, 2)  # type: ignore[arg-type, assignment]
            package.rating_count = rating_count  # type: ignore[assignment]
            await db.commit()


# Singleton instance for dependency injection
package_rating_service = PackageRatingService()
