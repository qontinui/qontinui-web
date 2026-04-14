"""
Recording service facade for backward compatibility.

This module delegates to the refactored recording package services:
- RecordingMetadataValidator: Metadata validation
- RecordingDataBuilder: Model building
- RecordingFileExtractor: File extraction
- RecordingResponseBuilder: Response building
- RecordingStorageManager: S3 operations

For new code, consider importing directly from app.services.recording.
"""

from typing import Any

from app.models.recording import Recording, RecordingFrame
from app.schemas.recording import (
    DiscoveredStateResponse,
    DiscoveredTransitionResponse,
    FrameResponse,
    ProcessingJobStatus,
    RecordingResponse,
)
from app.services.recording import (
    RecordingDataBuilder,
    RecordingFileExtractor,
    RecordingMetadataValidator,
    RecordingResponseBuilder,
    RecordingStorageManager,
)
from fastapi import UploadFile
from sqlalchemy.ext.asyncio import AsyncSession


class RecordingService:
    """
    Facade for recording operations.

    Maintains backward compatibility by delegating to refactored services.
    """

    # Delegate to RecordingMetadataValidator
    def validate_recording_metadata(
        self, metadata: dict
    ) -> tuple[bool, list[str], list[str]]:
        """Validate recording metadata."""
        return RecordingMetadataValidator.validate(metadata)

    # Delegate to RecordingDataBuilder
    def build_recording_from_metadata(
        self,
        metadata: dict,
        project_id: str,
        user_id: str,
        recording_id: str,
        s3_prefix: str,
        upload_size_bytes: int,
        interactions_count: int,
        context_events_count: int,
        warnings: list[str],
    ) -> Recording:
        """Build a Recording model from metadata."""
        return RecordingDataBuilder.build_recording(
            metadata=metadata,
            project_id=project_id,
            user_id=user_id,
            recording_id=recording_id,
            s3_prefix=s3_prefix,
            upload_size_bytes=upload_size_bytes,
            interactions_count=interactions_count,
            context_events_count=context_events_count,
            warnings=warnings,
        )

    def build_frame_from_data(
        self,
        frame_data: dict,
        recording_id: str,
        s3_prefix: str,
        start_time: Any,
        frame_rate: float,
        screen_width: int,
        screen_height: int,
        image_bytes: bytes,
        format_ext: str,
    ) -> Any:
        """Build a RecordingFrame from frame data."""
        return RecordingDataBuilder.build_frame(
            frame_data=frame_data,
            recording_id=recording_id,
            s3_prefix=s3_prefix,
            start_time=start_time,
            frame_rate=frame_rate,
            screen_width=screen_width,
            screen_height=screen_height,
            image_bytes=image_bytes,
            format_ext=format_ext,
        )

    def build_interaction_from_data(
        self,
        interaction_data: dict,
        recording_id: str,
    ) -> Any:
        """Build a RecordingInteraction from interaction data."""
        return RecordingDataBuilder.build_interaction(interaction_data, recording_id)

    def build_context_from_data(
        self,
        context_data: dict,
        recording_id: str,
    ) -> Any:
        """Build a RecordingContext from context data."""
        return RecordingDataBuilder.build_context(context_data, recording_id)

    # Delegate to RecordingFileExtractor
    async def extract_json_recording(
        self,
        json_file: UploadFile,
        project_id: str,
        user_id: str,
        db: AsyncSession,
    ) -> tuple[Recording, dict]:
        """Extract and process JSON format recording."""
        return await RecordingFileExtractor.extract_json(
            json_file, project_id, user_id, db
        )

    async def extract_zip_recording(
        self,
        zip_file: UploadFile,
        project_id: str,
        user_id: str,
        db: AsyncSession,
    ) -> tuple[Recording, dict]:
        """Extract and process ZIP format recording."""
        return await RecordingFileExtractor.extract_zip(
            zip_file, project_id, user_id, db
        )

    # Delegate to RecordingStorageManager
    def delete_recording_files(self, recording: Recording) -> int:
        """Delete all S3 files for a recording."""
        return RecordingStorageManager.delete_recording_files(recording)

    # Delegate to RecordingResponseBuilder
    def build_recording_response(self, recording: Recording) -> RecordingResponse:
        """Build RecordingResponse from database model."""
        return RecordingResponseBuilder.build_recording_response(recording)

    def build_frame_response(self, frame: RecordingFrame) -> FrameResponse:
        """Build FrameResponse from database model."""
        return RecordingResponseBuilder.build_frame_response(frame)

    def build_processing_status(self, recording: Recording) -> ProcessingJobStatus:
        """Build ProcessingJobStatus from database model."""
        return RecordingResponseBuilder.build_processing_status(recording)

    def build_state_response(self, state: Any) -> DiscoveredStateResponse:
        """Build DiscoveredStateResponse from database model."""
        return RecordingResponseBuilder.build_state_response(state)

    def build_transition_response(
        self, transition: Any
    ) -> DiscoveredTransitionResponse:
        """Build DiscoveredTransitionResponse from database model."""
        return RecordingResponseBuilder.build_transition_response(transition)


# Singleton instance for convenience
recording_service = RecordingService()
