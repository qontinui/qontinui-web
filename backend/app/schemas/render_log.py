"""Schemas for render logging API (development debugging).

These schemas are used for the render logging system that captures DOM snapshots
for AI-assisted debugging. Only enabled when RENDER_LOG_ENABLED=True.
"""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import Field

from app.schemas.base import BaseORMSchema, BaseSchema, IsoDatetime


class DOMElementSnapshot(BaseSchema):
    """Schema for a single DOM element in a snapshot."""

    tag: str = Field(..., description="HTML tag name")
    id: str | None = Field(None, description="Element ID")
    class_list: list[str] = Field(default_factory=list, description="CSS classes")
    text_content: str | None = Field(None, description="Visible text content")
    inner_html_length: int | None = Field(
        None, description="Length of innerHTML for truncation info"
    )

    # Position and dimensions (relative to viewport)
    rect: dict[str, float] | None = Field(
        None, description="Bounding rect: {x, y, width, height}"
    )

    # Visibility
    is_visible: bool = Field(True, description="Whether element is visible")
    opacity: float | None = Field(None, description="Computed opacity")
    display: str | None = Field(None, description="Computed display value")

    # Key attributes
    attributes: dict[str, str] = Field(
        default_factory=dict, description="Key HTML attributes"
    )

    # Computed styles (selective - performance sensitive)
    computed_styles: dict[str, str] | None = Field(
        None, description="Selected computed styles"
    )

    # Children (recursive)
    children: list["DOMElementSnapshot"] = Field(
        default_factory=list, description="Child elements"
    )


class RenderSnapshotData(BaseSchema):
    """Schema for the full DOM snapshot stored in JSONB."""

    root: DOMElementSnapshot | None = Field(None, description="Root element tree")
    total_elements: int = Field(0, description="Total element count")
    visible_text: str | None = Field(
        None, description="Concatenated visible text (truncated)"
    )
    forms: list[dict[str, Any]] = Field(
        default_factory=list, description="Form elements with their inputs"
    )
    links: list[dict[str, str]] = Field(
        default_factory=list, description="Links on page"
    )
    images: list[dict[str, Any]] = Field(
        default_factory=list, description="Images on page"
    )
    errors: list[str] = Field(
        default_factory=list, description="JavaScript console errors"
    )
    warnings: list[str] = Field(
        default_factory=list, description="JavaScript console warnings"
    )


class RenderLogCreate(BaseSchema):
    """Schema for creating a new render log entry."""

    session_id: str = Field(
        ..., max_length=64, description="Session identifier for grouping snapshots"
    )
    page_url: str = Field(..., max_length=512, description="Current page URL")
    page_title: str | None = Field(None, max_length=256, description="Page title")
    trigger: str = Field(
        ...,
        max_length=64,
        description="What triggered capture: mutation, navigation, manual, interval",
    )
    mutation_type: str | None = Field(
        None,
        max_length=32,
        description="Type of mutation: childList, attributes, characterData",
    )
    target_selector: str | None = Field(
        None, description="CSS selector of mutated element"
    )
    snapshot: dict[str, Any] = Field(..., description="DOM snapshot data")
    viewport_width: int | None = Field(None, ge=0, description="Viewport width")
    viewport_height: int | None = Field(None, ge=0, description="Viewport height")
    scroll_x: int | None = Field(None, ge=0, description="Horizontal scroll position")
    scroll_y: int | None = Field(None, ge=0, description="Vertical scroll position")
    capture_duration_ms: int | None = Field(
        None, ge=0, description="Time to capture snapshot in ms"
    )
    element_count: int | None = Field(
        None, ge=0, description="Number of elements captured"
    )


class RenderLogResponse(BaseORMSchema):
    """Schema for render log response."""

    id: int
    session_id: str
    timestamp: IsoDatetime
    page_url: str
    page_title: str | None = None
    trigger: str
    mutation_type: str | None = None
    target_selector: str | None = None
    snapshot: dict[str, Any]
    viewport_width: int | None = None
    viewport_height: int | None = None
    scroll_x: int | None = None
    scroll_y: int | None = None
    capture_duration_ms: int | None = None
    element_count: int | None = None
    user_id: UUID | None = None


class RenderLogSummary(BaseORMSchema):
    """Schema for render log summary (without full snapshot)."""

    id: int
    session_id: str
    timestamp: IsoDatetime
    page_url: str
    page_title: str | None = None
    trigger: str
    mutation_type: str | None = None
    element_count: int | None = None
    capture_duration_ms: int | None = None


class RenderLogList(BaseSchema):
    """Schema for paginated render log list."""

    items: list[RenderLogSummary]
    total: int
    page: int
    page_size: int
    has_more: bool


class RenderImageCreate(BaseSchema):
    """Schema for creating a render image reference."""

    render_log_id: int = Field(..., description="Associated render log ID")
    image_type: str = Field(
        ..., max_length=32, description="Image type: screenshot, element, canvas"
    )
    element_selector: str | None = Field(
        None, description="CSS selector if element capture"
    )
    width: int | None = Field(None, ge=0, description="Image width")
    height: int | None = Field(None, ge=0, description="Image height")
    file_size_bytes: int | None = Field(None, ge=0, description="File size in bytes")
    mime_type: str | None = Field(None, max_length=64, description="MIME type")


class RenderImageResponse(BaseORMSchema):
    """Schema for render image response."""

    id: int
    render_log_id: int
    image_type: str
    element_selector: str | None = None
    file_path: str
    width: int | None = None
    height: int | None = None
    file_size_bytes: int | None = None
    mime_type: str | None = None
    created_at: IsoDatetime


class RenderLogWithImages(RenderLogResponse):
    """Schema for render log with associated images."""

    images: list[RenderImageResponse] = Field(default_factory=list)


class RenderLogSessionSummary(BaseSchema):
    """Schema for session-level summary of render logs."""

    session_id: str
    first_timestamp: IsoDatetime
    last_timestamp: IsoDatetime
    snapshot_count: int
    unique_pages: int
    total_mutations: int


class RenderLogStats(BaseSchema):
    """Schema for render logging statistics."""

    enabled: bool = Field(..., description="Whether render logging is enabled")
    total_snapshots: int = Field(0, description="Total snapshots in database")
    total_sessions: int = Field(0, description="Total unique sessions")
    oldest_snapshot: IsoDatetime | None = Field(None, description="Oldest snapshot")
    newest_snapshot: IsoDatetime | None = Field(None, description="Newest snapshot")
    storage_used_bytes: int = Field(0, description="Estimated storage used")
    image_count: int = Field(0, description="Total images stored")


class ClearRenderLogsRequest(BaseSchema):
    """Request to clear render logs."""

    session_id: str | None = Field(
        None, description="Clear only this session (if provided)"
    )
    before: datetime | None = Field(
        None, description="Clear snapshots before this time"
    )
    confirm: bool = Field(
        False, description="Confirmation flag for safety (must be True)"
    )


class ClearRenderLogsResponse(BaseSchema):
    """Response from clearing render logs."""

    deleted_snapshots: int
    deleted_images: int
    deleted_files: int
