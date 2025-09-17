from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field
from datetime import datetime


class ImageData(BaseModel):
    id: str
    name: str
    data: str  # base64 encoded
    format: str
    width: int
    height: int
    hash: Optional[str] = None


class ActionConfig(BaseModel):
    target: Optional[Dict[str, Any]] = None
    text: Optional[str] = None
    key: Optional[str] = None
    position: Optional[Dict[str, float]] = None
    duration: Optional[int] = None
    direction: Optional[str] = None


class Action(BaseModel):
    id: str
    type: str
    config: ActionConfig
    timeout: Optional[int] = 5000
    retryCount: Optional[int] = 3


class Process(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    type: str = "sequence"
    actions: List[Action]


class StateImage(BaseModel):
    imageId: str
    threshold: float = 0.9
    required: bool = True
    tags: List[str] = Field(default_factory=list)


class State(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    identifyingImages: List[StateImage]
    position: Dict[str, float]
    isInitial: bool = False
    isFinal: bool = False


class Transition(BaseModel):
    id: str
    type: str
    name: str
    processes: List[str]
    fromState: Optional[str] = None
    toState: Optional[str] = None
    staysVisible: bool = False
    activateStates: List[str] = Field(default_factory=list)
    deactivateStates: List[str] = Field(default_factory=list)
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
    description: Optional[str] = None
    author: Optional[str] = None
    created: datetime
    modified: datetime
    tags: List[str] = Field(default_factory=list)
    targetApplication: Optional[str] = None


class ConfigurationExport(BaseModel):
    version: str = "1.0.0"
    metadata: Metadata
    images: List[ImageData]
    processes: List[Process]
    states: List[State]
    transitions: List[Transition]
    settings: Settings = Field(default_factory=Settings)


class ValidationResult(BaseModel):
    valid: bool
    errors: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)