"""
Log repository for automation session log queries.

Handles: get_session_logs_paginated
"""

from typing import Any
from uuid import UUID

import structlog
from app.models.automation_log import AutomationLog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


class LogRepository:
    """
    Repository for automation session log operations.

    Provides paginated, filterable access to session logs.
    """

    async def get_session_logs_paginated(
        self,
        db: AsyncSession,
        session_id: UUID,
        skip: int = 0,
        limit: int = 100,
        level: str | None = None,
        order_by: str = "timestamp",
        order_desc: bool = False,
    ) -> tuple[list[dict[str, Any]], int]:
        """
        Get paginated logs for an automation session.

        Args:
            db: Async database session
            session_id: UUID of the session
            skip: Number of logs to skip for pagination
            limit: Maximum logs to return
            level: Optional filter by log level
            order_by: Field to order by (timestamp or sequence_number)
            order_desc: Order descending (newest first)

        Returns:
            Tuple of (list of log dicts, total count)
        """
        # Build query
        query = select(AutomationLog).where(AutomationLog.session_id == session_id)

        # Apply level filter
        if level:
            query = query.where(AutomationLog.level == level.lower())

        # Get total count
        count_query = select(func.count()).select_from(query.subquery())
        count_result = await db.execute(count_query)
        total = count_result.scalar_one()

        # Apply ordering
        if order_by == "sequence_number":
            if order_desc:
                query = query.order_by(AutomationLog.sequence_number.desc())
            else:
                query = query.order_by(AutomationLog.sequence_number.asc())
        else:
            if order_desc:
                query = query.order_by(AutomationLog.timestamp.desc())
            else:
                query = query.order_by(AutomationLog.timestamp.asc())

        # Apply pagination
        query = query.offset(skip).limit(limit)

        # Execute query
        result = await db.execute(query)
        logs = result.scalars().all()

        # Convert logs to dict
        logs_data = [
            {
                "id": log.id,
                "sequence_number": log.sequence_number,
                "level": log.level,
                "message": log.message,
                "log_data": log.log_data,
                "timestamp": log.timestamp.isoformat() + "Z",
                "created_at": log.created_at.isoformat() + "Z",
            }
            for log in logs
        ]

        logger.debug(
            "get_session_logs_paginated_completed",
            session_id=str(session_id),
            log_count=len(logs_data),
            total=total,
        )

        return logs_data, total
