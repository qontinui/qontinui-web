"""Feedback schemas."""

from pydantic import BaseModel, EmailStr, Field


class FeedbackSubmission(BaseModel):
    """Schema for feedback submission."""

    name: str = Field(..., min_length=1, max_length=100, description="User's name")
    email: EmailStr = Field(..., description="User's email address")
    message: str = Field(
        ..., min_length=10, max_length=2000, description="Feedback message"
    )
    page_url: str | None = Field(
        None, max_length=500, description="Page URL where feedback was submitted"
    )


class FeedbackResponse(BaseModel):
    """Response after feedback submission."""

    success: bool
    message: str
