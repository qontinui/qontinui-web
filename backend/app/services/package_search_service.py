"""
Package search and discovery service.

Provides business logic for searching, filtering, and discovering code packages.
Extracted from crud/code_package.py for SRP compliance.
"""

from datetime import datetime, timedelta

from sqlalchemy import and_, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.code_package import CodePackage


class PackageSearchService:
    """
    Service for searching and discovering code packages.

    Handles:
    - Full-text search across package name, description, slug
    - Category and tag filtering
    - Verification and rating filtering
    - Popular and trending package discovery
    """

    async def search(
        self,
        db: AsyncSession,
        query: str | None = None,
        category_id: int | None = None,
        tags: list[str] | None = None,
        verified_only: bool = False,
        min_rating: float | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[CodePackage], int]:
        """
        Search packages with filters and pagination.

        Args:
            db: Database session
            query: Text search query (searches name, description, slug)
            category_id: Category ID filter
            tags: List of tags to filter by (AND logic)
            verified_only: Only return verified packages
            min_rating: Minimum average rating
            limit: Maximum number of results
            offset: Pagination offset

        Returns:
            Tuple of (packages, total_count)
        """
        conditions = self._build_search_conditions(
            query=query,
            category_id=category_id,
            tags=tags,
            verified_only=verified_only,
            min_rating=min_rating,
        )

        # Get total count
        total = await self._count_matching(db, conditions)

        # Get paginated results
        packages = await self._fetch_packages(
            db, conditions, limit=limit, offset=offset
        )

        return packages, total

    async def get_popular(
        self,
        db: AsyncSession,
        limit: int = 20,
    ) -> list[CodePackage]:
        """
        Get most popular packages by download count.

        Args:
            db: Database session
            limit: Maximum number of packages to return

        Returns:
            List of popular packages ordered by downloads
        """
        result = await db.execute(
            select(CodePackage)
            .options(selectinload(CodePackage.category))
            .order_by(desc(CodePackage.total_downloads))
            .limit(limit)
        )
        return list(result.scalars().all())

    async def get_trending(
        self,
        db: AsyncSession,
        days: int = 7,
        limit: int = 20,
    ) -> list[CodePackage]:
        """
        Get trending packages (high ratings + recent activity).

        Trending is defined as packages created within the time window,
        ordered by rating and download count.

        Args:
            db: Database session
            days: Number of days to consider for trending window
            limit: Maximum number of packages to return

        Returns:
            List of trending packages
        """
        cutoff_date = datetime.utcnow() - timedelta(days=days)

        result = await db.execute(
            select(CodePackage)
            .options(selectinload(CodePackage.category))
            .where(CodePackage.created_at >= cutoff_date)
            .order_by(
                desc(CodePackage.avg_rating),
                desc(CodePackage.total_downloads),
            )
            .limit(limit)
        )
        return list(result.scalars().all())

    async def get_by_category(
        self,
        db: AsyncSession,
        category_id: int,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[CodePackage], int]:
        """
        Get packages in a specific category.

        Args:
            db: Database session
            category_id: Category ID
            limit: Maximum number of results
            offset: Pagination offset

        Returns:
            Tuple of (packages, total_count)
        """
        return await self.search(
            db, category_id=category_id, limit=limit, offset=offset
        )

    async def get_by_tag(
        self,
        db: AsyncSession,
        tag: str,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[CodePackage], int]:
        """
        Get packages with a specific tag.

        Args:
            db: Database session
            tag: Tag to search for
            limit: Maximum number of results
            offset: Pagination offset

        Returns:
            Tuple of (packages, total_count)
        """
        return await self.search(db, tags=[tag], limit=limit, offset=offset)

    def _build_search_conditions(
        self,
        query: str | None = None,
        category_id: int | None = None,
        tags: list[str] | None = None,
        verified_only: bool = False,
        min_rating: float | None = None,
    ) -> list:
        """Build SQLAlchemy filter conditions from search parameters."""
        conditions = []

        if query:
            search_term = f"%{query.lower()}%"
            conditions.append(
                or_(
                    CodePackage.name.ilike(search_term),
                    CodePackage.description.ilike(search_term),
                    CodePackage.slug.ilike(search_term),
                )
            )

        if category_id:
            conditions.append(CodePackage.category_id == category_id)

        if tags:
            for tag in tags:
                conditions.append(CodePackage.tags.contains([tag.lower()]))

        if verified_only:
            conditions.append(CodePackage.is_verified.is_(True))

        if min_rating is not None:
            conditions.append(CodePackage.avg_rating >= min_rating)

        return conditions

    async def _count_matching(
        self,
        db: AsyncSession,
        conditions: list,
    ) -> int:
        """Count packages matching the conditions."""
        count_query = select(func.count()).select_from(CodePackage)
        if conditions:
            count_query = count_query.where(and_(*conditions))

        result = await db.execute(count_query)
        return result.scalar() or 0

    async def _fetch_packages(
        self,
        db: AsyncSession,
        conditions: list,
        limit: int = 20,
        offset: int = 0,
    ) -> list[CodePackage]:
        """Fetch packages matching the conditions with pagination."""
        query = select(CodePackage).options(selectinload(CodePackage.category))

        if conditions:
            query = query.where(and_(*conditions))

        query = (
            query.order_by(desc(CodePackage.total_downloads))
            .offset(offset)
            .limit(limit)
        )

        result = await db.execute(query)
        return list(result.scalars().all())


# Singleton instance for dependency injection
package_search_service = PackageSearchService()
