"""Wrapper marketplace service — Phase 6.

Handles list/detail aggregation (avg_rating, install_count) and the
write-side operations for ratings, comments, and install events.

Aggregates are computed in SQL — never Python loops — because some
wrappers can accumulate thousands of ratings/installs and we don't want
to materialise them just to count.
"""

from __future__ import annotations

import hashlib
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import asc, delete, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.wrapper_entry import (
    WrapperComment,
    WrapperEntry,
    WrapperInstallEvent,
    WrapperRating,
)
from app.schemas.wrapper import (
    InstallEventCreate,
    WrapperAuthor,
    WrapperCommentCreate,
    WrapperCommentRead,
    WrapperEntryDetailRead,
    WrapperEntryRead,
    WrapperRatingCreate,
)

logger = structlog.get_logger(__name__)


def _hash_runner_id(runner_id: str) -> str:
    """sha256 of runner_id; the raw value is never persisted."""
    return hashlib.sha256(runner_id.encode("utf-8")).hexdigest()


def _entry_to_dict(
    entry: WrapperEntry,
    avg_rating: float | None,
    rating_count: int,
    install_count: int,
) -> dict[str, Any]:
    """Build the WrapperEntryRead-shaped dict from an ORM row + aggregates."""
    author_json = entry.author_json or {}
    return {
        "id": entry.id,
        "package": entry.package,
        "latest_version": entry.latest_version,
        "display_name": entry.display_name,
        "description": entry.description,
        "categories": list(entry.categories or []),
        "transport": entry.transport,
        "author": WrapperAuthor(
            name=str(author_json.get("name", "")),
            url=author_json.get("url"),
            email=author_json.get("email"),
        ),
        "repo": entry.repo,
        "license": entry.license,
        "verified": entry.verified,
        "registry_synced_at": entry.registry_synced_at,
        "created_at": entry.created_at,
        "updated_at": entry.updated_at,
        "avg_rating": float(avg_rating) if avg_rating is not None else None,
        "rating_count": rating_count,
        "install_count": install_count,
    }


def _build_aggregate_query(
    *,
    q: str | None,
    category: str | None,
    verified: bool | None,
    sort: str,
    limit: int,
    offset: int,
):
    """Construct the list query with aggregate columns and filters."""
    avg_stars = func.avg(WrapperRating.stars).label("avg_rating")
    rating_count = func.count(WrapperRating.id.distinct()).label("rating_count")
    install_count = func.count(WrapperInstallEvent.id.distinct()).label("install_count")

    stmt = (
        select(WrapperEntry, avg_stars, rating_count, install_count)
        .outerjoin(WrapperRating, WrapperRating.wrapper_id == WrapperEntry.id)
        .outerjoin(
            WrapperInstallEvent,
            WrapperInstallEvent.wrapper_id == WrapperEntry.id,
        )
        .group_by(WrapperEntry.id)
    )

    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(WrapperEntry.display_name).like(like),
                func.lower(WrapperEntry.description).like(like),
                func.lower(WrapperEntry.id).like(like),
                func.lower(WrapperEntry.package).like(like),
            )
        )

    if category:
        # JSONB containment: categories @> '["<category>"]'
        stmt = stmt.where(WrapperEntry.categories.contains([category]))

    if verified is not None:
        stmt = stmt.where(WrapperEntry.verified.is_(verified))

    if sort == "installs":
        stmt = stmt.order_by(desc("install_count"), asc(WrapperEntry.id))
    elif sort == "rating":
        stmt = stmt.order_by(
            desc("avg_rating").nulls_last(), desc("rating_count"), asc(WrapperEntry.id)
        )
    elif sort == "recent":
        stmt = stmt.order_by(desc(WrapperEntry.registry_synced_at))
    else:
        # Default: alphabetical by display name
        stmt = stmt.order_by(asc(WrapperEntry.display_name))

    return stmt.limit(limit).offset(offset)


class WrapperService:
    """Service-layer entry point for wrapper marketplace operations."""

    async def list_entries(
        self,
        db: AsyncSession,
        *,
        q: str | None = None,
        category: str | None = None,
        verified: bool | None = None,
        sort: str = "installs",
        limit: int = 50,
        offset: int = 0,
    ) -> list[WrapperEntryRead]:
        stmt = _build_aggregate_query(
            q=q,
            category=category,
            verified=verified,
            sort=sort,
            limit=limit,
            offset=offset,
        )
        result = await db.execute(stmt)
        rows = result.all()
        return [
            WrapperEntryRead.model_validate(_entry_to_dict(entry, avg, count, installs))
            for entry, avg, count, installs in rows
        ]

    async def get_entry(
        self,
        db: AsyncSession,
        wrapper_id: str,
    ) -> WrapperEntryDetailRead | None:
        stmt = (
            select(
                WrapperEntry,
                func.avg(WrapperRating.stars),
                func.count(WrapperRating.id.distinct()),
                func.count(WrapperInstallEvent.id.distinct()),
            )
            .outerjoin(WrapperRating, WrapperRating.wrapper_id == WrapperEntry.id)
            .outerjoin(
                WrapperInstallEvent,
                WrapperInstallEvent.wrapper_id == WrapperEntry.id,
            )
            .where(WrapperEntry.id == wrapper_id)
            .group_by(WrapperEntry.id)
        )
        result = await db.execute(stmt)
        row = result.first()
        if row is None:
            return None
        entry, avg_stars, rating_count, install_count = row

        comments_stmt = (
            select(WrapperComment)
            .where(WrapperComment.wrapper_id == wrapper_id)
            .where(WrapperComment.moderation_state != "hidden")
            .order_by(asc(WrapperComment.created_at))
            .limit(50)
        )
        comments_result = await db.execute(comments_stmt)
        comments = [
            WrapperCommentRead.model_validate(c)
            for c in comments_result.scalars().all()
        ]

        payload = _entry_to_dict(entry, avg_stars, rating_count, install_count)
        payload["comments"] = comments
        return WrapperEntryDetailRead.model_validate(payload)

    # -- Ratings -----------------------------------------------------------

    async def upsert_rating(
        self,
        db: AsyncSession,
        wrapper_id: str,
        user_id: UUID,
        data: WrapperRatingCreate,
    ) -> tuple[float | None, int]:
        """Insert or update the user's rating for ``wrapper_id``.

        Returns the post-write ``(avg_rating, rating_count)`` aggregate.
        """
        existing_stmt = select(WrapperRating).where(
            WrapperRating.wrapper_id == wrapper_id,
            WrapperRating.user_id == user_id,
        )
        existing = (await db.execute(existing_stmt)).scalar_one_or_none()
        if existing is None:
            db.add(
                WrapperRating(
                    wrapper_id=wrapper_id,
                    user_id=user_id,
                    stars=data.stars,
                )
            )
        else:
            existing.stars = data.stars

        await db.commit()
        return await self._rating_summary(db, wrapper_id)

    async def delete_rating(
        self,
        db: AsyncSession,
        wrapper_id: str,
        user_id: UUID,
    ) -> tuple[float | None, int]:
        await db.execute(
            delete(WrapperRating).where(
                WrapperRating.wrapper_id == wrapper_id,
                WrapperRating.user_id == user_id,
            )
        )
        await db.commit()
        return await self._rating_summary(db, wrapper_id)

    async def _rating_summary(
        self, db: AsyncSession, wrapper_id: str
    ) -> tuple[float | None, int]:
        stmt = select(
            func.avg(WrapperRating.stars),
            func.count(WrapperRating.id),
        ).where(WrapperRating.wrapper_id == wrapper_id)
        avg, count = (await db.execute(stmt)).one()
        return (float(avg) if avg is not None else None, int(count or 0))

    # -- Comments ----------------------------------------------------------

    async def create_comment(
        self,
        db: AsyncSession,
        wrapper_id: str,
        user_id: UUID,
        data: WrapperCommentCreate,
    ) -> WrapperCommentRead:
        # Optional: validate parent_id belongs to the same wrapper.
        if data.parent_id is not None:
            parent = await db.execute(
                select(WrapperComment).where(WrapperComment.id == data.parent_id)
            )
            parent_row = parent.scalar_one_or_none()
            if parent_row is None or parent_row.wrapper_id != wrapper_id:
                raise ValueError("parent_id does not belong to this wrapper")

        comment = WrapperComment(
            wrapper_id=wrapper_id,
            user_id=user_id,
            parent_id=data.parent_id,
            body=data.body,
        )
        db.add(comment)
        await db.commit()
        await db.refresh(comment)
        return WrapperCommentRead.model_validate(comment)

    # -- Install events ----------------------------------------------------

    async def record_install_event(
        self,
        db: AsyncSession,
        wrapper_id: str,
        data: InstallEventCreate,
    ) -> int:
        """Record an anonymous install ping and return the new install_count."""
        event = WrapperInstallEvent(
            wrapper_id=wrapper_id,
            runner_id_hash=_hash_runner_id(data.runner_id),
            version=data.version,
        )
        db.add(event)
        await db.commit()

        count_stmt = select(func.count(WrapperInstallEvent.id)).where(
            WrapperInstallEvent.wrapper_id == wrapper_id
        )
        return int((await db.execute(count_stmt)).scalar() or 0)

    # -- Existence check (used by router) ---------------------------------

    async def entry_exists(self, db: AsyncSession, wrapper_id: str) -> bool:
        stmt = select(func.count(WrapperEntry.id)).where(WrapperEntry.id == wrapper_id)
        return bool((await db.execute(stmt)).scalar())
