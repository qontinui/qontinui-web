"""Screenshot handling for automation WebSocket.

Handles screenshot upload, validation, S3 storage, and database persistence.
"""

import base64
import io
import uuid
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import structlog
from fastapi import HTTPException
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.images import (
    validate_image_magic_bytes,
    validate_image_mime_type,
)
from app.models.automation_screenshot import AutomationScreenshot
from app.services.object_storage import object_storage
from app.websockets.automation.schemas import make_timestamp

logger = structlog.get_logger(__name__)


async def handle_screenshot(
    message: dict[str, Any],
    db: AsyncSession,
    user_id: UUID,
    session_id: UUID | None = None,
) -> dict[str, Any]:
    """Handle screenshot message with full S3 upload and database storage.

    Steps:
    1. Decode base64 image from message.data["image"]
    2. Validate image (MIME type, magic bytes, file size)
    3. Extract image dimensions using PIL
    4. Generate S3 key: automation/{user_id}/{session_id}/{uuid}.png
    5. Upload to S3
    6. Create AutomationScreenshot record in database
    7. Return success response

    Args:
        message: Message data containing screenshot image and metadata.
        db: Database session.
        user_id: User ID for S3 path organization.
        session_id: Current automation session ID.

    Returns:
        Response message with screenshot_id.
    """
    try:
        if not session_id:
            return {
                "type": "error",
                "message": "No active session. Start session first.",
            }

        # Step 1: Extract and validate base64 image data
        image_data_b64 = message.get("image")
        if not image_data_b64:
            return {
                "type": "error",
                "message": "Missing required field: image",
            }

        # Decode base64 image
        try:
            image_bytes = base64.b64decode(image_data_b64)
        except Exception as e:
            logger.error(
                "screenshot_decode_failed",
                session_id=str(session_id),
                error=str(e),
            )
            return {
                "type": "error",
                "message": f"Failed to decode base64 image: {str(e)}",
            }

        # Step 2: Validate image MIME type
        metadata = message.get("metadata", {})
        content_type = metadata.get("content_type", "image/png")

        try:
            content_type = validate_image_mime_type(content_type)
        except HTTPException as e:
            logger.error(
                "screenshot_mime_validation_failed",
                session_id=str(session_id),
                content_type=content_type,
            )
            return {
                "type": "error",
                "message": e.detail,
            }

        # Step 3: Validate file size (10MB limit)
        file_size = len(image_bytes)
        if file_size > 10 * 1024 * 1024:
            logger.error(
                "screenshot_too_large",
                session_id=str(session_id),
                file_size=file_size,
            )
            return {
                "type": "error",
                "message": "Screenshot too large. Maximum size: 10.0MB",
            }

        # Step 4: Validate magic bytes
        try:
            validate_image_magic_bytes(image_bytes, content_type)
        except HTTPException as e:
            logger.error(
                "screenshot_magic_bytes_validation_failed",
                session_id=str(session_id),
                content_type=content_type,
            )
            return {
                "type": "error",
                "message": e.detail,
            }

        # Step 5: Extract image dimensions using PIL
        try:
            image_file = io.BytesIO(image_bytes)
            with Image.open(image_file) as img:
                width, height = img.size
        except Exception as e:
            logger.error(
                "screenshot_dimension_extraction_failed",
                session_id=str(session_id),
                error=str(e),
            )
            return {
                "type": "error",
                "message": f"Failed to extract image dimensions: {str(e)}",
            }

        # Step 6: Generate unique screenshot ID and S3 key
        screenshot_id = uuid.uuid4()
        file_extension = content_type.split("/")[-1]  # png, jpeg, etc.
        s3_key = f"automation/{user_id}/{session_id}/{screenshot_id}.{file_extension}"

        # Step 7: Upload to S3
        try:
            image_file = io.BytesIO(image_bytes)
            object_storage.backend.upload_file(
                file_obj=image_file,
                key=s3_key,
                content_type=content_type,
                metadata={
                    "user_id": str(user_id),
                    "session_id": str(session_id),
                    "screenshot_id": str(screenshot_id),
                    "width": str(width),
                    "height": str(height),
                },
            )

            logger.info(
                "screenshot_uploaded_to_s3",
                user_id=str(user_id),
                session_id=str(session_id),
                screenshot_id=str(screenshot_id),
                s3_key=s3_key,
                file_size=file_size,
                width=width,
                height=height,
            )
        except Exception as e:
            logger.error(
                "screenshot_s3_upload_failed",
                user_id=str(user_id),
                session_id=str(session_id),
                screenshot_id=str(screenshot_id),
                error=str(e),
                error_type=type(e).__name__,
            )
            return {
                "type": "error",
                "message": f"Failed to upload screenshot to storage: {str(e)}",
            }

        # Step 8: Parse timestamp from metadata
        timestamp_str = metadata.get("timestamp")
        if timestamp_str:
            try:
                screenshot_timestamp = datetime.fromisoformat(
                    timestamp_str.replace("Z", "+00:00")
                )
            except (ValueError, AttributeError):
                screenshot_timestamp = datetime.now(UTC)
        else:
            screenshot_timestamp = datetime.now(UTC)

        # Step 9: Create AutomationScreenshot record
        screenshot_name = metadata.get(
            "name", f"Screenshot {screenshot_timestamp.strftime('%Y-%m-%d %H:%M:%S')}"
        )

        screenshot_record = AutomationScreenshot(
            id=screenshot_id,
            session_id=session_id,
            name=screenshot_name,
            storage_path=s3_key,
            width=width,
            height=height,
            content_type=content_type,
            timestamp=screenshot_timestamp,
            automation_metadata=metadata,
        )

        db.add(screenshot_record)
        await db.commit()
        await db.refresh(screenshot_record)

        logger.info(
            "screenshot_record_created",
            screenshot_id=str(screenshot_id),
            session_id=str(session_id),
            name=screenshot_name,
        )

        # Step 10: Return success response
        return {
            "type": "screenshot_stored",
            "screenshot_id": str(screenshot_id),
            "timestamp": make_timestamp(),
        }

    except Exception as e:
        logger.error(
            "screenshot_handler_error",
            session_id=str(session_id) if session_id else None,
            error=str(e),
            error_type=type(e).__name__,
        )
        return {
            "type": "error",
            "message": f"Failed to process screenshot: {str(e)}",
        }
