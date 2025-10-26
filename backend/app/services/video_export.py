"""
Video Export Service

Generates MP4 videos from execution playback with overlays and visualizations.
Uses OpenCV for video generation with configurable quality and features.
"""

import logging
from collections.abc import Callable
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any

import cv2
import numpy as np

logger = logging.getLogger(__name__)


class VideoQuality(str, Enum):
    """Video quality presets"""

    LOW = "480p"
    MEDIUM = "720p"
    HIGH = "1080p"


class VideoExportOptions:
    """Options for video export"""

    def __init__(
        self,
        frame_duration: float = 1.5,
        quality: VideoQuality = VideoQuality.MEDIUM,
        include_overlays: bool = True,
        include_timeline: bool = True,
        include_text: bool = True,
        smooth_transitions: bool = True,
        fps: int = 30,
    ):
        self.frame_duration = frame_duration
        self.quality = quality
        self.include_overlays = include_overlays
        self.include_timeline = include_timeline
        self.include_text = include_text
        self.smooth_transitions = smooth_transitions
        self.fps = fps

    @property
    def target_resolution(self) -> tuple[int, int]:
        """Get target resolution based on quality"""
        resolutions = {
            VideoQuality.LOW: (854, 480),
            VideoQuality.MEDIUM: (1280, 720),
            VideoQuality.HIGH: (1920, 1080),
        }
        return resolutions[self.quality]


class VideoFrameRenderer:
    """Renders individual video frames with overlays"""

    def __init__(self, options: VideoExportOptions):
        self.options = options
        self.font_path = self._get_font_path()

    def _get_font_path(self) -> Path | None:
        """Try to find a suitable font"""
        common_fonts = [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
            "/System/Library/Fonts/Helvetica.ttc",
            "C:\\Windows\\Fonts\\arial.ttf",
        ]

        for font_path in common_fonts:
            if Path(font_path).exists():
                return Path(font_path)

        logger.warning("No system font found, using default")
        return None

    def render_frame(
        self,
        screenshot_path: str,
        action_data: dict[str, Any],
        frame_number: int,
        total_frames: int,
        target_size: tuple[int, int] | None = None,
    ) -> np.ndarray:
        """
        Render a single frame with all overlays

        Args:
            screenshot_path: Path to the screenshot image
            action_data: Action visualization data
            frame_number: Current frame number (0-indexed)
            total_frames: Total number of frames
            target_size: Optional target size (width, height)

        Returns:
            Frame as numpy array in BGR format
        """
        # Load screenshot
        try:
            img = cv2.imread(screenshot_path)
            if img is None:
                raise ValueError(f"Could not load image: {screenshot_path}")
        except Exception as e:
            logger.error(f"Error loading screenshot {screenshot_path}: {e}")
            # Create blank frame
            target_size = target_size or self.options.target_resolution
            img = np.zeros((target_size[1], target_size[0], 3), dtype=np.uint8)

        # Resize if needed
        if target_size:
            img = self._resize_frame(img, target_size)

        # Apply overlays
        if self.options.include_overlays:
            img = self._add_action_overlays(img, action_data)

        if self.options.include_text:
            img = self._add_text_overlays(img, action_data)

        if self.options.include_timeline:
            img = self._add_timeline(img, frame_number, total_frames)

        # Add success/failure badge
        img = self._add_status_badge(img, action_data.get("success", True))

        # Add active states
        active_states = action_data.get("active_states", [])
        if active_states:
            img = self._add_states_badge(img, active_states)

        return img

    def _resize_frame(
        self, img: np.ndarray, target_size: tuple[int, int]
    ) -> np.ndarray:
        """Resize frame maintaining aspect ratio"""
        h, w = img.shape[:2]
        target_w, target_h = target_size

        # Calculate scaling to fit within target while maintaining aspect ratio
        scale = min(target_w / w, target_h / h)
        new_w, new_h = int(w * scale), int(h * scale)

        # Resize
        img = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_LANCZOS4)

        # Add padding if needed
        if new_w != target_w or new_h != target_h:
            padded = np.zeros((target_h, target_w, 3), dtype=np.uint8)
            y_offset = (target_h - new_h) // 2
            x_offset = (target_w - new_w) // 2
            padded[y_offset : y_offset + new_h, x_offset : x_offset + new_w] = img
            img = padded

        return img

    def _add_action_overlays(
        self, img: np.ndarray, action_data: dict[str, Any]
    ) -> np.ndarray:
        """Add action-specific visualizations"""
        action_type = action_data.get("action_type", "")

        # Draw action region
        if "action_region" in action_data:
            region = action_data["action_region"]
            x, y, w, h = region["x"], region["y"], region["w"], region["h"]
            cv2.rectangle(img, (x, y), (x + w, y + h), (255, 255, 0), 2)

        # Draw action location (click point, etc.)
        if "action_location" in action_data:
            loc = action_data["action_location"]
            if loc and len(loc) == 2:
                x, y = int(loc[0]), int(loc[1])

                if action_type == "CLICK":
                    # Draw click ripple
                    cv2.circle(img, (x, y), 20, (0, 255, 0), 2)
                    cv2.circle(img, (x, y), 30, (0, 255, 0), 1)
                    cv2.circle(img, (x, y), 3, (0, 255, 0), -1)
                elif action_type == "TYPE":
                    # Draw keyboard indicator
                    cv2.circle(img, (x, y), 15, (255, 0, 255), 2)
                    cv2.putText(
                        img,
                        "KB",
                        (x - 10, y + 5),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.5,
                        (255, 0, 255),
                        2,
                    )
                else:
                    # Generic location marker
                    cv2.circle(img, (x, y), 5, (255, 0, 0), -1)

        # Draw matches for FIND actions
        if action_type == "FIND" and "matches" in action_data:
            for match in action_data["matches"]:
                x, y, w, h = match["x"], match["y"], match["w"], match["h"]
                score = match.get("score", 0)

                # Draw bounding box
                color = (0, 255, 0) if score > 0.9 else (0, 255, 255)
                cv2.rectangle(img, (x, y), (x + w, y + h), color, 2)

                # Draw score
                cv2.putText(
                    img,
                    f"{score:.2f}",
                    (x, y - 5),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.5,
                    color,
                    2,
                )

        return img

    def _add_text_overlays(
        self, img: np.ndarray, action_data: dict[str, Any]
    ) -> np.ndarray:
        """Add text overlays showing action details"""
        h, w = img.shape[:2]

        # Action type overlay
        action_type = action_data.get("action_type", "UNKNOWN")
        text = f"Action: {action_type}"

        # Add typed text if available
        if action_data.get("text"):
            text += f' - "{action_data["text"]}"'

        # Add duration
        duration_ms = action_data.get("duration_ms", 0)
        text += f" ({duration_ms:.0f}ms)"

        # Draw text box
        font = cv2.FONT_HERSHEY_SIMPLEX
        font_scale = 0.8
        thickness = 2
        (text_w, text_h), baseline = cv2.getTextSize(text, font, font_scale, thickness)

        # Background box
        padding = 10
        box_coords = ((10, 10), (20 + text_w + padding, 20 + text_h + padding))
        cv2.rectangle(img, box_coords[0], box_coords[1], (0, 0, 0), -1)
        cv2.rectangle(img, box_coords[0], box_coords[1], (255, 255, 255), 2)

        # Text
        cv2.putText(
            img, text, (15, 20 + text_h), font, font_scale, (255, 255, 255), thickness
        )

        return img

    def _add_timeline(
        self, img: np.ndarray, frame_number: int, total_frames: int
    ) -> np.ndarray:
        """Add timeline progress bar at bottom"""
        h, w = img.shape[:2]

        # Timeline dimensions
        bar_height = 30
        bar_y = h - bar_height - 10
        bar_x = 20
        bar_width = w - 40

        # Background
        cv2.rectangle(
            img, (bar_x, bar_y), (bar_x + bar_width, bar_y + bar_height), (0, 0, 0), -1
        )
        cv2.rectangle(
            img,
            (bar_x, bar_y),
            (bar_x + bar_width, bar_y + bar_height),
            (255, 255, 255),
            2,
        )

        # Progress
        progress = (frame_number + 1) / total_frames
        progress_width = int(bar_width * progress)
        cv2.rectangle(
            img,
            (bar_x, bar_y),
            (bar_x + progress_width, bar_y + bar_height),
            (0, 255, 0),
            -1,
        )

        # Text
        text = f"{frame_number + 1} / {total_frames}"
        font = cv2.FONT_HERSHEY_SIMPLEX
        font_scale = 0.6
        thickness = 2
        (text_w, text_h), _ = cv2.getTextSize(text, font, font_scale, thickness)
        text_x = bar_x + (bar_width - text_w) // 2
        text_y = bar_y + (bar_height + text_h) // 2

        cv2.putText(
            img, text, (text_x, text_y), font, font_scale, (255, 255, 255), thickness
        )

        return img

    def _add_status_badge(self, img: np.ndarray, success: bool) -> np.ndarray:
        """Add success/failure badge in top-right corner"""
        h, w = img.shape[:2]

        text = "SUCCESS" if success else "FAILED"
        color = (0, 255, 0) if success else (0, 0, 255)

        font = cv2.FONT_HERSHEY_SIMPLEX
        font_scale = 0.8
        thickness = 2
        (text_w, text_h), _ = cv2.getTextSize(text, font, font_scale, thickness)

        # Position in top-right
        padding = 15
        x = w - text_w - padding * 2
        y = padding

        # Background
        cv2.rectangle(
            img,
            (x - padding, y),
            (x + text_w + padding, y + text_h + padding * 2),
            color,
            -1,
        )

        # Text
        cv2.putText(
            img,
            text,
            (x, y + text_h + padding),
            font,
            font_scale,
            (255, 255, 255),
            thickness,
        )

        return img

    def _add_states_badge(self, img: np.ndarray, states: list[str]) -> np.ndarray:
        """Add active states badge in top-left corner"""
        if not states:
            return img

        text = "States: " + ", ".join(states[:3])  # Limit to 3 states
        if len(states) > 3:
            text += f" +{len(states) - 3}"

        font = cv2.FONT_HERSHEY_SIMPLEX
        font_scale = 0.6
        thickness = 2
        (text_w, text_h), _ = cv2.getTextSize(text, font, font_scale, thickness)

        # Position below action text overlay
        padding = 10
        x = 10
        y = 60

        # Background
        cv2.rectangle(
            img,
            (x, y),
            (x + text_w + padding * 2, y + text_h + padding * 2),
            (50, 50, 50),
            -1,
        )
        cv2.rectangle(
            img,
            (x, y),
            (x + text_w + padding * 2, y + text_h + padding * 2),
            (200, 200, 200),
            1,
        )

        # Text
        cv2.putText(
            img,
            text,
            (x + padding, y + text_h + padding),
            font,
            font_scale,
            (200, 200, 200),
            thickness,
        )

        return img


class VideoExporter:
    """Main video export service"""

    def __init__(self, options: VideoExportOptions):
        self.options = options
        self.renderer = VideoFrameRenderer(options)

    async def export_video(
        self,
        actions: list[dict[str, Any]],
        screenshot_base_path: str,
        output_path: str,
        progress_callback: Callable | None = None,
    ) -> dict[str, Any]:
        """
        Export execution to video file

        Args:
            actions: List of action visualization data
            screenshot_base_path: Base path for screenshot files
            output_path: Output video file path
            progress_callback: Optional callback for progress updates (frame, total)

        Returns:
            Dict with video metadata
        """
        try:
            start_time = datetime.now()

            # Prepare output path
            output_file = Path(output_path)
            output_file.parent.mkdir(parents=True, exist_ok=True)

            # Initialize video writer
            target_size = self.options.target_resolution
            fourcc = cv2.VideoWriter_fourcc(*"mp4v")
            out = cv2.VideoWriter(
                str(output_file), fourcc, self.options.fps, target_size
            )

            if not out.isOpened():
                raise RuntimeError("Failed to initialize video writer")

            total_frames = len(actions)
            frames_per_action = int(self.options.frame_duration * self.options.fps)

            logger.info(
                f"Starting video export: {total_frames} actions, {frames_per_action} frames each"
            )

            # Process each action
            for idx, action in enumerate(actions):
                # Build screenshot path
                screenshot_rel_path = action.get("screenshot_path", "")
                screenshot_path = str(Path(screenshot_base_path) / screenshot_rel_path)

                # Render base frame
                frame = self.renderer.render_frame(
                    screenshot_path,
                    action,
                    idx,
                    total_frames,
                    target_size,
                )

                # Write frames (duplicate for duration)
                if self.options.smooth_transitions and idx < total_frames - 1:
                    # Add transition frames
                    next_action = actions[idx + 1]
                    next_screenshot_path = str(
                        Path(screenshot_base_path)
                        / next_action.get("screenshot_path", "")
                    )

                    self._write_frames_with_transition(
                        out,
                        frame,
                        screenshot_path,
                        next_screenshot_path,
                        next_action,
                        idx + 1,
                        total_frames,
                        frames_per_action,
                        target_size,
                    )
                else:
                    # Write static frames
                    for _ in range(frames_per_action):
                        out.write(frame)

                # Progress callback
                if progress_callback:
                    await progress_callback(idx + 1, total_frames)

                # Log progress every 10 actions
                if (idx + 1) % 10 == 0 or idx == total_frames - 1:
                    logger.info(f"Processed {idx + 1}/{total_frames} actions")

            # Release video writer
            out.release()

            duration = (datetime.now() - start_time).total_seconds()

            # Get file info
            file_size = output_file.stat().st_size

            metadata = {
                "file_path": str(output_file),
                "file_size": file_size,
                "duration_seconds": duration,
                "total_frames": total_frames,
                "fps": self.options.fps,
                "resolution": target_size,
                "quality": self.options.quality.value,
            }

            logger.info(f"Video export completed: {metadata}")

            return metadata

        except Exception as e:
            logger.error(f"Video export failed: {e}", exc_info=True)
            raise

    def _write_frames_with_transition(
        self,
        out: cv2.VideoWriter,
        current_frame: np.ndarray,
        current_screenshot: str,
        next_screenshot: str,
        next_action: dict[str, Any],
        next_idx: int,
        total_frames: int,
        frames_per_action: int,
        target_size: tuple[int, int],
    ):
        """Write frames with smooth transition to next frame"""
        # Write most frames as-is
        hold_frames = int(frames_per_action * 0.8)
        transition_frames = frames_per_action - hold_frames

        for _ in range(hold_frames):
            out.write(current_frame)

        # Render next frame for transition
        try:
            next_frame = self.renderer.render_frame(
                next_screenshot,
                next_action,
                next_idx,
                total_frames,
                target_size,
            )

            # Blend transition
            for i in range(transition_frames):
                alpha = i / transition_frames
                blended = cv2.addWeighted(
                    current_frame, 1 - alpha, next_frame, alpha, 0
                )
                out.write(blended)
        except Exception as e:
            logger.warning(f"Transition rendering failed: {e}")
            # Fall back to static frames
            for _ in range(transition_frames):
                out.write(current_frame)


async def create_execution_video(
    execution_data: dict[str, Any],
    screenshot_base_path: str,
    output_path: str,
    options: VideoExportOptions | None = None,
    progress_callback: Callable | None = None,
) -> dict[str, Any]:
    """
    Convenience function to create video from execution data

    Args:
        execution_data: Execution response data with actions
        screenshot_base_path: Base path for screenshots
        output_path: Output video file path
        options: Optional video export options
        progress_callback: Optional progress callback

    Returns:
        Video metadata dict
    """
    if options is None:
        options = VideoExportOptions()

    exporter = VideoExporter(options)

    actions = execution_data.get("actions", [])
    if not actions:
        raise ValueError("No actions found in execution data")

    return await exporter.export_video(
        actions,
        screenshot_base_path,
        output_path,
        progress_callback,
    )
