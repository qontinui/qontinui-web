"""Pydantic schemas for configuration export/import."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class ImageData(BaseModel):
    """Image data for configuration export."""

    id: str
    name: str
    data: str
    format: str
    width: int
    height: int
    hash: str | None = None


class ActionConfig(BaseModel):
    """
    Flexible action configuration supporting all action types.

    Uses extra="allow" to support different config structures
    for different action types.
    """

    model_config = {"extra": "allow"}


class BaseActionSettings(BaseModel):
    """Base settings for actions."""

    enabled: bool | None = None
    notes: str | None = None


class ExecutionSettings(BaseModel):
    """Execution settings for actions."""

    timeout: int | None = None
    retryCount: int | None = None
    continueOnError: bool | None = None


class Action(BaseModel):
    """Action definition matching qontinui library schema."""

    id: str
    type: str
    name: str | None = None
    config: dict[str, Any]
    base: BaseActionSettings | None = None
    execution: ExecutionSettings | None = None
    position: tuple[int, int] | None = None


class Connection(BaseModel):
    """Connection from one action to another in graph format."""

    action: str = Field(..., description="Target action ID")
    type: str = Field(..., description="Connection type (main, error, success)")
    index: int = Field(..., description="Input index on target action")


class Variables(BaseModel):
    """Multi-scope variables for workflow execution."""

    local: dict[str, Any] | None = None
    process: dict[str, Any] | None = None
    globalVars: dict[str, Any] | None = Field(None, alias="global")


class WorkflowSettings(BaseModel):
    """Workflow-level settings."""

    timeout: int | None = None
    retryCount: int | None = None
    continueOnError: bool | None = None
    parallelExecution: bool | None = None
    maxParallelActions: int | None = None


class WorkflowMetadata(BaseModel):
    """Metadata about the workflow."""

    created: str | None = None
    updated: str | None = None
    author: str | None = None
    description: str | None = None
    version: str | None = None


class Workflow(BaseModel):
    """
    Complete workflow definition in graph format.

    Matches the qontinui library Workflow schema exactly.
    """

    id: str
    name: str
    version: str
    format: str = "graph"
    actions: list[Action]
    connections: dict[str, dict[str, list[list[Connection]]]]
    visibility: str | None = "public"
    variables: Variables | None = None
    settings: WorkflowSettings | None = None
    metadata: WorkflowMetadata | None = None
    category: str | None = None
    tags: list[str] | None = None


class StateImage(BaseModel):
    """Image used to identify a state."""

    imageId: str
    threshold: float = 0.9
    required: bool = True
    tags: list[str] = Field(default_factory=list)


class State(BaseModel):
    """State definition for state machine."""

    id: str
    name: str
    description: str | None = None
    identifyingImages: list[StateImage]
    position: dict[str, float]
    isInitial: bool = False
    isFinal: bool = False


class Transition(BaseModel):
    """Transition between states."""

    id: str
    type: str
    name: str
    processes: list[str]
    fromState: str | None = None
    toState: str | None = None
    staysVisible: bool = False
    activateStates: list[str] = Field(default_factory=list)
    deactivateStates: list[str] = Field(default_factory=list)
    timeout: int = 10000
    retryCount: int = 3


class GlobalExecutionSettings(BaseModel):
    """Global execution settings."""

    defaultTimeout: int = 10000
    defaultRetryCount: int = 3
    actionDelay: int = 100
    failureStrategy: str = "stop"


class RecognitionSettings(BaseModel):
    """Image recognition settings."""

    defaultThreshold: float = 0.9
    searchAlgorithm: str = "template_matching"
    multiScaleSearch: bool = True
    colorSpace: str = "rgb"


class LoggingSettings(BaseModel):
    """Logging settings."""

    level: str = "info"
    screenshotOnError: bool = True
    consoleOutput: bool = True


class PerformanceSettings(BaseModel):
    """Performance optimization settings."""

    maxParallelActions: int = 1
    cacheImages: bool = True
    optimizeSearch: bool = True


class Settings(BaseModel):
    """Global configuration settings."""

    execution: GlobalExecutionSettings = Field(default_factory=GlobalExecutionSettings)
    recognition: RecognitionSettings = Field(default_factory=RecognitionSettings)
    logging: LoggingSettings = Field(default_factory=LoggingSettings)
    performance: PerformanceSettings = Field(default_factory=PerformanceSettings)


class Metadata(BaseModel):
    """Configuration metadata."""

    name: str
    description: str | None = None
    author: str | None = None
    created: datetime
    modified: datetime
    tags: list[str] = Field(default_factory=list)
    targetApplication: str | None = None


class ConfigurationExport(BaseModel):
    """
    Complete configuration export format.

    This is the top-level schema for all configuration exports
    and imports. Uses 'workflows' terminology throughout.
    """

    version: str = "1.0.0"
    metadata: Metadata
    images: list[ImageData]
    workflows: list[Workflow]
    states: list[State]
    transitions: list[Transition]
    categories: list[str] = Field(default_factory=list)
    settings: Settings = Field(default_factory=Settings)


class ValidationResult(BaseModel):
    """Result of configuration validation."""

    valid: bool
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
