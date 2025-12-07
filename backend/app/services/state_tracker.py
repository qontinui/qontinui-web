"""
State tracking service for automation workflows.

Manages state machine states and debugging information.
"""

import asyncio
import logging
from datetime import datetime
from typing import Any

from app.services.websocket_manager import connection_manager

logger = logging.getLogger(__name__)


class StateTracker:
    """
    Manages state machine states and debugging information for automation workflows.

    Handles:
    - Active state machine states
    - Execution logs
    - Debug breakpoints
    """

    def __init__(
        self,
        workflow_run_id: str,
        active_states: set[str] | None = None,
    ):
        """
        Initialize state tracker.

        Args:
            workflow_run_id: Unique ID for this workflow execution run
            active_states: Currently active state machine states
        """
        self.workflow_run_id = workflow_run_id
        self._active_states = active_states or set()
        self._logs: list[dict[str, Any]] = []
        self._breakpoints: list[dict[str, Any]] = []

    # ========================================================================
    # State Machine States
    # ========================================================================

    def get_active_states(self) -> frozenset[str]:
        """
        Get currently active state machine states.

        Returns:
            Frozen set of active state names
        """
        return frozenset(self._active_states)

    # ========================================================================
    # Logging
    # ========================================================================

    def log(self, message: str, level: str = "info") -> None:
        """
        Log message (appears in workflow execution logs).

        Args:
            message: Log message
            level: Log level (debug, info, warning, error)
        """
        log_entry = {
            "timestamp": datetime.now().isoformat(),
            "level": level,
            "message": message,
            "workflow_run_id": self.workflow_run_id,
        }

        self._logs.append(log_entry)

        # Also log to Python logger
        logger.log(
            getattr(logging, level.upper()), f"[{self.workflow_run_id}] {message}"
        )

    def get_execution_logs(self) -> list[dict[str, Any]]:
        """
        Get all execution logs (for debugging).

        Returns:
            List of log entry dictionaries
        """
        return self._logs.copy()

    def clear_logs(self) -> None:
        """Clear execution logs (internal use)."""
        self._logs.clear()

    # ========================================================================
    # Debugging
    # ========================================================================

    def debug_breakpoint(self, locals_dict: dict[str, Any]) -> None:
        """
        Pause execution and show variables in UI (debugging).

        Args:
            locals_dict: Local variables to inspect (use locals())
        """
        # Serialize locals (filter out non-serializable items)
        serialized_locals = {}
        for key, value in locals_dict.items():
            if key.startswith("_"):
                continue  # Skip private variables
            try:
                # Test JSON serializability
                import json

                json.dumps(value)
                serialized_locals[key] = value
            except (TypeError, ValueError):
                # Not JSON serializable, convert to string representation
                serialized_locals[key] = str(value)

        breakpoint_data = {
            "timestamp": datetime.now().isoformat(),
            "workflow_run_id": self.workflow_run_id,
            "locals": serialized_locals,
        }

        self._breakpoints.append(breakpoint_data)
        self.log("Debug breakpoint triggered", level="debug")

        # Send to frontend via WebSocket for interactive debugging
        try:
            message = {
                "type": "debug_breakpoint",
                "data": breakpoint_data,
            }
            # Use asyncio to run async broadcast from sync context
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(
                    connection_manager.broadcast(self.workflow_run_id, message)
                )
            else:
                loop.run_until_complete(
                    connection_manager.broadcast(self.workflow_run_id, message)
                )
            logger.debug(
                f"[{self.workflow_run_id}] Breakpoint data sent to frontend via WebSocket"
            )
        except Exception as e:
            logger.warning(
                f"[{self.workflow_run_id}] Failed to send breakpoint to WebSocket: {e}"
            )

    def get_breakpoints(self) -> list[dict[str, Any]]:
        """
        Get all breakpoints (for debugging).

        Returns:
            List of breakpoint dictionaries
        """
        return self._breakpoints.copy()

    def clear_breakpoints(self) -> None:
        """Clear breakpoints (internal use)."""
        self._breakpoints.clear()
