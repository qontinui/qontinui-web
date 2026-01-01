"""
Video capture models for continuous video recording.

This package contains models for the video capture system (migrated from qontinui-api):
- VideoCaptureSession: Video recording session metadata
- InputEvent: Mouse and keyboard events
- FrameIndex: Timestamp to frame mapping
- ActionFrame: Links automation actions to video frames
- HistoricalResult: Queryable execution results
- StorageBackend/InputEventType: Enums
"""

from .action_frame import ActionFrame
from .enums import InputEventType, StorageBackend
from .frame_index import FrameIndex
from .historical_result import HistoricalResult
from .input_event import InputEvent
from .session import VideoCaptureSession

__all__ = [
    "StorageBackend",
    "InputEventType",
    "VideoCaptureSession",
    "InputEvent",
    "FrameIndex",
    "ActionFrame",
    "HistoricalResult",
]
