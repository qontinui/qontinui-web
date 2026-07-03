"""CRUD operations for tenant-scoped design/UX policies."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.design_policy import DesignPolicy
from app.schemas.design_policy import DesignPolicyCreate, DesignPolicyUpdate

# ─── 7 built-in policies (Jacob's project-agnostic UX policy set) ────────────
# Seeded per-tenant on first access. Built-ins cannot be deleted (only
# disabled or edited). Kept in sync with the design intent captured in the
# team's UX policy set: findability, readability, hierarchy, consistency,
# accessibility, one-job-per-surface, every-element-earns-its-place.

_UI_GLOB = "**/*.{tsx,jsx,vue,svelte,css,scss}"

DEFAULT_DESIGN_POLICIES: list[dict] = [
    {
        "slug": "findability",
        "name": "Ease of finding information",
        "principle": "Information architecture makes things discoverable.",
        "rationale": "Users can only act on what they can find.",
        "enforcement": "Group related controls; surface primary paths; avoid burying key info in dense or unlabeled regions.",
        "category": "findability",
        "severity": "info",
        "applies_to": _UI_GLOB,
        "sort_order": 1,
    },
    {
        "slug": "readability",
        "name": "Ease of readability",
        "principle": "Typography, contrast, and spacing prioritize reading.",
        "rationale": "Legibility is a precondition for every other goal.",
        "enforcement": "Use the shared typography scale; keep line lengths and leading readable; meet contrast on token pairings.",
        "category": "readability",
        "severity": "info",
        "applies_to": _UI_GLOB,
        "sort_order": 2,
    },
    {
        "slug": "top-down-organization",
        "name": "Top-down organization",
        "principle": "Layout flows from most to least important with clear hierarchy.",
        "rationale": "A clear visual hierarchy lets users scan and prioritize.",
        "enforcement": "One h1 per page; sections lead with a single heading; most-important content first.",
        "category": "hierarchy",
        "severity": "info",
        "applies_to": _UI_GLOB,
        "sort_order": 3,
    },
    {
        "slug": "consistency-reuse",
        "name": "Consistency & reuse (single source of truth)",
        "principle": "Same intent produces the same result; shared decisions live in one place.",
        "rationale": "One source of truth prevents drift as the codebase grows.",
        "enforcement": "No hardcoded hex or raw color scales (e.g. bg-red-500) for semantic states in feature code; reference design tokens and shared component classes.",
        "category": "consistency",
        "severity": "warning",
        "applies_to": _UI_GLOB,
        "sort_order": 4,
    },
    {
        "slug": "accessibility",
        "name": "Accessibility & inclusivity",
        "principle": "Anyone can perceive and operate the UI.",
        "rationale": "Inclusivity is a baseline, and retrofitting it is far costlier.",
        "enforcement": "Sufficient contrast; visible focus; keyboard reachability; color is never the sole carrier of meaning; honor prefers-reduced-motion.",
        "category": "accessibility",
        "severity": "warning",
        "applies_to": _UI_GLOB,
        "sort_order": 5,
    },
    {
        "slug": "one-job-per-surface",
        "name": "One job per surface (single responsibility)",
        "principle": "A view serves one coherent user job; distinct concerns get distinct surfaces.",
        "rationale": "Conflated jobs inflate length, split attention, and blur ownership.",
        "enforcement": "If a surface's contents need two unrelated nouns to describe, split it. Monitoring surfaces show/link; they don't host destructive mutations.",
        "category": "structure",
        "severity": "info",
        "applies_to": _UI_GLOB,
        "sort_order": 6,
    },
    {
        "slug": "every-element-earns-its-place",
        "name": "Every element earns its place (relevance × cost)",
        "principle": "Each element must answer a question the surface exists for and be actionable there.",
        "rationale": "Persistent space and background work are scarce; unearned elements dilute signal and tax performance.",
        "enforcement": "Cut or relocate decorative, demo, or off-mission content; scrutinize anything that also polls or renders heavily.",
        "category": "relevance",
        "severity": "info",
        "applies_to": _UI_GLOB,
        "sort_order": 7,
    },
]


async def seed_default_policies(
    db: AsyncSession,
    tenant_id: UUID,
    created_by: str | None = None,
) -> list[DesignPolicy]:
    """Insert the built-in policies for a tenant (idempotent on slug)."""
    existing = await db.execute(
        select(DesignPolicy.slug).where(DesignPolicy.tenant_id == tenant_id)
    )
    have = {row[0] for row in existing.all()}
    created: list[DesignPolicy] = []
    for spec in DEFAULT_DESIGN_POLICIES:
        if spec["slug"] in have:
            continue
        policy = DesignPolicy(
            tenant_id=tenant_id,
            is_built_in=True,
            created_by=created_by,
            updated_by=created_by,
            **spec,
        )
        db.add(policy)
        created.append(policy)
    if created:
        await db.commit()
        for policy in created:
            await db.refresh(policy)
    return created


async def get_tenant_policies(
    db: AsyncSession,
    tenant_id: UUID,
    created_by: str | None = None,
) -> list[DesignPolicy]:
    """Return a tenant's policies, seeding built-ins on first access."""
    result = await db.execute(
        select(DesignPolicy)
        .where(DesignPolicy.tenant_id == tenant_id)
        .order_by(DesignPolicy.sort_order, DesignPolicy.name)
    )
    policies = list(result.scalars().all())
    if not policies:
        await seed_default_policies(db, tenant_id, created_by)
        result = await db.execute(
            select(DesignPolicy)
            .where(DesignPolicy.tenant_id == tenant_id)
            .order_by(DesignPolicy.sort_order, DesignPolicy.name)
        )
        policies = list(result.scalars().all())
    return policies


async def create_policy(
    db: AsyncSession,
    tenant_id: UUID,
    data: DesignPolicyCreate,
    created_by: str | None = None,
) -> DesignPolicy:
    """Create a custom policy for a tenant."""
    policy = DesignPolicy(
        tenant_id=tenant_id,
        is_built_in=False,
        created_by=created_by,
        updated_by=created_by,
        **data.model_dump(),
    )
    db.add(policy)
    await db.commit()
    await db.refresh(policy)
    return policy


async def _get_owned(
    db: AsyncSession, tenant_id: UUID, policy_id: UUID
) -> DesignPolicy | None:
    result = await db.execute(
        select(DesignPolicy).where(
            DesignPolicy.id == policy_id,
            DesignPolicy.tenant_id == tenant_id,
        )
    )
    return result.scalar_one_or_none()


async def update_policy(
    db: AsyncSession,
    tenant_id: UUID,
    policy_id: UUID,
    data: DesignPolicyUpdate,
    updated_by: str | None = None,
) -> DesignPolicy | None:
    """Update a policy (built-in or custom). Slug is immutable here."""
    policy = await _get_owned(db, tenant_id, policy_id)
    if policy is None:
        return None
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(policy, field, value)
    if updated_by is not None:
        policy.updated_by = updated_by
    await db.commit()
    await db.refresh(policy)
    return policy


async def delete_policy(
    db: AsyncSession,
    tenant_id: UUID,
    policy_id: UUID,
) -> bool | str:
    """Delete a custom policy. Returns True, or an error string."""
    policy = await _get_owned(db, tenant_id, policy_id)
    if policy is None:
        return "Policy not found"
    if policy.is_built_in:
        return "Cannot delete built-in policy"
    await db.delete(policy)
    await db.commit()
    return True


async def reset_to_defaults(
    db: AsyncSession,
    tenant_id: UUID,
    created_by: str | None = None,
) -> list[DesignPolicy]:
    """Delete all of a tenant's policies and re-seed the built-ins."""
    result = await db.execute(
        select(DesignPolicy).where(DesignPolicy.tenant_id == tenant_id)
    )
    for policy in result.scalars().all():
        await db.delete(policy)
    await db.commit()
    await seed_default_policies(db, tenant_id, created_by)
    return await get_tenant_policies(db, tenant_id, created_by)
