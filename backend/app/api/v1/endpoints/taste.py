"""The taste inbox — pairwise image labels the operator gives asynchronously.

Phase 23 of plan ``2026-10-13-image-generation-and-visual-judgment``. Taste is
bootstrapped asynchronously (decision D3): nothing waits on the operator, and
taste arrives through this inbox as pairwise labels — which of two images is
better, or ``both_bad``, with reason chips, a comment and an edit. The taste
twin (Phase 24) learns from the labelled rows; the console page is
``/admin/coord/taste``.

Endpoints (mounted under ``/api/v1/taste``):

* ``GET "/inbox"`` — the page's one read: the head of the queue, the weekly
  budget and its use, the recent labels (the undo list), the calibration pool
  and whether this caller may label.
* ``POST "/pairs"`` — queue one pair (studio's door; a re-push of a queued
  pair answers with it). ``DELETE "/pairs/{pair_id}"`` withdraws a
  NEVER-answered pair — the correction for a wrong push: a device or service
  credential (studio's own correction), or an operator who may label. A pair
  with label history (answered, or answered and undone) is never withdrawn:
  its tombstone must stay in the feed.
* ``PUT "/pairs/{pair_id}/label"`` — answer a pair (``relabel`` replaces the
  caller's OWN answer; ``force`` a colleague's); ``DELETE`` the same path
  undoes the caller's OWN answer (``force=true`` a colleague's). Either kind
  of removal is recorded on the row: forced or not, by whom, and the answer;
  ``POST "/pairs/{pair_id}/skip"`` moves an unanswered pair to the back of
  the queue.
* ``POST "/calibration-batch"`` — queue the first, deliberately diverse batch
  (step 3) from the tenant's own candidate and exemplar images.
* ``PUT "/settings"`` — the weekly budget.
* ``GET "/labels"`` — the label feed, by commit-ordered position, undos
  included as tombstones: the taste twin's read (``TasteLabelPage``).

Auth. Reads and the pair push/withdraw use
:func:`app.api.v1.endpoints.memory.get_memory_tenant`, unchanged — the image
store's dependency: a coord device JWT, the coord service token, or an
operator's session, the tenant taken only from the principal. LABEL writes,
skips, the budget and the calibration build are the operator's: they require
coord-tenant admin in the EFFECTIVE tenant (or a qontinui superuser) through
:func:`require_coord_tenant_admin_target`, and every label records its
labeller (``auth.users.id``). Any tenant member may view. A labeller's email
is shown only to an operator's session, never to a device or service
credential.

What this phase cannot show yet, and says so: a pair's in-situ captures come
from Phase 18's operated capture, which has not landed, so every pair today
has ``in_situ: false`` and the page shows the bare images with that stated.
Studio's ``active_learning`` and ``post_hoc`` pushes start with Phase 20's
judge panel; until then the calibration batch is the queue.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any, Final, Literal, cast
from uuid import UUID

import structlog
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Path,
    Query,
    Request,
    Response,
    status,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.api.strict_query import StrictQueryRoute
from app.api.v1.endpoints.memory import MemoryPrincipal, get_memory_tenant
from app.api.v1.endpoints.operations import (
    ACTIVE_TENANT_HEADER,
    _effective_tenant_roles,
    require_coord_tenant_admin_target,
)
from app.auth.config import current_active_user_optional
from app.crud import taste as crud
from app.models.image_asset import ImageAsset
from app.models.taste import TastePair
from app.models.user import User
from app.schemas.taste import (
    TASTE_REASONS,
    CalibrationBatchRequest,
    CalibrationBatchResult,
    TasteBudget,
    TasteDirection,
    TasteImage,
    TasteInbox,
    TasteLabel,
    TasteLabelPage,
    TasteLabelWrite,
    TastePairOut,
    TastePairPush,
    TastePairPushResponse,
    TastePool,
    TasteReason,
    TasteRemoval,
    TasteRemovedLabel,
    TasteSettingsOut,
    TasteSettingsWrite,
    TasteSource,
)
from app.services.coord_identity import get_coord_identity
from app.services.taste_calibration import (
    PoolImage,
    declared_direction,
    plan_calibration_pairs,
)

logger = structlog.get_logger(__name__)

router = APIRouter(route_class=StrictQueryRoute)

DEFAULT_QUEUE_LIMIT: Final = 5
MAX_QUEUE_LIMIT: Final = 50
RECENT_LABELS: Final = 10
DEFAULT_LABEL_PAGE: Final = 200
MAX_LABEL_PAGE: Final = 1000


def _refusal(status_code: int, error: str, message: str, **extra: Any) -> HTTPException:
    return HTTPException(
        status_code=status_code, detail={"error": error, "message": message, **extra}
    )


def _asset_gone(field: str | None) -> HTTPException:
    """An image the write named was deleted after it was checked: the same
    answer as an image the tenant never held."""
    return _refusal(
        status.HTTP_404_NOT_FOUND,
        "image_asset_not_found",
        "An image this write names was deleted from the store while it was "
        "being written; nothing was changed.",
        field=field,
    )


def _pair_not_found() -> HTTPException:
    return _refusal(
        status.HTTP_404_NOT_FOUND,
        "taste_pair_not_found",
        "This tenant has no taste pair with that id.",
    )


# ── who may label ──────────────────────────────────────────────────────


async def get_can_label(
    request: Request,
    principal: MemoryPrincipal = Depends(get_memory_tenant),
    user: User | None = Depends(current_active_user_optional),
) -> bool:
    """Whether the caller may label — the rule the label routes enforce
    (``require_coord_tenant_admin``): admin in the EFFECTIVE tenant, or a
    qontinui superuser. A device or service credential never labels: a taste
    label is a human's."""
    if principal.actor != "operator" or user is None:
        return False
    if user.is_superuser:
        return True
    identity = await get_coord_identity(request)
    return "admin" in _effective_tenant_roles(
        identity, request.headers.get(ACTIVE_TENANT_HEADER)
    )


def viewer_user_id(principal: MemoryPrincipal) -> UUID | None:
    """The caller's own user id when the caller is an operator's session
    (``get_memory_tenant`` binds it from the authenticated user); None for a
    device or service credential, even one that carries a user claim."""
    return principal.user_id if principal.actor == "operator" else None


class Labeller:
    """The operator a label write is attributed to, and the tenant it lands in."""

    def __init__(self, tenant_id: UUID, user: User) -> None:
        self.tenant_id = tenant_id
        self.user = user


async def get_labeller(
    tenant_id: UUID = Depends(require_coord_tenant_admin_target),
    user: User = Depends(get_current_active_user_async),
) -> Labeller:
    return Labeller(tenant_id=tenant_id, user=user)


# ── rendering ──────────────────────────────────────────────────────────


def _image(asset: ImageAsset) -> TasteImage:
    return TasteImage(
        sha256=asset.sha256,
        kind=cast(Any, asset.kind),
        mime_type=asset.mime_type,
        width=asset.width,
        height=asset.height,
        byte_size=asset.byte_size,
        direction=declared_direction(asset.provenance or {}),
    )


def _displaced_labeller(pair: TastePair) -> UUID | None:
    raw = (pair.removed_label or {}).get("labeller_user_id")
    return UUID(raw) if raw else None


def _removal(pair: TastePair, names: dict[UUID, str]) -> TasteRemoval | None:
    if pair.removed_at is None or pair.removed_label is None:
        return None
    removed = pair.removed_label
    removed_by = _displaced_labeller(pair)
    return TasteRemoval(
        # ck_taste_pairs_removal_whole holds via, at and label together.
        via=cast(Any, pair.removed_via),
        removed_at=pair.removed_at,
        removed_by_user_id=pair.removed_by_user_id,
        removed_by_name=names.get(pair.removed_by_user_id)
        if pair.removed_by_user_id
        else None,
        forced=pair.removed_forced,
        removed=TasteRemovedLabel(
            label=removed["label"],
            reasons=list(removed.get("reasons") or []),
            comment=removed.get("comment"),
            edit_note=removed.get("edit_note"),
            edit_asset_sha256=removed.get("edit_asset_sha256"),
            labeller_user_id=removed_by,
            labeller_name=names.get(removed_by) if removed_by else None,
            labelled_at=removed["labelled_at"],
        ),
    )


async def _render_pairs(
    db: AsyncSession,
    tenant_id: UUID,
    pairs: list[TastePair],
    *,
    with_email: bool,
) -> list[TastePairOut]:
    """``with_email``: an operator's session only (see ``labeller_names``)."""
    assets = await crud.get_assets(
        db,
        tenant_id=tenant_id,
        shas=[sha for p in pairs for sha in (p.asset_a_sha256, p.asset_b_sha256)],
    )
    names = await crud.labeller_names(
        db,
        (
            uid
            for p in pairs
            for uid in (
                p.labeller_user_id,
                p.removed_by_user_id,
                _displaced_labeller(p),
            )
        ),
        with_email=with_email,
    )
    out: list[TastePairOut] = []
    for pair in pairs:
        out.append(
            TastePairOut(
                id=pair.id,
                repo=pair.repo,
                slot_id=pair.slot_id,
                # The CHECKs hold source, label and reasons to these sets.
                source=cast(TasteSource, pair.source),
                uncertainty=pair.uncertainty,
                context=pair.context,
                asset_a=_image(assets[pair.asset_a_sha256]),
                asset_b=_image(assets[pair.asset_b_sha256]),
                capture_a_sha256=pair.capture_a_sha256,
                capture_b_sha256=pair.capture_b_sha256,
                in_situ=pair.capture_a_sha256 is not None
                and pair.capture_b_sha256 is not None,
                pushed_by=pair.pushed_by,
                skipped_at=pair.skipped_at,
                skip_count=pair.skip_count,
                label=cast(TasteLabel | None, pair.label),
                reasons=cast(list[TasteReason], list(pair.reasons)),
                comment=pair.comment,
                edit_note=pair.edit_note,
                edit_asset_sha256=pair.edit_asset_sha256,
                labeller_user_id=pair.labeller_user_id,
                labeller_name=names.get(pair.labeller_user_id)
                if pair.labeller_user_id
                else None,
                labelled_at=pair.labelled_at,
                first_labelled_at=pair.first_labelled_at,
                change_seq=pair.change_seq,
                tombstone=pair.label is None and pair.change_seq is not None,
                removal=_removal(pair, names),
                created_at=pair.created_at,
                updated_at=pair.updated_at,
            )
        )
    return out


def _pool_view(pool: list[PoolImage]) -> TastePool:
    counts: dict[str, int] = {}
    for image in pool:
        counts[image.direction] = counts.get(image.direction, 0) + 1
    return TastePool(
        images=len(pool),
        directions=[
            TasteDirection(direction=d, images=n) for d, n in sorted(counts.items())
        ],
    )


async def _budget(
    db: AsyncSession, tenant_id: UUID, now: datetime
) -> tuple[TasteBudget, crud.QueueCounts]:
    setting = await crud.get_budget(db, tenant_id=tenant_id)
    start = crud.week_start(now)
    counts = await crud.queue_counts(db, tenant_id=tenant_id, since=start)
    return (
        TasteBudget(
            weekly_budget=setting.weekly_budget,
            source="setting" if setting.written else "default",
            week_starts_at=start,
            labelled_this_week=counts.labelled_since,
            remaining=max(0, setting.weekly_budget - counts.labelled_since),
        ),
        counts,
    )


# ── the inbox read ─────────────────────────────────────────────────────


@router.get(
    "/inbox",
    response_model=TasteInbox,
    summary="Read the taste inbox: the queue head, the budget, recent labels",
)
async def read_taste_inbox(
    limit: Annotated[
        int,
        Query(ge=1, le=MAX_QUEUE_LIMIT, description="How many queued pairs to return."),
    ] = DEFAULT_QUEUE_LIMIT,
    over_budget: Annotated[
        bool,
        Query(
            description="Return queued pairs even when this week's budget is "
            "spent (the operator chose to keep going)."
        ),
    ] = False,
    principal: MemoryPrincipal = Depends(get_memory_tenant),
    can_label: bool = Depends(get_can_label),
    db: AsyncSession = Depends(get_async_db),
) -> TasteInbox:
    tenant_id = principal.tenant_id
    budget, counts = await _budget(db, tenant_id, datetime.now(UTC))
    # A spent budget hides the queue head but never touches the queue.
    head_limit = limit if over_budget else min(limit, budget.remaining)
    queue = list(await crud.list_queue(db, tenant_id=tenant_id, limit=head_limit))
    recent = list(
        await crud.list_recent_labels(db, tenant_id=tenant_id, limit=RECENT_LABELS)
    )
    rendered = await _render_pairs(
        db, tenant_id, queue + recent, with_email=principal.actor == "operator"
    )
    pool = await crud.calibration_pool(db, tenant_id=tenant_id)
    return TasteInbox(
        budget=budget,
        pending_total=counts.pending,
        labelled_total=counts.labelled,
        viewer_user_id=viewer_user_id(principal),
        over_budget=over_budget,
        pairs=rendered[: len(queue)],
        recent=rendered[len(queue) :],
        pool=_pool_view(pool),
        can_label=can_label,
        reason_vocabulary=cast(list[TasteReason], list(TASTE_REASONS)),
    )


# ── pushes ─────────────────────────────────────────────────────────────


async def _require_assets(
    db: AsyncSession, tenant_id: UUID, payload: TastePairPush
) -> None:
    named = {
        "asset_a_sha256": payload.asset_a_sha256,
        "asset_b_sha256": payload.asset_b_sha256,
        "capture_a_sha256": payload.capture_a_sha256,
        "capture_b_sha256": payload.capture_b_sha256,
    }
    held = await crud.get_assets(
        db, tenant_id=tenant_id, shas=[sha for sha in named.values() if sha]
    )
    for field, sha in named.items():
        if sha is None:
            continue
        asset = held.get(sha)
        if asset is None:
            # The same answer whether or not another tenant holds the hash.
            raise _refusal(
                status.HTTP_404_NOT_FOUND,
                "image_asset_not_found",
                f"{field}: this tenant holds no image with that sha256.",
                field=field,
            )
        if field.startswith("capture_") and asset.kind != "capture":
            raise _refusal(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "capture_not_a_capture",
                f"{field} names an image stored as '{asset.kind}', not 'capture'.",
                field=field,
            )


@router.post(
    "/pairs",
    response_model=TastePairPushResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        200: {
            "model": TastePairPushResponse,
            "description": "The pair was already queued (in either order); "
            "nothing changed.",
        },
        404: {
            "description": "This tenant holds no image with a named sha256 "
            "(or one was deleted while the pair was being queued)."
        },
        422: {"description": "A malformed field, or a capture that is not one."},
    },
    summary="Queue one pairwise taste question",
)
async def queue_taste_pair(
    payload: TastePairPush,
    response: Response,
    principal: MemoryPrincipal = Depends(get_memory_tenant),
    db: AsyncSession = Depends(get_async_db),
) -> TastePairPushResponse:
    await _require_assets(db, principal.tenant_id, payload)
    try:
        pair, created = await crud.push_pair(
            db,
            tenant_id=principal.tenant_id,
            repo=payload.repo,
            slot_id=payload.slot_id,
            asset_a_sha256=payload.asset_a_sha256,
            asset_b_sha256=payload.asset_b_sha256,
            capture_a_sha256=payload.capture_a_sha256,
            capture_b_sha256=payload.capture_b_sha256,
            source=payload.source,
            uncertainty=payload.uncertainty,
            context=payload.context,
            pushed_by=principal.actor,
        )
    except crud.ImageAssetGone as exc:
        raise _asset_gone(None) from exc
    await db.commit()
    logger.info(
        "taste_pair_pushed",
        tenant_id=str(principal.tenant_id),
        actor=principal.actor,
        pair_id=str(pair.id),
        source=payload.source,
        created=created,
    )
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    [out] = await _render_pairs(
        db, principal.tenant_id, [pair], with_email=principal.actor == "operator"
    )
    return TastePairPushResponse(pair=out, created=created)


@router.delete(
    "/pairs/{pair_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        403: {
            "description": "An operator who may not label (a coord-tenant "
            "admin, or a qontinui superuser, may)."
        },
        404: {"description": "No such pair for this tenant."},
        409: {
            "description": "The pair is labelled, or was answered and undone "
            "(its history is in the label feed); neither is withdrawn."
        },
    },
    summary="Withdraw a never-answered pair",
)
async def withdraw_taste_pair(
    pair_id: Annotated[UUID, Path()],
    principal: MemoryPrincipal = Depends(get_memory_tenant),
    can_label: bool = Depends(get_can_label),
    db: AsyncSession = Depends(get_async_db),
) -> Response:
    """Two populations: a device or service credential — studio correcting
    its own push — and an operator. The operator's path is the labeller's:
    a member who may only view the inbox may not empty it either."""
    if principal.actor == "operator" and not can_label:
        raise _refusal(
            status.HTTP_403_FORBIDDEN,
            "not_coord_tenant_admin",
            "Only a coord admin of this project withdraws a queued pair.",
        )
    if not await crud.withdraw_pair(db, tenant_id=principal.tenant_id, pair_id=pair_id):
        existing = await crud.get_pair(
            db, tenant_id=principal.tenant_id, pair_id=pair_id
        )
        if existing is None:
            raise _pair_not_found()
        if existing.label is not None:
            raise _refusal(
                status.HTTP_409_CONFLICT,
                "pair_already_labelled",
                "This pair is labelled; the label is the operator's and the "
                "pair is not withdrawn.",
            )
        raise _refusal(
            status.HTTP_409_CONFLICT,
            "pair_has_label_history",
            "This pair was answered and the answer undone; its history is in "
            "the label feed, so the pair is not withdrawn. It waits in the "
            "queue to be answered again or skipped.",
        )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── labels ─────────────────────────────────────────────────────────────


async def _label_refusal(
    db: AsyncSession,
    tenant_id: UUID,
    pair_id: UUID,
    reason: crud.LabelRefusal,
    *,
    verb: Literal["replace", "undo"],
) -> HTTPException:
    """The refusal for a label write that changed nothing. The write's
    savepoint has already rolled back, so the feed clock is released before
    the row is read and rendered here."""
    if reason == "absent":
        return _pair_not_found()
    if reason == "not_labelled":
        if verb == "undo":
            return _refusal(
                status.HTTP_409_CONFLICT,
                "pair_not_labelled",
                "This pair has no label to undo.",
            )
        # A label write cannot miss on an unanswered pair unless the pair
        # changed under it (a concurrent undo between its UPDATE and this
        # re-read): say so, rather than talk about an undo nobody asked for.
        return _refusal(
            status.HTTP_409_CONFLICT,
            "pair_changed_meanwhile",
            "This pair changed while the label was being saved; nothing was "
            "changed. Read it again and answer it.",
        )
    existing = await crud.get_pair(db, tenant_id=tenant_id, pair_id=pair_id)
    if existing is None:
        return _pair_not_found()
    [current] = await _render_pairs(db, tenant_id, [existing], with_email=True)
    if reason == "already_labelled":
        return _refusal(
            status.HTTP_409_CONFLICT,
            "pair_already_labelled",
            "This pair was already labelled; nothing was changed.",
            current=current.model_dump(mode="json"),
        )
    who = current.labeller_name or "a labeller who no longer exists"
    return _refusal(
        status.HTTP_409_CONFLICT,
        "label_not_yours",
        f"This label is {who}'s, not yours; nothing was changed. Send "
        f"force=true to {verb} it anyway — that is recorded, with your name "
        "and their answer.",
        current=current.model_dump(mode="json"),
    )


@router.put(
    "/pairs/{pair_id}/label",
    response_model=TastePairOut,
    responses={
        404: {"description": "No such pair, or no such edited image, for this tenant."},
        409: {
            "description": "pair_already_labelled: the pair is already "
            "labelled (send relabel: true to replace your own answer). "
            "label_not_yours: the answer is another labeller's (send force: "
            "true as well; the replaced answer is recorded). "
            "pair_changed_meanwhile: the pair changed under the write (a "
            "concurrent undo); nothing was changed — read it again."
        },
    },
    summary="Label one pair: A, B or both bad, with reasons, a comment and an edit",
)
async def label_taste_pair(
    pair_id: Annotated[UUID, Path()],
    payload: TasteLabelWrite,
    labeller: Labeller = Depends(get_labeller),
    db: AsyncSession = Depends(get_async_db),
) -> TastePairOut:
    tenant_id = labeller.tenant_id
    if payload.edit_asset_sha256 is not None:
        held = await crud.get_assets(
            db, tenant_id=tenant_id, shas=[payload.edit_asset_sha256]
        )
        if not held:
            raise _refusal(
                status.HTTP_404_NOT_FOUND,
                "image_asset_not_found",
                "edit_asset_sha256: this tenant holds no image with that sha256.",
                field="edit_asset_sha256",
            )
    try:
        pair = await crud.set_label(
            db,
            tenant_id=tenant_id,
            pair_id=pair_id,
            choice=payload.choice,
            reasons=list(payload.reasons),
            comment=payload.comment,
            edit_note=payload.edit_note,
            edit_asset_sha256=payload.edit_asset_sha256,
            labeller_user_id=labeller.user.id,
            relabel=payload.relabel,
            force=payload.force,
        )
    except crud.ImageAssetGone as exc:
        raise _asset_gone("edit_asset_sha256") from exc
    if isinstance(pair, str):
        raise await _label_refusal(db, tenant_id, pair_id, pair, verb="replace")
    await db.commit()
    # This write replaced an answer exactly when its removal record was
    # stamped by it: set_label writes removed_at and labelled_at from one
    # clock reading. An older record (an earlier undo or relabel) is not this
    # write's and is not logged as such.
    replaced = (
        pair.removed_label
        if pair.removed_via == "relabel" and pair.removed_at == pair.labelled_at
        else None
    )
    logger.info(
        "taste_pair_labelled",
        tenant_id=str(tenant_id),
        pair_id=str(pair_id),
        by=str(labeller.user.id),
        label=payload.choice,
        reasons=len(payload.reasons),
        relabel=payload.relabel,
        change_seq=pair.change_seq,
        replaced=replaced,
        forced=replaced is not None and pair.removed_forced,
    )
    [out] = await _render_pairs(db, tenant_id, [pair], with_email=True)
    return out


@router.delete(
    "/pairs/{pair_id}/label",
    response_model=TastePairOut,
    responses={
        404: {"description": "No such pair for this tenant."},
        409: {
            "description": "The pair is not labelled, or its label is another "
            "labeller's and force was not sent."
        },
    },
    summary="Undo your label (or, with force, a colleague's): the pair returns "
    "to the queue",
)
async def unlabel_taste_pair(
    pair_id: Annotated[UUID, Path()],
    force: Annotated[
        bool,
        Query(
            description="Remove the label even though another labeller gave "
            "it. The row records that the undo was forced, who forced it, and "
            "the answer it removed."
        ),
    ] = False,
    labeller: Labeller = Depends(get_labeller),
    db: AsyncSession = Depends(get_async_db),
) -> TastePairOut:
    """Admin-gated like every label write (``get_labeller``), ``force``
    included: only a coord-tenant admin of the effective tenant, or a
    qontinui superuser, reaches this handler at all."""
    tenant_id = labeller.tenant_id
    outcome = await crud.clear_label(
        db,
        tenant_id=tenant_id,
        pair_id=pair_id,
        actor_user_id=labeller.user.id,
        force=force,
    )
    if isinstance(outcome, str):
        raise await _label_refusal(db, tenant_id, pair_id, outcome, verb="undo")
    await db.commit()
    logger.info(
        "taste_pair_unlabelled",
        tenant_id=str(tenant_id),
        pair_id=str(pair_id),
        by=str(labeller.user.id),
        change_seq=outcome.change_seq,
        removed=outcome.removed_label,
        forced=outcome.removed_forced,
    )
    [out] = await _render_pairs(db, tenant_id, [outcome], with_email=True)
    return out


@router.post(
    "/pairs/{pair_id}/skip",
    response_model=TastePairOut,
    responses={
        404: {"description": "No such pair for this tenant."},
        409: {"description": "The pair is already labelled."},
    },
    summary="Skip an unanswered pair: it moves to the back of the queue",
)
async def skip_taste_pair(
    pair_id: Annotated[UUID, Path()],
    labeller: Labeller = Depends(get_labeller),
    db: AsyncSession = Depends(get_async_db),
) -> TastePairOut:
    pair = await crud.skip_pair(db, tenant_id=labeller.tenant_id, pair_id=pair_id)
    if pair is None:
        if (
            await crud.get_pair(db, tenant_id=labeller.tenant_id, pair_id=pair_id)
            is None
        ):
            raise _pair_not_found()
        raise _refusal(
            status.HTTP_409_CONFLICT,
            "pair_already_labelled",
            "This pair is already labelled; there is nothing to skip.",
        )
    await db.commit()
    [out] = await _render_pairs(db, labeller.tenant_id, [pair], with_email=True)
    return out


# ── calibration and settings ───────────────────────────────────────────


@router.post(
    "/calibration-batch",
    response_model=CalibrationBatchResult,
    responses={
        409: {"description": "An image left the pool mid-build; nothing was queued."}
    },
    summary="Queue the calibration batch: pairs across the tenant's directions",
)
async def build_taste_calibration_batch(
    payload: CalibrationBatchRequest,
    labeller: Labeller = Depends(get_labeller),
    db: AsyncSession = Depends(get_async_db),
) -> CalibrationBatchResult:
    """Idempotent: a pair already queued is never queued twice, so building
    again only adds pairs the pool's growth makes possible."""
    tenant_id = labeller.tenant_id
    pool = await crud.calibration_pool(db, tenant_id=tenant_id)
    queued = await crud.queued_slotless_pairs(db, tenant_id=tenant_id)
    plan = plan_calibration_pairs(pool, payload.size, queued)
    created_ids: list[UUID] = []
    raced = 0
    for a, b in plan.new_pairs:
        try:
            pair, created = await crud.push_pair(
                db,
                tenant_id=tenant_id,
                repo=None,
                slot_id=None,
                asset_a_sha256=a.sha256,
                asset_b_sha256=b.sha256,
                capture_a_sha256=None,
                capture_b_sha256=None,
                source="calibration",
                uncertainty=None,
                context={"directions": [a.direction, b.direction]},
                pushed_by="operator",
            )
        except crud.ImageAssetGone as exc:
            # Nothing of this build is committed: the request rolls back.
            raise _refusal(
                status.HTTP_409_CONFLICT,
                "calibration_pool_changed",
                "An image left the calibration pool while the batch was being "
                "built; nothing was queued. Build the batch again.",
            ) from exc
        if created:
            created_ids.append(pair.id)
        else:
            raced += 1
    await db.commit()
    logger.info(
        "taste_calibration_batch",
        tenant_id=str(tenant_id),
        requested=payload.size,
        created=len(created_ids),
        pool=len(pool),
        shortfall=plan.shortfall,
    )
    return CalibrationBatchResult(
        requested=payload.size,
        created=len(created_ids),
        already_queued=plan.already_queued + raced,
        pool=_pool_view(pool),
        # A pair the plan chose that a concurrent build queued first is not
        # this build's: it is counted in already_queued and named here.
        shortfall=plan.shortfall or ("concurrent_build" if raced else None),
        pair_ids=created_ids,
    )


@router.put(
    "/settings",
    response_model=TasteSettingsOut,
    summary="Set the weekly labelling budget",
)
async def write_taste_settings(
    payload: TasteSettingsWrite,
    labeller: Labeller = Depends(get_labeller),
    db: AsyncSession = Depends(get_async_db),
) -> TasteSettingsOut:
    setting = await crud.set_budget(
        db,
        tenant_id=labeller.tenant_id,
        weekly_budget=payload.weekly_budget,
        user_id=labeller.user.id,
    )
    await db.commit()
    return TasteSettingsOut(
        weekly_budget=setting.weekly_budget,
        source="setting" if setting.written else "default",
        updated_at=setting.updated_at,
    )


# ── the taste twin's read ──────────────────────────────────────────────


@router.get(
    "/labels",
    response_model=TasteLabelPage,
    responses={422: {"description": "A malformed cursor."}},
    summary="Read the label feed: labels and undos, by commit-ordered position",
)
async def read_taste_labels(
    limit: Annotated[int, Query(ge=1, le=MAX_LABEL_PAGE)] = DEFAULT_LABEL_PAGE,
    after: Annotated[
        str | None,
        Query(
            max_length=512,
            description="The previous page's next_cursor (set on every page, "
            "the last one included, so a reader can follow the feed).",
        ),
    ] = None,
    principal: MemoryPrincipal = Depends(get_memory_tenant),
    db: AsyncSession = Depends(get_async_db),
) -> TasteLabelPage:
    try:
        resume = crud.decode_label_cursor(after) if after is not None else None
    except crud.InvalidCursor as exc:
        raise _refusal(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "invalid_cursor", str(exc)
        ) from exc
    rows, truncated = await crud.list_labels(
        db, tenant_id=principal.tenant_id, limit=limit, after=resume
    )
    pairs = list(rows)
    last_seq = pairs[-1].change_seq if pairs else resume
    return TasteLabelPage(
        limit=limit,
        truncated=truncated,
        next_cursor=crud.encode_label_cursor(last_seq)
        if last_seq is not None
        else None,
        labels=await _render_pairs(
            db,
            principal.tenant_id,
            pairs,
            with_email=principal.actor == "operator",
        ),
    )
