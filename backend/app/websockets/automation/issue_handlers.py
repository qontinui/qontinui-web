"""Issue detection and sync handlers for automation WebSocket.

Handles issue_detected, issue_updated, and issues_sync message types.
"""

import uuid
from datetime import datetime
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud import detected_issue as issue_crud
from app.schemas.detected_issue import IssueSource, IssueSyncItem
from app.websockets.automation.schemas import WSMessage, make_timestamp

logger = structlog.get_logger(__name__)


def _parse_issue_source(source_data: dict[str, Any]) -> IssueSource:
    """Parse source data into IssueSource object.

    Args:
        source_data: Raw source data from message.

    Returns:
        Parsed IssueSource object.
    """
    return IssueSource(
        type=source_data.get("type", "other"),
        path=source_data.get("path"),
        line_range=(
            tuple(source_data["line_range"]) if source_data.get("line_range") else None
        ),
        description=source_data.get("description"),
    )


def _parse_issue_item(
    issue_data: dict[str, Any],
    session_id: UUID | None,
) -> IssueSyncItem:
    """Parse issue data into IssueSyncItem object.

    Args:
        issue_data: Raw issue data from message.
        session_id: Current session ID.

    Returns:
        Parsed IssueSyncItem object.
    """
    source = _parse_issue_source(issue_data.get("source", {}))

    return IssueSyncItem(
        id=issue_data.get("id", str(uuid.uuid4())),
        session_id=str(session_id) if session_id else "unknown",
        type=issue_data.get("type", "error"),
        severity=issue_data.get("severity", "medium"),
        title=issue_data.get("title", "Unknown Issue"),
        description=issue_data.get("description"),
        file=issue_data.get("file"),
        line=issue_data.get("line"),
        source=source,
        status=issue_data.get("status", "detected"),
        resolution=issue_data.get("resolution"),
        detected_at=datetime.fromisoformat(
            issue_data.get("detected_at", datetime.utcnow().isoformat()).replace(
                "Z", "+00:00"
            )
        ),
        resolved_at=(
            datetime.fromisoformat(issue_data["resolved_at"].replace("Z", "+00:00"))
            if issue_data.get("resolved_at")
            else None
        ),
    )


async def handle_issue_detected(
    message: WSMessage,
    raw_data: dict[str, Any],
    db: AsyncSession,
    user_id: UUID,
    session_id: UUID | None,
    send_to_frontends: Any,
) -> dict[str, Any]:
    """Handle detected issue from runner.

    Args:
        message: Parsed WebSocket message.
        raw_data: Raw message data.
        db: Database session.
        user_id: User ID.
        session_id: Current session ID.
        send_to_frontends: Function to relay to frontends.

    Returns:
        Response message dict.
    """
    if not session_id:
        return {
            "type": "error",
            "message": "No active session. Start session first.",
        }

    try:
        payload = message.data.get("payload", {})
        issue_item = _parse_issue_item(payload, session_id)

        project_id = (
            UUID(message.data.get("project_id"))
            if message.data.get("project_id")
            else None
        )
        synced, updated, _ = await issue_crud.sync_issues(
            db=db,
            user_id=user_id,
            project_id=project_id,
            issues=[issue_item],
        )

        logger.info(
            "issue_detected_stored",
            user_id=str(user_id),
            issue_title=issue_item.title[:50],
            synced=synced,
            updated=updated,
        )

        # Relay to frontends
        await send_to_frontends(
            {
                "type": "issue_detected",
                **payload,
                "timestamp": make_timestamp(),
            }
        )

        return {
            "type": "issue_detected_ack",
            "synced": synced,
            "updated": updated,
            "timestamp": make_timestamp(),
        }

    except Exception as e:
        logger.error(
            "issue_detected_error",
            error=str(e),
            error_type=type(e).__name__,
        )
        return {
            "type": "error",
            "message": f"Failed to store issue: {str(e)}",
        }


async def handle_issue_updated(
    message: WSMessage,
    raw_data: dict[str, Any],
    user_id: UUID,
    session_id: UUID | None,
    send_to_frontends: Any,
) -> dict[str, Any]:
    """Handle issue status update from runner.

    Args:
        message: Parsed WebSocket message.
        raw_data: Raw message data.
        user_id: User ID.
        session_id: Current session ID.
        send_to_frontends: Function to relay to frontends.

    Returns:
        Response message dict.
    """
    if not session_id:
        return {
            "type": "error",
            "message": "No active session. Start session first.",
        }

    try:
        payload = message.data.get("payload", {})

        logger.info(
            "issue_updated_received",
            user_id=str(user_id),
            issue_id=payload.get("id"),
            status=payload.get("status"),
        )

        # Relay to frontends
        await send_to_frontends(
            {
                "type": "issue_updated",
                **payload,
                "timestamp": make_timestamp(),
            }
        )

        return {
            "type": "issue_updated_ack",
            "timestamp": make_timestamp(),
        }

    except Exception as e:
        logger.error(
            "issue_updated_error",
            error=str(e),
            error_type=type(e).__name__,
        )
        return {
            "type": "error",
            "message": f"Failed to update issue: {str(e)}",
        }


async def handle_issues_sync(
    message: WSMessage,
    raw_data: dict[str, Any],
    db: AsyncSession,
    user_id: UUID,
    session_id: UUID | None,
) -> dict[str, Any]:
    """Handle bulk issues sync from runner.

    Args:
        message: Parsed WebSocket message.
        raw_data: Raw message data.
        db: Database session.
        user_id: User ID.
        session_id: Current session ID.

    Returns:
        Response message dict.
    """
    if not session_id:
        return {
            "type": "error",
            "message": "No active session. Start session first.",
        }

    try:
        payload = message.data.get("payload", {})
        issues_data = payload.get("issues", [])
        project_id = (
            UUID(message.data.get("project_id"))
            if message.data.get("project_id")
            else None
        )

        issue_items = [
            _parse_issue_item(issue_data, session_id) for issue_data in issues_data
        ]

        synced, updated, errors = await issue_crud.sync_issues(
            db=db,
            user_id=user_id,
            project_id=project_id,
            issues=issue_items,
        )

        logger.info(
            "issues_sync_completed",
            user_id=str(user_id),
            total_issues=len(issues_data),
            synced=synced,
            updated=updated,
            errors=len(errors),
        )

        return {
            "type": "issues_sync_ack",
            "synced": synced,
            "updated": updated,
            "errors": errors,
            "timestamp": make_timestamp(),
        }

    except Exception as e:
        logger.error(
            "issues_sync_error",
            error=str(e),
            error_type=type(e).__name__,
        )
        return {
            "type": "error",
            "message": f"Failed to sync issues: {str(e)}",
        }
