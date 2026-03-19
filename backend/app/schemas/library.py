"""Pydantic schemas for library CRUD operations."""

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.base import IsoDatetime

# =============================================================================
# Pagination
# =============================================================================


class Pagination(BaseModel):
    """Standard pagination info."""

    total: int
    limit: int
    offset: int
    has_more: bool


# =============================================================================
# Check
# =============================================================================


class CheckCreate(BaseModel):
    """Create a new check."""

    name: str = Field(..., max_length=255)
    description: str | None = None
    check_type: str = Field(default="custom", max_length=50)
    tool: str | None = Field(default=None, max_length=100)
    command: str | None = None
    working_directory: str | None = Field(default=None, max_length=500)
    config_path: str | None = Field(default=None, max_length=500)
    auto_fix: bool = False
    fail_on_warning: bool = False
    is_critical: bool = False
    timeout_seconds: int = Field(default=300, ge=1)
    enabled: bool = True
    tags: list[str] = Field(default_factory=list)
    project_id: UUID | None = None


class CheckUpdate(BaseModel):
    """Update a check."""

    name: str | None = Field(default=None, max_length=255)
    description: str | None = None
    check_type: str | None = Field(default=None, max_length=50)
    tool: str | None = Field(default=None, max_length=100)
    command: str | None = None
    working_directory: str | None = Field(default=None, max_length=500)
    config_path: str | None = Field(default=None, max_length=500)
    auto_fix: bool | None = None
    fail_on_warning: bool | None = None
    is_critical: bool | None = None
    timeout_seconds: int | None = Field(default=None, ge=1)
    enabled: bool | None = None
    tags: list[str] | None = None


class CheckResponse(BaseModel):
    """Check response."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_by_user_id: UUID
    project_id: UUID | None
    name: str
    description: str | None
    check_type: str
    tool: str | None
    command: str | None
    working_directory: str | None
    config_path: str | None
    auto_fix: bool
    fail_on_warning: bool
    is_critical: bool
    timeout_seconds: int
    enabled: bool
    tags: list[str]
    created_at: IsoDatetime
    updated_at: IsoDatetime


class CheckListResponse(BaseModel):
    """Paginated list of checks."""

    items: list[CheckResponse]
    pagination: Pagination


# =============================================================================
# CheckGroup
# =============================================================================


class CheckGroupCreate(BaseModel):
    """Create a new check group."""

    name: str = Field(..., max_length=255)
    description: str | None = None
    check_ids: list[UUID] = Field(default_factory=list)
    stop_on_failure: bool = False
    run_in_parallel: bool = False
    tags: list[str] = Field(default_factory=list)
    project_id: UUID | None = None


class CheckGroupUpdate(BaseModel):
    """Update a check group."""

    name: str | None = Field(default=None, max_length=255)
    description: str | None = None
    check_ids: list[UUID] | None = None
    stop_on_failure: bool | None = None
    run_in_parallel: bool | None = None
    tags: list[str] | None = None


class CheckGroupResponse(BaseModel):
    """Check group response."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_by_user_id: UUID
    project_id: UUID | None
    name: str
    description: str | None
    check_ids: list[UUID]
    stop_on_failure: bool
    run_in_parallel: bool
    tags: list[str]
    created_at: IsoDatetime
    updated_at: IsoDatetime


class CheckGroupListResponse(BaseModel):
    """Paginated list of check groups."""

    items: list[CheckGroupResponse]
    pagination: Pagination


# =============================================================================
# ShellCommand
# =============================================================================


class ShellCommandCreate(BaseModel):
    """Create a new shell command."""

    name: str = Field(..., max_length=255)
    description: str | None = None
    command: str
    working_directory: str | None = Field(default=None, max_length=500)
    platform: str | None = Field(default=None, max_length=50)
    timeout_seconds: int = Field(default=60, ge=1)
    fail_on_error: bool = True
    enabled: bool = True
    tags: list[str] = Field(default_factory=list)
    project_id: UUID | None = None


class ShellCommandUpdate(BaseModel):
    """Update a shell command."""

    name: str | None = Field(default=None, max_length=255)
    description: str | None = None
    command: str | None = None
    working_directory: str | None = Field(default=None, max_length=500)
    platform: str | None = Field(default=None, max_length=50)
    timeout_seconds: int | None = Field(default=None, ge=1)
    fail_on_error: bool | None = None
    enabled: bool | None = None
    tags: list[str] | None = None


class ShellCommandResponse(BaseModel):
    """Shell command response."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_by_user_id: UUID
    project_id: UUID | None
    name: str
    description: str | None
    command: str
    working_directory: str | None
    platform: str | None
    timeout_seconds: int
    fail_on_error: bool
    enabled: bool
    tags: list[str]
    created_at: IsoDatetime
    updated_at: IsoDatetime


class ShellCommandListResponse(BaseModel):
    """Paginated list of shell commands."""

    items: list[ShellCommandResponse]
    pagination: Pagination


# =============================================================================
# SavedApiRequest
# =============================================================================


class SavedApiRequestCreate(BaseModel):
    """Create a new saved API request."""

    name: str = Field(..., max_length=255)
    description: str | None = None
    method: str = Field(default="GET", max_length=10)
    url: str
    headers: dict = Field(default_factory=dict)
    body: str | None = None
    auth_config: dict | None = None
    variables: dict = Field(default_factory=dict)
    timeout_ms: int = Field(default=30000, ge=1)
    tags: list[str] = Field(default_factory=list)
    project_id: UUID | None = None


class SavedApiRequestUpdate(BaseModel):
    """Update a saved API request."""

    name: str | None = Field(default=None, max_length=255)
    description: str | None = None
    method: str | None = Field(default=None, max_length=10)
    url: str | None = None
    headers: dict | None = None
    body: str | None = None
    auth_config: dict | None = None
    variables: dict | None = None
    timeout_ms: int | None = Field(default=None, ge=1)
    tags: list[str] | None = None


class SavedApiRequestResponse(BaseModel):
    """Saved API request response."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_by_user_id: UUID
    project_id: UUID | None
    name: str
    description: str | None
    method: str
    url: str
    headers: dict
    body: str | None
    auth_config: dict | None
    variables: dict
    timeout_ms: int
    tags: list[str]
    created_at: IsoDatetime
    updated_at: IsoDatetime


class SavedApiRequestListResponse(BaseModel):
    """Paginated list of saved API requests."""

    items: list[SavedApiRequestResponse]
    pagination: Pagination


# =============================================================================
# Context
# =============================================================================


class ContextCreate(BaseModel):
    """Create a new context."""

    name: str = Field(..., max_length=255)
    description: str | None = None
    content: str
    category: str | None = Field(default=None, max_length=100)
    scope: str | None = Field(default=None, max_length=50)
    enabled: bool = True
    auto_include: dict | None = None
    tags: list[str] = Field(default_factory=list)
    project_id: UUID | None = None


class ContextUpdate(BaseModel):
    """Update a context."""

    name: str | None = Field(default=None, max_length=255)
    description: str | None = None
    content: str | None = None
    category: str | None = Field(default=None, max_length=100)
    scope: str | None = Field(default=None, max_length=50)
    enabled: bool | None = None
    auto_include: dict | None = None
    tags: list[str] | None = None


class ContextResponse(BaseModel):
    """Context response."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_by_user_id: UUID
    project_id: UUID | None
    name: str
    description: str | None
    content: str
    category: str | None
    scope: str | None
    enabled: bool
    auto_include: dict | None
    tags: list[str]
    created_at: IsoDatetime
    updated_at: IsoDatetime


class ContextListResponse(BaseModel):
    """Paginated list of contexts."""

    items: list[ContextResponse]
    pagination: Pagination


# =============================================================================
# Macro
# =============================================================================


class MacroStepSchema(BaseModel):
    """A single step in a macro."""

    action_type: str
    name: str | None = None
    target_image_ids: list[str] = Field(default_factory=list)
    target_image_names: list[str] = Field(default_factory=list)
    text_input: str | None = None
    hotkey: str | None = None
    target_state_ids: list[str] = Field(default_factory=list)
    target_state_names: list[str] = Field(default_factory=list)
    pause_after_ms: int | None = None
    timeout_seconds: int | None = None


class MacroCreate(BaseModel):
    """Create a new macro."""

    name: str = Field(..., max_length=255)
    description: str | None = None
    category: str | None = Field(default=None, max_length=100)
    steps: list[MacroStepSchema] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    project_id: UUID | None = None


class MacroUpdate(BaseModel):
    """Update a macro."""

    name: str | None = Field(default=None, max_length=255)
    description: str | None = None
    category: str | None = Field(default=None, max_length=100)
    steps: list[MacroStepSchema] | None = None
    tags: list[str] | None = None


class MacroResponse(BaseModel):
    """Macro response."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_by_user_id: UUID
    project_id: UUID | None
    name: str
    description: str | None
    category: str | None
    steps: list[dict]
    tags: list[str]
    created_at: IsoDatetime
    updated_at: IsoDatetime


class MacroListResponse(BaseModel):
    """Paginated list of macros."""

    items: list[MacroResponse]
    pagination: Pagination


# =============================================================================
# PromptSnippet
# =============================================================================


class PromptSnippetCreate(BaseModel):
    """Create a new prompt snippet."""

    name: str = Field(..., max_length=255)
    description: str | None = None
    language: str = Field(default="python", max_length=50)
    code: str
    category: str | None = Field(default=None, max_length=100)
    tags: list[str] = Field(default_factory=list)
    project_id: UUID | None = None


class PromptSnippetUpdate(BaseModel):
    """Update a prompt snippet."""

    name: str | None = Field(default=None, max_length=255)
    description: str | None = None
    language: str | None = Field(default=None, max_length=50)
    code: str | None = None
    category: str | None = Field(default=None, max_length=100)
    tags: list[str] | None = None


class PromptSnippetResponse(BaseModel):
    """Prompt snippet response."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_by_user_id: UUID
    project_id: UUID | None
    name: str
    description: str | None
    language: str
    code: str
    category: str | None
    tags: list[str]
    created_at: IsoDatetime
    updated_at: IsoDatetime


class PromptSnippetListResponse(BaseModel):
    """Paginated list of prompt snippets."""

    items: list[PromptSnippetResponse]
    pagination: Pagination
