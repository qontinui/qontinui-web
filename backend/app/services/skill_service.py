"""
Skill service — CRUD and business logic for user-created skills.

Skills are parameterized step templates. Built-in skills are embedded in the
runner; this service manages user-created skills stored in PostgreSQL.
"""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from app.models.skill import Skill
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

# =============================================================================
# Pydantic Schemas
# =============================================================================


class SkillCreate(BaseModel):
    """Request to create a skill."""

    name: str
    slug: str
    description: str = ""
    category: str = "custom"
    tags: list[str] = Field(default_factory=list)
    icon: str = "puzzle"
    color: str = "gray"
    allowed_phases: list[str] = Field(default_factory=lambda: ["setup"])
    parameters: list[dict[str, Any]] = Field(default_factory=list)
    template: dict[str, Any]
    organization_id: str | None = None
    version: str = "1.0.0"
    author: dict[str, Any] | None = None
    depends_on: list[str] = Field(default_factory=list)
    forked_from: str | None = None


class SkillUpdate(BaseModel):
    """Request to update a skill. All fields optional."""

    name: str | None = None
    slug: str | None = None
    description: str | None = None
    category: str | None = None
    tags: list[str] | None = None
    icon: str | None = None
    color: str | None = None
    allowed_phases: list[str] | None = None
    parameters: list[dict[str, Any]] | None = None
    template: dict[str, Any] | None = None
    version: str | None = None
    author: dict[str, Any] | None = None
    depends_on: list[str] | None = None


class SkillResponse(BaseModel):
    """Response for a skill."""

    id: str
    created_by_user_id: str | None = None
    name: str
    slug: str
    description: str
    category: str
    tags: list[str]
    icon: str
    color: str
    allowed_phases: list[str]
    parameters: list[dict[str, Any]]
    template: dict[str, Any]
    source: str = "user"
    organization_id: str | None = None
    is_shared: bool = False
    version: str = "1.0.0"
    author: dict[str, Any] | None = None
    checksum: str | None = None
    depends_on: list[str] = Field(default_factory=list)
    usage_count: int = 0
    approval_status: str | None = None
    forked_from: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class Pagination(BaseModel):
    total: int
    limit: int
    offset: int
    has_more: bool


class SkillListResponse(BaseModel):
    items: list[SkillResponse]
    pagination: Pagination


# =============================================================================
# Helpers
# =============================================================================


def _model_to_response(skill: Skill) -> SkillResponse:
    return SkillResponse(
        id=str(skill.id),
        created_by_user_id=(
            str(skill.created_by_user_id) if skill.created_by_user_id else None
        ),
        name=skill.name,
        slug=skill.slug,
        description=skill.description or "",
        category=skill.category or "custom",
        tags=skill.tags or [],
        icon=skill.icon or "puzzle",
        color=skill.color or "gray",
        allowed_phases=skill.allowed_phases or ["setup"],
        parameters=skill.parameters or [],
        template=skill.template,
        source="user",
        organization_id=str(skill.organization_id) if skill.organization_id else None,
        is_shared=skill.is_shared if skill.is_shared is not None else False,
        version=skill.version or "1.0.0",
        author=skill.author,
        checksum=skill.checksum,
        depends_on=skill.depends_on or [],
        usage_count=skill.usage_count or 0,
        approval_status=skill.approval_status,
        forked_from=str(skill.forked_from) if skill.forked_from else None,
        created_at=skill.created_at,
        updated_at=skill.updated_at,
    )


# =============================================================================
# Service
# =============================================================================


class SkillService:
    """Service for skill CRUD operations."""

    async def list_skills(
        self,
        db: AsyncSession,
        user_id: UUID | None = None,
        category: str | None = None,
        offset: int = 0,
        limit: int = 100,
    ) -> SkillListResponse:
        query = select(Skill)

        if user_id:
            query = query.where(Skill.created_by_user_id == user_id)
        if category:
            query = query.where(Skill.category == category)

        count_query = select(func.count()).select_from(query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar() or 0

        query = query.order_by(Skill.updated_at.desc()).offset(offset).limit(limit)
        result = await db.execute(query)
        skills = list(result.scalars().all())

        return SkillListResponse(
            items=[_model_to_response(s) for s in skills],
            pagination=Pagination(
                total=total,
                limit=limit,
                offset=offset,
                has_more=(offset + limit) < total,
            ),
        )

    async def list_marketplace_skills(
        self,
        db: AsyncSession,
        category: str | None = None,
        search: str | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> SkillListResponse:
        """List all shared and approved skills across organizations."""
        query = select(Skill).where(
            Skill.is_shared == True,  # noqa: E712
            # Only approved skills (or skills without approval requirement)
            or_(
                Skill.approval_status == "approved",
                Skill.approval_status.is_(None),
            ),
        )

        if category:
            query = query.where(Skill.category == category)

        if search:
            pattern = f"%{search}%"
            query = query.where(
                or_(
                    Skill.name.ilike(pattern),
                    Skill.description.ilike(pattern),
                    Skill.slug.ilike(pattern),
                )
            )

        count_query = select(func.count()).select_from(query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar() or 0

        query = (
            query.order_by(Skill.usage_count.desc(), Skill.updated_at.desc())
            .offset(offset)
            .limit(limit)
        )
        result = await db.execute(query)
        skills = list(result.scalars().all())

        return SkillListResponse(
            items=[_model_to_response(s) for s in skills],
            pagination=Pagination(
                total=total,
                limit=limit,
                offset=offset,
                has_more=(offset + limit) < total,
            ),
        )

    async def get_skill(self, db: AsyncSession, skill_id: UUID) -> SkillResponse:
        query = select(Skill).where(Skill.id == skill_id)
        result = await db.execute(query)
        skill = result.scalar_one_or_none()
        if not skill:
            raise ValueError(f"Skill not found: {skill_id}")
        return _model_to_response(skill)

    async def create_skill(
        self,
        db: AsyncSession,
        data: SkillCreate,
        user_id: UUID,
    ) -> SkillResponse:
        skill = Skill(
            name=data.name,
            slug=data.slug,
            description=data.description,
            category=data.category,
            tags=data.tags,
            icon=data.icon,
            color=data.color,
            allowed_phases=data.allowed_phases,
            parameters=data.parameters,
            template=data.template,
            created_by_user_id=user_id,
            organization_id=data.organization_id,
            version=data.version,
            author=data.author,
            depends_on=data.depends_on,
            forked_from=data.forked_from,
        )
        db.add(skill)
        await db.commit()
        await db.refresh(skill)
        return _model_to_response(skill)

    async def update_skill(
        self,
        db: AsyncSession,
        skill_id: UUID,
        data: SkillUpdate,
    ) -> SkillResponse:
        query = select(Skill).where(Skill.id == skill_id)
        result = await db.execute(query)
        skill = result.scalar_one_or_none()
        if not skill:
            raise ValueError(f"Skill not found: {skill_id}")

        update_data = data.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(skill, key, value)

        skill.updated_at = datetime.now(UTC)
        await db.commit()
        await db.refresh(skill)
        return _model_to_response(skill)

    async def delete_skill(self, db: AsyncSession, skill_id: UUID) -> bool:
        query = select(Skill).where(Skill.id == skill_id)
        result = await db.execute(query)
        skill = result.scalar_one_or_none()
        if not skill:
            return False

        await db.delete(skill)
        await db.commit()
        return True

    async def search_skills(
        self,
        db: AsyncSession,
        query_text: str,
        user_id: UUID | None = None,
    ) -> list[SkillResponse]:
        query = select(Skill)
        if user_id:
            query = query.where(Skill.created_by_user_id == user_id)

        if query_text:
            pattern = f"%{query_text}%"
            query = query.where(
                Skill.name.ilike(pattern)
                | Skill.description.ilike(pattern)
                | Skill.slug.ilike(pattern)
            )

        query = query.order_by(Skill.updated_at.desc()).limit(50)
        result = await db.execute(query)
        skills = list(result.scalars().all())
        return [_model_to_response(s) for s in skills]

    async def share_skill(
        self,
        db: AsyncSession,
        skill_id: UUID,
        user_id: UUID,
        is_shared: bool,
    ) -> SkillResponse:
        query = select(Skill).where(
            Skill.id == skill_id,
            Skill.created_by_user_id == user_id,
        )
        result = await db.execute(query)
        skill = result.scalar_one_or_none()
        if not skill:
            raise ValueError(f"Skill not found or not owned by user: {skill_id}")

        skill.is_shared = is_shared
        skill.updated_at = datetime.now(UTC)
        await db.commit()
        await db.refresh(skill)
        return _model_to_response(skill)

    async def list_org_skills(
        self,
        db: AsyncSession,
        organization_id: UUID,
        category: str | None = None,
        offset: int = 0,
        limit: int = 100,
    ) -> SkillListResponse:
        query = select(Skill).where(
            Skill.organization_id == organization_id,
            Skill.is_shared == True,  # noqa: E712
        )

        if category:
            query = query.where(Skill.category == category)

        count_query = select(func.count()).select_from(query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar() or 0

        query = query.order_by(Skill.updated_at.desc()).offset(offset).limit(limit)
        result = await db.execute(query)
        skills = list(result.scalars().all())

        return SkillListResponse(
            items=[_model_to_response(s) for s in skills],
            pagination=Pagination(
                total=total,
                limit=limit,
                offset=offset,
                has_more=(offset + limit) < total,
            ),
        )

    async def approve_skill(
        self,
        db: AsyncSession,
        skill_id: UUID,
        status: str,
    ) -> SkillResponse:
        query = select(Skill).where(Skill.id == skill_id)
        result = await db.execute(query)
        skill = result.scalar_one_or_none()
        if not skill:
            raise ValueError(f"Skill not found: {skill_id}")

        skill.approval_status = status
        skill.updated_at = datetime.now(UTC)
        await db.commit()
        await db.refresh(skill)
        return _model_to_response(skill)

    async def fork_skill(
        self,
        db: AsyncSession,
        skill_id: UUID,
        user_id: UUID,
        new_name: str | None = None,
    ) -> SkillResponse:
        query = select(Skill).where(Skill.id == skill_id)
        result = await db.execute(query)
        original = result.scalar_one_or_none()
        if not original:
            raise ValueError(f"Skill not found: {skill_id}")

        import uuid as uuid_mod

        fork_suffix = str(uuid_mod.uuid4())[:8]
        fork_name = new_name or f"{original.name} (fork)"
        fork_slug = f"{original.slug}-fork-{fork_suffix}"

        forked = Skill(
            name=fork_name,
            slug=fork_slug,
            description=original.description,
            category=original.category,
            tags=original.tags or [],
            icon=original.icon,
            color=original.color,
            allowed_phases=original.allowed_phases,
            parameters=original.parameters,
            template=original.template,
            created_by_user_id=user_id,
            organization_id=original.organization_id,
            version="1.0.0",
            author=original.author,
            depends_on=original.depends_on or [],
            forked_from=str(skill_id),
        )
        db.add(forked)
        await db.commit()
        await db.refresh(forked)
        return _model_to_response(forked)

    async def increment_usage(
        self,
        db: AsyncSession,
        skill_id: UUID,
    ) -> dict:
        query = select(Skill).where(Skill.id == skill_id)
        result = await db.execute(query)
        skill = result.scalar_one_or_none()
        if not skill:
            raise ValueError(f"Skill not found: {skill_id}")

        skill.usage_count = (skill.usage_count or 0) + 1
        skill.updated_at = datetime.now(UTC)
        await db.commit()
        await db.refresh(skill)
        return {"id": str(skill.id), "usage_count": skill.usage_count}
