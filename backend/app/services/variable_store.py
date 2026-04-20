"""
Variable storage and retrieval service for automation workflows.

Handles both in-memory (per-run) and persistent (across-runs) variable storage.
"""

import logging
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.workflow_variable import (
    VariableHistory,
    VariableScope,
    WorkflowVariable,
)

logger = logging.getLogger(__name__)


class VariableStore:
    """
    Manages workflow variables and state storage.

    Provides separate storage for:
    - Runtime variables: Workflow input/output variables
    - In-memory state: Temporary state for current run
    - Persistent state: State that survives across workflow runs
    """

    def __init__(
        self,
        workflow_run_id: str,
        db: AsyncSession | None = None,
        variables: dict[str, Any] | None = None,
        project_id: UUID | None = None,
        workflow_id: str | None = None,
    ):
        """
        Initialize variable store.

        Args:
            workflow_run_id: Unique ID for this workflow execution run
            db: Database session for state persistence
            variables: Initial workflow variables
            project_id: Project ID for persistent state operations
            workflow_id: Workflow ID for scoped persistent state
        """
        self.workflow_run_id = workflow_run_id
        self._db = db
        self._variables = variables or {}
        self._state: dict[str, Any] = {}
        self._persistent_state: dict[str, Any] = {}
        self._project_id = project_id
        self._workflow_id = workflow_id
        self._pending_writes: list[
            tuple[str, Any, Any | None]
        ] = []  # Queue for async writes

    # ========================================================================
    # Workflow Variables (Read-only)
    # ========================================================================

    def get_variables(self) -> dict[str, Any]:
        """
        Get all workflow variables.

        Returns:
            Dictionary of workflow variables
        """
        return self._variables

    def get_variable(self, key: str, default: Any = None) -> Any:
        """
        Get a workflow variable by key.

        Args:
            key: Variable name
            default: Default value if key doesn't exist

        Returns:
            Variable value or default
        """
        return self._variables.get(key, default)

    # ========================================================================
    # In-Memory State (Current Run)
    # ========================================================================

    def get_state(self, key: str, default: Any = None) -> Any:
        """
        Get value from in-memory state storage (current run only).

        Args:
            key: State variable name
            default: Default value if key doesn't exist

        Returns:
            State value or default
        """
        return self._state.get(key, default)

    def set_state(self, key: str, value: Any) -> None:
        """
        Set value in in-memory state storage (current run only).

        Args:
            key: State variable name
            value: Value to store
        """
        self._state[key] = value

    def clear_state(self) -> None:
        """Clear all in-memory state (internal use)."""
        self._state.clear()

    # ========================================================================
    # Persistent State (Across Runs)
    # ========================================================================

    def get_persistent(self, key: str, default: Any = None) -> Any:
        """
        Get value from persistent state (across workflow runs).

        Persistent state is stored in database and survives workflow restarts.
        This method returns cached values; use load_persistent_state() to load from DB.

        Args:
            key: Persistent state variable name
            default: Default value if key doesn't exist

        Returns:
            Persistent state value or default
        """
        return self._persistent_state.get(key, default)

    def set_persistent(self, key: str, value: Any) -> None:
        """
        Set value in persistent state (across workflow runs).

        Queues the write for async execution. Call flush_persistent_state() to persist.

        Args:
            key: Persistent state variable name
            value: Value to store
        """
        old_value = self._persistent_state.get(key)
        self._persistent_state[key] = value

        # Queue the write for async execution
        self._pending_writes.append((key, value, old_value))

        logger.debug(
            f"[{self.workflow_run_id}] Persistent state updated: {key} = {value}"
        )

    async def load_persistent_state(self) -> None:
        """
        Load all persistent state from database into cache.

        Call this at workflow start to populate the persistent state cache.
        """
        if not self._db or not self._project_id:
            logger.warning(
                f"[{self.workflow_run_id}] Cannot load persistent state: missing db or project_id"
            )
            return

        # Load workflow-scoped variables
        stmt = select(WorkflowVariable).where(
            WorkflowVariable.project_id == self._project_id,
            WorkflowVariable.workflow_id == self._workflow_id,
            WorkflowVariable.scope == VariableScope.WORKFLOW,
        )
        result = await self._db.execute(stmt)
        variables = result.scalars().all()

        for var in variables:
            self._persistent_state[str(var.name)] = var.value

        logger.debug(
            f"[{self.workflow_run_id}] Loaded {len(variables)} persistent variables from database"
        )

    async def flush_persistent_state(self) -> int:
        """
        Flush all pending persistent state writes to database.

        Returns:
            Number of variables written
        """
        if not self._db or not self._project_id:
            logger.warning(
                f"[{self.workflow_run_id}] Cannot flush persistent state: missing db or project_id"
            )
            return 0

        written = 0
        while self._pending_writes:
            key, value, old_value = self._pending_writes.pop(0)

            # Generate variable ID (project_id + workflow_id + name)
            var_id = f"{self._project_id}:{self._workflow_id or 'global'}:{key}"

            # Check if variable exists
            stmt = select(WorkflowVariable).where(WorkflowVariable.id == var_id)
            result = await self._db.execute(stmt)
            existing = result.scalar_one_or_none()

            if existing:
                # Update existing variable
                existing.value = value

                # Record history
                history = VariableHistory(
                    variable_id=var_id,
                    workflow_run_id=self.workflow_run_id,
                    old_value=old_value,
                    new_value=value,
                    changed_by_action=None,
                )
                self._db.add(history)
            else:
                # Create new variable
                new_var = WorkflowVariable(
                    id=var_id,
                    project_id=self._project_id,
                    workflow_id=self._workflow_id,
                    name=key,
                    value=value,
                    scope=(
                        VariableScope.WORKFLOW
                        if self._workflow_id
                        else VariableScope.GLOBAL
                    ),
                    description=None,
                )
                self._db.add(new_var)

                # Record history for new variable
                history = VariableHistory(
                    variable_id=var_id,
                    workflow_run_id=self.workflow_run_id,
                    old_value=None,
                    new_value=value,
                    changed_by_action=None,
                )
                self._db.add(history)

            written += 1

        await self._db.commit()
        logger.debug(
            f"[{self.workflow_run_id}] Flushed {written} persistent variables to database"
        )
        return written
