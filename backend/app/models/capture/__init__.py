"""
Capture models for workflow learning.

This package contains models for the workflow learning capture system:
- CaptureSession: Recording of user interactions
- CaptureScreenshot: Individual screenshots with analysis
- CaptureAction: User actions (clicks, typing, etc.)
- CaptureDetectedElement: UI elements detected via CV
- ScreenshotStateMatch: Matches between screenshots and known states
- LearnedWorkflow: Generated workflows from captures
"""

from .action import CaptureAction
from .detected_element import CaptureDetectedElement
from .learned_workflow import LearnedWorkflow
from .screenshot import CaptureScreenshot
from .session import CaptureSession
from .state_match import ScreenshotStateMatch

__all__ = [
    "CaptureSession",
    "CaptureScreenshot",
    "CaptureAction",
    "CaptureDetectedElement",
    "ScreenshotStateMatch",
    "LearnedWorkflow",
]
