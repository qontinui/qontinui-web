"""Pydantic schemas for configuration export/import.

This module re-exports models from qontinui-schemas for configuration
validation and provides backend-specific schemas.

Version History:
- v1.0.0: Original format (deprecated)
- v2.0.0+: Uses qontinui-schemas models with stateImages, workflows terminology
"""

from pydantic import BaseModel, Field

# Import core models from qontinui-schemas
from qontinui_schemas import (
    ConfigMetadata,
    ConfigSettings,
    Connection,
    ExecutionRecord,
    ImageAsset,
    IncomingTransition,
    OutgoingTransition,
    Pattern,
    Position,
    QontinuiConfig,
    Schedule,
    SearchRegion,
    State,
    StateImage,
    StateLocation,
    StateRegion,
    StateString,
    Workflow,
    WorkflowMetadata,
    WorkflowSettings,
)

# Re-export for convenience
__all__ = [
    # From qontinui-schemas
    "ConfigMetadata",
    "ConfigSettings",
    "Connection",
    "ExecutionRecord",
    "ImageAsset",
    "IncomingTransition",
    "OutgoingTransition",
    "Pattern",
    "Position",
    "QontinuiConfig",
    "Schedule",
    "SearchRegion",
    "State",
    "StateImage",
    "StateLocation",
    "StateRegion",
    "StateString",
    "Workflow",
    "WorkflowMetadata",
    "WorkflowSettings",
    # Backend-specific
    "ValidationResult",
    "ConfigurationExport",
]


# =============================================================================
# Backend-specific schemas
# =============================================================================


class ValidationResult(BaseModel):
    """Result of configuration validation."""

    valid: bool
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


# Alias for backward compatibility
ConfigurationExport = QontinuiConfig
