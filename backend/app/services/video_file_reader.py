"""
Video file reader for fetching local file paths usable by cv2.VideoCapture.

VideoCaptureSession.video_path may reference either a local filesystem path
(``storage_backend == 'local'``) or an object-storage key (``s3``/MinIO).
cv2.VideoCapture only operates on local file paths, so this service
abstracts away the difference: for local backend it returns the path
directly; for S3 it downloads the object to a temporary file and yields
that path, cleaning up afterwards.
"""

from __future__ import annotations

import asyncio
import os
import tempfile
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import structlog

from app.models.video_capture import VideoCaptureSession
from app.services.object_storage import ObjectStorageService, object_storage

logger = structlog.get_logger(__name__)


class VideoFileNotFoundError(FileNotFoundError):
    """Raised when a video file cannot be located on local disk or storage."""


class VideoFileReader:
    """Resolves a :class:`VideoCaptureSession` to a usable local file path.

    Use :meth:`open` as an async context manager:

        async with reader.open(session) as path:
            cap = cv2.VideoCapture(str(path))
            ...

    For local sessions the returned path is the original file (no copy).
    For S3-backed sessions the file is downloaded to a temporary location
    and removed when the context manager exits.
    """

    def __init__(self, storage: ObjectStorageService | None = None) -> None:
        self._storage = storage if storage is not None else object_storage

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def get_local_path(self, session: VideoCaptureSession) -> Path:
        """Return a usable local path for the session's video.

        For LOCAL backend: returns ``Path(session.video_path)`` directly.
        For S3 backend: downloads to a temp file and returns the path.

        Callers responsible for downloading temp files MUST clean them up.
        Prefer :meth:`open` which handles cleanup automatically.
        """
        key = self._select_video_key(session)
        backend = (session.storage_backend or "local").lower()

        if backend == "local":
            path = Path(key)
            if not path.exists():
                raise VideoFileNotFoundError(f"Local video file not found: {path}")
            return path

        # S3 / object storage — download to tempfile
        return await self._download_to_temp(key)

    @asynccontextmanager
    async def open(self, session: VideoCaptureSession) -> AsyncIterator[Path]:
        """Yield a local Path for the session's video, cleaning up if needed.

        Local sessions yield the original file (no cleanup).
        S3 sessions yield a temp file that is unlinked on exit.
        """
        backend = (session.storage_backend or "local").lower()
        path: Path | None = None
        cleanup = False

        try:
            if backend == "local":
                path = await self.get_local_path(session)
                yield path
            else:
                key = self._select_video_key(session)
                path = await self._download_to_temp(key)
                cleanup = True
                yield path
        finally:
            if cleanup and path is not None:
                try:
                    if path.exists():
                        path.unlink()
                except OSError as exc:
                    logger.warning(
                        "video_temp_file_cleanup_failed",
                        path=str(path),
                        error=str(exc),
                    )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _select_video_key(self, session: VideoCaptureSession) -> str:
        """Pick the smaller of compressed/full video paths if both exist.

        Returning the smaller version reduces S3 download bandwidth and
        local disk reads. cv2 handles both equally well at the codec level.
        """
        full_path = session.video_path
        full_size = session.video_size_bytes

        compressed_path = session.compressed_video_path
        compressed_size = session.compressed_video_size_bytes

        if compressed_path:
            # Prefer compressed if its size is known and smaller, OR if
            # the uncompressed size is unknown (assume compressed wins).
            if (
                compressed_size is not None
                and full_size is not None
                and compressed_size < full_size
            ):
                return compressed_path
            if compressed_size is not None and full_size is None:
                return compressed_path

        if not full_path:
            raise VideoFileNotFoundError(
                f"VideoCaptureSession {session.id} has no video_path set"
            )
        return full_path

    async def _download_to_temp(self, key: str) -> Path:
        """Download an object-storage object to a temp file.

        Runs blocking ``object_storage.download_file`` in a thread executor
        so the event loop remains responsive.
        """
        suffix = Path(key).suffix or ".mp4"

        loop = asyncio.get_event_loop()
        data: bytes = await loop.run_in_executor(None, self._storage.download_file, key)

        # delete=False so the file persists after close(); caller (or the
        # `open` context manager) is responsible for unlinking.
        tmp = tempfile.NamedTemporaryFile(  # noqa: SIM115
            suffix=suffix, delete=False, prefix="qontinui_video_"
        )
        try:
            tmp.write(data)
            tmp.flush()
            tmp.close()
        except Exception:
            # Cleanup if write failed
            try:
                os.unlink(tmp.name)
            except OSError:
                pass
            raise

        logger.debug(
            "video_downloaded_to_temp",
            key=key,
            temp_path=tmp.name,
            bytes=len(data),
        )
        return Path(tmp.name)


# Module-level singleton — convenient for endpoints that don't need to
# customize the storage backend.
video_file_reader = VideoFileReader()
