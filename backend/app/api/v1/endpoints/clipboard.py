"""
Clipboard sync API endpoints.

Provides a relay service for bidirectional clipboard sync between
runner and mobile devices. Entries auto-expire after 24 hours.
"""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import structlog
from app.api.deps import get_async_db, get_current_active_user_async
from app.models.clipboard import ClipboardEntry
from app.models.user import User
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class ClipboardPushRequest(BaseModel):
    source_device_id: str = Field(..., max_length=255)
    source_device_name: str = Field(..., max_length=255)
    content_type: str = Field(..., pattern="^(text|image|file_ref)$")
    text_content: str | None = None
    image_url: str | None = None
    file_ref: dict | None = None


class ClipboardEntryResponse(BaseModel):
    id: UUID
    user_id: UUID
    source_device_id: str
    source_device_name: str
    content_type: str
    text_content: str | None
    image_url: str | None
    file_ref: dict | None
    created_at: datetime
    expires_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("", response_model=ClipboardEntryResponse, status_code=201)
async def push_clipboard(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
    body: ClipboardPushRequest,
) -> Any:
    """Push clipboard content from a device."""
    logger.info(
        "clipboard_push",
        user_id=current_user.id,
        device_id=body.source_device_id,
        content_type=body.content_type,
    )

    entry = ClipboardEntry(
        user_id=current_user.id,
        source_device_id=body.source_device_id,
        source_device_name=body.source_device_name,
        content_type=body.content_type,
        text_content=body.text_content,
        image_url=body.image_url,
        file_ref=body.file_ref,
    )
    db.add(entry)
    await db.flush()
    await db.refresh(entry)

    return entry


@router.get("/latest", response_model=ClipboardEntryResponse | None)
async def get_latest_clipboard(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """Get the most recent clipboard entry for the current user."""
    now = datetime.now(UTC)
    query = (
        select(ClipboardEntry)
        .where(
            ClipboardEntry.user_id == current_user.id,
            ClipboardEntry.expires_at > now,
        )
        .order_by(ClipboardEntry.created_at.desc())
        .limit(1)
    )
    result = await db.execute(query)
    entry = result.scalar_one_or_none()

    return entry


@router.get("/history", response_model=list[ClipboardEntryResponse])
async def get_clipboard_history(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
    limit: int = Query(20, ge=1, le=100, description="Max entries to return"),
) -> Any:
    """Get recent clipboard history for the current user (last N entries)."""
    now = datetime.now(UTC)
    query = (
        select(ClipboardEntry)
        .where(
            ClipboardEntry.user_id == current_user.id,
            ClipboardEntry.expires_at > now,
        )
        .order_by(ClipboardEntry.created_at.desc())
        .limit(limit)
    )
    result = await db.execute(query)
    entries = list(result.scalars().all())

    logger.info(
        "clipboard_history",
        user_id=current_user.id,
        count=len(entries),
    )
    return entries


@router.delete("/{entry_id}", status_code=204)
async def delete_clipboard_entry(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
    entry_id: UUID,
) -> None:
    """Delete a clipboard entry (only owner can delete)."""
    query = select(ClipboardEntry).where(
        ClipboardEntry.id == entry_id,
        ClipboardEntry.user_id == current_user.id,
    )
    result = await db.execute(query)
    entry = result.scalar_one_or_none()

    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Clipboard entry not found",
        )

    await db.delete(entry)
    logger.info(
        "clipboard_delete",
        user_id=current_user.id,
        entry_id=str(entry_id),
    )
