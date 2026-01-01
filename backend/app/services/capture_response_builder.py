"""
Response builder for capture session endpoints.

Provides utilities for building Pydantic response models from database models.
"""

from app.models.capture import (
    CaptureAction,
    CaptureScreenshot,
    CaptureSession,
    LearnedWorkflow,
    ScreenshotStateMatch,
)
from app.schemas.capture import (
    CaptureActionResponse,
    CaptureScreenshotResponse,
    CaptureSessionResponse,
    LearnedWorkflowResponse,
    ScreenshotStateMatchResponse,
)


class CaptureResponseBuilder:
    """Builder for capture-related response objects."""

    @staticmethod
    def build_session_response(
        session: CaptureSession,
        screenshot_count: int | None = None,
    ) -> CaptureSessionResponse:
        """Build CaptureSessionResponse from database model."""
        if screenshot_count is None:
            screenshot_count = len(session.screenshots) if session.screenshots else 0

        return CaptureSessionResponse(
            id=session.id,
            project_id=session.project_id,
            user_id=session.user_id,
            name=session.name,
            description=session.description,
            status=session.status,
            extra_metadata=session.extra_metadata,
            created_at=session.created_at,
            completed_at=session.completed_at,
            screenshot_count=screenshot_count,
        )

    @staticmethod
    def build_screenshot_response(
        screenshot: CaptureScreenshot,
        action_count: int | None = None,
        detected_element_count: int | None = None,
    ) -> CaptureScreenshotResponse:
        """Build CaptureScreenshotResponse from database model."""
        if action_count is None:
            action_count = len(screenshot.actions) if screenshot.actions else 0
        if detected_element_count is None:
            detected_element_count = (
                len(screenshot.detected_elements) if screenshot.detected_elements else 0
            )

        return CaptureScreenshotResponse(
            id=screenshot.id,
            session_id=screenshot.session_id,
            sequence_number=screenshot.sequence_number,
            image_url=screenshot.image_url,
            thumbnail_url=screenshot.thumbnail_url,
            width=screenshot.width,
            height=screenshot.height,
            timestamp=screenshot.timestamp,
            extra_metadata=screenshot.extra_metadata,
            analysis_status=screenshot.analysis_status,
            action_count=action_count,
            detected_element_count=detected_element_count,
        )

    @staticmethod
    def build_action_response(action: CaptureAction) -> CaptureActionResponse:
        """Build CaptureActionResponse from database model."""
        return CaptureActionResponse(
            id=action.id,
            screenshot_id=action.screenshot_id,
            sequence_number=action.sequence_number,
            action_type=action.action_type,
            x=action.x,
            y=action.y,
            text=action.text,
            key=action.key,
            button=action.button,
            scroll_delta=action.scroll_delta,
            timestamp=action.timestamp,
            extra_metadata=action.extra_metadata,
        )

    @staticmethod
    def build_state_match_response(
        match: ScreenshotStateMatch,
    ) -> ScreenshotStateMatchResponse:
        """Build ScreenshotStateMatchResponse from database model."""
        return ScreenshotStateMatchResponse(
            id=match.id,
            screenshot_id=match.screenshot_id,
            state_identifier=match.state_identifier,
            state_metadata=match.state_metadata,
            confidence=match.confidence,
            matched_elements=match.matched_elements,
            is_confirmed=match.is_confirmed,
            review_notes=match.review_notes,
            created_at=match.created_at,
        )

    @staticmethod
    def build_workflow_response(workflow: LearnedWorkflow) -> LearnedWorkflowResponse:
        """Build LearnedWorkflowResponse from database model."""
        return LearnedWorkflowResponse(
            id=workflow.id,
            session_id=workflow.session_id,
            project_id=workflow.project_id,
            name=workflow.name,
            description=workflow.description,
            workflow_json=workflow.workflow_json,
            confidence=workflow.confidence,
            status=workflow.status,
            warnings=workflow.warnings,
            created_at=workflow.created_at,
            reviewed_at=workflow.reviewed_at,
            reviewer_id=workflow.reviewer_id,
            published_info=workflow.published_info,
        )

    @staticmethod
    def build_detected_element_dict(elem) -> dict:
        """Build detected element dictionary."""
        return {
            "id": str(elem.id),
            "element_type": elem.element_type,
            "x": elem.x,
            "y": elem.y,
            "width": elem.width,
            "height": elem.height,
            "text_content": elem.text_content,
            "confidence": elem.confidence,
            "properties": elem.properties,
        }

    @staticmethod
    def build_detected_element_dict_full(elem) -> dict:
        """Build detected element dictionary with visual hash."""
        return {
            "id": str(elem.id),
            "element_type": elem.element_type,
            "x": elem.x,
            "y": elem.y,
            "width": elem.width,
            "height": elem.height,
            "text_content": elem.text_content,
            "confidence": elem.confidence,
            "properties": elem.properties,
            "visual_hash": elem.visual_hash,
        }


# Singleton instance
capture_response_builder = CaptureResponseBuilder()
