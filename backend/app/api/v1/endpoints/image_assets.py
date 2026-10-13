"""The content-addressed image store — upload, read by hash, slot candidates.

Phase 13 of plan ``2026-10-13-image-generation-and-visual-judgment``. The
store every image the factory makes or measures lands in: generated
candidates, their derivatives, page captures, and exemplars that enter from
outside. Its writers and readers are the asset compile step (Phase 19), the
judges (Phase 20) and the taste inbox (Phase 23).

Endpoints (mounted under ``/api/v1/image-assets``):

* ``POST ""`` — upload one image as ``multipart/form-data`` (``file``,
  ``kind``, optional ``provenance``). The server hashes the bytes, reads the
  format, MIME type and dimensions FROM them (the filename and the part's
  Content-Type are ignored), caps the size, and stores the object at
  ``image-assets/{tenant_id}/sha256/{h[:2]}/{h}{ext}``. Idempotent: the same
  bytes again answer ``200`` with ``created: false`` and write no object;
  ``kind`` is set to the value sent and ``provenance`` replaced when sent.
* ``GET "/slot-candidates"`` — one slot's candidates (``repo``, ``slot_id``,
  optional ``status``, ``limit``), oldest first, each with its asset.
* ``PUT "/slot-candidates"`` — propose an asset for a slot, or move a
  proposal (``status``, ``recipe_hash``, ``values``, ``judge``). Choosing one
  returns the slot's previous choice to ``candidate`` in the same transaction
  and says so in ``demoted``.
* ``DELETE "/slot-candidates"`` — withdraw one proposal (the asset stays).
* ``GET "/{sha256}"`` — one asset and a time-limited URL to its bytes.

Auth: :func:`app.api.v1.endpoints.memory.get_memory_tenant`, unchanged — a
coord device JWT, the coord service token, or an operator's session. The
tenant comes ONLY from that principal, never from the request. A hash the
caller's tenant does not hold answers ``404`` whether or not another tenant
holds it, and every object key names its tenant, so nothing in this API can
reveal or reach another tenant's images.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Final, cast

import structlog
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Path,
    Query,
    Response,
    UploadFile,
    status,
)
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db
from app.api.strict_query import StrictQueryRoute
from app.api.v1.endpoints.memory import MemoryPrincipal, get_memory_tenant
from app.crud import image_assets as crud
from app.models.image_asset import ImageAsset, ImageSlotCandidate
from app.schemas.image_assets import (
    MAX_PROVENANCE_BYTES,
    REPO_PATTERN,
    SHA256_PATTERN,
    SLOT_ID_PATTERN,
    ImageAssetKind,
    ImageAssetOut,
    ImageAssetUploadFields,
    ImageAssetUploadResponse,
    ImageAssetWithUrl,
    SlotCandidateAsset,
    SlotCandidateDemotion,
    SlotCandidateList,
    SlotCandidateOut,
    SlotCandidateStatus,
    SlotCandidateUpsert,
    SlotCandidateUpsertResponse,
)
from app.services.image_sniff import ACCEPTED_FORMATS, ImageRefused, sniff_image
from app.services.storage import LocalBackend, ObjectStorageService, object_storage

logger = structlog.get_logger(__name__)

#: ``StrictQueryRoute``: a query key no handler here declares is a ``422
#: unknown_query_parameter`` naming the accepted set — ``?state=chosen`` must
#: not silently list every status.
router = APIRouter(route_class=StrictQueryRoute)

#: The key prefix of every object this store writes.
STORAGE_PREFIX: Final = "image-assets"

#: The largest image accepted, in bytes.
MAX_IMAGE_BYTES: Final = 25 * 1024 * 1024
#: The request-body cap ``app.main``'s ``BodyLimitMiddleware`` enforces for the
#: upload, before the multipart parser spools anything: the image, the largest
#: provenance field, and room for the multipart framing.
MAX_UPLOAD_REQUEST_BYTES: Final = MAX_IMAGE_BYTES + MAX_PROVENANCE_BYTES + 64 * 1024

DEFAULT_URL_EXPIRY_SECONDS: Final = 3600
#: SigV4's ceiling for a presigned URL.
MAX_URL_EXPIRY_SECONDS: Final = 7 * 24 * 3600

DEFAULT_CANDIDATE_LIMIT: Final = 100
MAX_CANDIDATE_LIMIT: Final = 500

_ACCEPTED_MIME_TYPES: Final = [fmt.mime_type for fmt in ACCEPTED_FORMATS]


def get_object_storage() -> ObjectStorageService:
    """The object store the image routes write to (overridable in tests)."""
    return object_storage


def _refusal(status_code: int, error: str, message: str, **extra: Any) -> HTTPException:
    return HTTPException(
        status_code=status_code, detail={"error": error, "message": message, **extra}
    )


def _asset_not_found() -> HTTPException:
    # The same answer whether or not ANOTHER tenant holds the hash: the
    # lookup is tenant-scoped, so it cannot tell, and must not.
    return _refusal(
        status.HTTP_404_NOT_FOUND,
        "image_asset_not_found",
        "This tenant holds no image with that sha256.",
    )


def _candidate_out(
    candidate: ImageSlotCandidate, asset: ImageAsset
) -> SlotCandidateOut:
    return SlotCandidateOut(
        repo=candidate.repo,
        slot_id=candidate.slot_id,
        asset_sha256=candidate.asset_sha256,
        # The CHECK ck_image_slot_candidates_status holds the column to this set.
        status=cast(SlotCandidateStatus, candidate.status),
        recipe_hash=candidate.recipe_hash,
        values=candidate.values,
        judge=candidate.judge,
        created_at=candidate.created_at,
        updated_at=candidate.updated_at,
        asset=SlotCandidateAsset.model_validate(asset),
    )


# ── upload ──────────────────────────────────────────────────────────────


@router.post(
    "",
    response_model=ImageAssetUploadResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        200: {
            "model": ImageAssetUploadResponse,
            "description": "The tenant already held these bytes; nothing was "
            "re-stored (kind / provenance updated as sent).",
        },
        413: {"description": "The image is larger than the store accepts."},
        415: {"description": "The bytes are not an accepted image format."},
        422: {"description": "Unreadable image, too many pixels, or bad fields."},
    },
    summary="Upload an image to the content-addressed store",
)
async def upload_image_asset(
    response: Response,
    file: Annotated[
        UploadFile,
        File(
            description="The image. Its filename and Content-Type are ignored: "
            "the format is read from the bytes."
        ),
    ],
    kind: Annotated[
        ImageAssetKind,
        Form(description="How the image entered the store."),
    ],
    provenance: Annotated[
        str | None,
        Form(
            description="The generator's provenance record: a JSON object, "
            f"serialized, at most {MAX_PROVENANCE_BYTES} bytes. Kept verbatim."
        ),
    ] = None,
    principal: MemoryPrincipal = Depends(get_memory_tenant),
    db: AsyncSession = Depends(get_async_db),
    storage: ObjectStorageService = Depends(get_object_storage),
) -> ImageAssetUploadResponse:
    """Store one image under the hash of its bytes, for the caller's tenant."""
    try:
        fields = ImageAssetUploadFields.model_validate(
            {"kind": kind, "provenance": provenance}
        )
    except ValidationError as exc:
        # ``kind`` was already held to its Literal by FastAPI, so in practice
        # this is ``provenance``: not JSON, not an object, or too large.
        first = exc.errors()[0]
        field = str(first["loc"][0]) if first["loc"] else "form"
        raise _refusal(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"{field}_invalid",
            f"{field}: {first['msg']}",
        ) from exc

    # One byte past the cap is enough to know it is over. The request-body
    # cap in app.main already refused anything far larger before parsing.
    data = await file.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise _refusal(
            status.HTTP_413_CONTENT_TOO_LARGE,
            "image_too_large",
            f"Images can be at most {MAX_IMAGE_BYTES // (1024 * 1024)} MB.",
            max_bytes=MAX_IMAGE_BYTES,
        )

    try:
        sniffed = await asyncio.to_thread(sniff_image, data)
    except ImageRefused as exc:
        if exc.code == "image_unsupported_format":
            raise _refusal(
                status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                exc.code,
                exc.message,
                accepted=_ACCEPTED_MIME_TYPES,
            ) from exc
        raise _refusal(
            status.HTTP_422_UNPROCESSABLE_CONTENT, exc.code, exc.message
        ) from exc

    stored = await asyncio.to_thread(
        storage.put_content_addressed,
        data,
        sniffed.extension,
        STORAGE_PREFIX,
        tenant_id=principal.tenant_id,
        content_type=sniffed.mime_type,
    )
    row, created = await crud.upsert_asset(
        db,
        tenant_id=principal.tenant_id,
        sha256=stored.sha256,
        storage_key=stored.key,
        mime_type=sniffed.mime_type,
        width=sniffed.width,
        height=sniffed.height,
        byte_size=stored.size,
        kind=fields.kind,
        provenance=fields.provenance,
    )
    await db.commit()

    logger.info(
        "image_asset_uploaded",
        tenant_id=str(principal.tenant_id),
        actor=principal.actor,
        sha256=stored.sha256,
        mime_type=sniffed.mime_type,
        byte_size=stored.size,
        kind=fields.kind,
        created=created,
        object_written=stored.written,
    )
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return ImageAssetUploadResponse(
        **ImageAssetOut.model_validate(row).model_dump(), created=created
    )


# ── slot candidates (declared before "/{sha256}" so the literal path wins) ──


@router.get(
    "/slot-candidates",
    response_model=SlotCandidateList,
    summary="List one image slot's candidates",
)
async def list_slot_candidates(
    repo: Annotated[str, Query(min_length=1, max_length=200, pattern=REPO_PATTERN)],
    slot_id: Annotated[
        str, Query(min_length=1, max_length=200, pattern=SLOT_ID_PATTERN)
    ],
    status_filter: Annotated[
        SlotCandidateStatus | None,
        Query(alias="status", description="Only candidates in this status."),
    ] = None,
    limit: Annotated[
        int, Query(ge=1, le=MAX_CANDIDATE_LIMIT)
    ] = DEFAULT_CANDIDATE_LIMIT,
    principal: MemoryPrincipal = Depends(get_memory_tenant),
    db: AsyncSession = Depends(get_async_db),
) -> SlotCandidateList:
    """The slot's candidates, oldest first, each with the asset it names."""
    rows, truncated = await crud.list_slot_candidates(
        db,
        tenant_id=principal.tenant_id,
        repo=repo,
        slot_id=slot_id,
        status=status_filter,
        limit=limit,
    )
    return SlotCandidateList(
        repo=repo,
        slot_id=slot_id,
        status=status_filter,
        limit=limit,
        truncated=truncated,
        candidates=[_candidate_out(candidate, asset) for candidate, asset in rows],
    )


@router.put(
    "/slot-candidates",
    response_model=SlotCandidateUpsertResponse,
    responses={
        201: {
            "model": SlotCandidateUpsertResponse,
            "description": "The candidate was created.",
        },
        404: {"description": "This tenant holds no image with that sha256."},
        409: {"description": "Another choice for the slot landed concurrently."},
    },
    summary="Propose an image for a slot, or move a proposal",
)
async def upsert_slot_candidate(
    payload: SlotCandidateUpsert,
    response: Response,
    principal: MemoryPrincipal = Depends(get_memory_tenant),
    db: AsyncSession = Depends(get_async_db),
) -> SlotCandidateUpsertResponse:
    """Create or update the (repo, slot_id, asset_sha256) candidate.

    ``recipe_hash``, ``values`` and ``judge`` are replaced when sent and kept
    when omitted. ``status: chosen`` returns the slot's previous choice to
    ``candidate`` in the same transaction; ``demoted`` names it.
    """
    asset = await crud.get_asset(
        db, tenant_id=principal.tenant_id, sha256=payload.asset_sha256
    )
    if asset is None:
        raise _asset_not_found()

    sent = payload.model_fields_set
    try:
        write = await crud.upsert_slot_candidate(
            db,
            tenant_id=principal.tenant_id,
            repo=payload.repo,
            slot_id=payload.slot_id,
            asset_sha256=payload.asset_sha256,
            status=payload.status,
            recipe_hash=payload.recipe_hash if "recipe_hash" in sent else crud.UNSET,
            values=payload.values if "values" in sent else crud.UNSET,
            judge=payload.judge if "judge" in sent else crud.UNSET,
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        logger.warning(
            "image_slot_candidate_conflict",
            tenant_id=str(principal.tenant_id),
            repo=payload.repo,
            slot_id=payload.slot_id,
            error=str(exc.orig),
        )
        raise _refusal(
            status.HTTP_409_CONFLICT,
            "slot_candidate_conflict",
            "A concurrent write to this slot conflicted (two choices at once); "
            "re-read the slot and retry.",
        ) from exc

    response.status_code = (
        status.HTTP_201_CREATED if write.created else status.HTTP_200_OK
    )
    return SlotCandidateUpsertResponse(
        candidate=_candidate_out(write.candidate, asset),
        created=write.created,
        demoted=[SlotCandidateDemotion(asset_sha256=h) for h in write.demoted],
    )


@router.delete(
    "/slot-candidates",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={404: {"description": "No such candidate for this tenant."}},
    summary="Withdraw one proposal (the image itself stays)",
)
async def delete_slot_candidate(
    repo: Annotated[str, Query(min_length=1, max_length=200, pattern=REPO_PATTERN)],
    slot_id: Annotated[
        str, Query(min_length=1, max_length=200, pattern=SLOT_ID_PATTERN)
    ],
    asset_sha256: Annotated[str, Query(pattern=SHA256_PATTERN)],
    principal: MemoryPrincipal = Depends(get_memory_tenant),
    db: AsyncSession = Depends(get_async_db),
) -> Response:
    """Delete the (repo, slot_id, asset_sha256) candidate row."""
    deleted = await crud.delete_slot_candidate(
        db,
        tenant_id=principal.tenant_id,
        repo=repo,
        slot_id=slot_id,
        asset_sha256=asset_sha256,
    )
    if not deleted:
        raise _refusal(
            status.HTTP_404_NOT_FOUND,
            "slot_candidate_not_found",
            "This tenant has no such candidate for that slot.",
        )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── read by hash ────────────────────────────────────────────────────────


@router.get(
    "/{sha256}",
    response_model=ImageAssetWithUrl,
    responses={404: {"description": "This tenant holds no image with that sha256."}},
    summary="Read one image's record and a time-limited URL to its bytes",
)
async def get_image_asset(
    sha256: Annotated[str, Path(pattern=SHA256_PATTERN)],
    expires_in: Annotated[
        int,
        Query(
            ge=60,
            le=MAX_URL_EXPIRY_SECONDS,
            description="Seconds the URL stays valid.",
        ),
    ] = DEFAULT_URL_EXPIRY_SECONDS,
    principal: MemoryPrincipal = Depends(get_memory_tenant),
    db: AsyncSession = Depends(get_async_db),
    storage: ObjectStorageService = Depends(get_object_storage),
) -> ImageAssetWithUrl:
    """Answers only when the caller's tenant holds an image with this hash."""
    row = await crud.get_asset(db, tenant_id=principal.tenant_id, sha256=sha256)
    if row is None:
        raise _asset_not_found()

    url = storage.generate_presigned_url(row.storage_key, expiration=expires_in)
    # The local development backend serves its files from a static mount with
    # no expiry, so it gets no expiry time rather than one it cannot keep.
    expires_at = (
        None
        if isinstance(storage.backend, LocalBackend)
        else datetime.now(UTC) + timedelta(seconds=expires_in)
    )
    return ImageAssetWithUrl(
        **ImageAssetOut.model_validate(row).model_dump(),
        url=url,
        url_expires_at=expires_at,
    )
