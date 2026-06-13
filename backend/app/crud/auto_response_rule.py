"""CRUD operations for org-scoped auto-response rules."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auto_response_rule import AutoResponseRule
from app.schemas.auto_response_rule import (
    AutoResponseRuleCreate,
    AutoResponseRuleUpdate,
)

# Sentinel returned by ``delete_rule`` when the caller tries to delete a
# built-in rule; the endpoint maps this to a 403.
DELETE_BUILTIN_FORBIDDEN = "cannot_delete_built_in"

# ─── Built-in default rule(s), seeded per-org on first read ──────────────────
# NOTE: ``max_delay_secs=None`` is INTENTIONAL — the rate-limit auto-continue
# backoff is unbounded (it keeps doubling the delay with no cap).
DEFAULT_RULES: list[dict] = [
    {
        "name": "Server rate-limit auto-continue",
        "pattern": r"(?i)server is temporarily limiting requests",
        "prompt": "Please continue.",
        "enabled": True,
        "is_built_in": True,
        "sort_order": 0,
        "backoff": {
            "initial_delay_secs": 60,
            "multiplier": 2.0,
            "max_delay_secs": None,
        },
    },
]


async def seed_default_rules(
    db: AsyncSession,
    organization_id: UUID,
) -> list[AutoResponseRule]:
    """Insert the built-in default rule(s) for an organization."""
    rules: list[AutoResponseRule] = []
    for spec in DEFAULT_RULES:
        row = AutoResponseRule(organization_id=organization_id, **spec)
        db.add(row)
        rules.append(row)
    await db.commit()
    for row in rules:
        await db.refresh(row)
    return rules


async def get_org_rules(
    db: AsyncSession,
    organization_id: UUID,
) -> list[AutoResponseRule]:
    """List all rules for an org, ordered by sort_order. Auto-seeds if empty."""
    result = await db.execute(
        select(AutoResponseRule)
        .filter(AutoResponseRule.organization_id == organization_id)
        .order_by(AutoResponseRule.sort_order)
    )
    rules = list(result.scalars().all())
    if not rules:
        rules = await seed_default_rules(db, organization_id)
    return rules


async def get_rule(
    db: AsyncSession,
    organization_id: UUID,
    rule_id: UUID,
) -> AutoResponseRule | None:
    """Get a single rule scoped to the organization."""
    result = await db.execute(
        select(AutoResponseRule).filter(
            AutoResponseRule.id == rule_id,
            AutoResponseRule.organization_id == organization_id,
        )
    )
    return result.scalar_one_or_none()


async def create_rule(
    db: AsyncSession,
    organization_id: UUID,
    data: AutoResponseRuleCreate,
) -> AutoResponseRule:
    """Create a custom (non-built-in) rule appended to the end of the order."""
    max_result = await db.execute(
        select(func.max(AutoResponseRule.sort_order)).filter(
            AutoResponseRule.organization_id == organization_id
        )
    )
    current_max = max_result.scalar()
    next_order = 0 if current_max is None else current_max + 1

    row = AutoResponseRule(
        organization_id=organization_id,
        name=data.name,
        pattern=data.pattern,
        prompt=data.prompt,
        enabled=data.enabled,
        is_built_in=False,
        sort_order=next_order,
        backoff=data.backoff.model_dump(),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def update_rule(
    db: AsyncSession,
    organization_id: UUID,
    rule_id: UUID,
    data: AutoResponseRuleUpdate,
) -> AutoResponseRule | None:
    """
    Partially update a rule. Built-ins are editable but ``is_built_in`` is
    never flipped (the field is not exposed on the update schema).
    """
    row = await get_rule(db, organization_id, rule_id)
    if row is None:
        return None

    update_dict = data.model_dump(exclude_unset=True)
    # Never let an update flip the built-in flag (defensive — not on schema).
    update_dict.pop("is_built_in", None)

    if "backoff" in update_dict and update_dict["backoff"] is not None:
        # ``backoff`` is a nested model; model_dump already produced a plain
        # dict, but normalize defensively in case None was passed.
        update_dict["backoff"] = dict(update_dict["backoff"])

    for key, value in update_dict.items():
        setattr(row, key, value)

    await db.commit()
    await db.refresh(row)
    return row


async def delete_rule(
    db: AsyncSession,
    organization_id: UUID,
    rule_id: UUID,
) -> bool | str | None:
    """
    Delete a rule.

    Returns:
        ``None`` if the rule does not exist (→ 404).
        ``DELETE_BUILTIN_FORBIDDEN`` if the rule is built-in (→ 403).
        ``True`` on successful delete.
    """
    row = await get_rule(db, organization_id, rule_id)
    if row is None:
        return None
    if row.is_built_in:
        return DELETE_BUILTIN_FORBIDDEN

    await db.delete(row)
    await db.commit()
    return True


async def reorder_rules(
    db: AsyncSession,
    organization_id: UUID,
    ordered_ids: list[UUID],
) -> list[AutoResponseRule]:
    """
    Apply a new ordering. Each id in ``ordered_ids`` gets sort_order = its
    index; ids not belonging to the org are ignored. Returns the org's rules
    in the new order.
    """
    result = await db.execute(
        select(AutoResponseRule).filter(
            AutoResponseRule.organization_id == organization_id
        )
    )
    rows = {row.id: row for row in result.scalars().all()}
    for index, rule_id in enumerate(ordered_ids):
        row = rows.get(rule_id)
        if row is not None:
            row.sort_order = index
    await db.commit()
    return await get_org_rules(db, organization_id)


async def org_rules_version(
    db: AsyncSession,
    organization_id: UUID,
) -> tuple[int, datetime]:
    """
    Return ``(count, max_updated_at)`` for the org's rules, used to build the
    runner ETag. If the org has no rules yet, max_updated falls back to the
    most recent row's timestamp after seeding is handled by the caller.
    """
    result = await db.execute(
        select(
            func.count(AutoResponseRule.id),
            func.max(AutoResponseRule.updated_at),
        ).filter(AutoResponseRule.organization_id == organization_id)
    )
    count, max_updated = result.one()
    return int(count or 0), max_updated
