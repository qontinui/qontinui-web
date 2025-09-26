from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class ImageData(BaseModel):
    id: str
    name: str
    data: str  # base64 encoded
    format: str
    width: int
    height: int
    hash: str | None = None


class ActionConfig(BaseModel):
    target: dict[str, Any] | None = None
    text: str | None = None
    key: str | None = None
    position: dict[str, float] | None = None
    duration: int | None = None
    direction: str | None = None


class Action(BaseModel):
    id: str
    type: str
    config: ActionConfig
    timeout: int | None = 5000
    retryCount: int | None = 3


class Process(BaseModel):
    id: str
    name: str
    description: str | None = None
    category: str | None = None  # Category for organizing processes
    type: str = "sequence"
    actions: list[Action]


class StateImage(BaseModel):
    imageId: str
    threshold: float = 0.9
    required: bool = True
    tags: list[str] = Field(default_factory=list)


class State(BaseModel):
    id: str
    name: str
    description: str | None = None
    identifyingImages: list[StateImage]
    position: dict[str, float]
    isInitial: bool = False
    isFinal: bool = False


class Transition(BaseModel):
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


class ExecutionSettings(BaseModel):
    defaultTimeout: int = 10000
    defaultRetryCount: int = 3
    actionDelay: int = 100
    failureStrategy: str = "stop"


class RecognitionSettings(BaseModel):
    defaultThreshold: float = 0.9
    searchAlgorithm: str = "template_matching"
    multiScaleSearch: bool = True
    colorSpace: str = "rgb"


class LoggingSettings(BaseModel):
    level: str = "info"
    screenshotOnError: bool = True
    consoleOutput: bool = True


class PerformanceSettings(BaseModel):
    maxParallelActions: int = 1
    cacheImages: bool = True
    optimizeSearch: bool = True


class Settings(BaseModel):
    execution: ExecutionSettings = Field(default_factory=ExecutionSettings)
    recognition: RecognitionSettings = Field(default_factory=RecognitionSettings)
    logging: LoggingSettings = Field(default_factory=LoggingSettings)
    performance: PerformanceSettings = Field(default_factory=PerformanceSettings)


class Metadata(BaseModel):
    name: str
    description: str | None = None
    author: str | None = None
    created: datetime
    modified: datetime
    tags: list[str] = Field(default_factory=list)
    targetApplication: str | None = None


class ConfigurationExport(BaseModel):
    version: str = "1.0.0"
    metadata: Metadata
    images: list[ImageData]
    processes: list[Process]
    states: list[State]
    transitions: list[Transition]
    categories: list[str] = Field(default_factory=list)  # List of process categories
    settings: Settings = Field(default_factory=Settings)


class ValidationResult(BaseModel):
    valid: bool
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
