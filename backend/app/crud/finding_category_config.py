"""CRUD operations for finding category configurations."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.finding_category_config import FindingCategoryConfig
from app.schemas.finding_category_config import (
    FindingCategoryConfigCreate,
    FindingCategoryConfigUpdate,
)

# ─── 13 built-in defaults (from qontinui-runner FindingCategories.ts) ────────

DEFAULT_CATEGORIES: list[dict] = [
    {
        "slug": "code_bug",
        "name": "Code Bug",
        "description": "Actual code issues that can be auto-fixed",
        "icon": "Bug",
        "color": "red",
        "default_action_type": "auto_fix",
        "sort_order": 1,
    },
    {
        "slug": "todo",
        "name": "TODO",
        "description": "Tasks that may require user decisions",
        "icon": "CheckSquare",
        "color": "amber",
        "default_action_type": "needs_user_input",
        "sort_order": 2,
    },
    {
        "slug": "security",
        "name": "Security",
        "description": "Security vulnerabilities or concerns",
        "icon": "Shield",
        "color": "red",
        "default_action_type": "auto_fix",
        "sort_order": 3,
    },
    {
        "slug": "config_issue",
        "name": "Configuration Issue",
        "description": "Configuration or environment problems",
        "icon": "Settings",
        "color": "orange",
        "default_action_type": "manual",
        "sort_order": 4,
    },
    {
        "slug": "already_fixed",
        "name": "Already Fixed",
        "description": "Issues resolved in previous sessions",
        "icon": "CheckCircle",
        "color": "green",
        "default_action_type": "informational",
        "sort_order": 5,
    },
    {
        "slug": "expected_behavior",
        "name": "Expected Behavior",
        "description": "Intentional design, not a bug",
        "icon": "Info",
        "color": "blue",
        "default_action_type": "informational",
        "sort_order": 6,
    },
    {
        "slug": "data_migration",
        "name": "Data Migration",
        "description": "Requires admin or manual intervention",
        "icon": "Database",
        "color": "purple",
        "default_action_type": "manual",
        "sort_order": 7,
    },
    {
        "slug": "runtime_issue",
        "name": "Runtime Issue",
        "description": "Operational issues, not code bugs",
        "icon": "Activity",
        "color": "yellow",
        "default_action_type": "manual",
        "sort_order": 8,
    },
    {
        "slug": "test_issue",
        "name": "Test Issue",
        "description": "Problems with test code or test setup",
        "icon": "TestTube",
        "color": "purple",
        "default_action_type": "auto_fix",
        "sort_order": 9,
    },
    {
        "slug": "enhancement",
        "name": "Enhancement",
        "description": "Improvement suggestions",
        "icon": "Sparkles",
        "color": "cyan",
        "default_action_type": "needs_user_input",
        "sort_order": 10,
    },
    {
        "slug": "documentation",
        "name": "Documentation",
        "description": "Documentation issues or improvements",
        "icon": "FileText",
        "color": "slate",
        "default_action_type": "auto_fix",
        "sort_order": 11,
    },
    {
        "slug": "performance",
        "name": "Performance",
        "description": "Performance issues or optimization opportunities",
        "icon": "Zap",
        "color": "yellow",
        "default_action_type": "needs_user_input",
        "sort_order": 12,
    },
    {
        "slug": "warning",
        "name": "Warning",
        "description": "Things to be aware of",
        "icon": "AlertTriangle",
        "color": "yellow",
        "default_action_type": "informational",
        "sort_order": 13,
    },
]


async def seed_default_categories(
    db: AsyncSession,
    user_id: UUID,
) -> list[FindingCategoryConfig]:
    """Insert the 13 built-in defaults for a user."""
    categories: list[FindingCategoryConfig] = []
    for cat in DEFAULT_CATEGORIES:
        row = FindingCategoryConfig(
            user_id=user_id,
            is_built_in=True,
            **cat,
        )
        db.add(row)
        categories.append(row)
    await db.commit()
    for row in categories:
        await db.refresh(row)
    return categories


async def get_user_categories(
    db: AsyncSession,
    user_id: UUID,
) -> list[FindingCategoryConfig]:
    """List all categories for a user, ordered by sort_order. Auto-seeds if empty."""
    result = await db.execute(
        select(FindingCategoryConfig)
        .filter(FindingCategoryConfig.user_id == user_id)
        .order_by(FindingCategoryConfig.sort_order)
    )
    categories = list(result.scalars().all())
    if not categories:
        categories = await seed_default_categories(db, user_id)
    return categories


async def create_category(
    db: AsyncSession,
    user_id: UUID,
    data: FindingCategoryConfigCreate,
) -> FindingCategoryConfig:
    """Create a custom (non-built-in) category."""
    row = FindingCategoryConfig(
        user_id=user_id,
        is_built_in=False,
        **data.model_dump(),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def update_category(
    db: AsyncSession,
    user_id: UUID,
    category_id: UUID,
    data: FindingCategoryConfigUpdate,
) -> FindingCategoryConfig | None:
    """
    Update a category.
    Built-in categories: only enabled and sort_order can be changed.
    Custom categories: all fields can be changed.
    """
    result = await db.execute(
        select(FindingCategoryConfig).filter(
            FindingCategoryConfig.id == category_id,
            FindingCategoryConfig.user_id == user_id,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        return None

    update_dict = data.model_dump(exclude_unset=True)

    if row.is_built_in:
        # Only allow toggling enabled and changing sort_order on built-ins
        allowed = {"enabled", "sort_order"}
        update_dict = {k: v for k, v in update_dict.items() if k in allowed}

    for key, value in update_dict.items():
        setattr(row, key, value)

    await db.commit()
    await db.refresh(row)
    return row


async def delete_category(
    db: AsyncSession,
    user_id: UUID,
    category_id: UUID,
) -> bool | str:
    """
    Delete a custom category. Returns True on success, error string on failure.
    Built-in categories cannot be deleted (returns error string).
    """
    result = await db.execute(
        select(FindingCategoryConfig).filter(
            FindingCategoryConfig.id == category_id,
            FindingCategoryConfig.user_id == user_id,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        return "Category not found"
    if row.is_built_in:
        return "Cannot delete built-in category"

    await db.delete(row)
    await db.commit()
    return True


async def reset_to_defaults(
    db: AsyncSession,
    user_id: UUID,
) -> list[FindingCategoryConfig]:
    """Delete all categories for a user and re-seed defaults."""
    result = await db.execute(
        select(FindingCategoryConfig).filter(FindingCategoryConfig.user_id == user_id)
    )
    for row in result.scalars().all():
        await db.delete(row)
    await db.commit()
    return await seed_default_categories(db, user_id)
