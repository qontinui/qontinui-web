"""
Schemas for code execution requests and responses.

Extracted from code_execution_service.py for SRP compliance.
"""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ExecutionContext(BaseModel):
    """Context available during code execution."""

    model_config = ConfigDict(from_attributes=True)

    # Previous action result (from workflow)
    action_result: dict[str, Any] | None = None

    # Workflow variables
    variables: dict[str, Any] = Field(default_factory=dict)

    # Workflow state
    workflow_state: dict[str, Any] = Field(default_factory=dict)

    # Active states (from state machine)
    active_states: set[str] = Field(default_factory=set)

    # Execution metadata
    workflow_id: str | None = None
    run_id: str | None = None


class CodeExecutionRequest(BaseModel):
    """Request to execute Python code."""

    model_config = ConfigDict(from_attributes=True)

    code: str = Field(..., description="Python code to execute")

    context: ExecutionContext = Field(
        default_factory=ExecutionContext, description="Execution context"
    )

    inputs: dict[str, Any] = Field(
        default_factory=dict, description="Additional input variables"
    )

    timeout: int = Field(
        default=30, ge=1, le=60, description="Execution timeout in seconds"
    )

    allowed_imports: list[str] = Field(
        default_factory=lambda: [
            "re",
            "json",
            "math",
            "datetime",
            "collections",
            "itertools",
            "functools",
            "typing",
        ],
        description="Whitelist of allowed imports",
    )

    project_root: str | None = Field(
        default=None,
        description="Project root directory for import resolution (file-based execution)",
    )

    debug: bool = Field(default=False, description="Enable debug logging")


class CodeExecutionResult(BaseModel):
    """Result of code execution."""

    model_config = ConfigDict(from_attributes=True)

    success: bool
    result: Any = None
    error: str | None = None
    error_type: str | None = None
    traceback: str | None = None
    execution_time_ms: float
    stdout: str = ""
    stderr: str = ""
