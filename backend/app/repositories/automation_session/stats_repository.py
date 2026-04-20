"""
Stats repository for image recognition analytics.

Handles: get_image_recognition_stats
"""

from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.automation_log import AutomationLog
from app.models.automation_session import AutomationSession
from app.repositories.automation_session.schemas import (
    ImageRecognitionReportData,
    ImageRecognitionStatsData,
)

logger = structlog.get_logger(__name__)


class StatsRepository:
    """
    Repository for image recognition statistics.

    Analyzes image_recognition log events to produce per-image and
    overall success/failure statistics.
    """

    async def get_image_recognition_stats(
        self,
        db: AsyncSession,
        session_id: UUID,
    ) -> tuple[AutomationSession | None, ImageRecognitionReportData | None]:
        """
        Query image recognition logs and calculate statistics.

        Analyzes all image_recognition events in the session:
        - Overall statistics (total attempts, success rate)
        - Per-image statistics (grouped by image_id)
        - Average confidence scores

        Only includes logs where log_data->>'event_type' = 'image_recognition'.

        Args:
            db: Async database session
            session_id: UUID of the session

        Returns:
            Tuple of (session, report) or (None, None) if session not found.
            If no image recognition events, returns session with empty report.
        """
        # Verify session exists
        session_query = select(AutomationSession).where(
            AutomationSession.id == session_id
        )
        session_result = await db.execute(session_query)
        session = session_result.scalar_one_or_none()

        if not session:
            return None, None

        # Query image recognition logs
        logs_query = select(AutomationLog).where(
            and_(
                AutomationLog.session_id == session_id,
                AutomationLog.log_data["event_type"].astext == "image_recognition",
            )
        )
        logs_result = await db.execute(logs_query)
        logs = logs_result.scalars().all()

        if not logs:
            # Return empty report if no image recognition events found
            return session, ImageRecognitionReportData(
                session_id=session_id,
                total_attempts=0,
                successful=0,
                failed=0,
                overall_success_rate=0.0,
                images=[],
            )

        # Calculate overall statistics
        total_attempts = len(logs)
        successful = sum(1 for log in logs if log.log_data.get("success", False))
        failed = total_attempts - successful
        overall_success_rate = (
            (successful / total_attempts * 100) if total_attempts > 0 else 0.0
        )

        # Group by image_id and calculate per-image statistics
        image_stats_map: dict[str, dict[str, Any]] = {}

        for log in logs:
            image_id = log.log_data.get("image_id", "unknown")
            is_success = log.log_data.get("success", False)
            confidence = log.log_data.get("confidence")

            if image_id not in image_stats_map:
                image_stats_map[image_id] = {
                    "total": 0,
                    "successful": 0,
                    "failed": 0,
                    "confidences": [],
                }

            stats = image_stats_map[image_id]
            stats["total"] += 1
            if is_success:
                stats["successful"] += 1
            else:
                stats["failed"] += 1

            if confidence is not None:
                stats["confidences"].append(float(confidence))

        # Build per-image statistics list
        image_stats_list: list[ImageRecognitionStatsData] = []
        for image_id, stats in image_stats_map.items():
            success_rate = (
                (stats["successful"] / stats["total"] * 100)
                if stats["total"] > 0
                else 0.0
            )
            avg_confidence = (
                sum(stats["confidences"]) / len(stats["confidences"])
                if stats["confidences"]
                else None
            )

            image_stats_list.append(
                ImageRecognitionStatsData(
                    image_id=image_id,
                    total_attempts=stats["total"],
                    successful=stats["successful"],
                    failed=stats["failed"],
                    success_rate=success_rate,
                    avg_confidence=avg_confidence,
                )
            )

        # Sort by total attempts descending
        image_stats_list.sort(key=lambda x: x.total_attempts, reverse=True)

        report = ImageRecognitionReportData(
            session_id=session_id,
            total_attempts=total_attempts,
            successful=successful,
            failed=failed,
            overall_success_rate=overall_success_rate,
            images=image_stats_list,
        )

        logger.debug(
            "get_image_recognition_stats_completed",
            session_id=str(session_id),
            total_attempts=total_attempts,
            successful=successful,
            failed=failed,
            image_count=len(image_stats_list),
        )

        return session, report
