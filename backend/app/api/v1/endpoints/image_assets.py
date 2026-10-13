"""The content-addressed image store — upload, read by hash, slot candidates.

Phase 13 of plan ``2026-10-13-image-generation-and-visual-judgment``. The
store every image the factory makes or measures lands in: generated
candidates, their derivatives, page captures, and exemplars that enter from
outside. Its writers and readers are the asset compile step (Phase 19), the
judges (Phase 20) and the taste inbox (Phase 23).

Endpoints (mounted under ``/api/v1/image-assets``):

* ``POST ""`` — upload one image as ``multipart/form-data`` (``file``,
  ``kind``, optional ``provenance``). The server hashes the bytes, reads the
  format, MIME type, dimensions and EXIF orientation FROM them (the filename
  and the part's Content-Type are ignored), caps the size and the total
  pixels, and stores the object at
  ``image-assets/{tenant_id}/sha256/{h[:2]}/{h}{ext}``. Idempotent: the same
  bytes again answer ``200`` with ``created: false`` and write no object. The
  FIRST upload's ``kind`` stands and ``provenance`` only gains keys, up to the
  same cap an upload's own provenance has; ``conflicts`` names whatever a
  re-upload sent that was therefore not applied, and why.
* ``GET "/slot-candidates"`` — one page of a slot's candidates (``repo``,
  ``slot_id``, optional ``status``, ``order`` oldest|newest, ``limit``,
  ``after``), each with its asset; ``next_cursor`` fetches the next page.
* ``PUT "/slot-candidates"`` — propose an asset for a slot, or move a
  proposal (``status``, ``recipe_hash``, ``values``, ``judge``). Choosing one
  returns the slot's previous choice to ``candidate`` in the same transaction
  and says so in ``demoted``.
* ``DELETE "/slot-candidates"`` — withdraw one proposal (the asset stays).
* ``GET "/{sha256}"`` — one asset and a URL to its bytes: presigned on S3 /
  MinIO, this API's content route on the local backend.
* ``GET "/{sha256}/content"`` — the bytes themselves, to the tenant that holds
  them.

Auth: :func:`app.api.v1.endpoints.memory.get_memory_tenant`, unchanged — a
coord device JWT, the coord service token, or an operator's session. The
tenant comes ONLY from that principal, never from the request. Every lookup is
tenant-scoped: a hash the caller's tenant does not hold answers the same
``404`` whether or not another tenant holds it, and every object key names its
tenant, so no route here reveals or serves another tenant's image.

One exposure sits OUTSIDE this API, and this module does not close it: on the
LOCAL development backend the objects are files under ``uploads/``, which
``app.main`` mounts at ``/uploads`` for avatars with no authentication, so
anyone who knows a tenant id and a hash can fetch an image there. No route
here hands out such a URL — the local backend's ``GET "/{sha256}"`` points at
the authenticated content route instead.
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, BinaryIO, Final, cast

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
from fastapi.responses import StreamingResponse
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db
from app.api.strict_query import StrictQueryRoute
from app.api.v1.endpoints.memory import MemoryPrincipal, get_memory_tenant
from app.core.config import settings
from app.crud import image_assets as crud
from app.models.image_asset import ImageAsset, ImageSlotCandidate
from app.schemas.image_assets import (
    MAX_PROVENANCE_BYTES,
    REPO_PATTERN,
    SHA256_PATTERN,
    SLOT_ID_PATTERN,
    CandidateOrder,
    ImageAssetConflict,
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

#: Bytes per read when streaming an image back.
_CONTENT_CHUNK_BYTES: Final = 256 * 1024

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


def _content_url(sha256: str) -> str:
    """This API's authenticated content route for ``sha256``, absolute."""
    base = settings.BACKEND_URL.rstrip("/")
    return f"{base}{settings.API_V1_STR}/image-assets/{sha256}/content"


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
            "re-stored. The first upload's kind stands and provenance only "
            "gained keys (up to its cap); `conflicts` names what was not "
            "applied, and why.",
        },
        413: {"description": "The image is larger than the store accepts."},
        415: {"description": "The bytes are not an accepted image format."},
        422: {
            "description": "Unreadable image, too many pixels, or a field that "
            "is malformed or cannot be stored (NaN, U+0000, nested too deep)."
        },
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
        Form(
            description="How the image entered the store. The first upload's "
            "kind stands."
        ),
    ],
    provenance: Annotated[
        str | None,
        Form(
            description="The generator's provenance record: a JSON object, "
            f"serialized, at most {MAX_PROVENANCE_BYTES} bytes. Stored as JSONB; "
            "a re-upload adds keys, up to that same cap, and never removes or "
            "changes one."
        ),
    ] = None,
    principal: MemoryPrincipal = Depends(get_memory_tenant),
    db: AsyncSession = Depends(get_async_db),
    storage: ObjectStorageService = Depends(get_object_storage),
) -> ImageAssetUploadResponse:
    """Store one image under the hash of its bytes, for the caller's tenant.

    Every refusal — a malformed or unstorable field, an oversized or
    unreadable image — happens before anything is written to storage.
    """
    try:
        fields = ImageAssetUploadFields.model_validate(
            {"kind": kind, "provenance": provenance}
        )
    except ValidationError as exc:
        # ``kind`` was already held to its Literal by FastAPI, so in practice
        # this is ``provenance``: not JSON, not an object, too large, nested
        # too deep, or holding a value JSON storage refuses (NaN, U+0000).
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
    row, created, conflicts = await crud.upsert_asset(
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
        orientation=sniffed.orientation,
    )
    await db.commit()

    logger.info(
        "image_asset_uploaded",
        tenant_id=str(principal.tenant_id),
        actor=principal.actor,
        sha256=stored.sha256,
        mime_type=sniffed.mime_type,
        byte_size=stored.size,
        frames=sniffed.frames,
        kind=row.kind,
        created=created,
        object_written=stored.written,
        conflicts=len(conflicts),
    )
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return ImageAssetUploadResponse(
        **ImageAssetOut.model_validate(row).model_dump(),
        created=created,
        conflicts=[ImageAssetConflict(path=c.path, reason=c.reason) for c in conflicts],
    )


# ── slot candidates (declared before "/{sha256}" so the literal path wins) ──


@router.get(
    "/slot-candidates",
    response_model=SlotCandidateList,
    responses={422: {"description": "A malformed cursor, or one for the other order."}},
    summary="List one image slot's candidates, a page at a time",
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
    order: Annotated[
        CandidateOrder,
        Query(description="oldest (the default) or newest first."),
    ] = "oldest",
    limit: Annotated[
        int, Query(ge=1, le=MAX_CANDIDATE_LIMIT)
    ] = DEFAULT_CANDIDATE_LIMIT,
    after: Annotated[
        str | None,
        Query(
            max_length=512,
            description="The previous page's next_cursor, with the same order.",
        ),
    ] = None,
    principal: MemoryPrincipal = Depends(get_memory_tenant),
    db: AsyncSession = Depends(get_async_db),
) -> SlotCandidateList:
    """One page of the slot's candidates, each with the asset it names."""
    try:
        resume = crud.decode_cursor(after, order) if after is not None else None
    except crud.InvalidCursor as exc:
        raise _refusal(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "invalid_cursor", str(exc)
        ) from exc
    rows, truncated = await crud.list_slot_candidates(
        db,
        tenant_id=principal.tenant_id,
        repo=repo,
        slot_id=slot_id,
        status=status_filter,
        limit=limit,
        order=order,
        after=resume,
    )
    next_cursor = crud.encode_cursor(rows[-1][0], order) if truncated else None
    return SlotCandidateList(
        repo=repo,
        slot_id=slot_id,
        status=status_filter,
        order=order,
        limit=limit,
        truncated=truncated,
        next_cursor=next_cursor,
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
    summary="Read one image's record and a URL to its bytes",
)
async def get_image_asset(
    sha256: Annotated[str, Path(pattern=SHA256_PATTERN)],
    expires_in: Annotated[
        int,
        Query(
            ge=60,
            le=MAX_URL_EXPIRY_SECONDS,
            description="Seconds a presigned URL stays valid (S3 / MinIO).",
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

    url: str
    expires_at: datetime | None
    if isinstance(storage.backend, LocalBackend):
        # The local backend's own URL is the unauthenticated /uploads static
        # mount; hand out the tenant-checked content route instead. It does
        # not expire, so no expiry time is claimed for it.
        url, expires_at = _content_url(row.sha256), None
    else:
        url = storage.generate_presigned_url(row.storage_key, expiration=expires_in)
        expires_at = datetime.now(UTC) + timedelta(seconds=expires_in)
        # A presigned URL dies with the temporary credential that signed it.
        credential_expiry = storage.backend.credential_expires_at()
        if credential_expiry is not None and credential_expiry < expires_at:
            expires_at = credential_expiry
    return ImageAssetWithUrl(
        **ImageAssetOut.model_validate(row).model_dump(),
        url=url,
        url_expires_at=expires_at,
    )


@router.get(
    "/{sha256}/content",
    response_class=StreamingResponse,
    responses={
        200: {
            "content": {mime: {} for mime in _ACCEPTED_MIME_TYPES},
            "description": "The image's bytes, as uploaded.",
        },
        404: {"description": "This tenant holds no image with that sha256."},
        500: {"description": "The record exists but its stored bytes do not."},
    },
    summary="Read one image's bytes",
)
async def get_image_asset_content(
    sha256: Annotated[str, Path(pattern=SHA256_PATTERN)],
    principal: MemoryPrincipal = Depends(get_memory_tenant),
    db: AsyncSession = Depends(get_async_db),
    storage: ObjectStorageService = Depends(get_object_storage),
) -> StreamingResponse:
    """The bytes of an image the caller's tenant holds — the same 404 as the
    record route for any other hash, another tenant's included."""
    row = await crud.get_asset(db, tenant_id=principal.tenant_id, sha256=sha256)
    if row is None:
        raise _asset_not_found()
    try:
        stream = await asyncio.to_thread(storage.open_stream, row.storage_key)
    except HTTPException as exc:
        if exc.status_code != status.HTTP_404_NOT_FOUND:
            raise
        logger.error(
            "image_object_missing",
            tenant_id=str(principal.tenant_id),
            sha256=row.sha256,
            storage_key=row.storage_key,
        )
        raise _refusal(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "image_object_missing",
            "The image's record exists but its stored bytes do not; uploading "
            "the same bytes again restores them.",
        ) from exc

    def chunks(source: BinaryIO) -> Iterator[bytes]:
        try:
            while chunk := source.read(_CONTENT_CHUNK_BYTES):
                yield chunk
        finally:
            source.close()

    return StreamingResponse(
        chunks(stream),
        media_type=row.mime_type,
        headers={
            # The bytes behind a hash never change; the response is the
            # tenant's own, so no shared cache may keep it.
            "Cache-Control": "private, max-age=31536000, immutable",
            "ETag": f'"{row.sha256}"',
            "X-Content-Type-Options": "nosniff",
        },
    )
