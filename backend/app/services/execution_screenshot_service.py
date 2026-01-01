"""
Service for execution screenshot business logic.

Handles screenshot upload, thumbnail generation, storage operations,
and response mapping. Separates business logic from HTTP handling.
"""

import io
from datetime import datetime
from uuid import UUID

import structlog
from PIL import Image

# Import schemas from qontinui-schemas
from qontinui_schemas.api.execution import ExecutionScreenshotResponse, ScreenshotType
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.execution_screenshot import ExecutionScreenshot, ExecutionScreenshotType
from app.repositories.action_execution import ActionExecutionRepository
from app.repositories.execution_screenshot import ExecutionScreenshotRepository
from app.services.object_storage import object_storage

logger = structlog.get_logger(__name__)


def _map_screenshot_type_to_model(
    screenshot_type: ScreenshotType,
) -> ExecutionScreenshotType:
    """Map schema ScreenshotType to model ExecutionScreenshotType."""
    mapping = {
        ScreenshotType.BEFORE_ACTION: ExecutionScreenshotType.BEFORE_ACTION,
        ScreenshotType.AFTER_ACTION: ExecutionScreenshotType.AFTER_ACTION,
        ScreenshotType.ON_ERROR: ExecutionScreenshotType.ON_ERROR,
        ScreenshotType.ON_SUCCESS: ExecutionScreenshotType.ON_SUCCESS,
        ScreenshotType.STATE_VERIFICATION: ExecutionScreenshotType.STATE_CAPTURE,
        ScreenshotType.MANUAL: ExecutionScreenshotType.MANUAL,
    }
    return mapping.get(screenshot_type, ExecutionScreenshotType.MANUAL)


def model_to_screenshot_response(
    screenshot: ExecutionScreenshot,
) -> ExecutionScreenshotResponse:
    """Convert ExecutionScreenshot model to ExecutionScreenshotResponse schema."""
    return ExecutionScreenshotResponse(
        id=screenshot.id,
        run_id=screenshot.run_id,
        sequence_number=screenshot.sequence_number,
        screenshot_type=ScreenshotType(
            screenshot.screenshot_type.value
            if hasattr(screenshot.screenshot_type, "value")
            else screenshot.screenshot_type
        ),
        image_url=screenshot.image_url,
        thumbnail_url=screenshot.thumbnail_url,
        state_name=screenshot.state_name,
        captured_at=screenshot.captured_at,
        file_size_bytes=screenshot.file_size_bytes,
        visual_comparison=None,
    )


class ExecutionScreenshotService:
    """Service for execution screenshot operations."""

    def __init__(
        self,
        screenshot_repo: ExecutionScreenshotRepository,
        action_repo: ActionExecutionRepository,
    ) -> None:
        """Initialize with repositories."""
        self.screenshot_repo = screenshot_repo
        self.action_repo = action_repo

    async def upload_screenshot(
        self,
        db: AsyncSession,
        run_id: UUID,
        screenshot_id: UUID,
        sequence_number: int,
        screenshot_type: ScreenshotType,
        captured_at: datetime,
        width: int,
        height: int,
        content: bytes,
        action_sequence_number: int | None = None,
        state_name: str | None = None,
    ) -> ExecutionScreenshot:
        """
        Upload a screenshot with thumbnail generation and storage.

        Args:
            db: Database session
            run_id: ID of the execution run
            screenshot_id: Client-generated screenshot ID
            sequence_number: Sequence number in the run
            screenshot_type: Type of screenshot
            captured_at: Capture timestamp
            width: Image width
            height: Image height
            content: Raw image bytes
            action_sequence_number: Optional associated action sequence
            state_name: Optional state name

        Returns:
            Created ExecutionScreenshot

        Raises:
            Exception: If upload fails
        """
        file_size = len(content)

        # Upload to S3/MinIO storage
        storage_prefix = f"execution/{run_id}/screenshots"
        storage_path = f"{storage_prefix}/{screenshot_id}.png"

        # Upload full image
        file_obj = io.BytesIO(content)
        image_url = object_storage.backend.upload_file(
            file_obj, storage_path, content_type="image/png"
        )

        # Generate and upload thumbnail (200px max)
        thumbnail_url = None
        try:
            img = Image.open(io.BytesIO(content))
            thumb = img.copy()
            thumb.thumbnail((200, 200), Image.Resampling.LANCZOS)
            thumb_buffer = io.BytesIO()
            thumb.save(thumb_buffer, format="PNG")
            thumb_buffer.seek(0)
            thumbnail_path = f"{storage_prefix}/{screenshot_id}_thumb.png"
            thumbnail_url = object_storage.backend.upload_file(
                thumb_buffer, thumbnail_path, content_type="image/png"
            )
        except Exception as e:
            logger.warning("thumbnail_generation_failed", error=str(e))

        # Get associated action if specified
        action_execution_id = None
        if action_sequence_number is not None:
            action = await self.action_repo.get_by_run_and_sequence(
                db, run_id, action_sequence_number
            )
            if action:
                action_execution_id = action.id

        screenshot = ExecutionScreenshot(
            id=screenshot_id,
            run_id=run_id,
            action_execution_id=action_execution_id,
            sequence_number=sequence_number,
            screenshot_type=_map_screenshot_type_to_model(screenshot_type),
            storage_path=storage_path,
            image_url=image_url,
            thumbnail_url=thumbnail_url,
            width=width,
            height=height,
            file_size_bytes=file_size,
            state_name=state_name,
            captured_at=captured_at,
            extra_metadata={},
        )

        created = await self.screenshot_repo.create(db, screenshot)

        logger.info(
            "screenshot_uploaded",
            run_id=str(run_id),
            screenshot_id=str(screenshot_id),
            screenshot_type=screenshot_type.value,
            file_size=file_size,
        )

        return created

    async def list_for_run(
        self,
        db: AsyncSession,
        run_id: UUID,
        screenshot_type: ScreenshotType | None = None,
    ) -> list[ExecutionScreenshotResponse]:
        """
        List screenshots for a run.

        Args:
            db: Database session
            run_id: ID of the execution run
            screenshot_type: Optional filter by type

        Returns:
            List of ExecutionScreenshotResponse
        """
        model_type = (
            _map_screenshot_type_to_model(screenshot_type) if screenshot_type else None
        )
        screenshots = await self.screenshot_repo.list_for_run(db, run_id, model_type)
        return [model_to_screenshot_response(s) for s in screenshots]

    async def get_by_ids(
        self,
        db: AsyncSession,
        screenshot_ids: list[UUID],
    ) -> list[ExecutionScreenshotResponse]:
        """
        Get screenshots by their IDs.

        Args:
            db: Database session
            screenshot_ids: List of screenshot IDs

        Returns:
            List of ExecutionScreenshotResponse
        """
        screenshots = await self.screenshot_repo.get_by_ids(db, screenshot_ids)
        return [model_to_screenshot_response(s) for s in screenshots]
