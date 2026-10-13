"""Database access for the content-addressed image store.

Phase 13 of plan ``2026-10-13-image-generation-and-visual-judgment``; the
tables are ``web.image_assets`` and ``web.image_slot_candidates``
(``app.models.image_asset``, alembic ``image_assets_01``).

**Every function takes ``tenant_id`` and filters on it.** There is no
row-level security and no tenant-scoped session, so a lookup that forgot the
predicate would be a cross-tenant read — the one failure this store exists to
make impossible. The composite FK on the candidate table backs the predicate in
the database: a candidate can only name an asset its own tenant holds.

The callers commit; these functions only flush.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import and_, delete, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.image_asset import ImageAsset, ImageSlotCandidate


def _now() -> datetime:
    return datetime.now(UTC)


class _Unset:
    """Marks a field the caller did not send (distinct from an explicit null)."""


UNSET: Any = _Unset()


# ── assets ──────────────────────────────────────────────────────────────


async def get_asset(
    db: AsyncSession, *, tenant_id: UUID, sha256: str
) -> ImageAsset | None:
    """The tenant's asset with this hash, or None — never another tenant's."""
    result = await db.execute(
        select(ImageAsset)
        .where(ImageAsset.tenant_id == tenant_id, ImageAsset.sha256 == sha256)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def upsert_asset(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    sha256: str,
    storage_key: str,
    mime_type: str,
    width: int,
    height: int,
    byte_size: int,
    kind: str,
    provenance: dict[str, Any] | None,
) -> tuple[ImageAsset, bool]:
    """Record that the tenant holds these bytes; ``(row, created)``.

    A re-upload of the same bytes keeps the row (and its ``created_at``), sets
    ``kind`` to the value sent, and replaces ``provenance`` only when one is
    sent. ``updated_at`` moves only when one of them actually changed. The
    byte-derived columns are never rewritten: the hash names the bytes, so
    they cannot differ.
    """
    now = _now()
    inserted = await db.scalars(
        pg_insert(ImageAsset)
        .values(
            tenant_id=tenant_id,
            sha256=sha256,
            storage_key=storage_key,
            mime_type=mime_type,
            width=width,
            height=height,
            byte_size=byte_size,
            kind=kind,
            provenance=provenance if provenance is not None else {},
            # Stamped here, not by the column default: now() is the
            # TRANSACTION's start, so rows written in one transaction would
            # all tie and "oldest first" would fall back to a random id.
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_nothing(constraint="uq_image_assets_tenant_sha256")
        .returning(ImageAsset),
        execution_options={"populate_existing": True},
    )
    row = inserted.one_or_none()
    if row is not None:
        return row, True

    # The tenant already holds these bytes (or a concurrent upload of them
    # won the insert). Lock the row so two re-uploads cannot interleave.
    existing = await db.execute(
        select(ImageAsset)
        .where(ImageAsset.tenant_id == tenant_id, ImageAsset.sha256 == sha256)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    row = existing.scalar_one()
    changed = False
    if row.kind != kind:
        row.kind = kind
        changed = True
    if provenance is not None and row.provenance != provenance:
        row.provenance = provenance
        changed = True
    if changed:
        row.updated_at = now
        await db.flush()
    return row, False


# ── slot candidates ─────────────────────────────────────────────────────


@dataclass(frozen=True)
class CandidateWrite:
    """The outcome of :func:`upsert_slot_candidate`."""

    candidate: ImageSlotCandidate
    created: bool
    #: Hashes of the slot's other candidates moved from ``chosen`` back to
    #: ``candidate`` by this write.
    demoted: list[str]


async def upsert_slot_candidate(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    repo: str,
    slot_id: str,
    asset_sha256: str,
    status: str,
    recipe_hash: Any = UNSET,
    values: Any = UNSET,
    judge: Any = UNSET,
) -> CandidateWrite:
    """Propose ``asset_sha256`` for the slot, or move an existing proposal.

    ``recipe_hash`` / ``values`` / ``judge`` left :data:`UNSET` keep their
    stored value (a new row takes NULL / ``{}``). Choosing a candidate
    (``status='chosen'``) first returns the slot's other ``chosen`` row, if
    any, to ``candidate`` — in this transaction — so the slot never holds two
    choices and a choice is one request. Two choices racing each other still
    meet ``uq_image_slot_candidates_one_chosen``; the loser's insert raises
    ``IntegrityError``.

    The asset must already be the tenant's; the caller checks, and the
    composite FK refuses it regardless.
    """
    demoted: list[str] = []
    now = _now()
    if status == "chosen":
        result = await db.execute(
            update(ImageSlotCandidate)
            .where(
                ImageSlotCandidate.tenant_id == tenant_id,
                ImageSlotCandidate.repo == repo,
                ImageSlotCandidate.slot_id == slot_id,
                ImageSlotCandidate.status == "chosen",
                ImageSlotCandidate.asset_sha256 != asset_sha256,
            )
            .values(status="candidate", updated_at=now)
            .returning(ImageSlotCandidate.asset_sha256)
        )
        demoted = sorted(result.scalars().all())

    inserted = await db.scalars(
        pg_insert(ImageSlotCandidate)
        .values(
            tenant_id=tenant_id,
            repo=repo,
            slot_id=slot_id,
            asset_sha256=asset_sha256,
            status=status,
            recipe_hash=None if recipe_hash is UNSET else recipe_hash,
            values={} if values is UNSET else values,
            judge={} if judge is UNSET else judge,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_nothing(constraint="uq_image_slot_candidates_slot_asset")
        .returning(ImageSlotCandidate),
        execution_options={"populate_existing": True},
    )
    row = inserted.one_or_none()
    if row is not None:
        return CandidateWrite(candidate=row, created=True, demoted=demoted)

    existing = await db.execute(
        select(ImageSlotCandidate)
        .where(
            ImageSlotCandidate.tenant_id == tenant_id,
            ImageSlotCandidate.repo == repo,
            ImageSlotCandidate.slot_id == slot_id,
            ImageSlotCandidate.asset_sha256 == asset_sha256,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    row = existing.scalar_one()
    changed = False
    updates: dict[str, Any] = {"status": status}
    if recipe_hash is not UNSET:
        updates["recipe_hash"] = recipe_hash
    if values is not UNSET:
        updates["values"] = values
    if judge is not UNSET:
        updates["judge"] = judge
    for name, value in updates.items():
        if getattr(row, name) != value:
            setattr(row, name, value)
            changed = True
    if changed:
        row.updated_at = now
        await db.flush()
    return CandidateWrite(candidate=row, created=False, demoted=demoted)


async def list_slot_candidates(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    repo: str,
    slot_id: str,
    status: str | None,
    limit: int,
) -> tuple[list[tuple[ImageSlotCandidate, ImageAsset]], bool]:
    """The slot's candidates with their assets, oldest first; ``(rows, truncated)``.

    Reads one row past ``limit`` so ``truncated`` is a reading, not a guess.
    """
    query = (
        select(ImageSlotCandidate, ImageAsset)
        .join(
            ImageAsset,
            and_(
                ImageAsset.tenant_id == ImageSlotCandidate.tenant_id,
                ImageAsset.sha256 == ImageSlotCandidate.asset_sha256,
            ),
        )
        .where(
            ImageSlotCandidate.tenant_id == tenant_id,
            ImageSlotCandidate.repo == repo,
            ImageSlotCandidate.slot_id == slot_id,
        )
        .order_by(ImageSlotCandidate.created_at, ImageSlotCandidate.id)
        .limit(limit + 1)
        .execution_options(populate_existing=True)
    )
    if status is not None:
        query = query.where(ImageSlotCandidate.status == status)
    rows = [(candidate, asset) for candidate, asset in (await db.execute(query)).all()]
    return rows[:limit], len(rows) > limit


async def delete_slot_candidate(
    db: AsyncSession, *, tenant_id: UUID, repo: str, slot_id: str, asset_sha256: str
) -> bool:
    """Remove one proposal (never the asset itself); True when a row went."""
    result = await db.execute(
        delete(ImageSlotCandidate)
        .where(
            ImageSlotCandidate.tenant_id == tenant_id,
            ImageSlotCandidate.repo == repo,
            ImageSlotCandidate.slot_id == slot_id,
            ImageSlotCandidate.asset_sha256 == asset_sha256,
        )
        .returning(ImageSlotCandidate.id)
    )
    return result.scalar_one_or_none() is not None
