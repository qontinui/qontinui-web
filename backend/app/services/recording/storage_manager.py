"""
Recording storage manager service.

Manages S3 storage operations for recordings.
"""

import structlog

from app.models.recording import Recording
from app.services.object_storage import S3Backend, object_storage

logger = structlog.get_logger(__name__)


class RecordingStorageManager:
    """Manages S3 storage for recording files."""

    @classmethod
    def delete_recording_files(cls, recording: Recording) -> int:
        """
        Delete all S3 files for a recording.

        Args:
            recording: Recording model

        Returns:
            Number of files deleted
        """
        storage = object_storage
        deleted_count = 0

        if recording.s3_prefix and isinstance(storage.backend, S3Backend):
            try:
                response = storage.backend.client.list_objects_v2(
                    Bucket=storage.backend.bucket_name, Prefix=recording.s3_prefix
                )

                if "Contents" in response:
                    for obj in response["Contents"]:
                        key = obj["Key"]
                        if storage.delete_file(key):
                            deleted_count += 1

                    logger.info(
                        "recording_s3_files_deleted",
                        recording_id=str(recording.id),
                        prefix=recording.s3_prefix,
                        deleted_count=deleted_count,
                    )
                else:
                    logger.info(
                        "no_s3_files_found",
                        recording_id=str(recording.id),
                        prefix=recording.s3_prefix,
                    )
            except Exception as e:
                logger.error(
                    "s3_cleanup_failed",
                    recording_id=str(recording.id),
                    error=str(e),
                    note="Continuing with database deletion",
                )
        else:
            logger.warning(
                "s3_cleanup_skipped",
                backend_type=type(storage.backend).__name__,
                message="Bulk delete not supported for this backend",
            )

        return deleted_count
