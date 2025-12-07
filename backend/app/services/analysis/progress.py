"""
Progress tracking for analysis jobs
"""

import json
import logging
from datetime import datetime
from typing import Any
from uuid import UUID

logger = logging.getLogger(__name__)


class ProgressTracker:
    """
    Track analysis progress in Redis for real-time updates

    Stores progress information that can be polled by the frontend
    to show progress bars and status updates.
    """

    def __init__(self, redis_client=None):
        """
        Initialize progress tracker

        Args:
            redis_client: Redis client for storing progress (optional, falls back to in-memory)
        """
        self.redis = redis_client
        self._in_memory_cache: dict[str, dict[str, Any]] = {}
        self.ttl = 3600  # 1 hour TTL for progress data

    def _make_key(self, job_id: UUID) -> str:
        """Make Redis key for a job"""
        return f"analysis:progress:{str(job_id)}"

    async def initialize(
        self,
        job_id: UUID,
        total_analyzers: int,
        analyzer_names: list[str],
    ):
        """
        Initialize progress tracking for a job

        Args:
            job_id: Analysis job ID
            total_analyzers: Total number of analyzers to run
            analyzer_names: List of analyzer names
        """
        progress_data = {
            "job_id": str(job_id),
            "status": "initializing",
            "total_analyzers": total_analyzers,
            "completed_analyzers": 0,
            "current_analyzer": None,
            "analyzer_progress": {},
            "analyzer_names": analyzer_names,
            "started_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
            "error": None,
        }

        await self._set_progress(job_id, progress_data)
        logger.info(f"Initialized progress tracking for job {job_id}")

    async def update_analyzer_start(self, job_id: UUID, analyzer_name: str):
        """
        Update progress when an analyzer starts

        Args:
            job_id: Analysis job ID
            analyzer_name: Name of the analyzer starting
        """
        progress = await self._get_progress(job_id)
        if not progress:
            logger.warning(f"No progress data for job {job_id}")
            return

        progress["current_analyzer"] = analyzer_name
        progress["status"] = "running"
        progress["analyzer_progress"][analyzer_name] = {
            "status": "running",
            "progress": 0.0,
            "started_at": datetime.utcnow().isoformat(),
        }
        progress["updated_at"] = datetime.utcnow().isoformat()

        await self._set_progress(job_id, progress)
        logger.debug(f"Analyzer {analyzer_name} started for job {job_id}")

    async def update_analyzer_progress(
        self,
        job_id: UUID,
        analyzer_name: str,
        progress_percent: float,
        message: str | None = None,
    ):
        """
        Update progress for a specific analyzer

        Args:
            job_id: Analysis job ID
            analyzer_name: Name of the analyzer
            progress_percent: Progress percentage (0-100)
            message: Optional progress message
        """
        progress = await self._get_progress(job_id)
        if not progress:
            return

        if analyzer_name not in progress["analyzer_progress"]:
            progress["analyzer_progress"][analyzer_name] = {}

        progress["analyzer_progress"][analyzer_name].update(
            {
                "progress": progress_percent,
                "message": message,
                "updated_at": datetime.utcnow().isoformat(),
            }
        )
        progress["updated_at"] = datetime.utcnow().isoformat()

        await self._set_progress(job_id, progress)

    async def update_analyzer_complete(
        self,
        job_id: UUID,
        analyzer_name: str,
        elements_found: int,
    ):
        """
        Mark an analyzer as complete

        Args:
            job_id: Analysis job ID
            analyzer_name: Name of the analyzer
            elements_found: Number of elements found
        """
        progress = await self._get_progress(job_id)
        if not progress:
            return

        progress["completed_analyzers"] += 1
        progress["analyzer_progress"][analyzer_name].update(
            {
                "status": "completed",
                "progress": 100.0,
                "elements_found": elements_found,
                "completed_at": datetime.utcnow().isoformat(),
            }
        )
        progress["updated_at"] = datetime.utcnow().isoformat()

        # Check if all analyzers are done
        if progress["completed_analyzers"] >= progress["total_analyzers"]:
            progress["status"] = "fusing"
            progress["current_analyzer"] = None

        await self._set_progress(job_id, progress)
        logger.debug(
            f"Analyzer {analyzer_name} completed for job {job_id} "
            f"({progress['completed_analyzers']}/{progress['total_analyzers']})"
        )

    async def update_analyzer_error(
        self,
        job_id: UUID,
        analyzer_name: str,
        error: str,
    ):
        """
        Mark an analyzer as failed

        Args:
            job_id: Analysis job ID
            analyzer_name: Name of the analyzer
            error: Error message
        """
        progress = await self._get_progress(job_id)
        if not progress:
            return

        progress["completed_analyzers"] += 1
        progress["analyzer_progress"][analyzer_name].update(
            {
                "status": "error",
                "error": error,
                "failed_at": datetime.utcnow().isoformat(),
            }
        )
        progress["updated_at"] = datetime.utcnow().isoformat()

        await self._set_progress(job_id, progress)
        logger.error(f"Analyzer {analyzer_name} failed for job {job_id}: {error}")

    async def update_fusion_start(self, job_id: UUID, total_elements: int):
        """
        Update progress when fusion starts

        Args:
            job_id: Analysis job ID
            total_elements: Total elements to fuse
        """
        progress = await self._get_progress(job_id)
        if not progress:
            return

        progress["status"] = "fusing"
        progress["fusion"] = {
            "status": "running",
            "total_elements": total_elements,
            "started_at": datetime.utcnow().isoformat(),
        }
        progress["updated_at"] = datetime.utcnow().isoformat()

        await self._set_progress(job_id, progress)
        logger.debug(f"Fusion started for job {job_id}")

    async def update_fusion_complete(
        self,
        job_id: UUID,
        fused_elements: int,
    ):
        """
        Mark fusion as complete

        Args:
            job_id: Analysis job ID
            fused_elements: Number of fused elements
        """
        progress = await self._get_progress(job_id)
        if not progress:
            return

        progress["status"] = "completed"
        progress["fusion"].update(
            {
                "status": "completed",
                "fused_elements": fused_elements,
                "completed_at": datetime.utcnow().isoformat(),
            }
        )
        progress["completed_at"] = datetime.utcnow().isoformat()
        progress["updated_at"] = datetime.utcnow().isoformat()

        await self._set_progress(job_id, progress)
        logger.info(f"Fusion completed for job {job_id}")

    async def update_error(self, job_id: UUID, error: str):
        """
        Mark the entire job as failed

        Args:
            job_id: Analysis job ID
            error: Error message
        """
        progress = await self._get_progress(job_id)
        if not progress:
            # Create minimal progress data
            progress = {
                "job_id": str(job_id),
                "status": "error",
                "error": error,
                "updated_at": datetime.utcnow().isoformat(),
            }
        else:
            progress["status"] = "error"
            progress["error"] = error
            progress["failed_at"] = datetime.utcnow().isoformat()
            progress["updated_at"] = datetime.utcnow().isoformat()

        await self._set_progress(job_id, progress)
        logger.error(f"Job {job_id} failed: {error}")

    async def get_progress(self, job_id: UUID) -> dict[str, Any] | None:
        """
        Get current progress for a job

        Args:
            job_id: Analysis job ID

        Returns:
            Progress data or None if not found
        """
        return await self._get_progress(job_id)

    async def clear_progress(self, job_id: UUID):
        """
        Clear progress data for a job

        Args:
            job_id: Analysis job ID
        """
        key = self._make_key(job_id)

        if self.redis:
            try:
                await self.redis.delete(key)
            except Exception as e:
                logger.error(f"Failed to delete progress from Redis: {e}")

        if str(job_id) in self._in_memory_cache:
            del self._in_memory_cache[str(job_id)]

    async def _get_progress(self, job_id: UUID) -> dict[str, Any] | None:
        """Get progress data from Redis or in-memory cache"""
        key = self._make_key(job_id)

        if self.redis:
            try:
                data = await self.redis.get(key)
                if data:
                    return json.loads(data)  # type: ignore[no-any-return]
            except Exception as e:
                logger.error(f"Failed to get progress from Redis: {e}")

        # Fall back to in-memory cache
        return self._in_memory_cache.get(str(job_id))

    async def _set_progress(self, job_id: UUID, progress_data: dict[str, Any]):
        """Set progress data in Redis or in-memory cache"""
        key = self._make_key(job_id)

        if self.redis:
            try:
                await self.redis.setex(
                    key,
                    self.ttl,
                    json.dumps(progress_data),
                )
            except Exception as e:
                logger.error(f"Failed to set progress in Redis: {e}")

        # Also store in memory as fallback
        self._in_memory_cache[str(job_id)] = progress_data


# Global progress tracker (will be initialized with Redis client)
progress_tracker: ProgressTracker | None = None


def get_progress_tracker() -> ProgressTracker:
    """Get the global progress tracker instance"""
    global progress_tracker
    if progress_tracker is None:
        progress_tracker = ProgressTracker()
    return progress_tracker
