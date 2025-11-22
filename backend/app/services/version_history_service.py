"""
Version History Service

Handles version snapshot management for projects, including:
- Creating version snapshots (full project state)
- Retrieving version history
- Restoring previous versions
- Comparing versions (diff)
- Managing version retention
"""

from typing import Any
from uuid import UUID

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud.project import get_project
from app.crud.version import (
    create_version,
    delete_old_versions,
    get_latest_version,
    get_version_by_number,
    get_version_count,
    get_versions_by_project,
)
from app.models.project import Project
from app.models.project_version import ProjectVersion
from app.schemas.project import ProjectUpdate
from app.schemas.version import (
    ProjectVersionCreate,
    ProjectVersionListItem,
    VersionComparisonResponse,
)

logger = structlog.get_logger(__name__)


class VersionHistoryService:
    """Service for managing project version history"""

    DEFAULT_VERSION_RETENTION = 10  # Keep last 10 versions by default

    @staticmethod
    async def create_version_snapshot(
        db: AsyncSession,
        project_id: int,
        user_id: UUID | None,
        comment: str | None = None,
    ) -> ProjectVersion:
        """
        Create a new version snapshot of the project's current state.

        Args:
            db: Database session
            project_id: ID of the project
            user_id: ID of the user creating the version
            comment: Optional description/comment for this version

        Returns:
            The created ProjectVersion

        Raises:
            ValueError if project not found
        """
        logger.info(
            "create_version_snapshot",
            project_id=project_id,
            user_id=user_id,
            comment=comment,
        )

        # Get current project state
        project = await get_project(db, str(project_id))
        if not project:
            raise ValueError(f"Project {project_id} not found")

        # Get next version number
        latest_version = await get_latest_version(db, project_id)
        next_version_number = (
            latest_version.version_number + 1 if latest_version else 1
        )

        # Create snapshot with full project state
        snapshot = {
            "name": project.name,
            "description": project.description,
            "configuration": project.configuration,
            "version": project.version,
            "owner_id": str(project.owner_id),
            "organization_id": str(project.organization_id) if project.organization_id else None,
            "created_at": project.created_at.isoformat() if project.created_at else None,
            "updated_at": project.updated_at.isoformat() if project.updated_at else None,
        }

        version_data = ProjectVersionCreate(
            project_id=project_id,
            version_number=next_version_number,
            snapshot=snapshot,
            comment=comment,
        )

        version = await create_version(db, version_data, user_id)

        # Clean up old versions (keep last N versions)
        await delete_old_versions(
            db, project_id, keep_count=VersionHistoryService.DEFAULT_VERSION_RETENTION
        )

        logger.info(
            "version_snapshot_created",
            project_id=project_id,
            version_number=next_version_number,
            version_id=version.id,
        )

        return version

    @staticmethod
    async def get_version_history(
        db: AsyncSession, project_id: int, skip: int = 0, limit: int = 100
    ) -> list[ProjectVersionListItem]:
        """
        Get version history for a project (without full snapshots for efficiency).

        Args:
            db: Database session
            project_id: ID of the project
            skip: Number of records to skip
            limit: Maximum number of records to return

        Returns:
            List of version list items (lightweight, no full snapshot)
        """
        logger.info(
            "get_version_history",
            project_id=project_id,
            skip=skip,
            limit=limit,
        )

        versions = await get_versions_by_project(db, project_id, skip, limit)

        # Convert to lightweight list items
        return [
            ProjectVersionListItem.model_validate(version) for version in versions
        ]

    @staticmethod
    async def get_version(
        db: AsyncSession, project_id: int, version_number: int
    ) -> ProjectVersion | None:
        """
        Get a specific version snapshot with full data.

        Args:
            db: Database session
            project_id: ID of the project
            version_number: Version number to retrieve

        Returns:
            The ProjectVersion with full snapshot, or None if not found
        """
        logger.info(
            "get_version",
            project_id=project_id,
            version_number=version_number,
        )

        return await get_version_by_number(db, project_id, version_number)

    @staticmethod
    async def restore_version(
        db: AsyncSession,
        project_id: int,
        version_number: int,
        user_id: UUID | None,
        comment: str | None = None,
    ) -> tuple[Project, ProjectVersion]:
        """
        Restore a project to a previous version.

        Creates a new version snapshot with the restored state, preserving history.

        Args:
            db: Database session
            project_id: ID of the project
            version_number: Version number to restore from
            user_id: ID of the user performing the restore
            comment: Optional comment for the restore action

        Returns:
            Tuple of (updated project, new version snapshot)

        Raises:
            ValueError if project or version not found
        """
        logger.info(
            "restore_version",
            project_id=project_id,
            version_number=version_number,
            user_id=user_id,
        )

        # Get the version to restore
        version = await get_version_by_number(db, project_id, version_number)
        if not version:
            raise ValueError(
                f"Version {version_number} not found for project {project_id}"
            )

        # Get current project
        project = await get_project(db, str(project_id))
        if not project:
            raise ValueError(f"Project {project_id} not found")

        # Restore project state from snapshot
        snapshot = version.snapshot
        project.name = snapshot.get("name", project.name)
        project.description = snapshot.get("description", project.description)
        project.configuration = snapshot.get("configuration", project.configuration)

        db.add(project)
        await db.commit()
        await db.refresh(project)

        # Create new version snapshot with restored state
        restore_comment = (
            f"Restored from version {version_number}" +
            (f": {comment}" if comment else "")
        )
        new_version = await VersionHistoryService.create_version_snapshot(
            db, project_id, user_id, restore_comment
        )

        logger.info(
            "version_restored",
            project_id=project_id,
            restored_from=version_number,
            new_version=new_version.version_number,
        )

        return project, new_version

    @staticmethod
    async def compare_versions(
        db: AsyncSession, project_id: int, version_from: int, version_to: int
    ) -> VersionComparisonResponse:
        """
        Compare two versions and return differences.

        Args:
            db: Database session
            project_id: ID of the project
            version_from: Starting version number
            version_to: Ending version number

        Returns:
            VersionComparisonResponse with diff and summary

        Raises:
            ValueError if either version not found
        """
        logger.info(
            "compare_versions",
            project_id=project_id,
            version_from=version_from,
            version_to=version_to,
        )

        # Get both versions
        v_from = await get_version_by_number(db, project_id, version_from)
        v_to = await get_version_by_number(db, project_id, version_to)

        if not v_from:
            raise ValueError(
                f"Version {version_from} not found for project {project_id}"
            )
        if not v_to:
            raise ValueError(f"Version {version_to} not found for project {project_id}")

        # Compare snapshots
        changes = VersionHistoryService._compute_diff(
            v_from.snapshot, v_to.snapshot
        )

        # Generate summary
        summary = VersionHistoryService._generate_summary(changes)

        return VersionComparisonResponse(
            version_from=version_from,
            version_to=version_to,
            created_at_from=v_from.created_at,
            created_at_to=v_to.created_at,
            changes=changes,
            summary=summary,
        )

    @staticmethod
    def _compute_diff(
        snapshot_from: dict[str, Any], snapshot_to: dict[str, Any]
    ) -> dict[str, Any]:
        """
        Compute differences between two snapshots.

        Returns a dict with keys: 'added', 'removed', 'modified'
        """
        diff = {"added": {}, "removed": {}, "modified": {}}

        # Find added and modified keys
        for key in snapshot_to:
            if key not in snapshot_from:
                diff["added"][key] = snapshot_to[key]
            elif snapshot_from[key] != snapshot_to[key]:
                diff["modified"][key] = {
                    "from": snapshot_from[key],
                    "to": snapshot_to[key],
                }

        # Find removed keys
        for key in snapshot_from:
            if key not in snapshot_to:
                diff["removed"][key] = snapshot_from[key]

        return diff

    @staticmethod
    def _generate_summary(changes: dict[str, Any]) -> str:
        """Generate a human-readable summary of changes"""
        added_count = len(changes.get("added", {}))
        removed_count = len(changes.get("removed", {}))
        modified_count = len(changes.get("modified", {}))

        parts = []
        if added_count:
            parts.append(f"{added_count} field(s) added")
        if removed_count:
            parts.append(f"{removed_count} field(s) removed")
        if modified_count:
            parts.append(f"{modified_count} field(s) modified")

        if not parts:
            return "No changes detected"

        return ", ".join(parts)
