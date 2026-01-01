"""
Recording file extraction service.

Extracts and processes recording data from JSON and ZIP files.
"""

import base64
import io
import json
import uuid
import zipfile
from datetime import datetime
from typing import Any

import structlog
from fastapi import HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.recording import Recording

from .data_builder import RecordingDataBuilder
from .metadata_validator import RecordingMetadataValidator

logger = structlog.get_logger(__name__)


class RecordingFileExtractor:
    """Extracts recording data from uploaded files."""

    @classmethod
    async def extract_json(
        cls,
        json_file: UploadFile,
        project_id: str,
        user_id: str,
        db: AsyncSession,
    ) -> tuple[Recording, dict]:
        """
        Extract and process JSON format recording.

        Args:
            json_file: Uploaded JSON file
            project_id: Project UUID as string
            user_id: User UUID as string
            db: Database session

        Returns:
            Tuple of (Recording object, metadata dict)

        Raises:
            HTTPException: If JSON is invalid or metadata validation fails
        """
        # Read and parse JSON file
        json_content = await json_file.read()
        try:
            data = json.loads(json_content.decode("utf-8"))
        except json.JSONDecodeError as e:
            raise HTTPException(
                status_code=400, detail=f"Invalid JSON format: {str(e)}"
            )

        # Extract components
        if "metadata" not in data:
            raise HTTPException(
                status_code=400, detail="metadata field not found in JSON"
            )

        metadata = data["metadata"]
        interactions = data.get("interactions", [])
        context_events = data.get("contextEvents", [])
        frames_data = data.get("frames", [])

        # Validate metadata
        is_valid, errors, warnings = RecordingMetadataValidator.validate(metadata)
        if not is_valid:
            raise HTTPException(
                status_code=400, detail=f"Invalid metadata: {', '.join(errors)}"
            )

        # Create recording
        recording_id = str(uuid.uuid4())
        s3_prefix = f"recordings/{project_id}/{recording_id}"

        recording = RecordingDataBuilder.build_recording(
            metadata=metadata,
            project_id=project_id,
            user_id=user_id,
            recording_id=recording_id,
            s3_prefix=s3_prefix,
            upload_size_bytes=len(json_content),
            interactions_count=len(interactions),
            context_events_count=len(context_events),
            warnings=warnings,
        )

        db.add(recording)

        # Process frames
        start_time = datetime.fromisoformat(
            metadata["recordingStartTime"].replace("Z", "+00:00")
        )

        for frame_data in frames_data:
            image_data_b64 = frame_data.get("imageData")
            if not image_data_b64:
                logger.warning(
                    f"Frame {frame_data.get('frameNumber')} missing imageData, skipping"
                )
                continue

            try:
                image_bytes = base64.b64decode(image_data_b64)
            except Exception as e:
                logger.warning(
                    f"Failed to decode frame {frame_data.get('frameNumber')}: {str(e)}"
                )
                continue

            format_ext = frame_data.get("format", "png")
            frame = RecordingDataBuilder.build_frame(
                frame_data=frame_data,
                recording_id=recording_id,
                s3_prefix=s3_prefix,
                start_time=start_time,
                frame_rate=metadata["frameRate"],
                screen_width=recording.screen_width,  # type: ignore[arg-type]
                screen_height=recording.screen_height,  # type: ignore[arg-type]
                image_bytes=image_bytes,
                format_ext=format_ext,
            )
            if frame:
                db.add(frame)

        # Process interactions
        for interaction_data in interactions:
            interaction = RecordingDataBuilder.build_interaction(
                interaction_data, recording_id
            )
            db.add(interaction)

        # Process context events
        for context_data in context_events:
            context = RecordingDataBuilder.build_context(context_data, recording_id)
            db.add(context)

        await db.commit()
        await db.refresh(recording)

        return recording, metadata

    @classmethod
    async def extract_zip(
        cls,
        zip_file: UploadFile,
        project_id: str,
        user_id: str,
        db: AsyncSession,
    ) -> tuple[Recording, dict]:
        """
        Extract and process ZIP format recording.

        Args:
            zip_file: Uploaded ZIP file
            project_id: Project UUID as string
            user_id: User UUID as string
            db: Database session

        Returns:
            Tuple of (Recording object, metadata dict)

        Raises:
            HTTPException: If ZIP is invalid or metadata validation fails
        """
        # Read ZIP file
        zip_content = await zip_file.read()
        zip_buffer = io.BytesIO(zip_content)

        with zipfile.ZipFile(zip_buffer, "r") as zip_ref:
            # Read metadata.json
            if "metadata.json" not in zip_ref.namelist():
                raise HTTPException(
                    status_code=400, detail="metadata.json not found in ZIP"
                )

            metadata_content = zip_ref.read("metadata.json")
            metadata = json.loads(metadata_content.decode("utf-8"))

            # Validate metadata
            is_valid, errors, warnings = RecordingMetadataValidator.validate(metadata)
            if not is_valid:
                raise HTTPException(
                    status_code=400, detail=f"Invalid metadata: {', '.join(errors)}"
                )

            # Read interactions.json
            interactions: list[dict[str, Any]] = []
            if "interactions.json" in zip_ref.namelist():
                interactions_content = zip_ref.read("interactions.json")
                interactions_data = json.loads(interactions_content.decode("utf-8"))
                interactions = interactions_data.get("interactions", [])

            # Read context.json
            context_events: list[dict[str, Any]] = []
            if "context.json" in zip_ref.namelist():
                context_content = zip_ref.read("context.json")
                context_data = json.loads(context_content.decode("utf-8"))
                context_events = context_data.get("contextEvents", [])

            # Create recording
            recording_id = str(uuid.uuid4())
            s3_prefix = f"recordings/{project_id}/{recording_id}"

            recording = RecordingDataBuilder.build_recording(
                metadata=metadata,
                project_id=project_id,
                user_id=user_id,
                recording_id=recording_id,
                s3_prefix=s3_prefix,
                upload_size_bytes=len(zip_content),
                interactions_count=len(interactions),
                context_events_count=len(context_events),
                warnings=warnings,
            )

            db.add(recording)

            # Process frames
            start_time = datetime.fromisoformat(
                metadata["recordingStartTime"].replace("Z", "+00:00")
            )

            frame_files = [
                f
                for f in zip_ref.namelist()
                if f.startswith("frames/")
                and f.endswith((".png", ".jpg", ".jpeg", ".webp"))
            ]

            for frame_file in frame_files:
                filename = frame_file.split("/")[-1]
                frame_num_str = filename.replace("frame_", "").split(".")[0]
                try:
                    frame_number = int(frame_num_str)
                except ValueError:
                    logger.warning(f"Could not parse frame number from {filename}")
                    continue

                frame_data_bytes = zip_ref.read(frame_file)
                format_ext = filename.split(".")[-1]

                frame = RecordingDataBuilder.build_frame(
                    frame_data={"frameNumber": frame_number},
                    recording_id=recording_id,
                    s3_prefix=s3_prefix,
                    start_time=start_time,
                    frame_rate=metadata["frameRate"],
                    screen_width=recording.screen_width,  # type: ignore[arg-type]
                    screen_height=recording.screen_height,  # type: ignore[arg-type]
                    image_bytes=frame_data_bytes,
                    format_ext=format_ext,
                )
                if frame:
                    db.add(frame)

            # Process interactions
            for interaction_data in interactions:
                interaction = RecordingDataBuilder.build_interaction(
                    interaction_data, recording_id
                )
                db.add(interaction)

            # Process context events
            for context_data in context_events:
                context = RecordingDataBuilder.build_context(context_data, recording_id)
                db.add(context)

            await db.commit()
            await db.refresh(recording)

            return recording, metadata
