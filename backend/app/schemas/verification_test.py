"""Schemas for verification test API operations."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class VisionConfig(BaseModel):
    """Configuration for vision-based tests."""

    patterns: list[dict] | None = None
    assertions: list[dict] | None = None
    regions: list[dict] | None = None
    tolerance: float = 0.95


class RepoTestConfig(BaseModel):
    """Configuration for external test runners."""

    command: str
    working_dir: str | None = None
    env: dict[str, str] | None = None
    timeout_seconds: int = 300
    test_framework: str | None = None  # pytest, jest, etc.
    output_format: str | None = None  # json, junit, etc.


class VerificationTestCreate(BaseModel):
    """Schema for creating a verification test."""

    name: str
    description: str | None = None
    test_type: str  # playwright, vision, python, repo_test, custom
    category: str | None = None
    playwright_code: str | None = None
    vision_config: VisionConfig | None = None
    python_code: str | None = None
    repo_test_config: RepoTestConfig | None = None
    success_criteria: str | None = None
    config: dict | None = None
    timeout_seconds: int = 300
    is_critical: bool = False
    enabled: bool = True
    tags: list[str] | None = None


class VerificationTestUpdate(BaseModel):
    """Schema for updating a verification test."""

    name: str | None = None
    description: str | None = None
    test_type: str | None = None
    category: str | None = None
    playwright_code: str | None = None
    vision_config: VisionConfig | None = None
    python_code: str | None = None
    repo_test_config: RepoTestConfig | None = None
    success_criteria: str | None = None
    config: dict | None = None
    timeout_seconds: int | None = None
    is_critical: bool | None = None
    enabled: bool | None = None
    tags: list[str] | None = None


class VerificationTestResponse(BaseModel):
    """Schema for verification test response."""

    id: UUID
    project_id: UUID
    created_by_user_id: UUID | None
    name: str
    description: str | None
    test_type: str
    category: str | None
    playwright_code: str | None
    vision_config: dict | None
    python_code: str | None
    repo_test_config: dict | None
    success_criteria: str | None
    config: dict
    timeout_seconds: int
    is_critical: bool
    enabled: bool
    ai_generated: bool
    tags: list[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        """Pydantic model config."""

        from_attributes = True


class VerificationTestListResponse(BaseModel):
    """Schema for listing verification tests."""

    tests: list[VerificationTestResponse]
    total: int
    skip: int
    limit: int


# ===== Workflow Test Association Schemas =====


class WorkflowTestAssociationCreate(BaseModel):
    """Schema for creating a workflow test association."""

    test_id: UUID
    workflow_id: str
    trigger_point: str  # before_workflow, after_workflow, on_checkpoint, etc.
    checkpoint_name: str | None = None
    action_id: str | None = None
    execution_order: int = 0
    enabled: bool = True


class WorkflowTestAssociationUpdate(BaseModel):
    """Schema for updating a workflow test association."""

    trigger_point: str | None = None
    checkpoint_name: str | None = None
    action_id: str | None = None
    execution_order: int | None = None
    enabled: bool | None = None


class WorkflowTestAssociationResponse(BaseModel):
    """Schema for workflow test association response."""

    id: UUID
    project_id: UUID
    test_id: UUID
    workflow_id: str
    trigger_point: str
    checkpoint_name: str | None
    action_id: str | None
    execution_order: int
    enabled: bool
    created_at: datetime
    updated_at: datetime
    test: VerificationTestResponse | None = None

    class Config:
        """Pydantic model config."""

        from_attributes = True
