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

import base64
import binascii
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal
from uuid import UUID

from sqlalchemy import and_, delete, select, tuple_, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.image_asset import ImageAsset, ImageSlotCandidate
from app.schemas.image_assets import (
    MAX_PROVENANCE_BYTES,
    ConflictReason,
    stored_json_bytes,
)


def _now() -> datetime:
    return datetime.now(UTC)


class _Unset:
    """Marks a field the caller did not send (distinct from an explicit null)."""


UNSET: Any = _Unset()


# ── assets ──────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class UploadConflict:
    """Something a re-upload sent that was not applied, and why
    (``app.schemas.image_assets.ConflictReason``)."""

    path: str
    reason: ConflictReason


def merge_provenance(
    stored: dict[str, Any], incoming: dict[str, Any], prefix: str = "provenance"
) -> tuple[dict[str, Any], list[str], list[str]]:
    """``stored`` with ``incoming``'s keys ADDED; ``(merged, differing, added)``.

    Never removes a key and never changes a stored value: a later upload of
    the same bytes can only add to the record. That is what keeps the
    generator's AI-generated marker (and every other first-recorded fact)
    from being dropped or rewritten by whoever uploads the bytes next. Nested
    objects merge the same way, key by key; any other differing value is not
    applied — the stored value stands. ``differing`` and ``added`` are dotted
    paths.
    """
    merged = dict(stored)
    differing: list[str] = []
    added: list[str] = []
    for key, value in incoming.items():
        path = f"{prefix}.{key}"
        if key not in merged:
            merged[key] = value
            added.append(path)
        elif isinstance(merged[key], dict) and isinstance(value, dict):
            merged[key], nested_differing, nested_added = merge_provenance(
                merged[key], value, path
            )
            differing += nested_differing
            added += nested_added
        elif merged[key] != value:
            differing.append(path)
    return merged, differing, added


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
    orientation: int | None,
) -> tuple[ImageAsset, bool, list[UploadConflict]]:
    """Record that the tenant holds these bytes; ``(row, created, conflicts)``.

    A re-upload of the same bytes keeps the row and its ``created_at``. The
    FIRST upload's ``kind`` stands, and ``provenance`` is merged
    (:func:`merge_provenance`): keys are added, never removed or changed —
    and the merged record is held to ``MAX_PROVENANCE_BYTES``, like an
    upload's own: when this upload's new keys would grow it past that, none
    of them is added (a stored key is never dropped to make room).
    ``conflicts`` names what this upload sent that was therefore NOT applied,
    each with its reason. ``updated_at`` moves only when a key was added. The
    byte-derived columns are never rewritten: the hash names the bytes, so
    they cannot differ.

    Two uploads of the same bytes may race. One inserts; the other's insert
    finds the row (waiting for the first to commit, if it has not) and merges
    under a row lock, so neither upload's provenance is lost.
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
            orientation=orientation,
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
        return row, True, []

    # The tenant already holds these bytes (or a concurrent upload of them
    # won the insert). Lock the row so two re-uploads cannot interleave: each
    # merges onto what the other committed.
    existing = await db.execute(
        select(ImageAsset)
        .where(ImageAsset.tenant_id == tenant_id, ImageAsset.sha256 == sha256)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    row = existing.scalar_one()
    conflicts = [UploadConflict("kind", "kind_stands")] if row.kind != kind else []
    if provenance:
        merged, differing, added = merge_provenance(row.provenance, provenance)
        conflicts += [UploadConflict(path, "stored_value_stands") for path in differing]
        if added and stored_json_bytes(merged) > MAX_PROVENANCE_BYTES:
            conflicts += [UploadConflict(path, "provenance_full") for path in added]
            merged = row.provenance
        if merged != row.provenance:
            row.provenance = merged
            row.updated_at = now
            await db.flush()
    return row, False, conflicts


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


CandidateOrder = Literal["oldest", "newest"]


class InvalidCursor(ValueError):
    """A list cursor that does not decode, or was minted for the other order."""


def encode_cursor(candidate: ImageSlotCandidate, order: CandidateOrder) -> str:
    """Opaque keyset cursor: the last row's ``(created_at, id)`` and the order
    it was read in. Its composition is not a client contract — callers only
    echo it back as ``after``."""
    raw = f"{order}|{candidate.created_at.isoformat()}|{candidate.id}"
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")


def decode_cursor(cursor: str, order: CandidateOrder) -> tuple[datetime, UUID]:
    """Inverse of :func:`encode_cursor`; :class:`InvalidCursor` on anything
    malformed, or on a cursor read in the other order — continuing a newest-
    first walk with an oldest-first cursor would skip or repeat rows."""
    try:
        raw = base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8")
        minted_order, created_raw, id_raw = raw.split("|")
        created_at = datetime.fromisoformat(created_raw)
        row_id = UUID(id_raw)
    except (ValueError, binascii.Error, UnicodeError) as exc:
        raise InvalidCursor("malformed cursor") from exc
    if created_at.tzinfo is None:
        raise InvalidCursor("malformed cursor")
    if minted_order != order:
        raise InvalidCursor(
            f"the cursor continues an order={minted_order} listing, not order={order}"
        )
    return created_at, row_id


async def list_slot_candidates(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    repo: str,
    slot_id: str,
    status: str | None,
    limit: int,
    order: CandidateOrder = "oldest",
    after: tuple[datetime, UUID] | None = None,
) -> tuple[list[tuple[ImageSlotCandidate, ImageAsset]], bool]:
    """One page of the slot's candidates with their assets; ``(rows, truncated)``.

    Keyset-paged on ``(created_at, id)`` — a total order, so a page boundary
    never skips or repeats a row — ``oldest`` or ``newest`` first, resuming
    after ``after``. Reads one row past ``limit`` so ``truncated`` is a
    reading, not a guess.
    """
    key = tuple_(ImageSlotCandidate.created_at, ImageSlotCandidate.id)
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
        .order_by(
            *(
                (ImageSlotCandidate.created_at, ImageSlotCandidate.id)
                if order == "oldest"
                else (
                    ImageSlotCandidate.created_at.desc(),
                    ImageSlotCandidate.id.desc(),
                )
            )
        )
        .limit(limit + 1)
        .execution_options(populate_existing=True)
    )
    if status is not None:
        query = query.where(ImageSlotCandidate.status == status)
    if after is not None:
        query = query.where(key > after if order == "oldest" else key < after)
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
