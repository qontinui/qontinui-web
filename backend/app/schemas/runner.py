"""
Pydantic schemas for runner connection management.

These schemas handle validation and serialization for runner connections.
"""

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.base import IsoDatetime


class RunnerConnectionResponse(BaseModel):
    """Schema for returning runner connection information."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    runner_name: str = Field(
        default="Desktop Runner",
        description="Name of the runner",
    )
    connected_at: IsoDatetime
    disconnected_at: IsoDatetime | None
    duration_seconds: int | None
    ip_address: str | None
    project_id: str | None
    project_name: str | None = None
    runner_port: int | None = Field(
        default=None,
        description="HTTP API port the runner is listening on",
    )
    ws_connected: bool = Field(
        default=False,
        description="Whether the runner is currently WebSocket-connected",
    )


class RunnerConnectionHistory(BaseModel):
    """Schema for paginated connection history."""

    connections: list[RunnerConnectionResponse]
    total: int = Field(
        ..., description="Total number of connections (across all pages)"
    )
    active_count: int = Field(..., description="Number of currently active connections")
    limit: int
    offset: int


class ConnectionCleanupResponse(BaseModel):
    """Schema for connection cleanup response."""

    total_active: int = Field(
        ..., description="Total number of active connections found in database"
    )
    stale_found: int = Field(..., description="Number of stale connections identified")
    cleaned: int = Field(
        ..., description="Number of connections successfully cleaned up"
    )
    message: str = Field(..., description="Human-readable status message")


class ExecuteWorkflowRequest(BaseModel):
    """Schema for executing a workflow on a connected runner."""

    workflow: dict = Field(
        ...,
        description="The workflow configuration to execute",
    )
    variables: dict | None = Field(
        default=None,
        description="Optional variables to pass to the workflow execution",
    )


class ExecuteWorkflowResponse(BaseModel):
    """Schema for workflow execution response."""

    execution_id: str = Field(
        ..., description="Unique ID for tracking this workflow execution"
    )
    status: str = Field(
        ..., description="Status of the execution request (sent, failed)"
    )
    message: str = Field(..., description="Human-readable status message")
    connection_id: int = Field(
        ..., description="The runner connection ID that received the workflow"
    )
