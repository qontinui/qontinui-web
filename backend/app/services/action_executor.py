"""
Action execution service for automation workflows.

Handles triggering GUI actions (click, type, etc.) through the runner
and managing action history.
"""

import asyncio
import logging
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import httpx

logger = logging.getLogger(__name__)

# Runner base URL for pattern matching
RUNNER_URL = "http://localhost:8001"


class ActionExecutor:
    """
    Manages action execution and action history for automation workflows.

    Handles:
    - Action history tracking
    - GUI action execution (click, find_pattern, etc.) via runner
    """

    def __init__(
        self,
        workflow_run_id: str,
        action_history: list[dict[str, Any]] | None = None,
        runner_connection_manager: Any = None,
        runner_connection_id: int | None = None,
    ):
        """
        Initialize action executor.

        Args:
            workflow_run_id: Unique ID for this workflow execution run
            action_history: List of previous action results
            runner_connection_manager: RunnerConnectionManager instance for runner communication
            runner_connection_id: Connection ID for the runner to communicate with
        """
        self.workflow_run_id = workflow_run_id
        self._action_history = action_history or []
        self._runner_manager = runner_connection_manager
        self._connection_id = runner_connection_id
        self._pending_responses: dict[str, asyncio.Future] = {}

    def set_runner_connection(
        self,
        runner_connection_manager: Any,
        runner_connection_id: int,
    ) -> None:
        """
        Set runner connection for action execution.

        Args:
            runner_connection_manager: RunnerConnectionManager instance
            runner_connection_id: Connection ID for the runner
        """
        self._runner_manager = runner_connection_manager
        self._connection_id = runner_connection_id

    # ========================================================================
    # Action History
    # ========================================================================

    def get_action_history(self) -> list[dict[str, Any]]:
        """
        Get history of previous actions in workflow.

        Returns:
            List of action result dictionaries
        """
        return self._action_history

    def get_previous_result(self) -> dict[str, Any] | None:
        """
        Get result of previous action.

        Returns:
            Previous action result dict, or None if no previous action
        """
        return self._action_history[-1] if self._action_history else None

    def update_action_history(self, action_result: dict[str, Any]) -> None:
        """
        Add new action to history (internal use).

        Args:
            action_result: Action result dictionary to append
        """
        self._action_history.append(action_result)

    def handle_runner_response(self, action_id: str, response: dict[str, Any]) -> None:
        """
        Handle a response from the runner for a pending action.

        Called when the runner sends a response via WebSocket.

        Args:
            action_id: ID of the action that was executed
            response: Response data from the runner
        """
        if action_id in self._pending_responses:
            future = self._pending_responses[action_id]
            if not future.done():
                future.set_result(response)

    async def _send_action_to_runner(
        self,
        action_type: str,
        action_params: dict[str, Any],
        timeout: float = 10.0,
    ) -> dict[str, Any]:
        """
        Send an action to the runner and wait for response.

        Args:
            action_type: Type of action (click, type, etc.)
            action_params: Action parameters
            timeout: Timeout in seconds

        Returns:
            Action result dictionary

        Raises:
            RuntimeError: If no runner connection is available
            TimeoutError: If the action times out
        """
        if not self._runner_manager or not self._connection_id:
            raise RuntimeError(
                "GUI actions require runner integration - no runner connected"
            )

        # Generate unique action ID
        action_id = str(uuid4())

        # Create command message
        command = {
            "type": "action",
            "action_type": action_type,
            "action_id": action_id,
            "workflow_run_id": self.workflow_run_id,
            "params": action_params,
            "timestamp": datetime.now(UTC).isoformat(),
        }

        # Create future for response
        loop = asyncio.get_event_loop()
        future: asyncio.Future[dict[str, Any]] = loop.create_future()
        self._pending_responses[action_id] = future

        try:
            # Send command to runner
            success = await self._runner_manager.send_command_to_runner(
                self._connection_id, command
            )
            if not success:
                raise RuntimeError(f"Failed to send {action_type} action to runner")

            # Wait for response with timeout
            result = await asyncio.wait_for(future, timeout=timeout)

            # Record in action history
            action_result = {
                "action_id": action_id,
                "action_type": action_type,
                "params": action_params,
                "result": result,
                "timestamp": datetime.now(UTC).isoformat(),
                "success": result.get("success", False),
            }
            self._action_history.append(action_result)

            return action_result

        except TimeoutError:
            raise TimeoutError(f"Action {action_type} timed out after {timeout}s")
        finally:
            # Cleanup pending response
            self._pending_responses.pop(action_id, None)

    # ========================================================================
    # GUI Actions (Runner Integration)
    # ========================================================================

    async def click_async(self, x: int, y: int) -> dict[str, Any]:
        """
        Click at coordinates (async version).

        Args:
            x: X coordinate
            y: Y coordinate

        Returns:
            Action result dictionary
        """
        return await self._send_action_to_runner(
            "click",
            {"x": x, "y": y},
        )

    def click(self, x: int, y: int) -> dict[str, Any]:
        """
        Click at coordinates.

        NOTE: This is a synchronous wrapper. Prefer click_async in async contexts.

        Args:
            x: X coordinate
            y: Y coordinate

        Returns:
            Action result dictionary

        Raises:
            RuntimeError: If no runner connection or not in async context
        """
        if not self._runner_manager or not self._connection_id:
            raise RuntimeError(
                "GUI actions require runner integration - no runner connected"
            )

        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # Create task and return placeholder - caller should use async version
                logger.warning(
                    f"[{self.workflow_run_id}] click() called in async context - use click_async() instead"
                )
                # Schedule and return pending result
                asyncio.ensure_future(self.click_async(x, y))
                # Block would deadlock - raise instead
                raise RuntimeError(
                    "Cannot use synchronous click() in async context. Use await click_async() instead."
                )
            else:
                return loop.run_until_complete(self.click_async(x, y))
        except RuntimeError as e:
            if "no running event loop" in str(e):
                loop = asyncio.new_event_loop()
                try:
                    return loop.run_until_complete(self.click_async(x, y))
                finally:
                    loop.close()
            raise

    async def find_pattern_async(
        self, image_path: str, screenshot_data: bytes | None = None
    ) -> dict[str, Any]:
        """
        Find pattern on screen using template matching (async version).

        Calls the runner for pattern matching against current screenshot.

        Args:
            image_path: Path to template image
            screenshot_data: Optional screenshot bytes (if not provided, uses cached)

        Returns:
            Action result dictionary with match information
        """
        action_id = str(uuid4())

        try:
            # Call runner pattern matching endpoint
            async with httpx.AsyncClient() as client:
                # Prepare multipart form data
                files = {}
                data = {
                    "workflow_run_id": self.workflow_run_id,
                    "action_id": action_id,
                }

                # Add template image
                with open(image_path, "rb") as f:
                    files["template"] = (image_path, f.read(), "image/png")

                # Add screenshot if provided
                if screenshot_data:
                    files["screenshot"] = (
                        "screenshot.png",
                        screenshot_data,
                        "image/png",
                    )

                response = await client.post(
                    f"{RUNNER_URL}/api/v1/pattern-match",
                    files=files,
                    data=data,
                    timeout=30.0,
                )
                response.raise_for_status()
                result = response.json()

        except httpx.HTTPError as e:
            result = {
                "success": False,
                "error": f"Pattern matching API error: {e}",
                "matches": [],
            }
        except FileNotFoundError:
            result = {
                "success": False,
                "error": f"Template image not found: {image_path}",
                "matches": [],
            }
        except Exception as e:
            result = {
                "success": False,
                "error": f"Pattern matching failed: {e}",
                "matches": [],
            }

        # Record in action history
        action_result = {
            "action_id": action_id,
            "action_type": "find_pattern",
            "params": {"image_path": image_path},
            "result": result,
            "timestamp": datetime.now(UTC).isoformat(),
            "success": result.get("success", False),
        }
        self._action_history.append(action_result)

        return action_result

    def find_pattern(self, image_path: str) -> dict[str, Any]:
        """
        Find pattern on screen.

        NOTE: This is a synchronous wrapper. Prefer find_pattern_async in async contexts.

        Args:
            image_path: Path to template image

        Returns:
            Action result dictionary with match information
        """
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                raise RuntimeError(
                    "Cannot use synchronous find_pattern() in async context. "
                    "Use await find_pattern_async() instead."
                )
            else:
                return loop.run_until_complete(self.find_pattern_async(image_path))
        except RuntimeError as e:
            if "no running event loop" in str(e):
                loop = asyncio.new_event_loop()
                try:
                    return loop.run_until_complete(self.find_pattern_async(image_path))
                finally:
                    loop.close()
            raise
