"""
Conflict resolution service for managing merge conflicts in collaborative editing.

Implements 3-way merge algorithm to detect and resolve conflicts between
concurrent edits by multiple users.
"""

from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.collaboration import ConflictLog

logger = structlog.get_logger(__name__)


class ConflictChange:
    """Represents a single field-level conflict."""

    def __init__(
        self,
        field: str,
        base_value: Any,
        local_value: Any,
        remote_value: Any,
        conflict_type: str,
    ):
        """
        Initialize conflict change.

        Args:
            field: JSON path to the conflicting field (e.g., "properties.name")
            base_value: Original value before both edits
            local_value: Local user's value
            remote_value: Remote user's value
            conflict_type: Type of conflict ('modify_modify', 'modify_delete', 'delete_modify')
        """
        self.field = field
        self.base_value = base_value
        self.local_value = local_value
        self.remote_value = remote_value
        self.conflict_type = conflict_type

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON storage."""
        return {
            "field": self.field,
            "baseValue": self.base_value,
            "localValue": self.local_value,
            "remoteValue": self.remote_value,
            "conflictType": self.conflict_type,
        }


class ConflictResolutionService:
    """Service for conflict detection and resolution."""

    def detect_conflicts(
        self,
        base_data: dict | None,
        local_data: dict | None,
        remote_data: dict | None,
        path: str = "",
    ) -> list[ConflictChange]:
        """
        Detect conflicts using 3-way merge algorithm.

        Algorithm:
        - If local == remote: No conflict (users made same change)
        - If local == base and remote != base: Auto-merge (take remote)
        - If remote == base and local != base: Auto-merge (take local)
        - If local != remote and both != base: CONFLICT

        Args:
            base_data: Original data before any edits
            local_data: Local user's edited data
            remote_data: Remote user's edited data
            path: Current JSON path for nested objects

        Returns:
            List of ConflictChange objects representing conflicts
        """
        conflicts = []

        # Handle None cases
        if base_data is None:
            base_data = {}
        if local_data is None:
            local_data = {}
        if remote_data is None:
            remote_data = {}

        # Get all keys from all versions
        all_keys = (
            set(base_data.keys()) | set(local_data.keys()) | set(remote_data.keys())
        )

        for key in all_keys:
            field_path = f"{path}.{key}" if path else key

            base_value = base_data.get(key)
            local_value = local_data.get(key)
            remote_value = remote_data.get(key)

            # Skip if values are identical (no conflict)
            if self._values_equal(local_value, remote_value):
                continue

            # Check if both are dictionaries - recurse
            if (
                isinstance(base_value, dict)
                and isinstance(local_value, dict)
                and isinstance(remote_value, dict)
            ):
                nested_conflicts = self.detect_conflicts(
                    base_value, local_value, remote_value, field_path
                )
                conflicts.extend(nested_conflicts)
                continue

            # Auto-merge: local unchanged, remote changed
            if self._values_equal(local_value, base_value) and not self._values_equal(
                remote_value, base_value
            ):
                logger.debug(
                    "auto_merge_remote",
                    field=field_path,
                    base=base_value,
                    remote=remote_value,
                )
                continue

            # Auto-merge: remote unchanged, local changed
            if self._values_equal(remote_value, base_value) and not self._values_equal(
                local_value, base_value
            ):
                logger.debug(
                    "auto_merge_local",
                    field=field_path,
                    base=base_value,
                    local=local_value,
                )
                continue

            # CONFLICT: Both changed differently
            conflict_type = self._determine_conflict_type(
                base_value, local_value, remote_value
            )

            conflict = ConflictChange(
                field=field_path,
                base_value=base_value,
                local_value=local_value,
                remote_value=remote_value,
                conflict_type=conflict_type,
            )

            conflicts.append(conflict)

            logger.info(
                "conflict_detected",
                field=field_path,
                conflict_type=conflict_type,
                base=base_value,
                local=local_value,
                remote=remote_value,
            )

        return conflicts

    def _values_equal(self, val1: Any, val2: Any) -> bool:
        """
        Check if two values are equal.

        Handles special cases like lists, dicts, and None.
        """
        # Handle None equality
        if val1 is None and val2 is None:
            return True
        if val1 is None or val2 is None:
            return False

        # Handle list equality (order matters)
        if isinstance(val1, list) and isinstance(val2, list):
            if len(val1) != len(val2):
                return False
            return all(
                self._values_equal(a, b) for a, b in zip(val1, val2, strict=False)
            )

        # Handle dict equality
        if isinstance(val1, dict) and isinstance(val2, dict):
            if set(val1.keys()) != set(val2.keys()):
                return False
            return all(self._values_equal(val1[k], val2[k]) for k in val1.keys())

        # Direct equality for primitives
        return bool(val1 == val2)

    def _determine_conflict_type(
        self, base_value: Any, local_value: Any, remote_value: Any
    ) -> str:
        """
        Determine the type of conflict.

        Returns:
            'modify_modify': Both sides modified the value
            'modify_delete': One side modified, other deleted
            'delete_modify': One side deleted, other modified
            'add_add': Both sides added different values
        """
        base_exists = base_value is not None
        local_exists = local_value is not None
        remote_exists = remote_value is not None

        if not base_exists and local_exists and remote_exists:
            return "add_add"
        elif base_exists and local_exists and not remote_exists:
            return "modify_delete"
        elif base_exists and not local_exists and remote_exists:
            return "delete_modify"
        else:
            return "modify_modify"

    async def create_conflict_log(
        self,
        db: AsyncSession,
        resource_type: str,
        resource_id: str,
        local_version: int,
        remote_version: int,
        local_user_id: UUID,
        remote_user_id: UUID,
        base_data: dict,
        local_data: dict,
        remote_data: dict,
        metadata: dict | None = None,
    ) -> ConflictLog:
        """
        Create a conflict log entry.

        Args:
            db: Database session
            resource_type: Type of resource
            resource_id: ID of resource
            local_version: Local version number
            remote_version: Remote version number
            local_user_id: ID of local user
            remote_user_id: ID of remote user
            base_data: Base data before edits
            local_data: Local user's data
            remote_data: Remote user's data
            metadata: Optional metadata

        Returns:
            Created ConflictLog instance
        """
        try:
            # Detect conflicts
            conflicts = self.detect_conflicts(base_data, local_data, remote_data)

            # Convert conflicts to dicts for JSON storage
            changes = [conflict.to_dict() for conflict in conflicts]

            # Create conflict log
            conflict_log = ConflictLog.create_conflict(
                resource_type=resource_type,
                resource_id=resource_id,
                local_version=local_version,
                remote_version=remote_version,
                local_user_id=local_user_id,
                remote_user_id=remote_user_id,
                base_data=base_data,
                local_data=local_data,
                remote_data=remote_data,
                changes=changes,
                metadata=metadata,
            )

            db.add(conflict_log)
            await db.commit()
            await db.refresh(conflict_log)

            logger.info(
                "conflict_log_created",
                conflict_id=conflict_log.id,
                resource_type=resource_type,
                resource_id=resource_id,
                num_conflicts=len(conflicts),
            )

            return conflict_log

        except Exception as e:
            logger.error("conflict_log_creation_failed", error=str(e))
            await db.rollback()
            raise

    async def resolve_conflict(
        self,
        db: AsyncSession,
        conflict_id: UUID,
        resolution_type: str,
        merged_data: dict,
    ) -> ConflictLog:
        """
        Resolve a conflict with the provided resolution.

        Args:
            db: Database session
            conflict_id: ID of conflict to resolve
            resolution_type: Type of resolution ('local', 'remote', 'merge')
            merged_data: Final merged data

        Returns:
            Updated ConflictLog instance

        Raises:
            ValueError: If conflict not found or already resolved
        """
        try:
            # Get conflict
            result = await db.execute(
                select(ConflictLog).filter(ConflictLog.id == conflict_id)
            )
            conflict = result.scalar_one_or_none()

            if not conflict:
                raise ValueError(f"Conflict {conflict_id} not found")

            if conflict.resolved:
                raise ValueError(f"Conflict {conflict_id} already resolved")

            # Validate resolution type
            if resolution_type == "local":
                final_data = conflict.local_data if merged_data is None else merged_data
            elif resolution_type == "remote":
                final_data = (
                    conflict.remote_data if merged_data is None else merged_data
                )
            elif resolution_type == "merge":
                if merged_data is None:
                    raise ValueError("merged_data required for 'merge' resolution type")
                final_data = merged_data
            else:
                raise ValueError(
                    f"Invalid resolution_type: {resolution_type}. Must be 'local', 'remote', or 'merge'"
                )

            # Resolve conflict
            conflict.resolve(resolution_type, final_data)

            await db.commit()
            await db.refresh(conflict)

            logger.info(
                "conflict_resolved",
                conflict_id=conflict_id,
                resolution_type=resolution_type,
            )

            return conflict

        except Exception as e:
            logger.error(
                "conflict_resolution_failed", error=str(e), conflict_id=conflict_id
            )
            await db.rollback()
            raise

    async def get_unresolved_conflicts(
        self,
        db: AsyncSession,
        resource_type: str | None = None,
        resource_id: str | None = None,
        user_id: UUID | None = None,
    ) -> list[ConflictLog]:
        """
        Get unresolved conflicts with optional filtering.

        Args:
            db: Database session
            resource_type: Optional filter by resource type
            resource_id: Optional filter by resource ID
            user_id: Optional filter by user involvement

        Returns:
            List of unresolved ConflictLog instances
        """
        try:
            query = select(ConflictLog).filter(ConflictLog.resolved.is_(False))

            if resource_type:
                query = query.filter(ConflictLog.resource_type == resource_type)

            if resource_id:
                query = query.filter(ConflictLog.resource_id == resource_id)

            if user_id:
                query = query.filter(
                    (ConflictLog.local_user_id == user_id)
                    | (ConflictLog.remote_user_id == user_id)
                )

            query = query.order_by(ConflictLog.detected_at.desc())

            result = await db.execute(query)
            conflicts = result.scalars().all()

            logger.debug(
                "unresolved_conflicts_retrieved",
                count=len(conflicts),
                resource_type=resource_type,
                resource_id=resource_id,
            )

            return list(conflicts)

        except Exception as e:
            logger.error("get_unresolved_conflicts_failed", error=str(e))
            raise

    def apply_merge_strategy(
        self,
        base_data: dict | None,
        local_data: dict | None,
        remote_data: dict | None,
        strategy: str = "recursive",
    ) -> dict:
        """
        Apply automatic merge strategy for non-conflicting changes.

        Args:
            base_data: Original data
            local_data: Local changes
            remote_data: Remote changes
            strategy: Merge strategy ('recursive', 'theirs', 'ours')

        Returns:
            Merged data dictionary
        """
        if strategy == "theirs":
            return remote_data or {}
        elif strategy == "ours":
            return local_data or {}
        elif strategy == "recursive":
            return self._recursive_merge(base_data, local_data, remote_data)
        else:
            raise ValueError(f"Unknown merge strategy: {strategy}")

    def _recursive_merge(
        self,
        base_data: dict | None,
        local_data: dict | None,
        remote_data: dict | None,
    ) -> dict:
        """
        Recursively merge data, preferring non-conflicting changes.

        For conflicts, this method prefers the most recent change.
        """
        if base_data is None:
            base_data = {}
        if local_data is None:
            local_data = {}
        if remote_data is None:
            remote_data = {}

        merged = {}
        all_keys = (
            set(base_data.keys()) | set(local_data.keys()) | set(remote_data.keys())
        )

        for key in all_keys:
            base_value = base_data.get(key)
            local_value = local_data.get(key)
            remote_value = remote_data.get(key)

            # If values are equal, take either
            if self._values_equal(local_value, remote_value):
                merged[key] = local_value
            # Local unchanged, take remote
            elif self._values_equal(local_value, base_value):
                merged[key] = remote_value
            # Remote unchanged, take local
            elif self._values_equal(remote_value, base_value):
                merged[key] = local_value
            # Both changed - recurse if both are dicts
            elif isinstance(local_value, dict) and isinstance(remote_value, dict):
                merged[key] = self._recursive_merge(
                    base_value if isinstance(base_value, dict) else {},
                    local_value,
                    remote_value,
                )
            # Both changed differently - prefer remote (most recent)
            else:
                merged[key] = remote_value

        return merged


# Global instance
conflict_resolution_service = ConflictResolutionService()
