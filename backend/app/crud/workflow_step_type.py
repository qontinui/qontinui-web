"""
CRUD operations for workflow step type configurations.

Manages step types, GUI action types, and workflow phases.
All three auto-seed with built-in defaults on first access.
"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.workflow_step_type import (
    GuiActionTypeConfig,
    StepTypeConfig,
    WorkflowPhaseConfig,
)
from app.schemas.workflow_step_type import (
    GuiActionTypeConfigCreate,
    GuiActionTypeConfigUpdate,
    StepTypeConfigCreate,
    StepTypeConfigUpdate,
    WorkflowPhaseConfigUpdate,
)

# ─── Default step types (from qontinui-runner STEP_TYPES) ───────────────────
# Each entry: (step_type, phase, label, description, icon, color, sort_order)

DEFAULT_STEP_TYPES: list[dict] = [
    # ── Setup phase ──
    {
        "step_type": "script",
        "phase": "setup",
        "label": "Playwright Script",
        "description": "Browser automation with Playwright",
        "icon": "FileCode",
        "color": "emerald",
        "sort_order": 1,
    },
    {
        "step_type": "state",
        "phase": "setup",
        "label": "Navigate to State",
        "description": "Go to a stored application state",
        "icon": "Navigation",
        "color": "blue",
        "sort_order": 2,
    },
    {
        "step_type": "workflow_ref",
        "phase": "setup",
        "label": "Run Workflow",
        "description": "Execute another saved workflow",
        "icon": "GitBranch",
        "color": "purple",
        "sort_order": 3,
    },
    {
        "step_type": "macro",
        "phase": "setup",
        "label": "Run Macro",
        "description": "Execute a saved macro (action sequence)",
        "icon": "Layers",
        "color": "pink",
        "sort_order": 4,
    },
    {
        "step_type": "gui_action",
        "phase": "setup",
        "label": "GUI Action",
        "description": "Click, type, or press hotkeys",
        "icon": "MousePointer2",
        "color": "orange",
        "sort_order": 5,
    },
    {
        "step_type": "api_request",
        "phase": "setup",
        "label": "API Request",
        "description": "Make HTTP requests to APIs",
        "icon": "Globe",
        "color": "cyan",
        "sort_order": 6,
    },
    {
        "step_type": "prompt",
        "phase": "setup",
        "label": "AI Setup Task",
        "description": "AI-driven environment preparation",
        "icon": "Bot",
        "color": "violet",
        "sort_order": 7,
    },
    {
        "step_type": "shell_command",
        "phase": "setup",
        "label": "Shell Command",
        "description": "Run shell commands (git, scripts, etc.)",
        "icon": "Terminal",
        "color": "gray",
        "sort_order": 8,
    },
    {
        "step_type": "mcp_call",
        "phase": "setup",
        "label": "MCP Call",
        "description": "Call a tool on an MCP server",
        "icon": "Plug",
        "color": "indigo",
        "sort_order": 9,
    },
    {
        "step_type": "test_playwright",
        "phase": "setup",
        "label": "Playwright Test",
        "description": "Browser assertions and checks",
        "icon": "TestTube2",
        "color": "green",
        "sort_order": 10,
    },
    {
        "step_type": "test_vision",
        "phase": "setup",
        "label": "Qontinui Vision Test",
        "description": "Visual element detection",
        "icon": "Eye",
        "color": "cyan",
        "sort_order": 11,
    },
    {
        "step_type": "test_python",
        "phase": "setup",
        "label": "Python Test",
        "description": "White-box unit tests",
        "icon": "Code",
        "color": "yellow",
        "sort_order": 12,
    },
    {
        "step_type": "test_repository",
        "phase": "setup",
        "label": "Repository Test",
        "description": "Run tests from your repo (pytest, jest, cargo)",
        "icon": "Package",
        "color": "indigo",
        "sort_order": 13,
    },
    {
        "step_type": "test_custom",
        "phase": "setup",
        "label": "Custom Test Command",
        "description": "Any shell command for testing",
        "icon": "Terminal",
        "color": "gray",
        "sort_order": 14,
    },
    {
        "step_type": "check_lint",
        "phase": "setup",
        "label": "Lint Check",
        "description": "Run linting checks (ruff, eslint, clippy)",
        "icon": "AlertTriangle",
        "color": "cyan",
        "sort_order": 15,
    },
    {
        "step_type": "check_format",
        "phase": "setup",
        "label": "Format Check",
        "description": "Run formatting checks (black, prettier, rustfmt)",
        "icon": "AlignLeft",
        "color": "cyan",
        "sort_order": 16,
    },
    {
        "step_type": "check_typecheck",
        "phase": "setup",
        "label": "Type Check",
        "description": "Run type checking (mypy, tsc)",
        "icon": "FileType",
        "color": "cyan",
        "sort_order": 17,
    },
    {
        "step_type": "check_analyze",
        "phase": "setup",
        "label": "Code Analysis",
        "description": "Run code analysis",
        "icon": "Search",
        "color": "indigo",
        "sort_order": 18,
    },
    {
        "step_type": "check_security",
        "phase": "setup",
        "label": "Security Check",
        "description": "Run security scans",
        "icon": "Shield",
        "color": "red",
        "sort_order": 19,
    },
    {
        "step_type": "check_custom",
        "phase": "setup",
        "label": "Custom Check",
        "description": "Run custom check command",
        "icon": "Terminal",
        "color": "cyan",
        "sort_order": 20,
    },
    {
        "step_type": "screenshot",
        "phase": "setup",
        "label": "Screenshot",
        "description": "Capture current screen state",
        "icon": "Camera",
        "color": "pink",
        "sort_order": 21,
    },
    {
        "step_type": "awas_discover",
        "phase": "setup",
        "label": "AWAS Discover",
        "description": "Discover AWAS manifest from a URL",
        "icon": "Search",
        "color": "teal",
        "sort_order": 22,
    },
    {
        "step_type": "awas_check_support",
        "phase": "setup",
        "label": "AWAS Check Support",
        "description": "Check if URL supports AWAS",
        "icon": "CheckCircle",
        "color": "teal",
        "sort_order": 23,
    },
    {
        "step_type": "awas_list_actions",
        "phase": "setup",
        "label": "AWAS List Actions",
        "description": "List available AWAS actions",
        "icon": "List",
        "color": "teal",
        "sort_order": 24,
    },
    {
        "step_type": "awas_execute",
        "phase": "setup",
        "label": "AWAS Execute",
        "description": "Execute an AWAS action",
        "icon": "Play",
        "color": "teal",
        "sort_order": 25,
    },
    # ── Verification phase ──
    {
        "step_type": "test_playwright",
        "phase": "verification",
        "label": "Playwright Test",
        "description": "Browser assertions and checks",
        "icon": "TestTube2",
        "color": "green",
        "sort_order": 1,
    },
    {
        "step_type": "test_vision",
        "phase": "verification",
        "label": "Qontinui Vision Test",
        "description": "Visual element detection",
        "icon": "Eye",
        "color": "cyan",
        "sort_order": 2,
    },
    {
        "step_type": "test_python",
        "phase": "verification",
        "label": "Python Test",
        "description": "White-box unit tests",
        "icon": "Code",
        "color": "yellow",
        "sort_order": 3,
    },
    {
        "step_type": "test_repository",
        "phase": "verification",
        "label": "Repository Test",
        "description": "Run tests from your repo (pytest, jest, cargo)",
        "icon": "Package",
        "color": "indigo",
        "sort_order": 4,
    },
    {
        "step_type": "test_custom",
        "phase": "verification",
        "label": "Custom Test Command",
        "description": "Any shell command for testing",
        "icon": "Terminal",
        "color": "gray",
        "sort_order": 5,
    },
    {
        "step_type": "check_lint",
        "phase": "verification",
        "label": "Lint Check",
        "description": "Run linting checks (ruff, eslint, clippy)",
        "icon": "AlertTriangle",
        "color": "cyan",
        "sort_order": 6,
    },
    {
        "step_type": "check_format",
        "phase": "verification",
        "label": "Format Check",
        "description": "Run formatting checks (black, prettier, rustfmt)",
        "icon": "AlignLeft",
        "color": "cyan",
        "sort_order": 7,
    },
    {
        "step_type": "check_typecheck",
        "phase": "verification",
        "label": "Type Check",
        "description": "Run type checking (mypy, tsc)",
        "icon": "FileType",
        "color": "cyan",
        "sort_order": 8,
    },
    {
        "step_type": "check_analyze",
        "phase": "verification",
        "label": "Code Analysis",
        "description": "Run code analysis (circular deps, god class, coupling, SRP, dead code)",
        "icon": "Search",
        "color": "indigo",
        "sort_order": 9,
    },
    {
        "step_type": "check_security",
        "phase": "verification",
        "label": "Security Check",
        "description": "Run security scans (vulnerability detection, unsafe code audit)",
        "icon": "Shield",
        "color": "red",
        "sort_order": 10,
    },
    {
        "step_type": "check_custom",
        "phase": "verification",
        "label": "Custom Check",
        "description": "Run custom check command",
        "icon": "Terminal",
        "color": "cyan",
        "sort_order": 11,
    },
    {
        "step_type": "screenshot",
        "phase": "verification",
        "label": "Screenshot",
        "description": "Capture current screen state",
        "icon": "Camera",
        "color": "pink",
        "sort_order": 12,
    },
    {
        "step_type": "state",
        "phase": "verification",
        "label": "Navigate to State",
        "description": "Go to a stored application state",
        "icon": "Navigation",
        "color": "blue",
        "sort_order": 13,
    },
    {
        "step_type": "workflow_ref",
        "phase": "verification",
        "label": "Run Workflow",
        "description": "Execute another saved workflow",
        "icon": "GitBranch",
        "color": "purple",
        "sort_order": 14,
    },
    {
        "step_type": "gui_action",
        "phase": "verification",
        "label": "GUI Action",
        "description": "Click, type, or press hotkeys",
        "icon": "MousePointer2",
        "color": "orange",
        "sort_order": 15,
    },
    {
        "step_type": "macro",
        "phase": "verification",
        "label": "Run Macro",
        "description": "Execute a saved macro (action sequence)",
        "icon": "Layers",
        "color": "pink",
        "sort_order": 16,
    },
    {
        "step_type": "script",
        "phase": "verification",
        "label": "Playwright Script",
        "description": "Browser automation with Playwright",
        "icon": "FileCode",
        "color": "emerald",
        "sort_order": 17,
    },
    {
        "step_type": "api_request",
        "phase": "verification",
        "label": "API Request",
        "description": "Verify API responses with assertions",
        "icon": "Globe",
        "color": "cyan",
        "sort_order": 18,
    },
    {
        "step_type": "shell_command",
        "phase": "verification",
        "label": "Shell Command",
        "description": "Run shell commands for verification",
        "icon": "Terminal",
        "color": "gray",
        "sort_order": 19,
    },
    {
        "step_type": "prompt",
        "phase": "verification",
        "label": "AI Verification",
        "description": "AI-evaluated success criteria",
        "icon": "Bot",
        "color": "violet",
        "sort_order": 20,
    },
    {
        "step_type": "mcp_call",
        "phase": "verification",
        "label": "MCP Call",
        "description": "Call an MCP tool for verification",
        "icon": "Plug",
        "color": "indigo",
        "sort_order": 21,
    },
    {
        "step_type": "awas_execute",
        "phase": "verification",
        "label": "AWAS Execute",
        "description": "Execute an AWAS action for verification",
        "icon": "Play",
        "color": "teal",
        "sort_order": 22,
    },
    {
        "step_type": "awas_list_actions",
        "phase": "verification",
        "label": "AWAS List Actions",
        "description": "List available AWAS actions",
        "icon": "List",
        "color": "teal",
        "sort_order": 23,
    },
    {
        "step_type": "awas_extract_elements",
        "phase": "verification",
        "label": "AWAS Extract Elements",
        "description": "Extract AWAS elements from HTML",
        "icon": "FileSearch",
        "color": "teal",
        "sort_order": 24,
    },
    {
        "step_type": "spec",
        "phase": "verification",
        "label": "UI Bridge Spec",
        "description": "Verify UI elements against spec assertions",
        "icon": "ShieldCheck",
        "color": "emerald",
        "sort_order": 25,
    },
    {
        "step_type": "gate",
        "phase": "verification",
        "label": "Gate",
        "description": "Aggregate step results to control agentic loop",
        "icon": "ShieldCheck",
        "color": "red",
        "sort_order": 26,
    },
    # ── Agentic phase ──
    {
        "step_type": "prompt",
        "phase": "agentic",
        "label": "Prompt",
        "description": "AI task instructions",
        "icon": "MessageSquare",
        "color": "amber",
        "sort_order": 1,
    },
    # ── Completion phase ──
    {
        "step_type": "prompt",
        "phase": "completion",
        "label": "AI Completion Task",
        "description": "Final AI actions after loop exits",
        "icon": "Bot",
        "color": "violet",
        "sort_order": 1,
    },
    {
        "step_type": "script",
        "phase": "completion",
        "label": "Playwright Script",
        "description": "Final browser automation",
        "icon": "FileCode",
        "color": "emerald",
        "sort_order": 2,
    },
    {
        "step_type": "api_request",
        "phase": "completion",
        "label": "API Request",
        "description": "Final API calls (notifications, cleanup)",
        "icon": "Globe",
        "color": "cyan",
        "sort_order": 3,
    },
    {
        "step_type": "shell_command",
        "phase": "completion",
        "label": "Shell Command",
        "description": "Run shell commands (git commit, cleanup, etc.)",
        "icon": "Terminal",
        "color": "gray",
        "sort_order": 4,
    },
    {
        "step_type": "mcp_call",
        "phase": "completion",
        "label": "MCP Call",
        "description": "Call an MCP tool (notifications, cleanup)",
        "icon": "Plug",
        "color": "indigo",
        "sort_order": 5,
    },
    {
        "step_type": "workflow_ref",
        "phase": "completion",
        "label": "Run Workflow",
        "description": "Execute another saved workflow",
        "icon": "GitBranch",
        "color": "purple",
        "sort_order": 6,
    },
    {
        "step_type": "state",
        "phase": "completion",
        "label": "Navigate to State",
        "description": "Return to a specific application state",
        "icon": "Navigation",
        "color": "blue",
        "sort_order": 7,
    },
    {
        "step_type": "macro",
        "phase": "completion",
        "label": "Run Macro",
        "description": "Execute a saved macro (action sequence)",
        "icon": "Layers",
        "color": "pink",
        "sort_order": 8,
    },
    {
        "step_type": "gui_action",
        "phase": "completion",
        "label": "GUI Action",
        "description": "Click, type, or press hotkeys",
        "icon": "MousePointer2",
        "color": "orange",
        "sort_order": 9,
    },
    {
        "step_type": "test_playwright",
        "phase": "completion",
        "label": "Playwright Test",
        "description": "Final browser assertions",
        "icon": "TestTube2",
        "color": "green",
        "sort_order": 10,
    },
    {
        "step_type": "test_vision",
        "phase": "completion",
        "label": "Qontinui Vision Test",
        "description": "Final visual verification",
        "icon": "Eye",
        "color": "cyan",
        "sort_order": 11,
    },
    {
        "step_type": "test_python",
        "phase": "completion",
        "label": "Python Test",
        "description": "Final unit tests",
        "icon": "Code",
        "color": "yellow",
        "sort_order": 12,
    },
    {
        "step_type": "test_repository",
        "phase": "completion",
        "label": "Repository Test",
        "description": "Run final tests from repo",
        "icon": "Package",
        "color": "indigo",
        "sort_order": 13,
    },
    {
        "step_type": "test_custom",
        "phase": "completion",
        "label": "Custom Test Command",
        "description": "Any shell command for final testing",
        "icon": "Terminal",
        "color": "gray",
        "sort_order": 14,
    },
    {
        "step_type": "check_lint",
        "phase": "completion",
        "label": "Lint Check",
        "description": "Final linting (ruff, eslint, clippy)",
        "icon": "AlertTriangle",
        "color": "cyan",
        "sort_order": 15,
    },
    {
        "step_type": "check_format",
        "phase": "completion",
        "label": "Format Check",
        "description": "Final formatting (black, prettier, rustfmt)",
        "icon": "AlignLeft",
        "color": "cyan",
        "sort_order": 16,
    },
    {
        "step_type": "check_typecheck",
        "phase": "completion",
        "label": "Type Check",
        "description": "Final type checking (mypy, tsc)",
        "icon": "FileType",
        "color": "cyan",
        "sort_order": 17,
    },
    {
        "step_type": "check_analyze",
        "phase": "completion",
        "label": "Code Analysis",
        "description": "Final code analysis",
        "icon": "Search",
        "color": "indigo",
        "sort_order": 18,
    },
    {
        "step_type": "check_security",
        "phase": "completion",
        "label": "Security Check",
        "description": "Final security scans",
        "icon": "Shield",
        "color": "red",
        "sort_order": 19,
    },
    {
        "step_type": "check_custom",
        "phase": "completion",
        "label": "Custom Check",
        "description": "Run custom check command",
        "icon": "Terminal",
        "color": "cyan",
        "sort_order": 20,
    },
    {
        "step_type": "screenshot",
        "phase": "completion",
        "label": "Screenshot",
        "description": "Capture final screen state",
        "icon": "Camera",
        "color": "pink",
        "sort_order": 21,
    },
]

# ─── Default GUI action types ────────────────────────────────────────────────

DEFAULT_GUI_ACTION_TYPES: list[dict] = [
    {
        "action_type": "click",
        "label": "Click",
        "icon": "MousePointer2",
        "description": "Single click on target",
        "sort_order": 1,
    },
    {
        "action_type": "double_click",
        "label": "Double-Click",
        "icon": "MousePointerClick",
        "description": "Double-click on target",
        "sort_order": 2,
    },
    {
        "action_type": "right_click",
        "label": "Right-Click",
        "icon": "MousePointer",
        "description": "Context menu click",
        "sort_order": 3,
    },
    {
        "action_type": "type",
        "label": "Type Text",
        "icon": "Keyboard",
        "description": "Type text at cursor",
        "sort_order": 4,
    },
    {
        "action_type": "hotkey",
        "label": "Hotkey",
        "icon": "Command",
        "description": "Press key combination",
        "sort_order": 5,
    },
    {
        "action_type": "scroll",
        "label": "Scroll",
        "icon": "ArrowUpDown",
        "description": "Scroll up or down",
        "sort_order": 6,
    },
]

# ─── Default workflow phases ─────────────────────────────────────────────────

DEFAULT_WORKFLOW_PHASES: list[dict] = [
    {
        "phase": "setup",
        "label": "Setup",
        "description": "Runs once at the beginning",
        "color": "blue",
        "sort_order": 1,
    },
    {
        "phase": "verification",
        "label": "Verification",
        "description": "Checks success criteria, loops with agentic",
        "color": "green",
        "sort_order": 2,
    },
    {
        "phase": "agentic",
        "label": "Agentic",
        "description": "AI work, iterates until verification passes",
        "color": "amber",
        "sort_order": 3,
    },
    {
        "phase": "completion",
        "label": "Completion",
        "description": "Runs once after the loop exits",
        "color": "purple",
        "sort_order": 4,
    },
]


# ─── Step Type CRUD ──────────────────────────────────────────────────────────


async def seed_default_step_types(
    db: AsyncSession, user_id: UUID
) -> list[StepTypeConfig]:
    rows: list[StepTypeConfig] = []
    for entry in DEFAULT_STEP_TYPES:
        row = StepTypeConfig(user_id=user_id, is_built_in=True, **entry)
        db.add(row)
        rows.append(row)
    await db.commit()
    for row in rows:
        await db.refresh(row)
    return rows


async def get_user_step_types(
    db: AsyncSession, user_id: UUID, phase: str | None = None
) -> list[StepTypeConfig]:
    query = select(StepTypeConfig).filter(StepTypeConfig.user_id == user_id)
    if phase:
        query = query.filter(StepTypeConfig.phase == phase)
    query = query.order_by(StepTypeConfig.phase, StepTypeConfig.sort_order)
    result = await db.execute(query)
    rows = list(result.scalars().all())
    if not rows and phase is None:
        rows = await seed_default_step_types(db, user_id)
    return rows


async def create_step_type(
    db: AsyncSession, user_id: UUID, data: StepTypeConfigCreate
) -> StepTypeConfig:
    row = StepTypeConfig(user_id=user_id, is_built_in=False, **data.model_dump())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def update_step_type(
    db: AsyncSession, user_id: UUID, config_id: UUID, data: StepTypeConfigUpdate
) -> StepTypeConfig | None:
    result = await db.execute(
        select(StepTypeConfig).filter(
            StepTypeConfig.id == config_id,
            StepTypeConfig.user_id == user_id,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        return None
    update_dict = data.model_dump(exclude_unset=True)
    if row.is_built_in:
        allowed = {"enabled", "sort_order"}
        update_dict = {k: v for k, v in update_dict.items() if k in allowed}
    for key, value in update_dict.items():
        setattr(row, key, value)
    await db.commit()
    await db.refresh(row)
    return row


async def delete_step_type(
    db: AsyncSession, user_id: UUID, config_id: UUID
) -> bool | str:
    result = await db.execute(
        select(StepTypeConfig).filter(
            StepTypeConfig.id == config_id,
            StepTypeConfig.user_id == user_id,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        return "Step type not found"
    if row.is_built_in:
        return "Cannot delete built-in step type"
    await db.delete(row)
    await db.commit()
    return True


async def reset_step_types(db: AsyncSession, user_id: UUID) -> list[StepTypeConfig]:
    result = await db.execute(
        select(StepTypeConfig).filter(StepTypeConfig.user_id == user_id)
    )
    for row in result.scalars().all():
        await db.delete(row)
    await db.commit()
    return await seed_default_step_types(db, user_id)


# ─── GUI Action Type CRUD ────────────────────────────────────────────────────


async def seed_default_gui_action_types(
    db: AsyncSession, user_id: UUID
) -> list[GuiActionTypeConfig]:
    rows: list[GuiActionTypeConfig] = []
    for entry in DEFAULT_GUI_ACTION_TYPES:
        row = GuiActionTypeConfig(user_id=user_id, is_built_in=True, **entry)
        db.add(row)
        rows.append(row)
    await db.commit()
    for row in rows:
        await db.refresh(row)
    return rows


async def get_user_gui_action_types(
    db: AsyncSession, user_id: UUID
) -> list[GuiActionTypeConfig]:
    result = await db.execute(
        select(GuiActionTypeConfig)
        .filter(GuiActionTypeConfig.user_id == user_id)
        .order_by(GuiActionTypeConfig.sort_order)
    )
    rows = list(result.scalars().all())
    if not rows:
        rows = await seed_default_gui_action_types(db, user_id)
    return rows


async def create_gui_action_type(
    db: AsyncSession, user_id: UUID, data: GuiActionTypeConfigCreate
) -> GuiActionTypeConfig:
    row = GuiActionTypeConfig(user_id=user_id, is_built_in=False, **data.model_dump())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def update_gui_action_type(
    db: AsyncSession, user_id: UUID, config_id: UUID, data: GuiActionTypeConfigUpdate
) -> GuiActionTypeConfig | None:
    result = await db.execute(
        select(GuiActionTypeConfig).filter(
            GuiActionTypeConfig.id == config_id,
            GuiActionTypeConfig.user_id == user_id,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        return None
    update_dict = data.model_dump(exclude_unset=True)
    if row.is_built_in:
        allowed = {"enabled", "sort_order"}
        update_dict = {k: v for k, v in update_dict.items() if k in allowed}
    for key, value in update_dict.items():
        setattr(row, key, value)
    await db.commit()
    await db.refresh(row)
    return row


async def delete_gui_action_type(
    db: AsyncSession, user_id: UUID, config_id: UUID
) -> bool | str:
    result = await db.execute(
        select(GuiActionTypeConfig).filter(
            GuiActionTypeConfig.id == config_id,
            GuiActionTypeConfig.user_id == user_id,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        return "GUI action type not found"
    if row.is_built_in:
        return "Cannot delete built-in GUI action type"
    await db.delete(row)
    await db.commit()
    return True


async def reset_gui_action_types(
    db: AsyncSession, user_id: UUID
) -> list[GuiActionTypeConfig]:
    result = await db.execute(
        select(GuiActionTypeConfig).filter(GuiActionTypeConfig.user_id == user_id)
    )
    for row in result.scalars().all():
        await db.delete(row)
    await db.commit()
    return await seed_default_gui_action_types(db, user_id)


# ─── Workflow Phase CRUD ─────────────────────────────────────────────────────


async def seed_default_workflow_phases(
    db: AsyncSession, user_id: UUID
) -> list[WorkflowPhaseConfig]:
    rows: list[WorkflowPhaseConfig] = []
    for entry in DEFAULT_WORKFLOW_PHASES:
        row = WorkflowPhaseConfig(user_id=user_id, is_built_in=True, **entry)
        db.add(row)
        rows.append(row)
    await db.commit()
    for row in rows:
        await db.refresh(row)
    return rows


async def get_user_workflow_phases(
    db: AsyncSession, user_id: UUID
) -> list[WorkflowPhaseConfig]:
    result = await db.execute(
        select(WorkflowPhaseConfig)
        .filter(WorkflowPhaseConfig.user_id == user_id)
        .order_by(WorkflowPhaseConfig.sort_order)
    )
    rows = list(result.scalars().all())
    if not rows:
        rows = await seed_default_workflow_phases(db, user_id)
    return rows


async def update_workflow_phase(
    db: AsyncSession, user_id: UUID, config_id: UUID, data: WorkflowPhaseConfigUpdate
) -> WorkflowPhaseConfig | None:
    result = await db.execute(
        select(WorkflowPhaseConfig).filter(
            WorkflowPhaseConfig.id == config_id,
            WorkflowPhaseConfig.user_id == user_id,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        return None
    update_dict = data.model_dump(exclude_unset=True)
    if row.is_built_in:
        allowed = {"enabled", "sort_order"}
        update_dict = {k: v for k, v in update_dict.items() if k in allowed}
    for key, value in update_dict.items():
        setattr(row, key, value)
    await db.commit()
    await db.refresh(row)
    return row


async def reset_workflow_phases(
    db: AsyncSession, user_id: UUID
) -> list[WorkflowPhaseConfig]:
    result = await db.execute(
        select(WorkflowPhaseConfig).filter(WorkflowPhaseConfig.user_id == user_id)
    )
    for row in result.scalars().all():
        await db.delete(row)
    await db.commit()
    return await seed_default_workflow_phases(db, user_id)
