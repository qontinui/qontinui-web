"""Feedback API endpoints."""

import structlog
from app.schemas.feedback import FeedbackResponse, FeedbackSubmission
from app.services.email import (EmailTemplateService, EmailTransportService,
                                FeedbackEmailComposer)
from fastapi import APIRouter, Depends, HTTPException, status

logger = structlog.get_logger(__name__)

router = APIRouter()


def get_feedback_composer() -> FeedbackEmailComposer:
    """Dependency to create feedback email composer."""
    transport_service = EmailTransportService()
    template_service = EmailTemplateService()
    return FeedbackEmailComposer(
        template_service=template_service, transport_service=transport_service
    )


@router.post("/feedback", response_model=FeedbackResponse)
async def submit_feedback(
    feedback: FeedbackSubmission,
    composer: FeedbackEmailComposer = Depends(get_feedback_composer),
) -> FeedbackResponse:
    """
    Submit feedback from non-technical users.

    Args:
        feedback: Feedback submission data
        composer: Feedback email composer

    Returns:
        Success response with message

    Raises:
        HTTPException: If email sending fails
    """
    logger.info(
        "feedback_submission",
        name=feedback.name,
        email=feedback.email,
        page_url=feedback.page_url,
    )

    try:
        success = await composer.send(
            name=feedback.name,
            email=feedback.email,
            message=feedback.message,
            page_url=feedback.page_url,
        )

        if not success:
            logger.error(
                "feedback_email_send_failed",
                name=feedback.name,
                email=feedback.email,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to send feedback. Please try again later.",
            )

        logger.info(
            "feedback_submitted_successfully",
            name=feedback.name,
            email=feedback.email,
        )

        return FeedbackResponse(
            success=True,
            message="Thank you for your feedback! We'll review it shortly.",
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "feedback_submission_error",
            error=str(e),
            error_type=type(e).__name__,
            name=feedback.name,
            email=feedback.email,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred while submitting feedback. Please try again later.",
        )
