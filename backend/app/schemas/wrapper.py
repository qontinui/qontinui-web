"""Pydantic schemas for the wrapper marketplace — Phase 6.

Schemas mirror the four wrapper marketplace tables:

* :class:`WrapperEntryRead` — list/detail responses with computed
  ``avg_rating``, ``rating_count``, and ``install_count``.
* :class:`WrapperRatingCreate` / :class:`WrapperRatingRead` — star ratings.
* :class:`WrapperCommentCreate` / :class:`WrapperCommentRead` — threaded
  comments with moderation state.
* :class:`InstallEventCreate` — anonymous install ping payload.
"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# =============================================================================
# Author (embedded in WrapperEntry)
# =============================================================================


class WrapperAuthor(BaseModel):
    """Author block as stored in the registry's author_json column."""

    name: str
    url: str | None = None
    email: str | None = None


# =============================================================================
# Wrapper entry — list / detail
# =============================================================================


class WrapperEntryRead(BaseModel):
    """Read model for a wrapper marketplace entry.

    Includes computed aggregates (``avg_rating``, ``rating_count``,
    ``install_count``) that the frontend uses to render cards and detail
    pages without an extra round-trip.
    """

    model_config = ConfigDict(from_attributes=True)

    id: str
    package: str
    latest_version: str
    display_name: str
    description: str | None
    categories: list[str]
    transport: str
    author: WrapperAuthor
    repo: str | None
    license: str | None
    verified: bool
    registry_synced_at: datetime
    created_at: datetime
    updated_at: datetime

    # Computed aggregates (populated by the service layer, never the ORM)
    avg_rating: float | None = None
    rating_count: int = 0
    install_count: int = 0


class WrapperEntryDetailRead(WrapperEntryRead):
    """Detail-page payload — same as the list shape plus comments."""

    comments: list["WrapperCommentRead"] = Field(default_factory=list)


# =============================================================================
# Ratings
# =============================================================================


class WrapperRatingCreate(BaseModel):
    """POST body for creating/updating a star rating."""

    stars: int = Field(..., ge=1, le=5)


class WrapperRatingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    wrapper_id: str
    user_id: UUID
    stars: int
    created_at: datetime


class WrapperRatingSummary(BaseModel):
    """Aggregate response for rating create/delete endpoints."""

    wrapper_id: str
    avg_rating: float | None
    rating_count: int


# =============================================================================
# Comments
# =============================================================================


class WrapperCommentCreate(BaseModel):
    """POST body for creating a comment.

    A non-null ``parent_id`` makes this a threaded reply to that comment.
    """

    body: str = Field(..., min_length=1, max_length=8000)
    parent_id: int | None = None


class WrapperCommentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    wrapper_id: str
    user_id: UUID
    parent_id: int | None
    body: str
    moderation_state: str
    created_at: datetime


# =============================================================================
# Install events (anonymous, no auth)
# =============================================================================


class InstallEventCreate(BaseModel):
    """POST body for anonymous install pings from runners.

    The backend hashes ``runner_id`` with sha256 before storage —
    the raw value is never persisted (privacy).
    """

    runner_id: str = Field(..., min_length=1, max_length=512)
    version: str | None = Field(default=None, max_length=128)


class InstallEventAck(BaseModel):
    """Lightweight ack returned to the runner after a successful install ping."""

    wrapper_id: str
    install_count: int


# Resolve forward references after every class is defined.
WrapperEntryDetailRead.model_rebuild()
