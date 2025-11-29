"""
AutomationContext - Facade providing context and utilities for custom automation functions.

Available to custom functions via the 'context' parameter:

@automation_function(...)
def my_function(input, context: AutomationContext):
    context.log("Processing...")
    previous = context.previous_result
    ...
"""

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.action_executor import ActionExecutor
from app.services.pattern_matcher import PatternMatcher
from app.services.screenshot_capture import ScreenshotCapture
from app.services.state_tracker import StateTracker
from app.services.variable_store import VariableStore


class AutomationContext:
    """
    Facade providing context and utilities for custom automation functions.

    This class delegates to specialized services for different responsibilities:
    - VariableStore: Variable and state management
    - ActionExecutor: Action execution and history
    - ScreenshotCapture: Screenshot operations
    - PatternMatcher: Pattern matching delegation
    - StateTracker: State tracking and logging

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
        workflow_id: str | None = None,
        db: AsyncSession | None = None,
        variables: dict[str, Any] | None = None,
        action_history: list[dict[str, Any]] | None = None,
        active_states: set[str] | None = None,
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

        # Initialize specialized services
        self._variable_store = VariableStore(
            workflow_run_id=workflow_run_id,
            db=db,
            variables=variables,
        )
        self._action_executor = ActionExecutor(
            workflow_run_id=workflow_run_id,
            action_history=action_history,
        )
        self._screenshot_capture = ScreenshotCapture(
            workflow_run_id=workflow_run_id,
        )
        self._pattern_matcher = PatternMatcher(
            workflow_run_id=workflow_run_id,
        )
        self._state_tracker = StateTracker(
            workflow_run_id=workflow_run_id,
            active_states=active_states,
        )

    # ========================================================================
    # State Management (Delegates to VariableStore)
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
        return self._variable_store.get_state(key, default)

    def set_state(self, key: str, value: Any) -> None:
        """
        Set value in workflow state storage (in-memory for this run).

        Example:
            context.set_state("retry_count", retry_count + 1)

        Args:
            key: State variable name
            value: Value to store
        """
        self._variable_store.set_state(key, value)
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
        return self._variable_store.get_persistent(key, default)

    def set_persistent(self, key: str, value: Any) -> None:
        """
        Set value in persistent state (across workflow runs).

        Example:
            context.set_persistent("last_run_date", datetime.now().isoformat())

        Args:
            key: Persistent state variable name
            value: Value to store
        """
        self._variable_store.set_persistent(key, value)

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
        return self._state_tracker.get_active_states()

    # ========================================================================
    # Logging & Debugging (Delegates to StateTracker)
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
        self._state_tracker.log(message, level)

    def debug_breakpoint(self, locals_dict: dict[str, Any]) -> None:
        """
        Pause execution and show variables in UI (debugging).

        Example:
            if suspicious_condition:
                context.debug_breakpoint(locals())

        Args:
            locals_dict: Local variables to inspect (use locals())
        """
        self._state_tracker.debug_breakpoint(locals_dict)

    # ========================================================================
    # Action History (Delegates to ActionExecutor)
    # ========================================================================

    @property
    def action_history(self) -> list[dict[str, Any]]:
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
        return self._action_executor.get_action_history()

    @property
    def previous_result(self) -> dict[str, Any] | None:
        """
        Get result of previous action.

        Example:
            previous = context.previous_result
            if previous and previous.get('success'):
                text = previous.get('text', '')

        Returns:
            Previous action result dict, or None if no previous action
        """
        return self._action_executor.get_previous_result()

    # ========================================================================
    # Workflow Metadata
    # ========================================================================

    @property
    def workflow_id(self) -> str | None:
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
    def variables(self) -> dict[str, Any]:
        """
        Get all workflow variables.

        Example:
            threshold = context.variables.get('threshold', 100)

        Returns:
            Dictionary of workflow variables
        """
        return self._variable_store.get_variables()

    # ========================================================================
    # Screen/Display Info (Delegates to ScreenshotCapture)
    # ========================================================================

    @property
    def current_screenshot(self):
        """
        Get current screen capture.

        NOTE: Only available when runner provides screenshot.

        Returns:
            PIL Image object, or None if not available
        """
        return self._screenshot_capture.get_current_screenshot()

    @property
    def screen_size(self) -> tuple[int, int] | None:
        """
        Get screen dimensions (width, height).

        Returns:
            Tuple of (width, height), or None if not available
        """
        return self._screenshot_capture.get_screen_size()

    # ========================================================================
    # Trigger GUI Actions (Delegates to ActionExecutor & PatternMatcher)
    # ========================================================================

    def click(self, x: int, y: int) -> dict[str, Any]:
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
        return self._action_executor.click(x, y)

    def find_pattern(self, image_path: str) -> dict[str, Any]:
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
        return self._pattern_matcher.find_pattern(image_path)

    # ========================================================================
    # Internal Methods (For CodeExecutionService & WorkflowEngine)
    # ========================================================================

    def _get_execution_logs(self) -> list[dict[str, Any]]:
        """Get all execution logs (for debugging)."""
        return self._state_tracker.get_execution_logs()

    def _get_breakpoints(self) -> list[dict[str, Any]]:
        """Get all breakpoints (for debugging)."""
        return self._state_tracker.get_breakpoints()

    def _update_action_history(self, action_result: dict[str, Any]) -> None:
        """Add new action to history (internal use)."""
        self._action_executor.update_action_history(action_result)

    def _clear_state(self) -> None:
        """Clear in-memory state (internal use)."""
        self._variable_store.clear_state()
        self._state_tracker.clear_logs()
        self._state_tracker.clear_breakpoints()
