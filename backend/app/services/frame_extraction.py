"""
Frame extraction service for VideoCaptureSession.

Given a VideoCaptureSession (which references an mp4 on disk or in S3) and
a target timestamp, returns the JPEG bytes of the closest frame.

Uses the FrameIndex table to seek by frame number — preferring the nearest
keyframe at-or-before the requested timestamp, since cv2's
``CAP_PROP_POS_FRAMES`` seek lands accurately on keyframes but can be
off-by-a-few on inter-frames. If an ActionFrame has a ``cached_frame_path``
populated, the cached JPEG is returned directly (fast path); otherwise the
slow path opens the video, seeks, decodes, and (optionally) writes the
JPEG to ``cached_frame_path`` for next time.

cv2 calls are blocking and run in a thread executor.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.video_capture import ActionFrame, FrameIndex, VideoCaptureSession
from app.services.video_file_reader import VideoFileReader, video_file_reader

logger = structlog.get_logger(__name__)


JPEG_QUALITY = 85


@dataclass
class _SeekTarget:
    """Resolved frame_number + timestamp to seek to in the video."""

    frame_number: int
    timestamp_ms: int


class FrameExtractionService:
    """Extract JPEG frames from VideoCaptureSession recordings."""

    def __init__(
        self,
        db: AsyncSession,
        reader: VideoFileReader | None = None,
    ) -> None:
        self._db = db
        self._reader = reader if reader is not None else video_file_reader

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def extract_frame(
        self,
        session: VideoCaptureSession,
        timestamp_ms: int,
        *,
        use_cache: bool = True,
        action_frame: ActionFrame | None = None,
    ) -> bytes:
        """Return JPEG bytes for the frame nearest to ``timestamp_ms``.

        Fast path: if ``action_frame.cached_frame_path`` exists on disk,
        read and return its bytes.

        Slow path: query FrameIndex for a seek target, open the video,
        seek + decode + encode JPEG. If ``use_cache`` and an action_frame
        is provided, the JPEG is written next to the cached_frame_path
        and the model is updated (caller is responsible for committing).
        """
        # Fast path: cached frame on local disk
        if action_frame is not None and action_frame.cached_frame_path:
            cached_path = Path(action_frame.cached_frame_path)
            if cached_path.exists():
                try:
                    return cached_path.read_bytes()
                except OSError as exc:
                    logger.warning(
                        "cached_frame_read_failed",
                        path=str(cached_path),
                        error=str(exc),
                    )

        target = await self._resolve_seek_target(session.id, timestamp_ms)

        async with self._reader.open(session) as video_path:
            jpeg = await asyncio.get_event_loop().run_in_executor(
                None,
                self._extract_one_blocking,
                video_path,
                target.frame_number,
            )

        if jpeg is None:
            raise FrameExtractionError(
                f"Failed to decode frame {target.frame_number} from "
                f"session {session.id} (timestamp_ms={timestamp_ms})"
            )

        # Optional cache write — best-effort, never fatal
        if use_cache and action_frame is not None:
            await self._cache_jpeg(action_frame, jpeg)

        return jpeg

    async def extract_batch(
        self,
        session: VideoCaptureSession,
        timestamps_ms: list[int],
    ) -> list[bytes | None]:
        """Extract multiple frames in one open/close cycle.

        Returns JPEGs in the original order of ``timestamps_ms``. Frames
        that fail to decode are returned as ``None`` rather than raising,
        so a single bad frame doesn't poison the rest of the batch.
        """
        if not timestamps_ms:
            return []

        # Resolve seek targets up front via the FrameIndex
        targets: list[_SeekTarget | None] = []
        for ts in timestamps_ms:
            try:
                target = await self._resolve_seek_target(session.id, ts)
                targets.append(target)
            except FrameExtractionError as exc:
                logger.warning(
                    "frame_index_lookup_failed",
                    session_id=session.id,
                    timestamp_ms=ts,
                    error=str(exc),
                )
                targets.append(None)

        # Walk the video once; ascending frame_number order minimizes
        # backward seeks (cv2 seeks forward efficiently, backward is slow).
        # Build (original_index, target) pairs sorted by frame_number.
        order = sorted(
            (i for i, t in enumerate(targets) if t is not None),
            key=lambda i: targets[i].frame_number,  # type: ignore[union-attr]
        )

        results: list[bytes | None] = [None] * len(timestamps_ms)
        if not order:
            return results

        async with self._reader.open(session) as video_path:
            decoded = await asyncio.get_event_loop().run_in_executor(
                None,
                self._extract_many_blocking,
                video_path,
                [targets[i].frame_number for i in order],  # type: ignore[union-attr]
            )

        for original_idx, jpeg in zip(order, decoded, strict=True):
            results[original_idx] = jpeg

        return results

    # ------------------------------------------------------------------
    # FrameIndex resolution
    # ------------------------------------------------------------------

    async def _resolve_seek_target(
        self, session_id: int, timestamp_ms: int
    ) -> _SeekTarget:
        """Find the best frame_number to seek to for ``timestamp_ms``.

        Priority:
          1. Nearest keyframe at-or-before target (best for accurate decode).
          2. Nearest indexed frame at-or-before target (any kind).
          3. Earliest indexed frame at-or-after target (fall-forward).

        Raises FrameExtractionError if no frames are indexed for the session.
        """
        # 1. Keyframe at-or-before
        stmt = (
            select(FrameIndex)
            .where(
                FrameIndex.video_capture_session_id == session_id,
                FrameIndex.timestamp_ms <= timestamp_ms,
                FrameIndex.is_keyframe.is_(True),
            )
            .order_by(FrameIndex.timestamp_ms.desc())
            .limit(1)
        )
        result = await self._db.execute(stmt)
        row = result.scalar_one_or_none()
        if row is not None:
            return _SeekTarget(
                frame_number=row.frame_number, timestamp_ms=row.timestamp_ms
            )

        # 2. Any frame at-or-before
        stmt = (
            select(FrameIndex)
            .where(
                FrameIndex.video_capture_session_id == session_id,
                FrameIndex.timestamp_ms <= timestamp_ms,
            )
            .order_by(FrameIndex.timestamp_ms.desc())
            .limit(1)
        )
        result = await self._db.execute(stmt)
        row = result.scalar_one_or_none()
        if row is not None:
            return _SeekTarget(
                frame_number=row.frame_number, timestamp_ms=row.timestamp_ms
            )

        # 3. Fall-forward — earliest frame at-or-after
        stmt = (
            select(FrameIndex)
            .where(
                FrameIndex.video_capture_session_id == session_id,
                FrameIndex.timestamp_ms >= timestamp_ms,
            )
            .order_by(FrameIndex.timestamp_ms.asc())
            .limit(1)
        )
        result = await self._db.execute(stmt)
        row = result.scalar_one_or_none()
        if row is not None:
            return _SeekTarget(
                frame_number=row.frame_number, timestamp_ms=row.timestamp_ms
            )

        raise FrameExtractionError(f"No FrameIndex entries for session {session_id}")

    # ------------------------------------------------------------------
    # cv2 blocking primitives (run via run_in_executor)
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_one_blocking(video_path: Path, frame_number: int) -> bytes | None:
        """Open + seek + read + encode a single frame. Blocking."""
        cap = cv2.VideoCapture(str(video_path))
        try:
            if not cap.isOpened():
                logger.error("video_capture_open_failed", path=str(video_path))
                return None
            return _seek_decode_encode(cap, frame_number)
        finally:
            cap.release()

    @staticmethod
    def _extract_many_blocking(
        video_path: Path, frame_numbers: list[int]
    ) -> list[bytes | None]:
        """Open the video once, seek+decode+encode each frame. Blocking.

        ``frame_numbers`` is expected to be in ascending order so seeks
        are mostly forward.
        """
        cap = cv2.VideoCapture(str(video_path))
        results: list[bytes | None] = []
        try:
            if not cap.isOpened():
                logger.error("video_capture_open_failed", path=str(video_path))
                return [None] * len(frame_numbers)

            for frame_number in frame_numbers:
                try:
                    jpeg = _seek_decode_encode(cap, frame_number)
                except Exception as exc:  # noqa: BLE001 — never fail batch
                    logger.warning(
                        "frame_extraction_individual_failed",
                        frame_number=frame_number,
                        error=str(exc),
                    )
                    jpeg = None
                results.append(jpeg)
        finally:
            cap.release()

        return results

    # ------------------------------------------------------------------
    # Cache write
    # ------------------------------------------------------------------

    async def _cache_jpeg(self, action_frame: ActionFrame, jpeg: bytes) -> None:
        """Write the JPEG to a deterministic local path and update the model.

        Best-effort: failures are logged but never propagated. The caller is
        responsible for committing the SQLAlchemy change.
        """
        # Cache directory: uploads/frame-cache/{session_id}/
        cache_dir = (
            Path("uploads") / "frame-cache" / str(action_frame.video_capture_session_id)
        )
        cache_path = cache_dir / (
            f"action-{action_frame.snapshot_action_id}-"
            f"{action_frame.frame_type}-frame{action_frame.frame_number}.jpg"
        )

        try:
            await asyncio.get_event_loop().run_in_executor(
                None, _write_cache_blocking, cache_path, jpeg
            )
        except OSError as exc:
            logger.warning(
                "frame_cache_write_failed",
                path=str(cache_path),
                error=str(exc),
            )
            return

        action_frame.cached_frame_path = str(cache_path)
        action_frame.cache_storage_backend = "local"


class FrameExtractionError(RuntimeError):
    """Raised when a frame cannot be extracted (missing index, decode fail)."""


# ----------------------------------------------------------------------
# Module-level helpers (kept outside the class to make patching/testing
# straightforward and avoid pickling issues with run_in_executor).
# ----------------------------------------------------------------------


def _seek_decode_encode(cap: cv2.VideoCapture, frame_number: int) -> bytes | None:
    """Seek to ``frame_number``, read the frame, return JPEG bytes or None."""
    cap.set(cv2.CAP_PROP_POS_FRAMES, float(frame_number))
    ret, frame = cap.read()
    if not ret or frame is None:
        return None

    ok, buf = cv2.imencode(
        ".jpg",
        frame,
        [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY],
    )
    if not ok:
        return None

    # buf is a numpy ndarray of uint8 — convert to plain bytes
    return bytes(np.asarray(buf).tobytes())


def _write_cache_blocking(path: Path, jpeg: bytes) -> None:
    """Write JPEG bytes to ``path``, creating parent dirs as needed."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        f.write(jpeg)
