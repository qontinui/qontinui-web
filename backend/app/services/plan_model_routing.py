"""Resolve and record each organization's model family per plan difficulty.

Plan ``2026-10-08-operator-editable-model-family-per-plan-difficulty``.

The served routing map (``model_selectors`` + its display twin ``model_tiers``
on ``GET /plan-library``, ``/candidates`` and ``/difficulty``) used to be a
constant. It is now read per request from ``agent.plan_difficulty_model_routes``
for the caller's plan-library scope, each level falling back to
:data:`~app.services.plan_difficulty.DEFAULT_MODEL_SELECTORS` when no row names
it. One resolver serves all three envelopes and the routing endpoint, so the
envelopes stay byte-identical within a request.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

import structlog
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.plan_model_route import ROUTE_LEVELS, PlanDifficultyModelRoute
from app.services.plan_difficulty import DEFAULT_MODEL_SELECTORS, model_tiers_for

logger = structlog.get_logger(__name__)

RouteSource = Literal["stored", "default"]

#: Postgres ``undefined_table``.
_UNDEFINED_TABLE = "42P01"


@dataclass(frozen=True)
class ModelRouting:
    """One organization's resolved routing map, with where each level came from."""

    selectors: dict[str, str]
    sources: dict[str, RouteSource]
    updated_at: datetime | None
    updated_by_user_id: UUID | None

    @property
    def tiers(self) -> dict[str, str]:
        return model_tiers_for(self.selectors)


def _default_routing() -> ModelRouting:
    return ModelRouting(
        selectors=dict(DEFAULT_MODEL_SELECTORS),
        sources=dict.fromkeys(DEFAULT_MODEL_SELECTORS, "default"),
        updated_at=None,
        updated_by_user_id=None,
    )


async def load_model_routing(db: AsyncSession, org_id: UUID | None) -> ModelRouting:
    """The map ``org_id`` is served. The NULL bucket always reads the defaults.

    A failed read RAISES rather than falling back to the defaults: serving the
    default map on an unreadable store would silently route plans to a family
    the operator moved them off (an UNKNOWN rendered as a default).

    ONE exception: the table not existing yet (``42P01``). ``deploy-web`` and
    ``migrate`` both start on a push to ``main`` and neither waits for the
    other, so code reading this table can serve before the revision that
    creates it has run. No row can exist in a table that does not, so the
    defaults are then exactly what is stored — not a guess — and the three
    plan-library reads every sweep depends on stay up. The read runs in a
    SAVEPOINT so that failure leaves the caller's transaction usable.
    """
    if org_id is None:
        return _default_routing()
    try:
        async with db.begin_nested():
            rows = (
                (
                    await db.execute(
                        select(PlanDifficultyModelRoute)
                        .where(PlanDifficultyModelRoute.organization_id == org_id)
                        # The save path writes with a Core upsert, which never
                        # touches the session's identity map; without this a
                        # session that loaded a row before the save would
                        # re-read its OLD family after it.
                        .execution_options(populate_existing=True)
                    )
                )
                .scalars()
                .all()
            )
    except ProgrammingError as exc:
        if getattr(exc.orig, "sqlstate", None) != _UNDEFINED_TABLE:
            raise
        logger.warning(
            "plan_model_routing.table_absent",
            detail="serving the default map until the migration has run",
        )
        return _default_routing()
    stored = {row.level: row for row in rows if row.level in DEFAULT_MODEL_SELECTORS}
    selectors: dict[str, str] = {}
    sources: dict[str, RouteSource] = {}
    for level, default in DEFAULT_MODEL_SELECTORS.items():
        row = stored.get(level)
        selectors[level] = row.model_family if row else default
        sources[level] = "stored" if row else "default"
    latest = max(stored.values(), key=lambda r: r.updated_at, default=None)
    return ModelRouting(
        selectors=selectors,
        sources=sources,
        updated_at=latest.updated_at if latest else None,
        updated_by_user_id=latest.updated_by_user_id if latest else None,
    )


async def save_model_routing(
    db: AsyncSession,
    *,
    org_id: UUID,
    selectors: dict[str, str],
    actor_user_id: UUID | None,
) -> ModelRouting:
    """Record every level of ``selectors`` for ``org_id`` and commit.

    ``selectors`` must name every level in :data:`ROUTE_LEVELS` (the request
    schema guarantees it); each level's row is upserted, so a save is a full
    replacement of the organization's map. Returns the map as re-read after
    the commit — the caller reports what is stored, not what it sent.
    """
    missing = [level for level in ROUTE_LEVELS if level not in selectors]
    if missing:
        raise ValueError(f"selectors must name every level; missing {missing}")
    now = datetime.now(UTC)
    for level in ROUTE_LEVELS:
        stmt = insert(PlanDifficultyModelRoute).values(
            organization_id=org_id,
            level=level,
            model_family=selectors[level],
            updated_at=now,
            updated_by_user_id=actor_user_id,
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=[
                PlanDifficultyModelRoute.organization_id,
                PlanDifficultyModelRoute.level,
            ],
            set_={
                "model_family": stmt.excluded.model_family,
                "updated_at": stmt.excluded.updated_at,
                "updated_by_user_id": stmt.excluded.updated_by_user_id,
            },
        )
        await db.execute(stmt)
    await db.commit()
    return await load_model_routing(db, org_id)


async def reset_model_routing(db: AsyncSession, *, org_id: UUID) -> ModelRouting:
    """Delete ``org_id``'s rows, so every level serves the shipped default again.

    Distinct from saving a map equal to today's defaults: that stores a COPY,
    which stays pinned if the defaults later move. After a reset each level's
    ``source`` is ``default`` and follows :data:`DEFAULT_MODEL_SELECTORS`.
    """
    await db.execute(
        delete(PlanDifficultyModelRoute).where(
            PlanDifficultyModelRoute.organization_id == org_id
        )
    )
    await db.commit()
    return await load_model_routing(db, org_id)
