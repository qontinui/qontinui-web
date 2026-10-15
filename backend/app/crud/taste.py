"""Database access for the taste inbox.

Phase 23 of plan ``2026-10-13-image-generation-and-visual-judgment``; the
tables are ``web.taste_pairs`` and ``web.taste_settings``
(``app.models.taste``, alembic ``taste_inbox_01``).

**Every function takes ``tenant_id`` and filters on it**, as the image store's
does (``app.crud.image_assets``): there is no row-level security, so a query
that forgot the predicate would be a cross-tenant read. The composite FKs back
it in the database — a pair can only name images its own tenant holds.

Every state change is ONE conditional statement (``UPDATE … WHERE label IS
NULL … RETURNING``), so two labellers working the queue at once can neither
overwrite each other's label nor answer the same pair twice: the loser's
statement matches no row, and the caller reads the row to say why.

The callers commit; these functions only flush.
"""

from __future__ import annotations

import base64
import binascii
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.image_asset import ImageAsset
from app.models.taste import DEFAULT_WEEKLY_BUDGET, TastePair, TasteSettings
from app.models.user import User
from app.services.taste_calibration import MAX_POOL_IMAGES, PoolImage, direction_of

#: The image kinds a calibration batch draws from: generated candidates and
#: the operator's own references. Derivatives and captures are renderings of
#: other images, not taste options.
POOL_KINDS: tuple[str, ...] = ("candidate", "exemplar")


def _now() -> datetime:
    return datetime.now(UTC)


def week_start(now: datetime) -> datetime:
    """Monday 00:00 UTC of ``now``'s week — when a weekly budget resets."""
    day = now.astimezone(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    return day - timedelta(days=day.weekday())


# ── reads ───────────────────────────────────────────────────────────────


async def get_pair(
    db: AsyncSession, *, tenant_id: UUID, pair_id: UUID
) -> TastePair | None:
    result = await db.execute(
        select(TastePair)
        .where(TastePair.tenant_id == tenant_id, TastePair.id == pair_id)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def get_assets(
    db: AsyncSession, *, tenant_id: UUID, shas: Iterable[str]
) -> dict[str, ImageAsset]:
    wanted = sorted(set(shas))
    if not wanted:
        return {}
    result = await db.execute(
        select(ImageAsset).where(
            ImageAsset.tenant_id == tenant_id, ImageAsset.sha256.in_(wanted)
        )
    )
    return {row.sha256: row for row in result.scalars()}


async def labeller_names(
    db: AsyncSession, user_ids: Iterable[UUID | None]
) -> dict[UUID, str]:
    wanted = sorted({uid for uid in user_ids if uid is not None}, key=str)
    if not wanted:
        return {}
    result = await db.execute(
        select(User.id, User.full_name, User.email).where(User.id.in_(wanted))
    )
    return {uid: (name or email) for uid, name, email in result.all()}


def _queue_order() -> tuple[Any, ...]:
    """Never-skipped first (most uncertain, then oldest), then skipped pairs,
    least recently skipped first. ``id`` makes the order total."""
    return (
        TastePair.skipped_at.is_not(None).asc(),
        TastePair.skipped_at.asc().nulls_first(),
        TastePair.uncertainty.desc().nulls_last(),
        TastePair.created_at.asc(),
        TastePair.id.asc(),
    )


async def list_queue(
    db: AsyncSession, *, tenant_id: UUID, limit: int
) -> Sequence[TastePair]:
    if limit <= 0:
        return []
    result = await db.execute(
        select(TastePair)
        .where(TastePair.tenant_id == tenant_id, TastePair.label.is_(None))
        .order_by(*_queue_order())
        .limit(limit)
    )
    return result.scalars().all()


async def list_recent_labels(
    db: AsyncSession, *, tenant_id: UUID, limit: int
) -> Sequence[TastePair]:
    result = await db.execute(
        select(TastePair)
        .where(TastePair.tenant_id == tenant_id, TastePair.label.is_not(None))
        .order_by(TastePair.labelled_at.desc(), TastePair.id.desc())
        .limit(limit)
    )
    return result.scalars().all()


@dataclass(frozen=True)
class QueueCounts:
    pending: int
    labelled: int
    labelled_since: int


async def queue_counts(
    db: AsyncSession, *, tenant_id: UUID, since: datetime
) -> QueueCounts:
    result = await db.execute(
        select(
            func.count().filter(TastePair.label.is_(None)),
            func.count().filter(TastePair.label.is_not(None)),
            func.count().filter(
                TastePair.label.is_not(None), TastePair.labelled_at >= since
            ),
        ).where(TastePair.tenant_id == tenant_id)
    )
    pending, labelled, labelled_since = result.one()
    return QueueCounts(int(pending), int(labelled), int(labelled_since))


class InvalidCursor(ValueError):
    """A ``labels`` cursor that is not one this API minted."""


def encode_label_cursor(pair: TastePair) -> str:
    assert pair.labelled_at is not None
    raw = f"{pair.labelled_at.isoformat()}|{pair.id}"
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")


def decode_label_cursor(cursor: str) -> tuple[datetime, UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8")
        at, _, ident = raw.partition("|")
        when = datetime.fromisoformat(at)
        if when.tzinfo is None:
            raise ValueError("naive timestamp")
        return when, UUID(ident)
    except (binascii.Error, UnicodeError, ValueError) as exc:
        raise InvalidCursor("after is not a cursor this API issued") from exc


async def list_labels(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    limit: int,
    after: tuple[datetime, UUID] | None,
) -> tuple[Sequence[TastePair], bool]:
    """Labelled pairs, oldest label first; ``truncated`` when more exist."""
    query = select(TastePair).where(
        TastePair.tenant_id == tenant_id, TastePair.label.is_not(None)
    )
    if after is not None:
        at, ident = after
        query = query.where(
            or_(
                TastePair.labelled_at > at,
                and_(TastePair.labelled_at == at, TastePair.id > ident),
            )
        )
    result = await db.execute(
        query.order_by(TastePair.labelled_at.asc(), TastePair.id.asc()).limit(limit + 1)
    )
    rows = result.scalars().all()
    return rows[:limit], len(rows) > limit


# ── the pool and calibration ────────────────────────────────────────────


async def calibration_pool(db: AsyncSession, *, tenant_id: UUID) -> list[PoolImage]:
    """The newest :data:`MAX_POOL_IMAGES` candidate and exemplar images,
    returned OLDEST first (so a batch asks about the earliest images first,
    and a new upload extends the order rather than reshuffling it)."""
    result = await db.execute(
        select(ImageAsset.sha256, ImageAsset.kind, ImageAsset.provenance)
        .where(ImageAsset.tenant_id == tenant_id, ImageAsset.kind.in_(POOL_KINDS))
        .order_by(ImageAsset.created_at.desc(), ImageAsset.sha256.desc())
        .limit(MAX_POOL_IMAGES)
    )
    rows = list(result.all())
    rows.reverse()
    return [
        PoolImage(sha256=sha, direction=direction_of(kind, prov or {}))
        for sha, kind, prov in rows
    ]


async def queued_slotless_pairs(
    db: AsyncSession, *, tenant_id: UUID
) -> set[tuple[str, str]]:
    """The unordered identity of every slot-less pair already queued."""
    result = await db.execute(
        select(
            func.least(TastePair.asset_a_sha256, TastePair.asset_b_sha256),
            func.greatest(TastePair.asset_a_sha256, TastePair.asset_b_sha256),
        ).where(TastePair.tenant_id == tenant_id, TastePair.repo.is_(None))
    )
    return {(low, high) for low, high in result.all()}


# ── writes ──────────────────────────────────────────────────────────────


async def find_pair(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    repo: str | None,
    slot_id: str | None,
    asset_a_sha256: str,
    asset_b_sha256: str,
) -> TastePair | None:
    """The queued pair with this identity — the slot and the UNORDERED images."""
    low, high = sorted((asset_a_sha256, asset_b_sha256))
    result = await db.execute(
        select(TastePair)
        .where(
            TastePair.tenant_id == tenant_id,
            func.coalesce(TastePair.repo, "") == (repo or ""),
            func.coalesce(TastePair.slot_id, "") == (slot_id or ""),
            func.least(TastePair.asset_a_sha256, TastePair.asset_b_sha256) == low,
            func.greatest(TastePair.asset_a_sha256, TastePair.asset_b_sha256) == high,
        )
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def push_pair(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    repo: str | None,
    slot_id: str | None,
    asset_a_sha256: str,
    asset_b_sha256: str,
    capture_a_sha256: str | None,
    capture_b_sha256: str | None,
    source: str,
    uncertainty: float | None,
    context: dict[str, Any],
    pushed_by: str,
) -> tuple[TastePair, bool]:
    """Queue the pair, or return the queued one with its identity unchanged.

    ``INSERT … ON CONFLICT DO NOTHING`` against ``uq_taste_pairs_pair``: a
    concurrent push of the same pair cannot raise, and the second caller reads
    the first one's row.
    """
    now = _now()
    inserted = await db.execute(
        pg_insert(TastePair)
        .values(
            tenant_id=tenant_id,
            repo=repo,
            slot_id=slot_id,
            asset_a_sha256=asset_a_sha256,
            asset_b_sha256=asset_b_sha256,
            capture_a_sha256=capture_a_sha256,
            capture_b_sha256=capture_b_sha256,
            source=source,
            uncertainty=uncertainty,
            context=context,
            pushed_by=pushed_by,
            reasons=[],
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_nothing()
        .returning(TastePair.id)
    )
    new_id = inserted.scalar_one_or_none()
    if new_id is not None:
        pair = await get_pair(db, tenant_id=tenant_id, pair_id=new_id)
        assert pair is not None
        return pair, True
    existing = await find_pair(
        db,
        tenant_id=tenant_id,
        repo=repo,
        slot_id=slot_id,
        asset_a_sha256=asset_a_sha256,
        asset_b_sha256=asset_b_sha256,
    )
    assert existing is not None, "ON CONFLICT DO NOTHING matched no queued pair"
    return existing, False


async def set_label(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    pair_id: UUID,
    choice: str,
    reasons: list[str],
    comment: str | None,
    edit_note: str | None,
    edit_asset_sha256: str | None,
    labeller_user_id: UUID,
    relabel: bool,
) -> TastePair | None:
    """Label the pair; None when no row matched (absent, or already labelled
    and ``relabel`` was not asked for — the caller reads the row to say
    which). A label clears the pair's skip: an answered pair is no longer
    deferred."""
    now = _now()
    condition = [TastePair.tenant_id == tenant_id, TastePair.id == pair_id]
    if not relabel:
        condition.append(TastePair.label.is_(None))
    result = await db.execute(
        update(TastePair)
        .where(*condition)
        .values(
            label=choice,
            reasons=reasons,
            comment=comment,
            edit_note=edit_note,
            edit_asset_sha256=edit_asset_sha256,
            labeller_user_id=labeller_user_id,
            labelled_at=now,
            skipped_at=None,
            updated_at=now,
        )
        .returning(TastePair.id)
    )
    if result.scalar_one_or_none() is None:
        return None
    return await get_pair(db, tenant_id=tenant_id, pair_id=pair_id)


async def clear_label(
    db: AsyncSession, *, tenant_id: UUID, pair_id: UUID
) -> TastePair | None:
    """Undo a label: the pair returns to the queue, unanswered. None when no
    LABELLED row matched."""
    result = await db.execute(
        update(TastePair)
        .where(
            TastePair.tenant_id == tenant_id,
            TastePair.id == pair_id,
            TastePair.label.is_not(None),
        )
        .values(
            label=None,
            reasons=[],
            comment=None,
            edit_note=None,
            edit_asset_sha256=None,
            labeller_user_id=None,
            labelled_at=None,
            updated_at=_now(),
        )
        .returning(TastePair.id)
    )
    if result.scalar_one_or_none() is None:
        return None
    return await get_pair(db, tenant_id=tenant_id, pair_id=pair_id)


async def skip_pair(
    db: AsyncSession, *, tenant_id: UUID, pair_id: UUID
) -> TastePair | None:
    """Move an unanswered pair to the back of the queue. None when no
    UNANSWERED row matched."""
    now = _now()
    result = await db.execute(
        update(TastePair)
        .where(
            TastePair.tenant_id == tenant_id,
            TastePair.id == pair_id,
            TastePair.label.is_(None),
        )
        .values(
            skipped_at=now,
            skip_count=TastePair.skip_count + 1,
            updated_at=now,
        )
        .returning(TastePair.id)
    )
    if result.scalar_one_or_none() is None:
        return None
    return await get_pair(db, tenant_id=tenant_id, pair_id=pair_id)


async def withdraw_pair(db: AsyncSession, *, tenant_id: UUID, pair_id: UUID) -> bool:
    """Delete an UNANSWERED pair; False when none matched. A labelled pair is
    the operator's evidence and is never withdrawn by this door."""
    result = await db.execute(
        delete(TastePair)
        .where(
            TastePair.tenant_id == tenant_id,
            TastePair.id == pair_id,
            TastePair.label.is_(None),
        )
        .returning(TastePair.id)
    )
    return result.scalar_one_or_none() is not None


# ── settings ────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class BudgetSetting:
    weekly_budget: int
    written: bool
    updated_at: datetime | None


async def get_budget(db: AsyncSession, *, tenant_id: UUID) -> BudgetSetting:
    row = (
        await db.execute(
            select(TasteSettings)
            .where(TasteSettings.tenant_id == tenant_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if row is None:
        return BudgetSetting(DEFAULT_WEEKLY_BUDGET, written=False, updated_at=None)
    return BudgetSetting(row.weekly_budget, written=True, updated_at=row.updated_at)


async def set_budget(
    db: AsyncSession, *, tenant_id: UUID, weekly_budget: int, user_id: UUID
) -> BudgetSetting:
    now = _now()
    statement = pg_insert(TasteSettings).values(
        tenant_id=tenant_id,
        weekly_budget=weekly_budget,
        updated_by_user_id=user_id,
        updated_at=now,
    )
    await db.execute(
        statement.on_conflict_do_update(
            index_elements=[TasteSettings.tenant_id],
            set_={
                "weekly_budget": statement.excluded.weekly_budget,
                "updated_by_user_id": statement.excluded.updated_by_user_id,
                "updated_at": statement.excluded.updated_at,
            },
        )
    )
    return await get_budget(db, tenant_id=tenant_id)
