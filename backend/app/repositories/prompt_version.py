"""
Repository for prompt template version database operations.

Handles query logic for prompt template versions, encapsulating database access
and providing reusable methods for CRUD, listing, diffing, and version management.
"""

import difflib
import hashlib
from uuid import UUID

import structlog
from app.models.ai_prompt import AIPromptTemplate
from app.models.prompt_template_version import PromptTemplateVersion
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


class PromptVersionRepository:
    """Repository for prompt template version database operations."""

    @staticmethod
    async def create_version(
        db: AsyncSession,
        data: dict,
    ) -> PromptTemplateVersion:
        """
        Create a new prompt template version.

        Auto-computes content_hash (SHA256 of prompt_content) and
        auto-increments version_number (SELECT MAX + 1). Also updates
        the parent template's current_version.

        Args:
            db: Database session
            data: Dictionary with version fields including:
                - template_id, prompt_content, parameters_json,
                  change_description, created_by

        Returns:
            Created PromptTemplateVersion instance
        """
        template_id = data["template_id"]

        # Auto-compute content hash
        content_hash = hashlib.sha256(
            data["prompt_content"].encode("utf-8")
        ).hexdigest()

        # Auto-increment version number
        max_query = select(func.max(PromptTemplateVersion.version_number)).where(
            PromptTemplateVersion.template_id == template_id
        )
        result = await db.execute(max_query)
        max_version = result.scalar() or 0
        next_version = max_version + 1

        version = PromptTemplateVersion(
            template_id=template_id,
            version_number=next_version,
            prompt_content=data["prompt_content"],
            parameters_json=data.get("parameters_json"),
            content_hash=content_hash,
            change_description=data.get("change_description"),
            created_by=data.get("created_by"),
        )
        db.add(version)

        # Update parent template's current_version
        template_query = select(AIPromptTemplate).where(
            AIPromptTemplate.id == template_id
        )
        template_result = await db.execute(template_query)
        template = template_result.scalar_one_or_none()
        if template:
            template.current_version = next_version  # type: ignore[assignment]

        try:
            await db.flush()
        except IntegrityError:
            await db.rollback()
            # Re-read max version after conflict
            result = await db.execute(max_query)
            max_version = result.scalar() or 0
            next_version = max_version + 1
            version.version_number = next_version
            db.add(version)
            # Re-fetch and update template after rollback
            template_result = await db.execute(template_query)
            template = template_result.scalar_one_or_none()
            if template:
                template.current_version = next_version  # type: ignore[assignment]
            await db.flush()

        await db.commit()
        await db.refresh(version)

        logger.info(
            "prompt_version_created",
            version_id=str(version.id),
            template_id=template_id,
            version_number=next_version,
        )

        return version

    @staticmethod
    async def get_version(
        db: AsyncSession,
        template_id: str,
        version_number: int,
    ) -> PromptTemplateVersion | None:
        """
        Get a specific version of a prompt template.

        Args:
            db: Database session
            template_id: ID of the parent prompt template
            version_number: Version number to retrieve

        Returns:
            PromptTemplateVersion or None if not found
        """
        query = select(PromptTemplateVersion).where(
            PromptTemplateVersion.template_id == template_id,
            PromptTemplateVersion.version_number == version_number,
        )
        result = await db.execute(query)
        return result.scalar_one_or_none()

    @staticmethod
    async def list_versions(
        db: AsyncSession,
        template_id: str,
        skip: int = 0,
        limit: int = 50,
    ) -> tuple[list[PromptTemplateVersion], int]:
        """
        List all versions for a prompt template with pagination.

        Args:
            db: Database session
            template_id: ID of the parent prompt template
            skip: Number of records to skip
            limit: Maximum number of records to return

        Returns:
            Tuple of (list of PromptTemplateVersion, total count)
        """
        base_query = select(PromptTemplateVersion).where(
            PromptTemplateVersion.template_id == template_id
        )

        # Get total count
        count_query = select(func.count()).select_from(base_query.subquery())
        total_result = await db.execute(count_query)
        total = total_result.scalar() or 0

        # Order by version number descending, apply pagination
        query = (
            base_query.order_by(PromptTemplateVersion.version_number.desc())
            .offset(skip)
            .limit(limit)
        )

        result = await db.execute(query)
        versions = list(result.scalars().all())

        logger.debug(
            "list_versions_executed",
            template_id=template_id,
            total=total,
        )

        return versions, total

    @staticmethod
    async def get_latest_version(
        db: AsyncSession,
        template_id: str,
    ) -> PromptTemplateVersion | None:
        """
        Get the latest (highest version_number) version for a template.

        Args:
            db: Database session
            template_id: ID of the parent prompt template

        Returns:
            PromptTemplateVersion or None if no versions exist
        """
        query = (
            select(PromptTemplateVersion)
            .where(PromptTemplateVersion.template_id == template_id)
            .order_by(PromptTemplateVersion.version_number.desc())
            .limit(1)
        )
        result = await db.execute(query)
        return result.scalar_one_or_none()

    @staticmethod
    async def get_version_diff(
        db: AsyncSession,
        template_id: str,
        version_a: int,
        version_b: int,
    ) -> dict:
        """
        Compute a unified diff between two prompt template versions.

        Fetches both versions and uses difflib.unified_diff to generate
        the diff text of their prompt_content.

        Args:
            db: Database session
            template_id: ID of the parent prompt template
            version_a: First version number
            version_b: Second version number

        Returns:
            Dict with version_a, version_b, and diff_text keys

        Raises:
            ValueError: If either version is not found
        """
        va = await PromptVersionRepository.get_version(db, template_id, version_a)
        vb = await PromptVersionRepository.get_version(db, template_id, version_b)

        if va is None:
            raise ValueError(
                f"Version {version_a} not found for template {template_id}"
            )
        if vb is None:
            raise ValueError(
                f"Version {version_b} not found for template {template_id}"
            )

        diff_lines = difflib.unified_diff(
            va.prompt_content.splitlines(keepends=True),
            vb.prompt_content.splitlines(keepends=True),
            fromfile=f"v{version_a}",
            tofile=f"v{version_b}",
        )
        diff_text = "".join(diff_lines)

        logger.debug(
            "version_diff_computed",
            template_id=template_id,
            version_a=version_a,
            version_b=version_b,
        )

        return {
            "version_a": version_a,
            "version_b": version_b,
            "diff_text": diff_text,
        }

    @staticmethod
    async def delete_version(
        db: AsyncSession,
        version_id: UUID,
    ) -> bool:
        """
        Delete a prompt template version by ID.

        Args:
            db: Database session
            version_id: ID of the version to delete

        Returns:
            True if deleted, False if not found
        """
        query = select(PromptTemplateVersion).where(
            PromptTemplateVersion.id == version_id
        )
        result = await db.execute(query)
        version = result.scalar_one_or_none()

        if version is None:
            return False

        template_id = version.template_id
        await db.delete(version)
        await db.flush()

        # Update parent template's current_version
        new_max_query = select(func.max(PromptTemplateVersion.version_number)).where(
            PromptTemplateVersion.template_id == template_id
        )
        new_max_result = await db.execute(new_max_query)
        new_current = new_max_result.scalar()

        template_query = select(AIPromptTemplate).where(
            AIPromptTemplate.id == template_id
        )
        template_result = await db.execute(template_query)
        template = template_result.scalar_one_or_none()
        if template:
            template.current_version = new_current  # type: ignore[assignment]
            await db.flush()

        await db.commit()

        logger.info(
            "prompt_version_deleted",
            version_id=str(version_id),
            template_id=template_id,
            version_number=version.version_number,
        )

        return True
