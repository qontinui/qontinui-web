"""
AutomationContext - Provides context and utilities for custom automation functions.

Available to custom functions via the 'context' parameter:

@automation_function(...)
def my_function(input, context: AutomationContext):
    context.log("Processing...")
    previous = context.previous_result
    ...
"""

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional, Set

from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


class AutomationContext:
    """
    Provides context and utilities for custom automation functions.

    Available methods and properties:
    - State management: get_state(), set_state()
    - Logging: log(), debug_breakpoint()
    - Action history: action_history, previous_result
    - Workflow metadata: workflow_id, run_id, variables
    - Screen/display: current_screenshot, screen_size (future)
    - Trigger actions: click(), find_pattern() (future)
    """

    def __init__(
        self,
        workflow_run_id: str,
        workflow_id: Optional[str] = None,
        db: Optional[AsyncSession] = None,
        variables: Optional[Dict[str, Any]] = None,
        action_history: Optional[List[Dict[str, Any]]] = None,
        active_states: Optional[Set[str]] = None,
    ):
        """
        Initialize automation context.

        Args:
            workflow_run_id: Unique ID for this workflow execution run
            workflow_id: ID of the workflow being executed
            db: Database session for state persistence
            variables: Workflow variables
            action_history: List of previous action results
            active_states: Currently active state machine states
        """
        self.workflow_run_id = workflow_run_id
        self._workflow_id = workflow_id
        self._db = db
        self._variables = variables or {}
        self._action_history = action_history or []
        self._active_states = active_states or set()

        # In-memory state (for this run)
        self._state: Dict[str, Any] = {}

        # Persistent state (across runs) - would be loaded from DB
        self._persistent_state: Dict[str, Any] = {}

        # Debug breakpoints
        self._breakpoints: List[Dict[str, Any]] = []

        # Execution logs
        self._logs: List[Dict[str, Any]] = []

    # ========================================================================
    # State Management
    # ========================================================================

    def get_state(self, key: str, default: Any = None) -> Any:
        """
        Get value from workflow state storage (in-memory for this run).

        Example:
            retry_count = context.get_state("retry_count", default=0)

        Args:
            key: State variable name
            default: Default value if key doesn't exist

        Returns:
            State value or default
        """
        return self._state.get(key, default)

    def set_state(self, key: str, value: Any) -> None:
        """
        Set value in workflow state storage (in-memory for this run).

        Example:
            context.set_state("retry_count", retry_count + 1)

        Args:
            key: State variable name
            value: Value to store
        """
        self._state[key] = value

        # Log state change
        self.log(f"State updated: {key} = {value}", level="debug")

    def get_persistent(self, key: str, default: Any = None) -> Any:
        """
        Get value from persistent state (across workflow runs).

        Persistent state is stored in database and survives workflow restarts.

        Example:
            last_run_date = context.get_persistent("last_run_date")

        Args:
            key: Persistent state variable name
            default: Default value if key doesn't exist

        Returns:
            Persistent state value or default
        """
        # TODO: Load from database (workflow_variables table)
        return self._persistent_state.get(key, default)

    def set_persistent(self, key: str, value: Any) -> None:
        """
        Set value in persistent state (across workflow runs).

        Example:
            context.set_persistent("last_run_date", datetime.now().isoformat())

        Args:
            key: Persistent state variable name
            value: Value to store
        """
        self._persistent_state[key] = value

        # TODO: Save to database (workflow_variables table)
        # This requires async, so we'd need to queue the write

        self.log(f"Persistent state updated: {key} = {value}", level="debug")

    def get_active_states(self) -> frozenset[str]:
        """
        Get currently active state machine states.

        Example:
            if "logged_in" in context.get_active_states():
                # User is logged in
                ...

        Returns:
            Frozen set of active state names
        """
        return frozenset(self._active_states)

    # ========================================================================
    # Logging & Debugging
    # ========================================================================

    def log(self, message: str, level: str = "info") -> None:
        """
        Log message (appears in workflow execution logs).

        Example:
            context.log("Processing email validation", level="info")
            context.log(f"Retrying (attempt {count})", level="warning")

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

    def debug_breakpoint(self, locals_dict: Dict[str, Any]) -> None:
        """
        Pause execution and show variables in UI (debugging).

        Example:
            if suspicious_condition:
                context.debug_breakpoint(locals())

        Args:
            locals_dict: Local variables to inspect (use locals())
        """
        breakpoint_data = {
            "timestamp": datetime.now().isoformat(),
            "workflow_run_id": self.workflow_run_id,
            "locals": locals_dict,
            "state": self._state.copy(),
        }

        self._breakpoints.append(breakpoint_data)
        self.log("Debug breakpoint triggered", level="debug")

        # TODO: Send to frontend via WebSocket for interactive debugging

    # ========================================================================
    # Action History
    # ========================================================================

    @property
    def action_history(self) -> List[Dict[str, Any]]:
        """
        Get history of previous actions in workflow.

        Example:
            for action in context.action_history:
                if action['type'] == 'click':
                    # Process click actions
                    ...

        Returns:
            List of action result dictionaries
        """
        return self._action_history

    @property
    def previous_result(self) -> Optional[Dict[str, Any]]:
        """
        Get result of previous action.

        Example:
            previous = context.previous_result
            if previous and previous.get('success'):
                text = previous.get('text', '')

        Returns:
            Previous action result dict, or None if no previous action
        """
        return self._action_history[-1] if self._action_history else None

    # ========================================================================
    # Workflow Metadata
    # ========================================================================

    @property
    def workflow_id(self) -> Optional[str]:
        """
        Current workflow ID.

        Returns:
            Workflow ID string
        """
        return self._workflow_id

    @property
    def run_id(self) -> str:
        """
        Unique ID for this execution run.

        Returns:
            Run ID string
        """
        return self.workflow_run_id

    @property
    def variables(self) -> Dict[str, Any]:
        """
        Get all workflow variables.

        Example:
            threshold = context.variables.get('threshold', 100)

        Returns:
            Dictionary of workflow variables
        """
        return self._variables

    # ========================================================================
    # Screen/Display Info (Future Implementation)
    # ========================================================================

    @property
    def current_screenshot(self):
        """
        Get current screen capture.

        NOTE: Only available when runner provides screenshot.

        Returns:
            PIL Image object, or None if not available
        """
        # TODO: Get screenshot from runner
        return None

    @property
    def screen_size(self) -> Optional[tuple[int, int]]:
        """
        Get screen dimensions (width, height).

        Returns:
            Tuple of (width, height), or None if not available
        """
        # TODO: Get from runner
        return None

    # ========================================================================
    # Trigger GUI Actions from Code (Future Implementation)
    # ========================================================================

    def click(self, x: int, y: int) -> Dict[str, Any]:
        """
        Click at coordinates.

        NOTE: This requires runner integration.

        Example:
            result = context.click(100, 200)

        Args:
            x: X coordinate
            y: Y coordinate

        Returns:
            Action result dictionary
        """
        # TODO: Send action to runner via WebSocket
        raise NotImplementedError("GUI actions require runner integration")

    def find_pattern(self, image_path: str) -> Dict[str, Any]:
        """
        Find pattern on screen.

        NOTE: This requires runner integration.

        Example:
            result = context.find_pattern("button.png")

        Args:
            image_path: Path to template image

        Returns:
            Action result dictionary with match information
        """
        # TODO: Call qontinui-api pattern matching
        raise NotImplementedError("Pattern matching requires runner integration")

    # ========================================================================
    # Internal Methods
    # ========================================================================

    def _get_execution_logs(self) -> List[Dict[str, Any]]:
        """Get all execution logs (for debugging)."""
        return self._logs.copy()

    def _get_breakpoints(self) -> List[Dict[str, Any]]:
        """Get all breakpoints (for debugging)."""
        return self._breakpoints.copy()

    def _update_action_history(self, action_result: Dict[str, Any]) -> None:
        """Add new action to history (internal use)."""
        self._action_history.append(action_result)

    def _clear_state(self) -> None:
        """Clear in-memory state (internal use)."""
        self._state.clear()
        self._logs.clear()
        self._breakpoints.clear()
