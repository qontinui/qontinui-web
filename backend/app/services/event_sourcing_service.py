"""
Event Sourcing Service

Handles event sourcing for project changes, including:
- Recording edit commands (events)
- Retrieving command history
- Replaying commands to rebuild state
- Automatic sequence number management
"""

from typing import Any
from uuid import UUID

import structlog
from app.crud.version import (create_command, get_command_count,
                              get_commands_by_project)
from app.models.edit_command import EditCommand
from app.schemas.version import EditCommandCreate, EditCommandHistoryResponse
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


class EventSourcingService:
    """Service for event sourcing and command logging"""

    @staticmethod
    async def record_command(
        db: AsyncSession,
        project_id: UUID,
        user_id: UUID | None,
        command_type: str,
        entity_type: str,
        entity_id: str,
        payload: dict[str, Any],
    ) -> EditCommand:
        """
        Record an edit command (event) for a project.

        Automatically assigns the next sequence number to ensure ordering.

        Args:
            db: Database session
            project_id: ID of the project
            user_id: ID of the user who made the change
            command_type: Type of command ('update', 'create', 'delete')
            entity_type: Type of entity ('workflow', 'state', 'action', 'project', etc.)
            entity_id: ID of the entity being modified
            payload: Command payload (what changed)

        Returns:
            The created EditCommand

        Raises:
            ValueError if command_type is invalid
        """
        # Validate command type
        valid_types = ["update", "create", "delete"]
        if command_type not in valid_types:
            raise ValueError(
                f"Invalid command_type '{command_type}'. Must be one of: {', '.join(valid_types)}"
            )

        logger.info(
            "record_command",
            project_id=project_id,
            user_id=user_id,
            command_type=command_type,
            entity_type=entity_type,
            entity_id=entity_id,
        )

        command_data = EditCommandCreate(
            project_id=project_id,
            command_type=command_type,
            entity_type=entity_type,
            entity_id=entity_id,
            payload=payload,
        )

        command = await create_command(db, command_data, user_id)

        logger.info(
            "command_recorded",
            command_id=command.id,
            project_id=project_id,
            sequence_number=command.sequence_number,
        )

        return command

    @staticmethod
    async def get_command_history(
        db: AsyncSession,
        project_id: UUID,
        skip: int = 0,
        limit: int = 100,
    ) -> EditCommandHistoryResponse:
        """
        Get command history for a project.

        Commands are returned in sequence order (oldest to newest).

        Args:
            db: Database session
            project_id: ID of the project
            skip: Number of commands to skip
            limit: Maximum number of commands to return

        Returns:
            EditCommandHistoryResponse with commands and total count
        """
        logger.info(
            "get_command_history",
            project_id=project_id,
            skip=skip,
            limit=limit,
        )

        commands = await get_commands_by_project(db, project_id, skip, limit)
        total_count = await get_command_count(db, project_id)

        # Convert EditCommand models to EditCommandResponse schemas
        from app.schemas.version import EditCommandResponse

        command_responses = [
            EditCommandResponse.model_validate(cmd) for cmd in commands
        ]

        return EditCommandHistoryResponse(
            commands=command_responses,
            total_count=total_count,
            project_id=project_id,
        )

    @staticmethod
    async def replay_commands(
        db: AsyncSession,
        project_id: UUID,
        from_sequence: int = 1,
        to_sequence: int | None = None,
    ) -> dict[str, Any]:
        """
        Replay commands to rebuild project state.

        This is useful for debugging, auditing, or reconstructing state
        from events. Note: This returns a reconstructed state object,
        it does NOT modify the actual project.

        Args:
            db: Database session
            project_id: ID of the project
            from_sequence: Starting sequence number (inclusive)
            to_sequence: Ending sequence number (inclusive), or None for all

        Returns:
            Reconstructed state dictionary

        Note:
            This is a simplified implementation that returns the command history.
            A full implementation would replay commands to rebuild the actual state,
            but that requires understanding the project configuration structure.
        """
        logger.info(
            "replay_commands",
            project_id=project_id,
            from_sequence=from_sequence,
            to_sequence=to_sequence,
        )

        # Get all commands in the range
        all_commands = await get_commands_by_project(
            db, project_id, skip=0, limit=10000
        )

        # Filter by sequence range
        filtered_commands = [
            cmd
            for cmd in all_commands
            if cmd.sequence_number >= from_sequence
            and (to_sequence is None or cmd.sequence_number <= to_sequence)
        ]

        logger.info(
            "commands_replayed",
            project_id=project_id,
            command_count=len(filtered_commands),
        )

        # Return the command history for analysis
        # A full implementation would apply these commands to rebuild state
        return {
            "project_id": project_id,
            "from_sequence": from_sequence,
            "to_sequence": (
                to_sequence or filtered_commands[-1].sequence_number
                if filtered_commands
                else from_sequence
            ),
            "command_count": len(filtered_commands),
            "commands": [
                {
                    "sequence": cmd.sequence_number,
                    "command_type": cmd.command_type,
                    "entity_type": cmd.entity_type,
                    "entity_id": cmd.entity_id,
                    "payload": cmd.payload,
                    "applied_at": (
                        cmd.applied_at.isoformat() if cmd.applied_at else None
                    ),
                    "user_id": str(cmd.user_id) if cmd.user_id else None,
                }
                for cmd in filtered_commands
            ],
        }

    @staticmethod
    async def get_entity_history(
        db: AsyncSession,
        project_id: UUID,
        entity_type: str,
        entity_id: str,
    ) -> list[EditCommand]:
        """
        Get all commands for a specific entity.

        Useful for tracking the complete history of a single entity
        (e.g., a specific workflow, state, or action).

        Args:
            db: Database session
            project_id: ID of the project
            entity_type: Type of entity
            entity_id: ID of the entity

        Returns:
            List of commands for this entity, in sequence order
        """
        logger.info(
            "get_entity_history",
            project_id=project_id,
            entity_type=entity_type,
            entity_id=entity_id,
        )

        # Get all commands for this project
        all_commands = await get_commands_by_project(
            db, project_id, skip=0, limit=10000
        )

        # Filter by entity
        entity_commands = [
            cmd
            for cmd in all_commands
            if cmd.entity_type == entity_type and cmd.entity_id == entity_id
        ]

        logger.info(
            "entity_history_retrieved",
            project_id=project_id,
            entity_type=entity_type,
            entity_id=entity_id,
            command_count=len(entity_commands),
        )

        return entity_commands

    @staticmethod
    async def record_project_update(
        db: AsyncSession,
        project_id: UUID,
        user_id: UUID | None,
        old_configuration: dict[str, Any],
        new_configuration: dict[str, Any],
    ) -> EditCommand:
        """
        Convenience method to record a project configuration update.

        Args:
            db: Database session
            project_id: ID of the project
            user_id: ID of the user who made the change
            old_configuration: Previous configuration
            new_configuration: New configuration

        Returns:
            The created EditCommand
        """
        payload = {
            "old_configuration": old_configuration,
            "new_configuration": new_configuration,
        }

        return await EventSourcingService.record_command(
            db=db,
            project_id=project_id,
            user_id=user_id,
            command_type="update",
            entity_type="project",
            entity_id=str(project_id),
            payload=payload,
        )
