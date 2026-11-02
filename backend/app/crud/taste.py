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

Every label and every undo also takes the tenant's next label-feed position
from ``web.taste_label_clock`` (:func:`_next_change_seq`). That row lock is
held until the caller commits, so per tenant positions are handed out in
commit order — :func:`list_labels` pages by position and can never skip a
write that commits late.

The callers commit; these functions only flush. A write that names an image
deleted since the caller checked raises :class:`ImageAssetGone` (the FK
refused it) after rolling back only its own savepoint.
"""

from __future__ import annotations

import base64
import binascii
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal
from uuid import UUID

from sqlalchemy import case, delete, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.image_asset import ImageAsset
from app.models.taste import (
    DEFAULT_WEEKLY_BUDGET,
    TasteLabelClock,
    TastePair,
    TasteSettings,
)
from app.models.user import User
from app.services.taste_calibration import MAX_POOL_IMAGES, PoolImage, direction_of

#: The image kinds a calibration batch draws from: generated candidates and
#: the operator's own references. Derivatives and captures are renderings of
#: other images, not taste options.
POOL_KINDS: tuple[str, ...] = ("candidate", "exemplar")


def _now() -> datetime:
    return datetime.now(UTC)


class ImageAssetGone(LookupError):
    """An image a write names was deleted after the caller checked for it:
    the composite FK to ``web.image_assets`` refused the row."""


#: The composite FKs from a pair to ``web.image_assets`` — the images a write
#: names. Not the user FKs (labeller, remover), which are SET NULL and never a
#: deleted-image race.
ASSET_FKS: tuple[str, ...] = (
    "fk_taste_pairs_asset_a",
    "fk_taste_pairs_asset_b",
    "fk_taste_pairs_capture_a",
    "fk_taste_pairs_capture_b",
    "fk_taste_pairs_edit_asset",
)


def _is_asset_fk_violation(exc: IntegrityError) -> bool:
    constraint = getattr(getattr(exc.orig, "__cause__", None), "constraint_name", None)
    if constraint is None:
        constraint = getattr(exc.orig, "constraint_name", None)
    if constraint is not None:
        return constraint in ASSET_FKS
    text = str(exc.orig)
    return any(f'"{name}"' in text for name in ASSET_FKS)


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
    db: AsyncSession, user_ids: Iterable[UUID | None], *, with_email: bool
) -> dict[UUID, str]:
    """Each user's display name. ``with_email`` falls back to the email for
    a user with no name — for an operator's session only: a device or service
    credential is never handed a person's email."""
    wanted = sorted({uid for uid in user_ids if uid is not None}, key=str)
    if not wanted:
        return {}
    result = await db.execute(
        select(User.id, User.full_name, User.email).where(User.id.in_(wanted))
    )
    names: dict[UUID, str] = {}
    for uid, name, email in result.all():
        shown = name or (email if with_email else None)
        if shown:
            names[uid] = shown
    return names


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
            # Charged once, in the week the pair was FIRST answered: a
            # relabel or an undo-and-relabel of an older pair costs nothing.
            func.count().filter(
                TastePair.label.is_not(None), TastePair.first_labelled_at >= since
            ),
        ).where(TastePair.tenant_id == tenant_id)
    )
    pending, labelled, labelled_since = result.one()
    return QueueCounts(int(pending), int(labelled), int(labelled_since))


class InvalidCursor(ValueError):
    """A ``labels`` cursor that is not one this API minted."""


_CURSOR_PREFIX = "seq:"


def encode_label_cursor(change_seq: int) -> str:
    raw = f"{_CURSOR_PREFIX}{change_seq}"
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")


def decode_label_cursor(cursor: str) -> int:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8")
        if not raw.startswith(_CURSOR_PREFIX):
            raise ValueError("not a feed position")
        seq = int(raw[len(_CURSOR_PREFIX) :])
        if seq < 1:
            raise ValueError("not a feed position")
        return seq
    except (binascii.Error, UnicodeError, ValueError) as exc:
        raise InvalidCursor("after is not a cursor this API issued") from exc


async def list_labels(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    limit: int,
    after: int | None,
) -> tuple[Sequence[TastePair], bool]:
    """The tenant's label feed in position order: every pair that has ever
    been answered, at its LATEST change — a label, a relabel, or an undo
    (a tombstone: ``label`` NULL, ``removed_at`` set). ``truncated`` when more
    exist. A pair changed again moves to its new position, so a reader that
    replays the feed and keeps the last row per pair holds the current state.
    """
    query = select(TastePair).where(
        TastePair.tenant_id == tenant_id, TastePair.change_seq.is_not(None)
    )
    if after is not None:
        query = query.where(TastePair.change_seq > after)
    result = await db.execute(
        query.order_by(TastePair.change_seq.asc()).limit(limit + 1)
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


async def _next_change_seq(db: AsyncSession, *, tenant_id: UUID) -> int:
    """The tenant's next label-feed position. The clock row stays locked until
    the caller's transaction ends, so a second writer waits here and positions
    are handed out in commit order (module docstring)."""
    statement = pg_insert(TasteLabelClock).values(tenant_id=tenant_id, last_seq=1)
    result = await db.execute(
        statement.on_conflict_do_update(
            index_elements=[TasteLabelClock.tenant_id],
            set_={"last_seq": TasteLabelClock.last_seq + 1},
        ).returning(TasteLabelClock.last_seq)
    )
    return int(result.scalar_one())


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
    statement = (
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
    try:
        async with db.begin_nested():
            new_id = (await db.execute(statement)).scalar_one_or_none()
    except IntegrityError as exc:
        if _is_asset_fk_violation(exc):
            raise ImageAssetGone(str(exc.orig)) from exc
        raise
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


LabelRefusal = Literal["absent", "already_labelled", "not_labelled", "not_yours"]


class _NoMatch(Exception):
    """Raised inside a write's savepoint when its conditional UPDATE matched
    no row, so the savepoint rolls back — taking the feed-clock tick and the
    clock row's lock with it before the caller reads the row to say why."""


def _removal_snapshot(actor_user_id: UUID, via: str, now: datetime) -> dict[str, Any]:
    """SET clauses recording the answer a write is about to remove. Each
    right-hand side reads the row as it WAS, so ``removed_label`` is the
    answer removed; ``removed_forced`` is true only when that answer was
    another labeller's (or a deleted user's)."""
    return {
        "removed_label": func.jsonb_build_object(
            "label",
            TastePair.label,
            "reasons",
            TastePair.reasons,
            "comment",
            TastePair.comment,
            "edit_note",
            TastePair.edit_note,
            "edit_asset_sha256",
            TastePair.edit_asset_sha256,
            "labeller_user_id",
            TastePair.labeller_user_id,
            "labelled_at",
            TastePair.labelled_at,
        ),
        "removed_forced": TastePair.labeller_user_id.is_distinct_from(actor_user_id),
        "removed_by_user_id": actor_user_id,
        "removed_at": now,
        "removed_via": via,
    }


async def _refusal_reason(
    db: AsyncSession, *, tenant_id: UUID, pair_id: UUID, relabel: bool
) -> LabelRefusal:
    existing = await get_pair(db, tenant_id=tenant_id, pair_id=pair_id)
    if existing is None:
        return "absent"
    if existing.label is None:
        return "not_labelled"
    return "not_yours" if relabel else "already_labelled"


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
    force: bool,
) -> TastePair | LabelRefusal:
    """Label the pair, or say why not: ``absent``; ``already_labelled``
    (answered, and ``relabel`` was not asked for); ``not_yours`` (a relabel
    of another labeller's answer without ``force``).

    A relabel that replaces an answer records it as the pair's removal
    (``removed_via = 'relabel'``), so a replaced answer is never lost. A label
    clears the pair's skip. ``first_labelled_at`` is set once and kept, so the
    budget charges the pair once.
    """
    now = _now()
    condition = [TastePair.tenant_id == tenant_id, TastePair.id == pair_id]
    values: dict[str, Any] = {
        "label": choice,
        "reasons": reasons,
        "comment": comment,
        "edit_note": edit_note,
        "edit_asset_sha256": edit_asset_sha256,
        "labeller_user_id": labeller_user_id,
        "labelled_at": now,
        "first_labelled_at": func.coalesce(TastePair.first_labelled_at, now),
        "skipped_at": None,
        "updated_at": now,
    }
    if relabel:
        replaced = TastePair.label.is_not(None)
        if not force:
            condition.append(
                or_(
                    TastePair.label.is_(None),
                    TastePair.labeller_user_id == labeller_user_id,
                )
            )
        # Record the replaced answer — only when there IS one: relabelling an
        # unanswered pair keeps whatever earlier removal the row records.
        for column, value in _removal_snapshot(
            labeller_user_id, "relabel", now
        ).items():
            values[column] = case((replaced, value), else_=getattr(TastePair, column))
    else:
        condition.append(TastePair.label.is_(None))
    try:
        async with db.begin_nested():
            values["change_seq"] = await _next_change_seq(db, tenant_id=tenant_id)
            matched = (
                await db.execute(
                    update(TastePair)
                    .where(*condition)
                    .values(**values)
                    .returning(TastePair.id)
                )
            ).scalar_one_or_none()
            if matched is None:
                raise _NoMatch
    except _NoMatch:
        return await _refusal_reason(
            db, tenant_id=tenant_id, pair_id=pair_id, relabel=relabel
        )
    except IntegrityError as exc:
        if _is_asset_fk_violation(exc):
            raise ImageAssetGone(str(exc.orig)) from exc
        raise
    pair = await get_pair(db, tenant_id=tenant_id, pair_id=pair_id)
    assert pair is not None
    return pair


async def clear_label(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    pair_id: UUID,
    actor_user_id: UUID,
    force: bool,
) -> TastePair | LabelRefusal:
    """Undo a label: the pair returns to the queue, unanswered.

    Only the actor's OWN label is undone unless ``force`` is set — a label
    whose labeller is someone else (or a deleted user) is refused as
    ``not_yours``. Nothing is erased silently: the removed answer is kept on
    the row as its removal (``removed_via = 'undo'``), and the undo takes a
    feed position, so the taste twin reads it as a tombstone.
    """
    now = _now()
    condition = [
        TastePair.tenant_id == tenant_id,
        TastePair.id == pair_id,
        TastePair.label.is_not(None),
    ]
    if not force:
        condition.append(TastePair.labeller_user_id == actor_user_id)
    try:
        async with db.begin_nested():
            seq = await _next_change_seq(db, tenant_id=tenant_id)
            matched = (
                await db.execute(
                    update(TastePair)
                    .where(*condition)
                    .values(
                        **_removal_snapshot(actor_user_id, "undo", now),
                        label=None,
                        reasons=[],
                        comment=None,
                        edit_note=None,
                        edit_asset_sha256=None,
                        labeller_user_id=None,
                        labelled_at=None,
                        change_seq=seq,
                        updated_at=now,
                    )
                    .returning(TastePair.id)
                )
            ).scalar_one_or_none()
            if matched is None:
                raise _NoMatch
    except _NoMatch:
        return await _refusal_reason(
            db, tenant_id=tenant_id, pair_id=pair_id, relabel=True
        )
    pair = await get_pair(db, tenant_id=tenant_id, pair_id=pair_id)
    assert pair is not None
    return pair


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
    """Delete a pair that was NEVER answered; False when none matched.

    A pair with a feed position (``change_seq``) — answered now, or answered
    and undone — is the operator's evidence and is never withdrawn by this
    door: deleting an undone pair would drop its tombstone from the label
    feed, so a reader that saw the label would keep it forever, and the
    removal record (a forced undo's who and what) would go with the row.
    """
    result = await db.execute(
        delete(TastePair)
        .where(
            TastePair.tenant_id == tenant_id,
            TastePair.id == pair_id,
            TastePair.change_seq.is_(None),
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
