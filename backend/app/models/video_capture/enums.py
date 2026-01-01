"""Enums for video capture models."""

from enum import Enum as PyEnum


class StorageBackend(PyEnum):
    """Storage backend types for video files."""

    LOCAL = "local"
    S3 = "s3"


class InputEventType(PyEnum):
    """Types of input events."""

    MOUSE_MOVE = "mouse_move"
    MOUSE_CLICK = "mouse_click"
    MOUSE_DOWN = "mouse_down"
    MOUSE_UP = "mouse_up"
    MOUSE_SCROLL = "mouse_scroll"
    MOUSE_DRAG = "mouse_drag"
    KEY_PRESS = "key_press"
    KEY_DOWN = "key_down"
    KEY_UP = "key_up"
