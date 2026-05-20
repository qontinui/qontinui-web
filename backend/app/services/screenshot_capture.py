"""
Screenshot capture service for automation workflows.

Handles screen capture and display information retrieval from the runner.
"""

import asyncio
import base64
import io
import logging
from typing import Any

from PIL import Image

logger = logging.getLogger(__name__)


class ScreenshotCapture:
    """
    Manages screenshot capture and screen information for automation workflows.

    Handles:
    - Current screenshot retrieval
    - Screen dimension queries
    - Runner integration for display capture
    """

    def __init__(
        self,
        workflow_run_id: str,
        runner_connection_manager: Any = None,
        runner_connection_id: int | None = None,
    ):
        """
        Initialize screenshot capture service.

        Args:
            workflow_run_id: Unique ID for this workflow execution run
            runner_connection_manager: RunnerConnectionManager instance for runner communication
            runner_connection_id: Connection ID for the runner to communicate with
        """
        self.workflow_run_id = workflow_run_id
        self._runner_manager = runner_connection_manager
        self._connection_id = runner_connection_id
        self._cached_screenshot: Image.Image | None = None
        self._cached_screen_size: tuple[int, int] | None = None

    def set_runner_connection(
        self,
        runner_connection_manager: Any,
        runner_connection_id: int,
    ) -> None:
        """
        Set runner connection for screenshot capture.

        Args:
            runner_connection_manager: RunnerConnectionManager instance
            runner_connection_id: Connection ID for the runner
        """
        self._runner_manager = runner_connection_manager
        self._connection_id = runner_connection_id

    def update_from_runner_data(
        self,
        screenshot_data: str | bytes | None = None,
        screen_width: int | None = None,
        screen_height: int | None = None,
    ) -> None:
        """
        Update cached data from runner-provided screenshot.

        This is called when the runner sends a screenshot frame.

        Args:
            screenshot_data: Base64-encoded PNG screenshot data
            screen_width: Screen width in pixels
            screen_height: Screen height in pixels
        """
        if screenshot_data:
            try:
                # Decode base64 data if string
                if isinstance(screenshot_data, str):
                    image_bytes = base64.b64decode(screenshot_data)
                else:
                    image_bytes = screenshot_data

                # Load as PIL Image
                self._cached_screenshot = Image.open(io.BytesIO(image_bytes))
                logger.debug(
                    f"[{self.workflow_run_id}] Screenshot cached: {self._cached_screenshot.size}"
                )
            except Exception as e:
                logger.warning(
                    f"[{self.workflow_run_id}] Failed to decode screenshot: {e}"
                )

        if screen_width and screen_height:
            self._cached_screen_size = (screen_width, screen_height)

    # ========================================================================
    # Screen/Display Info
    # ========================================================================

    def get_current_screenshot(self) -> Image.Image | None:
        """
        Get current screen capture.

        Returns the cached screenshot from the runner. The runner sends screenshots
        as part of the automation session frame data.

        Returns:
            PIL Image object, or None if not available
        """
        return self._cached_screenshot

    def get_screen_size(self) -> tuple[int, int] | None:
        """
        Get screen dimensions (width, height).

        Returns:
            Tuple of (width, height), or None if not available
        """
        # Try cached value first
        if self._cached_screen_size:
            return self._cached_screen_size

        # Fall back to screenshot dimensions if available
        if self._cached_screenshot:
            # PIL Image.size is `tuple[int, int]` but typed as Any in the
            # stubs available here — surgical ignore for the baseline error.
            return self._cached_screenshot.size  # type: ignore[no-any-return]

        return None

    async def request_screenshot(self) -> Image.Image | None:
        """
        Request a fresh screenshot from the runner.

        Sends a command to the runner and waits for the response.

        Returns:
            PIL Image object, or None if not available or failed
        """
        if not self._runner_manager or not self._connection_id:
            logger.warning(
                f"[{self.workflow_run_id}] Cannot request screenshot: no runner connection"
            )
            return None

        try:
            command = {
                "type": "capture_screenshot",
                "workflow_run_id": self.workflow_run_id,
            }
            success = await self._runner_manager.send_command_to_runner(
                self._connection_id, command
            )
            if not success:
                logger.warning(
                    f"[{self.workflow_run_id}] Failed to send screenshot request to runner"
                )
                return None

            # Wait briefly for response (runner should send frame with screenshot)
            # The actual screenshot will arrive via WebSocket and update cache
            await asyncio.sleep(0.1)
            return self._cached_screenshot

        except Exception as e:
            logger.error(f"[{self.workflow_run_id}] Error requesting screenshot: {e}")
            return None
