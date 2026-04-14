"""
CRUD operations for workflow step type configurations.

Manages step types, GUI action types, and workflow phases.
All three auto-seed with built-in defaults on first access.

Step type metadata can be fetched from the runner API for consistency,
falling back to the hardcoded DEFAULT_STEP_TYPES when the runner is unavailable.
"""

import logging
from uuid import UUID

import httpx
from app.models.workflow_step_type import (GuiActionTypeConfig, StepTypeConfig,
                                           WorkflowPhaseConfig)
from app.schemas.workflow_step_type import (GuiActionTypeConfigCreate,
                                            GuiActionTypeConfigUpdate,
                                            StepTypeConfigCreate,
                                            StepTypeConfigUpdate,
                                            WorkflowPhaseConfigUpdate)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# ─── Default step types (from qontinui-runner STEP_TYPES) ───────────────────
# Each entry: (step_type, phase, label, description, icon, color, sort_order)

DEFAULT_STEP_TYPES: list[dict] = [
    # ── Setup phase (3 core types) ──
    {
        "step_type": "command",
        "phase": "setup",
        "label": "Command",
        "description": "Run shell commands, checks, or tests",
        "icon": "Terminal",
        "color": "gray",
        "sort_order": 1,
    },
    {
        "step_type": "ui_bridge",
        "phase": "setup",
        "label": "UI Bridge",
        "description": "Interact with UI via UI Bridge SDK",
        "icon": "Monitor",
        "color": "emerald",
        "sort_order": 2,
    },
    {
        "step_type": "prompt",
        "phase": "setup",
        "label": "AI Task",
        "description": "AI-driven task",
        "icon": "Bot",
        "color": "violet",
        "sort_order": 3,
    },
    # ── Verification phase (3 core types) ──
    {
        "step_type": "command",
        "phase": "verification",
        "label": "Command",
        "description": "Run commands, checks, or tests for verification",
        "icon": "Terminal",
        "color": "gray",
        "sort_order": 1,
    },
    {
        "step_type": "ui_bridge",
        "phase": "verification",
        "label": "UI Bridge",
        "description": "Verify UI state via UI Bridge",
        "icon": "Monitor",
        "color": "emerald",
        "sort_order": 2,
    },
    {
        "step_type": "prompt",
        "phase": "verification",
        "label": "AI Verification",
        "description": "AI-evaluated criteria",
        "icon": "Bot",
        "color": "violet",
        "sort_order": 3,
    },
    # ── Agentic phase (prompt only) ──
    {
        "step_type": "prompt",
        "phase": "agentic",
        "label": "Prompt",
        "description": "AI task instructions",
        "icon": "MessageSquare",
        "color": "amber",
        "sort_order": 1,
    },
    # ── Completion phase (3 core types) ──
    {
        "step_type": "command",
        "phase": "completion",
        "label": "Command",
        "description": "Run cleanup commands or final tests",
        "icon": "Terminal",
        "color": "gray",
        "sort_order": 1,
    },
    {
        "step_type": "ui_bridge",
        "phase": "completion",
        "label": "UI Bridge",
        "description": "Final UI interactions",
        "icon": "Monitor",
        "color": "emerald",
        "sort_order": 2,
    },
    {
        "step_type": "prompt",
        "phase": "completion",
        "label": "AI Completion",
        "description": "Final AI actions",
        "icon": "Bot",
        "color": "violet",
        "sort_order": 3,
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


# ─── Runner-sourced step types ───────────────────────────────────────────────

RUNNER_STEP_TYPES_URL = "http://localhost:9876/step-types/metadata"


async def fetch_step_types_from_runner(
    timeout: float = 3.0,
) -> list[dict] | None:
    """Fetch step type metadata from the runner API.

    Returns a list of dicts in DEFAULT_STEP_TYPES format, or None if
    the runner is unavailable.
    """
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(RUNNER_STEP_TYPES_URL)
            resp.raise_for_status()
            data = resp.json()

        if not data.get("success") or not data.get("data"):
            return None

        # Convert runner metadata format to DEFAULT_STEP_TYPES format
        # Runner returns one entry per step type; we need one entry per type×phase
        entries: list[dict] = []
        sort_order = 1
        for meta in data["data"]:
            for phase in meta.get("allowed_phases", []):
                entries.append(
                    {
                        "step_type": meta["step_type"],
                        "phase": phase,
                        "label": meta["display_name"],
                        "description": meta["description"],
                        "icon": meta.get("icon", "Circle"),
                        "color": meta.get("color", "gray"),
                        "sort_order": sort_order,
                    }
                )
                sort_order += 1

        if entries:
            logger.info("Fetched %d step type entries from runner API", len(entries))
            return entries

    except Exception as e:
        logger.debug("Runner step types unavailable (using defaults): %s", e)

    return None


# ─── Step Type CRUD ──────────────────────────────────────────────────────────


async def seed_default_step_types(
    db: AsyncSession, user_id: UUID
) -> list[StepTypeConfig]:
    # Try to fetch from runner first for consistency
    runner_types = await fetch_step_types_from_runner()
    source_types = runner_types if runner_types else DEFAULT_STEP_TYPES

    rows: list[StepTypeConfig] = []
    for entry in source_types:
        row = StepTypeConfig(user_id=user_id, is_built_in=True, **entry)
        db.add(row)
        rows.append(row)
    await db.commit()
    for row in rows:
        await db.refresh(row)
    return rows


async def backfill_missing_built_in_step_types(
    db: AsyncSession, user_id: UUID, existing: list[StepTypeConfig]
) -> list[StepTypeConfig]:
    """Add any built-in step types that are missing from the user's config.

    This handles the case where new built-in step types are added after a user
    has already been seeded. Only inserts types where (step_type, phase) is not
    already present.
    """
    runner_types = await fetch_step_types_from_runner()
    source_types = runner_types if runner_types else DEFAULT_STEP_TYPES

    existing_keys = {(r.step_type, r.phase) for r in existing}
    new_rows: list[StepTypeConfig] = []
    for entry in source_types:
        key = (entry["step_type"], entry["phase"])
        if key not in existing_keys:
            row = StepTypeConfig(user_id=user_id, is_built_in=True, **entry)
            db.add(row)
            new_rows.append(row)

    if new_rows:
        logger.info(
            "Backfilled %d missing built-in step types for user %s: %s",
            len(new_rows),
            user_id,
            [(r.step_type, r.phase) for r in new_rows],
        )
        await db.commit()
        for row in new_rows:
            await db.refresh(row)
    return new_rows


async def cleanup_removed_built_in_step_types(
    db: AsyncSession, user_id: UUID, existing: list[StepTypeConfig]
) -> None:
    """Remove built-in step types that are no longer in the defaults.

    When a built-in step type is removed (e.g., "test" merged into "command"),
    this cleans up the stale rows so users don't see outdated types.
    """
    runner_types = await fetch_step_types_from_runner()
    source_types = runner_types if runner_types else DEFAULT_STEP_TYPES

    valid_keys = {(entry["step_type"], entry["phase"]) for entry in source_types}
    removed: list[StepTypeConfig] = []

    for row in existing:
        if row.is_built_in and (row.step_type, row.phase) not in valid_keys:
            removed.append(row)

    if removed:
        logger.info(
            "Removing %d stale built-in step types for user %s: %s",
            len(removed),
            user_id,
            [(r.step_type, r.phase) for r in removed],
        )
        for row in removed:
            await db.delete(row)
        await db.commit()


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
    elif rows and phase is None:
        # Clean up stale built-in types (e.g., "test" merged into "command")
        await cleanup_removed_built_in_step_types(db, user_id, rows)
        # Re-query after cleanup to get accurate list
        result = await db.execute(
            select(StepTypeConfig)
            .filter(StepTypeConfig.user_id == user_id)
            .order_by(StepTypeConfig.phase, StepTypeConfig.sort_order)
        )
        rows = list(result.scalars().all())
        # Backfill any new built-in types added since the user was seeded
        new_rows = await backfill_missing_built_in_step_types(db, user_id, rows)
        if new_rows:
            rows.extend(new_rows)
            rows.sort(key=lambda r: (r.phase, r.sort_order))
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
