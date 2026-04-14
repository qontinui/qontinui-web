"""
Recording data builder service.

Builds database models from raw recording data.
"""

import io
import mimetypes
import uuid
from datetime import UTC, datetime, timedelta

import structlog
from app.models.recording import (
    Recording,
    RecordingContext,
    RecordingFrame,
    RecordingInteraction,
    RecordingStatus,
)
from app.services.object_storage import object_storage

logger = structlog.get_logger(__name__)


class RecordingDataBuilder:
    """Builds Recording and related models from raw data."""

    @classmethod
    def build_recording(
        cls,
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
        """
        Build a Recording model from metadata.

        Args:
            metadata: Recording metadata dict
            project_id: Project UUID as string
            user_id: User UUID as string
            recording_id: Generated recording UUID as string
            s3_prefix: S3 prefix for recording files
            upload_size_bytes: Size of uploaded file
            interactions_count: Number of interactions
            context_events_count: Number of context events
            warnings: Validation warnings

        Returns:
            Recording model instance
        """
        storage = object_storage

        # Parse times
        start_time = datetime.fromisoformat(
            metadata["recordingStartTime"].replace("Z", "+00:00")
        )
        end_time = datetime.fromisoformat(
            metadata["recordingEndTime"].replace("Z", "+00:00")
        )

        return Recording(
            id=recording_id,
            project_id=project_id,
            created_by_id=user_id,
            name=metadata.get("annotations", {}).get(
                "description", f"Recording {recording_id[:8]}"
            ),
            description=metadata.get("annotations", {}).get("description"),
            tags=metadata.get("annotations", {}).get("tags", []),
            recording_start_time=start_time,
            recording_end_time=end_time,
            duration_ms=metadata["duration"],
            recorder_name=metadata["recorder"]["name"],
            recorder_version=metadata["recorder"].get("version"),
            recorder_platform=metadata["recorder"]["platform"],
            screen_width=metadata["system"]["screenResolution"]["width"],
            screen_height=metadata["system"]["screenResolution"]["height"],
            screen_dpi=metadata["system"].get("dpi"),
            os_name=metadata["system"].get("os"),
            os_version=metadata["system"].get("osVersion"),
            locale=metadata["system"].get("locale"),
            app_name=metadata["targetApplication"]["name"],
            app_version=metadata["targetApplication"].get("version"),
            app_type=metadata["targetApplication"]["type"],
            app_url=metadata["targetApplication"].get("url"),
            frame_rate=metadata["frameRate"],
            total_frames=metadata["totalFrames"],
            total_interactions=interactions_count,
            total_context_events=context_events_count,
            s3_bucket=(
                storage.backend.bucket_name
                if hasattr(storage.backend, "bucket_name")
                else None
            ),
            s3_prefix=s3_prefix,
            upload_size_bytes=upload_size_bytes,
            status=RecordingStatus.UPLOADED,
            validation_warnings=warnings,
        )

    @classmethod
    def build_frame(
        cls,
        frame_data: dict,
        recording_id: str,
        s3_prefix: str,
        start_time: datetime,
        frame_rate: float,
        screen_width: int,
        screen_height: int,
        image_bytes: bytes,
        format_ext: str,
    ) -> RecordingFrame | None:
        """
        Build a RecordingFrame from frame data.

        Args:
            frame_data: Frame data dict
            recording_id: Recording UUID as string
            s3_prefix: S3 prefix for frames
            start_time: Recording start time
            frame_rate: Recording frame rate
            screen_width: Screen width
            screen_height: Screen height
            image_bytes: Frame image bytes
            format_ext: Image format extension

        Returns:
            RecordingFrame model or None if invalid
        """
        frame_number = frame_data.get("frameNumber")
        if frame_number is None:
            logger.warning("Frame missing frameNumber, skipping")
            return None

        filename = f"frame_{frame_number:04d}.{format_ext}"
        frame_key = f"{s3_prefix}/frames/{filename}"

        # Upload to S3
        storage = object_storage
        storage.backend.upload_file(
            io.BytesIO(image_bytes),
            frame_key,
            content_type=mimetypes.guess_type(filename)[0] or "image/png",
        )

        # Generate presigned URL
        presigned_url = storage.generate_presigned_url(
            frame_key, expiration=3600 * 24 * 7
        )  # 7 days

        # Calculate relative time
        relative_time_ms = int((frame_number / frame_rate) * 1000)
        timestamp = start_time + timedelta(milliseconds=relative_time_ms)

        return RecordingFrame(
            id=str(uuid.uuid4()),
            recording_id=recording_id,
            frame_number=frame_number,
            timestamp=timestamp,
            relative_time_ms=relative_time_ms,
            s3_key=frame_key,
            image_url=presigned_url,
            url_expires_at=datetime.now(UTC) + timedelta(days=7),
            width=screen_width,
            height=screen_height,
            size_bytes=len(image_bytes),
            format=format_ext,
        )

    @classmethod
    def build_interaction(
        cls,
        interaction_data: dict,
        recording_id: str,
    ) -> RecordingInteraction:
        """
        Build a RecordingInteraction from interaction data.

        Args:
            interaction_data: Interaction data dict
            recording_id: Recording UUID as string

        Returns:
            RecordingInteraction model
        """
        timestamp = datetime.fromisoformat(
            interaction_data["timestamp"].replace("Z", "+00:00")
        )

        return RecordingInteraction(
            id=str(uuid.uuid4()),
            recording_id=recording_id,
            timestamp=timestamp,
            relative_time_ms=interaction_data["relativeTime"],
            frame_number=interaction_data.get("frameNumber"),
            interaction_type=interaction_data["type"],
            action=interaction_data.get("action"),
            x=interaction_data.get("coordinates", {}).get("x"),
            y=interaction_data.get("coordinates", {}).get("y"),
            button=interaction_data.get("button"),
            click_count=interaction_data.get("clickCount", 1),
            start_x=interaction_data.get("startCoordinates", {}).get("x"),
            start_y=interaction_data.get("startCoordinates", {}).get("y"),
            end_x=interaction_data.get("endCoordinates", {}).get("x"),
            end_y=interaction_data.get("endCoordinates", {}).get("y"),
            drag_path=interaction_data.get("path"),
            key=interaction_data.get("key"),
            key_code=interaction_data.get("keyCode"),
            char=interaction_data.get("char"),
            text=interaction_data.get("text"),
            modifiers=interaction_data.get("metadata", {}).get("modifiers", []),
            is_combo=interaction_data.get("metadata", {}).get("isCombo", False),
            scroll_delta_x=interaction_data.get("delta", {}).get("x"),
            scroll_delta_y=interaction_data.get("delta", {}).get("y"),
            scroll_direction=interaction_data.get("direction"),
            hover_duration_ms=interaction_data.get("hoverDuration"),
            hover_triggered=interaction_data.get("hoverTriggered"),
            target_element=interaction_data.get("targetElement"),
            duration_ms=interaction_data.get("metadata", {}).get("duration"),
            extra_data=interaction_data.get("metadata"),
        )

    @classmethod
    def build_context(
        cls,
        context_data: dict,
        recording_id: str,
    ) -> RecordingContext:
        """
        Build a RecordingContext from context data.

        Args:
            context_data: Context data dict
            recording_id: Recording UUID as string

        Returns:
            RecordingContext model
        """
        timestamp = datetime.fromisoformat(
            context_data["timestamp"].replace("Z", "+00:00")
        )

        return RecordingContext(
            id=str(uuid.uuid4()),
            recording_id=recording_id,
            timestamp=timestamp,
            relative_time_ms=context_data["relativeTime"],
            frame_number=context_data.get("frameNumber"),
            event_type=context_data["eventType"],
            window_title=context_data.get("windowInfo", {}).get("title"),
            process_name=context_data.get("windowInfo", {}).get("processName"),
            process_id=context_data.get("windowInfo", {}).get("processId"),
            window_bounds=context_data.get("windowInfo", {}).get("bounds"),
            window_state=context_data.get("windowInfo", {}).get("state"),
            window_z_index=context_data.get("windowInfo", {}).get("zIndex"),
            is_modal=context_data.get("windowInfo", {}).get("isModal"),
            previous_window=context_data.get("previousWindow"),
            url=context_data.get("webContext", {}).get("url"),
            previous_url=context_data.get("webContext", {}).get("previousUrl"),
            page_title=context_data.get("webContext", {}).get("title"),
            domain=context_data.get("webContext", {}).get("domain"),
            pathname=context_data.get("webContext", {}).get("pathname"),
            navigation_type=context_data.get("webContext", {}).get("navigation"),
            load_time_ms=context_data.get("webContext", {}).get("loadTime"),
            load_complete=context_data.get("webContext", {}).get("loadComplete"),
            focused_element=context_data.get("focusedElement"),
            previous_focus=context_data.get("previousFocus"),
            app_state=context_data.get("appState"),
            cpu_usage=context_data.get("performance", {}).get("cpuUsage"),
            memory_usage=context_data.get("performance", {}).get("memoryUsage"),
            network_activity=context_data.get("performance", {}).get("networkActivity"),
            is_loading=context_data.get("performance", {}).get("isLoading"),
            extra_data=context_data.get("metadata"),
            description=context_data.get("description"),
        )
