"""Screenshot handling for testing WebSocket.

Handles screenshot processing, validation, and S3 upload.
"""

import base64
import io
from typing import Any
from uuid import UUID, uuid4

import structlog
from app.api.v1.endpoints.images import (validate_image_magic_bytes,
                                         validate_image_mime_type)
from app.models.transition_execution import TransitionExecution
from app.schemas.testing_ws import ScreenshotData
from app.services.object_storage import object_storage
from app.websockets.message_types import (create_error_response,
                                          create_timestamp)
from fastapi import HTTPException
from PIL import Image
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)


async def handle_screenshot(
    message: dict[str, Any],
    db: AsyncSession,
    user_id: UUID,
    test_run_id: UUID | None,
) -> dict[str, Any]:
    """Handle screenshot message with S3 upload and database storage.

    Args:
        message: Message data containing screenshot image and metadata.
        db: Database session.
        user_id: User ID for S3 path organization.
        test_run_id: Current test run ID.

    Returns:
        Response message with screenshot_id.
    """
    try:
        if not test_run_id:
            return create_error_response("No active test session. Start session first.")

        # Validate and parse message data
        try:
            screenshot_data = ScreenshotData(**message)
        except ValidationError as e:
            return create_error_response(f"Invalid screenshot data: {str(e)}")

        # Decode base64 image
        try:
            image_bytes = base64.b64decode(screenshot_data.image)
        except Exception as e:
            logger.error("screenshot_decode_failed", error=str(e))
            return create_error_response(f"Failed to decode base64 image: {str(e)}")

        # Validate image MIME type
        content_type = screenshot_data.metadata.get("content_type", "image/png")
        try:
            content_type = validate_image_mime_type(content_type)
        except HTTPException as e:
            return create_error_response(str(e.detail))

        # Validate file size (10MB limit)
        file_size = len(image_bytes)
        if file_size > 10 * 1024 * 1024:
            return create_error_response("Screenshot too large. Maximum size: 10.0MB")

        # Validate magic bytes
        try:
            validate_image_magic_bytes(image_bytes, content_type)
        except HTTPException as e:
            return create_error_response(str(e.detail))

        # Extract image dimensions
        try:
            image_file = io.BytesIO(image_bytes)
            with Image.open(image_file) as img:
                width, height = img.size
        except Exception as e:
            logger.error("screenshot_dimension_extraction_failed", error=str(e))
            return create_error_response(
                f"Failed to extract image dimensions: {str(e)}"
            )

        # Generate unique screenshot ID and S3 key
        screenshot_id = uuid4()
        file_extension = content_type.split("/")[-1]
        s3_key = f"testing/{user_id}/{test_run_id}/{screenshot_id}.{file_extension}"

        # Upload to S3
        try:
            image_file = io.BytesIO(image_bytes)
            object_storage.backend.upload_file(
                file_obj=image_file,
                key=s3_key,
                content_type=content_type,
                metadata={
                    "user_id": str(user_id),
                    "test_run_id": str(test_run_id),
                    "screenshot_id": str(screenshot_id),
                    "transition_id": screenshot_data.transition_id or "",
                    "sequence_number": str(screenshot_data.sequence_number or ""),
                    "width": str(width),
                    "height": str(height),
                },
            )

            logger.info(
                "screenshot_uploaded_to_s3",
                user_id=str(user_id),
                test_run_id=str(test_run_id),
                screenshot_id=str(screenshot_id),
                s3_key=s3_key,
                file_size=file_size,
            )
        except Exception as e:
            logger.error(
                "screenshot_s3_upload_failed",
                error=str(e),
                error_type=type(e).__name__,
            )
            return create_error_response(f"Failed to upload screenshot: {str(e)}")

        # Link screenshot to transition execution if provided
        if screenshot_data.transition_id and screenshot_data.sequence_number:
            await _link_screenshot_to_transition(
                db,
                test_run_id,
                screenshot_data.transition_id,
                screenshot_data.sequence_number,
                s3_key,
                screenshot_id,
            )

        return {
            "type": "screenshot_stored",
            "screenshot_id": str(screenshot_id),
            "timestamp": create_timestamp(),
        }

    except Exception as e:
        logger.error(
            "screenshot_handler_error",
            error=str(e),
            error_type=type(e).__name__,
        )
        return create_error_response(f"Failed to process screenshot: {str(e)}")


async def _link_screenshot_to_transition(
    db: AsyncSession,
    test_run_id: UUID,
    transition_id: str,
    sequence_number: int,
    s3_key: str,
    screenshot_id: UUID,
) -> None:
    """Link screenshot to a transition execution.

    Args:
        db: Database session.
        test_run_id: Test run ID.
        transition_id: Transition identifier.
        sequence_number: Sequence number in test run.
        s3_key: S3 key where screenshot is stored.
        screenshot_id: Screenshot UUID.
    """
    query = select(TransitionExecution).where(
        TransitionExecution.test_run_id == test_run_id,
        TransitionExecution.transition_id == transition_id,
        TransitionExecution.sequence_number == sequence_number,
    )
    result = await db.execute(query)
    transition_execution = result.scalar_one_or_none()

    if transition_execution:
        screenshot_urls = transition_execution.screenshot_urls or []
        screenshot_urls.append(s3_key)
        transition_execution.screenshot_urls = screenshot_urls
        await db.commit()

        logger.info(
            "screenshot_linked_to_transition",
            screenshot_id=str(screenshot_id),
            transition_execution_id=str(transition_execution.id),
        )
