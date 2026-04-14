"""
File sharing API endpoints.

Provides upload/download/list/delete for cross-device file sharing.
Files are stored on the local filesystem and auto-expire after 7 days.
"""

import os
import uuid
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import structlog
from app.api.deps import get_async_db, get_current_active_user_async
from app.models.shared_file import SharedFile
from app.models.user import User
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)

router = APIRouter()

# Storage directory — configurable via environment variable
SHARED_FILES_DIR = os.environ.get(
    "QONTINUI_SHARED_FILES_DIR",
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "shared-files"),
)

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class SharedFileResponse(BaseModel):
    id: UUID
    user_id: UUID
    source_device_id: str
    filename: str
    content_type: str
    size_bytes: int
    created_at: datetime
    expires_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _ensure_user_dir(user_id: UUID) -> str:
    """Create and return the user-specific storage directory."""
    user_dir = os.path.join(os.path.abspath(SHARED_FILES_DIR), str(user_id))
    os.makedirs(user_dir, exist_ok=True)
    return user_dir


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/upload", response_model=SharedFileResponse, status_code=201)
async def upload_file(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
    file: UploadFile = File(...),
    source_device_id: str = Form(...),
) -> Any:
    """Upload a file for cross-device sharing."""
    # Read file content
    content = await file.read()
    size = len(content)

    if size > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File too large. Maximum size is {MAX_FILE_SIZE // (1024 * 1024)} MB.",
        )

    if size == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Empty file.",
        )

    file_id = uuid.uuid4()
    safe_filename = os.path.basename(file.filename or "upload")
    storage_name = f"{file_id}_{safe_filename}"
    user_dir = _ensure_user_dir(current_user.id)
    storage_path = os.path.join(user_dir, storage_name)

    # Write to filesystem
    with open(storage_path, "wb") as f:
        f.write(content)

    logger.info(
        "file_upload",
        user_id=current_user.id,
        filename=safe_filename,
        size_bytes=size,
    )

    entry = SharedFile(
        id=file_id,
        user_id=current_user.id,
        source_device_id=source_device_id,
        filename=safe_filename,
        content_type=file.content_type or "application/octet-stream",
        size_bytes=size,
        storage_path=storage_path,
    )
    db.add(entry)
    await db.flush()
    await db.refresh(entry)
    # Explicit commit: file is already on disk, so we must persist the DB record
    # to avoid orphaned files if the auto-commit fails during response serialization.
    await db.commit()

    return entry


@router.get("", response_model=list[SharedFileResponse])
async def list_files(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
) -> Any:
    """List all shared files for the current user (non-expired)."""
    now = datetime.now(UTC)
    query = (
        select(SharedFile)
        .where(
            SharedFile.user_id == current_user.id,
            SharedFile.expires_at > now,
        )
        .order_by(SharedFile.created_at.desc())
    )
    result = await db.execute(query)
    entries = list(result.scalars().all())

    logger.info("files_list", user_id=current_user.id, count=len(entries))
    return entries


@router.get("/{file_id}/download")
async def download_file(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
    file_id: UUID,
) -> FileResponse:
    """Download a shared file (only owner can download, must not be expired)."""
    now = datetime.now(UTC)
    query = select(SharedFile).where(
        SharedFile.id == file_id,
        SharedFile.user_id == current_user.id,
        SharedFile.expires_at > now,
    )
    result = await db.execute(query)
    entry = result.scalar_one_or_none()

    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found",
        )

    if not os.path.exists(entry.storage_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File no longer exists on disk",
        )

    return FileResponse(
        path=entry.storage_path,
        filename=entry.filename,
        media_type=entry.content_type,
    )


@router.delete("/{file_id}", status_code=204)
async def delete_file(
    *,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
    file_id: UUID,
) -> None:
    """Delete a shared file (only owner can delete)."""
    query = select(SharedFile).where(
        SharedFile.id == file_id,
        SharedFile.user_id == current_user.id,
    )
    result = await db.execute(query)
    entry = result.scalar_one_or_none()

    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found",
        )

    # Remove from filesystem
    if os.path.exists(entry.storage_path):
        os.remove(entry.storage_path)

    await db.delete(entry)
    logger.info(
        "file_delete",
        user_id=current_user.id,
        file_id=str(file_id),
        filename=entry.filename,
    )
