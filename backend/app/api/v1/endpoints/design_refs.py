"""The design reference library API — ``/api/v1/design-refs``.

Phase 1 of plan
``2026-11-13-design-reference-library-stores-described-web-examples-for-any-project-to-query``
(with the Phase 1b store routes folded in). The tables are in
``app/models/design_refs.py``; the shared logic is in
``app/services/design_refs.py``.

Auth
====
Every route resolves its caller with
:func:`app.api.v1.endpoints.memory.get_memory_tenant`: a coord device JWT, the
coord service token, or an operator's session, the tenant taken only from the
principal and every row filtered on it (no FK, no RLS — the image store's
posture). On top of that:

* **The operator gate.** "Operator" is a human session of the owning tenant
  (``principal.actor == "operator"``); a device or service credential gets
  403. It guards confirming a site context or a personality row, curation
  (review state, quality), takedown, approving/rejecting/cancelling capture
  jobs, and ``include_holdout=true``.
* **Approving or retiring a principle** additionally follows the taste
  ``get_labeller`` pattern: :func:`get_principle_approver` requires coord-tenant
  admin in the effective tenant (``require_coord_tenant_admin_target``) plus an
  authenticated user.
* **The rater is derived, never read.** ``rater_kind`` and every confirmed
  state come from the credential arm: operator → ``operator``, any other
  principal → ``ai``. A ``rater_kind`` in the body is ignored.
* **Source copies and replay bundles** stream through
  ``GET /captures/{id}/source/{part}`` and ``GET /captures/{id}/bundle`` to an
  operator session or a device credential minted by pairing
  (``mint_provenance == "paired"``, the ``get_paired_device`` allowlist); a
  bootstrap-minted credential gets 403. No storage URL is ever returned for
  these blobs, and the bytes are never rendered on this origin: they are
  served as an ``application/octet-stream`` attachment under
  ``Content-Security-Policy: sandbox; default-src 'none'``.
* **Vocabularies** (style families, dimensions, traits) are global and written
  only by a qontinui superuser.

Holdout
=======
Agent-facing reads — ``POST /search``, ``GET /examples/{level}/{id}``,
``POST /similar-by-style``, ``POST /compare-to-references`` and
``GET /principles`` evidence — never return a holdout site, nor one whose split
is not yet assigned. Only an operator principal may pass
``include_holdout=true`` (the review UI); any other caller sending it gets 403.
The CRUD reads (the worker's plumbing) hide ASSIGNED holdout sites from a
non-operator but keep unassigned ones visible, so a worker can attach pages to
a site it just created; they are not references. The same rule hides an
assigned holdout's source copies and bundle from a paired device. A
non-operator never sees an OPERATOR judgement that touches a site which is not
a reference — decided per row over every target it names, so a comparison of a
reference page against a holdout one is hidden through either side — and the
correction log (which carries the operator's edits) is operator-only: an AI
judge never sees the operator's judgements of a holdout.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import os
import re
import tempfile
from collections import defaultdict
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, BinaryIO, Final, Literal
from uuid import UUID

import structlog
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Path,
    Query,
    Request,
    status,
)
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps as api_deps
from app.api.deps import get_async_db, get_current_active_user_async
from app.api.strict_query import StrictQueryRoute
from app.api.v1.endpoints.memory import MemoryPrincipal, get_memory_tenant
from app.api.v1.endpoints.operations import require_coord_tenant_admin_target
from app.auth.config import current_superuser
from app.models.design_refs import (
    Blob,
    Capture,
    CaptureJob,
    CaptureSource,
    Comparison,
    Component,
    Correction,
    Description,
    DesignPrinciple,
    DesignPrincipleEvidence,
    DoNotCapture,
    Flow,
    JudgeBenchRun,
    Page,
    PerceptionDimension,
    PerceptionRating,
    PersonalityTrait,
    ReplayBundle,
    Site,
    SitePersonality,
    StyleFamily,
)
from app.models.user import User
from app.schemas.design_refs import (
    BalanceCell,
    BlobOut,
    CaptureCreate,
    CaptureJobClaim,
    CaptureJobCreate,
    CaptureJobOut,
    CaptureJobUpdate,
    CaptureOut,
    CaptureSourceCreate,
    CaptureSourceOut,
    CompareHit,
    CompareRequest,
    CompareResponse,
    ComparisonCreate,
    ComparisonOut,
    ComponentCreate,
    ComponentOut,
    ComponentUpdate,
    ContextConfirm,
    CorpusBalance,
    CorrectionOut,
    CorrelationOut,
    DescriptionCreate,
    DescriptionOut,
    DescriptionUpdate,
    DimensionOut,
    DimensionWrite,
    DoNotCaptureOut,
    EvidenceAttach,
    ExampleOut,
    FingerprintBatch,
    FingerprintBatchOut,
    FlowCreate,
    FlowOut,
    FlowUpdate,
    JudgeBenchRunCreate,
    JudgeBenchRunOut,
    PageCreate,
    PageOut,
    PageUpdate,
    PersonalityConfirm,
    PersonalityCreate,
    PersonalityOut,
    PrincipleCreate,
    PrincipleEvidenceOut,
    PrincipleOut,
    PrincipleRetire,
    RatingCreate,
    RatingDistribution,
    RatingList,
    RatingOut,
    ReplayBundleCreate,
    ReplayBundleOut,
    ReviewWrite,
    SearchHit,
    SearchRequest,
    SearchResponse,
    SimilarByStyleRequest,
    SimilarByStyleResponse,
    SiteCreate,
    SiteOut,
    SiteUpdate,
    StyleFamilyOut,
    StyleFamilyWrite,
    StyleHit,
    TakedownRequest,
    TakedownResult,
    TokenDifference,
    TraitOut,
    TraitWrite,
    UploadIntent,
    UploadTicket,
    UploadVerify,
    VocabOut,
)
from app.services import design_refs as svc
from app.services.storage import ObjectStorageService, S3Backend, object_storage

logger = structlog.get_logger(__name__)

router = APIRouter(route_class=StrictQueryRoute)

API_ROOT: Final = "/api/v1/design-refs"
#: The largest blob one streaming upload accepts. A replay bundle's own
#: default ceiling is 250 MB (``bundle.max_page_mb``); ``0`` there means
#: unlimited, so this is the backend's backstop, not the policy.
MAX_BLOB_BYTES: Final = 4 * 1024 * 1024 * 1024
_CHUNK: Final = 1024 * 1024
#: A capture run below this many holdout pairs records UNKNOWN agreement.
MIN_BENCH_PAIRS: Final = 30
PRESIGNED_PUT_SECONDS: Final = 900

Tier = Literal["private", "public"]

Principal = Annotated[MemoryPrincipal, Depends(get_memory_tenant)]
Db = Annotated[AsyncSession, Depends(get_async_db)]


def get_design_refs_storage() -> ObjectStorageService:
    """The object store design-refs blobs live in (overridable in tests)."""
    return object_storage


Storage = Annotated[ObjectStorageService, Depends(get_design_refs_storage)]


# ═════════════════════════════ refusals and gates ═════════════════════════════


def _refusal(status_code: int, error: str, message: str, **extra: Any) -> HTTPException:
    return HTTPException(
        status_code=status_code, detail={"error": error, "message": message, **extra}
    )


def _not_found(what: str) -> HTTPException:
    return _refusal(
        status.HTTP_404_NOT_FOUND,
        f"{what}_not_found",
        f"This tenant has no {what.replace('_', ' ')} with that id.",
    )


def is_operator(principal: MemoryPrincipal) -> bool:
    return principal.actor == "operator"


def require_operator(principal: MemoryPrincipal, action: str) -> None:
    """The operator gate: a human session of the owning tenant."""
    if not is_operator(principal):
        raise _refusal(
            status.HTTP_403_FORBIDDEN,
            "operator_required",
            f"Only an operator's session may {action}; a device or service "
            "credential cannot.",
        )


def gate_include_holdout(principal: MemoryPrincipal, include_holdout: bool) -> bool:
    if include_holdout and not is_operator(principal):
        raise _refusal(
            status.HTTP_403_FORBIDDEN,
            "include_holdout_operator_only",
            "include_holdout=true is accepted only from an operator principal "
            "(the review UI); holdout sites are never served to an agent.",
        )
    return include_holdout


def derive_rater(
    principal: MemoryPrincipal, model_id: str | None, prompt_version: str | None
) -> tuple[str, str]:
    """``(rater_kind, rater_id)`` from the credential arm — never the body."""
    if is_operator(principal):
        return "operator", str(principal.user_id)
    who = model_id or (
        f"device:{principal.device_id}" if principal.device_id else principal.actor
    )
    return "ai", f"{who}@{prompt_version}" if prompt_version else who


def _actor_id(principal: MemoryPrincipal) -> str:
    if principal.user_id is not None:
        return f"{principal.actor}:{principal.user_id}"
    if principal.device_id is not None:
        return f"{principal.actor}:device:{principal.device_id}"
    return principal.actor


class PrincipleApprover:
    """The operator approving or retiring a principle, and the tenant."""

    def __init__(self, tenant_id: UUID, user: User) -> None:
        self.tenant_id = tenant_id
        self.user = user


async def get_principle_approver(
    tenant_id: UUID = Depends(require_coord_tenant_admin_target),
    user: User = Depends(get_current_active_user_async),
) -> PrincipleApprover:
    """The taste ``get_labeller`` pattern: coord-tenant admin in the
    effective tenant (or a qontinui superuser) plus an authenticated user."""
    return PrincipleApprover(tenant_id=tenant_id, user=user)


async def get_source_reader(
    principal: Principal,
    credentials: HTTPAuthorizationCredentials | None = Depends(
        api_deps._optional_bearer_scheme
    ),
) -> MemoryPrincipal:
    """An operator session, or a device credential minted by PAIRING.

    The ``get_paired_device`` allowlist: ``mint_provenance == "paired"`` on a
    device principal. A bootstrap-minted ``/agents/credential`` token (an
    agent principal), an unknown provenance and the coord service token all
    get 403 — source copies and bundles are the corpus's most sensitive
    bytes.
    """
    if is_operator(principal):
        return principal
    if principal.actor != "device":
        raise _refusal(
            status.HTTP_403_FORBIDDEN,
            "paired_credential_required",
            "Source copies and replay bundles are readable by an operator's "
            "session or a paired device credential only.",
        )
    await api_deps.get_paired_device(credentials)
    return principal


SourceReader = Annotated[MemoryPrincipal, Depends(get_source_reader)]


# ═════════════════════════════ helpers ═════════════════════════════


async def _owned[RowT](
    db: AsyncSession, model: type[RowT], tenant_id: UUID, row_id: UUID
) -> RowT | None:
    table: Any = model
    row: RowT | None = (
        await db.execute(
            select(model).where(table.tenant_id == tenant_id, table.id == row_id)
        )
    ).scalar_one_or_none()
    return row


async def _site_or_404(
    db: AsyncSession, principal: MemoryPrincipal, site_id: UUID
) -> Site:
    """A site of the tenant a CRUD read may show this caller: an ASSIGNED
    holdout is hidden from every non-operator."""
    site = await _owned(db, Site, principal.tenant_id, site_id)
    if site is None or (site.split == "holdout" and not is_operator(principal)):
        raise _not_found("site")
    return site


async def _page_and_site(
    db: AsyncSession, principal: MemoryPrincipal, page_id: UUID
) -> tuple[Page, Site]:
    page = await _owned(db, Page, principal.tenant_id, page_id)
    if page is None:
        raise _not_found("page")
    site = await _site_or_404(db, principal, page.site_id)
    return page, site


async def _require_blobs(
    db: AsyncSession, tenant_id: UUID, keys: list[str], *, tier: str, field: str
) -> None:
    """Every key is a verified blob of this tenant under ``tier``'s prefix."""
    for key in keys:
        parsed = svc.parse_blob_key(key)
        if parsed is None or parsed.tenant_id != tenant_id or parsed.tier != tier:
            raise _refusal(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "blob_key_refused",
                f"{field} must be a design-refs/{tier}/ key of this tenant.",
                key=key,
            )
        # FOR SHARE: a concurrent takedown (which takes FOR UPDATE on the
        # same row) waits for this record's transaction, then sees it.
        held = (
            await db.execute(
                select(Blob.key)
                .where(Blob.tenant_id == tenant_id, Blob.key == key)
                .with_for_update(read=True)
            )
        ).scalar()
        if held is None:
            raise _refusal(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "blob_not_verified",
                f"{field} names a blob that was never uploaded and verified.",
                key=key,
            )


def _correction(
    tenant_id: UUID,
    principal: MemoryPrincipal,
    target_kind: str,
    target_id: UUID,
    field: str,
    before: Any,
    after: Any,
) -> Correction:
    return Correction(
        tenant_id=tenant_id,
        target_kind=target_kind,
        target_id=target_id,
        field=field,
        from_value=before,
        to_value=after,
        actor_kind="operator" if is_operator(principal) else "ai",
        actor_id=_actor_id(principal),
    )


def _apply_edits(
    db: AsyncSession,
    principal: MemoryPrincipal,
    row: Any,
    target_kind: str,
    edits: dict[str, Any],
) -> None:
    """Set every edited field; an operator's edit of a field is logged.

    An explicit ``null`` for a column that cannot hold one is a 422, checked
    before anything is set (not the database's 500)."""
    columns = row.__table__.columns
    not_nullable = sorted(
        name
        for name, value in edits.items()
        if value is None and name in columns and not columns[name].nullable
    )
    if not_nullable:
        raise _refusal(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "null_not_allowed",
            "These fields cannot be cleared; send a value or omit them.",
            fields=not_nullable,
        )
    for name, value in edits.items():
        before = getattr(row, name)
        if before == value:
            continue
        setattr(row, name, value)
        if is_operator(principal):
            db.add(
                _correction(
                    principal.tenant_id,
                    principal,
                    target_kind,
                    row.id,
                    name,
                    before,
                    value,
                )
            )


async def _dimension(db: AsyncSession, key: str) -> PerceptionDimension:
    dim = await db.get(PerceptionDimension, key)
    if dim is None or not dim.active:
        raise _refusal(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "unknown_dimension",
            "dimension_key names no active perception dimension.",
            dimension_key=key,
        )
    return dim


# ═════════════════════════════ uploads ═════════════════════════════


def _stream_path(tier: str, sha256: str, ext: str) -> str:
    return f"{API_ROOT}/blobs/{tier}/{sha256}{ext}"


def _blob_tier(purpose: str, tier: Tier) -> Tier:
    """Source copies and bundles are ``private/`` whatever the record's tier."""
    return "private" if purpose in ("source", "bundle") else tier


@router.post("/uploads", response_model=UploadTicket, summary="Ask where to put a blob")
async def create_upload(
    body: UploadIntent, principal: Principal, db: Db, storage: Storage
) -> UploadTicket:
    if body.size > MAX_BLOB_BYTES:
        raise _refusal(
            status.HTTP_413_CONTENT_TOO_LARGE,
            "blob_too_large",
            f"A blob is at most {MAX_BLOB_BYTES} bytes.",
            max_bytes=MAX_BLOB_BYTES,
        )
    if body.purpose == "bundle" and body.ext != ".zip":
        raise _refusal(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "bundle_ext",
            "A replay bundle is a .zip.",
        )
    tier = _blob_tier(body.purpose, body.tier)
    key = svc.blob_key(tier, principal.tenant_id, body.sha256, body.ext)
    held = (
        await db.execute(
            select(Blob).where(Blob.tenant_id == principal.tenant_id, Blob.key == key)
        )
    ).scalar_one_or_none()
    stream_path = _stream_path(tier, body.sha256, body.ext)
    if held is not None:
        return UploadTicket(
            key=key,
            tier=tier,
            already_stored=True,
            method="stream",
            stream_path=stream_path,
        )
    if isinstance(storage.backend, S3Backend):
        backend = storage.backend
        # Pin the object's SHA-256: S3 refuses a PUT whose bytes do not hash
        # to it, so the presigned URL can only ever write THESE bytes.
        checksum = base64.b64encode(bytes.fromhex(body.sha256)).decode()
        url = await asyncio.to_thread(
            backend.client.generate_presigned_url,
            "put_object",
            Params={
                "Bucket": backend.bucket_name,
                "Key": key,
                "ChecksumSHA256": checksum,
            },
            ExpiresIn=PRESIGNED_PUT_SECONDS,
        )
        return UploadTicket(
            key=key,
            tier=tier,
            already_stored=False,
            method="presigned_put",
            stream_path=stream_path,
            presigned_url=url,
            required_headers={"x-amz-checksum-sha256": checksum},
            verify_path=f"{API_ROOT}/uploads/verify",
        )
    return UploadTicket(
        key=key,
        tier=tier,
        already_stored=False,
        method="stream",
        stream_path=stream_path,
    )


def _hash_stream(source: BinaryIO, limit: int) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    while chunk := source.read(_CHUNK):
        size += len(chunk)
        if size > limit:
            break
        digest.update(chunk)
    return digest.hexdigest(), size


async def _record_blob(
    db: AsyncSession,
    tenant_id: UUID,
    key: str,
    parsed: svc.ParsedKey,
    size: int,
    content_type: str | None,
) -> Blob:
    existing = await db.get(Blob, key)
    if existing is not None:
        return existing
    row = Blob(
        key=key,
        tenant_id=tenant_id,
        tier=parsed.tier,
        sha256=parsed.sha256,
        size=size,
        content_type=content_type,
    )
    db.add(row)
    await db.flush()
    return row


@router.put(
    "/blobs/{tier}/{filename}",
    response_model=BlobOut,
    summary="Stream one blob's bytes (verified before it is recorded)",
)
async def put_blob(
    tier: Literal["private", "public"],
    filename: Annotated[str, Path(pattern=r"^[0-9a-f]{64}\.[a-z0-9]{1,10}$")],
    request: Request,
    principal: Principal,
    db: Db,
    storage: Storage,
) -> BlobOut:
    """The streaming upload: the body goes to a temporary file chunk by chunk
    (never held whole in memory), its SHA-256 and size are checked against the
    key it names, and only then is it stored and recorded."""
    sha256, ext = filename[:64], filename[64:]
    key = svc.blob_key(tier, principal.tenant_id, sha256, ext)
    parsed = svc.parse_blob_key(key)
    assert parsed is not None
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > MAX_BLOB_BYTES:
        raise _refusal(
            status.HTTP_413_CONTENT_TOO_LARGE,
            "blob_too_large",
            f"A blob is at most {MAX_BLOB_BYTES} bytes.",
            max_bytes=MAX_BLOB_BYTES,
        )
    digest = hashlib.sha256()
    size = 0
    fd, tmp_path = tempfile.mkstemp(prefix="design-refs-", suffix=".part")
    try:
        with os.fdopen(fd, "wb") as sink:
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX_BLOB_BYTES:
                    raise _refusal(
                        status.HTTP_413_CONTENT_TOO_LARGE,
                        "blob_too_large",
                        f"A blob is at most {MAX_BLOB_BYTES} bytes.",
                        max_bytes=MAX_BLOB_BYTES,
                    )
                digest.update(chunk)
                sink.write(chunk)
        if digest.hexdigest() != sha256:
            raise _refusal(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "blob_digest_mismatch",
                "The bytes do not hash to the sha256 the path names; nothing was stored.",
                expected=sha256,
                actual=digest.hexdigest(),
            )
        content_type = request.headers.get("content-type")
        recorded = await db.get(Blob, key) is not None

        def _store() -> None:
            with open(tmp_path, "rb") as source:
                storage.backend.upload_file(
                    file_obj=source, key=key, content_type=content_type
                )
            with storage.open_stream(key) as stored:
                stored_sha, stored_size = _hash_stream(stored, MAX_BLOB_BYTES)
            if stored_sha != sha256 or stored_size != size:
                if not recorded:
                    storage.delete_file(key)
                raise _refusal(
                    status.HTTP_502_BAD_GATEWAY,
                    "blob_store_verify_failed",
                    "The stored object did not read back as the bytes sent.",
                )

        def _ensure_stored() -> None:
            """An object already at the key is trusted only once its bytes
            hash to the key; otherwise it is replaced by the verified ones."""
            if storage.file_exists(key):
                with storage.open_stream(key) as existing:
                    held_sha, held_size = _hash_stream(existing, MAX_BLOB_BYTES)
                if held_sha == sha256 and held_size == size:
                    return
                logger.warning("design_refs_blob_replaced_unverified_object", key=key)
            _store()

        await asyncio.to_thread(_ensure_stored)
        row = await _record_blob(
            db, principal.tenant_id, key, parsed, size, content_type
        )
        await db.commit()
        return BlobOut.model_validate(row)
    finally:
        try:
            os.unlink(tmp_path)
        except FileNotFoundError:
            pass


@router.post(
    "/uploads/verify",
    response_model=BlobOut,
    summary="Verify an object written by presigned PUT, then record it",
)
async def verify_upload(
    body: UploadVerify, principal: Principal, db: Db, storage: Storage
) -> BlobOut:
    parsed = svc.parse_blob_key(body.key)
    if parsed is None or parsed.tenant_id != principal.tenant_id:
        raise _refusal(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "blob_key_refused",
            "key is not a design-refs key of this tenant.",
        )
    if not await asyncio.to_thread(storage.file_exists, body.key):
        raise _refusal(
            status.HTTP_404_NOT_FOUND,
            "blob_object_missing",
            "No object is stored at that key yet.",
        )

    def _read() -> tuple[str, int]:
        with storage.open_stream(body.key) as source:
            return _hash_stream(source, MAX_BLOB_BYTES)

    sha, size = await asyncio.to_thread(_read)
    recorded = await db.get(Blob, body.key)
    if sha != parsed.sha256:
        if recorded is not None:
            # A recorded blob's object is never deleted here: records name it.
            logger.error("design_refs_recorded_blob_corrupt", key=body.key)
            raise _refusal(
                status.HTTP_409_CONFLICT,
                "blob_object_corrupt",
                "The stored object no longer hashes to its key; it is recorded, "
                "so it was left in place for the operator.",
            )
        await asyncio.to_thread(storage.delete_file, body.key)
        raise _refusal(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "blob_digest_mismatch",
            "The stored object does not hash to its key; it was removed.",
        )
    row = await _record_blob(db, principal.tenant_id, body.key, parsed, size, None)
    await db.commit()
    return BlobOut.model_validate(row)


# ═════════════════════════════ sites ═════════════════════════════


@router.post("/sites", response_model=SiteOut, status_code=status.HTTP_201_CREATED)
async def create_site(body: SiteCreate, principal: Principal, db: Db) -> SiteOut:
    domain = svc.normalise_domain(body.domain)
    if await svc.blocked_by_do_not_capture(
        db, principal.tenant_id, f"https://{domain}/"
    ):
        raise _refusal(
            status.HTTP_409_CONFLICT,
            "do_not_capture",
            "This domain is on the tenant's do-not-capture list.",
            domain=domain,
        )
    existing = (
        await db.execute(
            select(Site).where(
                Site.tenant_id == principal.tenant_id,
                Site.tier == body.tier,
                Site.domain == domain,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise _refusal(
            status.HTTP_409_CONFLICT,
            "site_exists",
            "This tenant already holds this domain in this tier.",
            site_id=str(existing.id),
        )
    if (
        body.style_family is not None
        and await db.get(StyleFamily, body.style_family) is None
    ):
        raise _refusal(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "unknown_style_family",
            "style_family names no style family.",
        )
    site = Site(
        tenant_id=principal.tenant_id,
        **body.model_dump(exclude={"domain"}),
        domain=domain,
    )
    db.add(site)
    await db.commit()
    await db.refresh(site)
    return SiteOut.model_validate(site)


@router.get("/sites", response_model=list[SiteOut])
async def list_sites(
    principal: Principal,
    db: Db,
    domain: str | None = None,
    tier: Literal["private", "public"] | None = None,
    include_holdout: bool = False,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[SiteOut]:
    gate_include_holdout(principal, include_holdout)
    stmt = select(Site).where(Site.tenant_id == principal.tenant_id)
    if domain is not None:
        stmt = stmt.where(Site.domain == svc.normalise_domain(domain))
    if tier is not None:
        stmt = stmt.where(Site.tier == tier)
    if not is_operator(principal):
        stmt = stmt.where(or_(Site.split.is_(None), Site.split != "holdout"))
    stmt = stmt.order_by(Site.created_at.desc()).limit(limit).offset(offset)
    return [SiteOut.model_validate(row) for row in (await db.execute(stmt)).scalars()]


@router.get("/sites/{site_id}", response_model=SiteOut)
async def get_site(site_id: UUID, principal: Principal, db: Db) -> SiteOut:
    return SiteOut.model_validate(await _site_or_404(db, principal, site_id))


@router.patch("/sites/{site_id}", response_model=SiteOut)
async def update_site(
    site_id: UUID, body: SiteUpdate, principal: Principal, db: Db
) -> SiteOut:
    site = await _site_or_404(db, principal, site_id)
    edits = body.model_dump(exclude_unset=True)
    if "split" in edits:
        raise _refusal(
            status.HTTP_409_CONFLICT,
            "split_immutable",
            "split is assigned once, at the first context confirmation, and "
            "never changes: a site an agent has seen cannot become a clean "
            "holdout.",
            split=site.split,
        )
    context_fields = set(ContextConfirm.model_fields)
    if (
        site.context_state == "confirmed"
        and not is_operator(principal)
        and (set(edits) & context_fields)
    ):
        raise _refusal(
            status.HTTP_403_FORBIDDEN,
            "operator_required",
            "A confirmed site context is edited only by an operator.",
        )
    if (
        edits.get("style_family") is not None
        and await db.get(StyleFamily, edits["style_family"]) is None
    ):
        raise _refusal(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "unknown_style_family",
            "style_family names no style family.",
        )
    _apply_edits(db, principal, site, "site", edits)
    await db.commit()
    await db.refresh(site)
    return SiteOut.model_validate(site)


@router.post("/sites/{site_id}/context/confirm", response_model=SiteOut)
async def confirm_context(
    site_id: UUID, body: ContextConfirm, principal: Principal, db: Db
) -> SiteOut:
    """The operator confirms (and may edit) the site context. Every edited
    field goes to the correction log; the first confirmation assigns
    ``split``."""
    require_operator(principal, "confirm a site context")
    site = await _site_or_404(db, principal, site_id)
    edits = body.model_dump(exclude_unset=True)
    family = edits.get("style_family", site.style_family)
    if family is None:
        raise _refusal(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "style_family_required",
            "A site context is confirmed with a style family: the holdout split "
            "is drawn within it.",
        )
    if await db.get(StyleFamily, family) is None:
        raise _refusal(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "unknown_style_family",
            "style_family names no style family.",
        )
    _apply_edits(db, principal, site, "site", edits)
    if site.context_state != "confirmed":
        db.add(
            _correction(
                principal.tenant_id,
                principal,
                "site",
                site.id,
                "context_state",
                site.context_state,
                "confirmed",
            )
        )
        site.context_state = "confirmed"
        site.context_confirmed_at = datetime.now(UTC)
        site.context_confirmed_by = principal.user_id
    await svc.assign_split(db, site)
    await db.commit()
    await db.refresh(site)
    return SiteOut.model_validate(site)


# ═════════════════════════════ pages, flows ═════════════════════════════


@router.post("/pages", response_model=PageOut, status_code=status.HTTP_201_CREATED)
async def create_page(body: PageCreate, principal: Principal, db: Db) -> PageOut:
    site = await _site_or_404(db, principal, body.site_id)
    if await svc.blocked_by_do_not_capture(db, principal.tenant_id, body.url):
        raise _refusal(
            status.HTTP_409_CONFLICT,
            "do_not_capture",
            "This URL is on the tenant's do-not-capture list.",
        )
    if body.capture_job_id is not None and (
        await _owned(db, CaptureJob, principal.tenant_id, body.capture_job_id) is None
    ):
        raise _not_found("capture_job")
    page = Page(tenant_id=principal.tenant_id, tier=site.tier, **body.model_dump())
    db.add(page)
    await db.commit()
    await db.refresh(page)
    return PageOut.model_validate(page)


@router.get("/pages", response_model=list[PageOut])
async def list_pages(
    site_id: UUID,
    principal: Principal,
    db: Db,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[PageOut]:
    await _site_or_404(db, principal, site_id)
    rows = await db.execute(
        select(Page)
        .where(Page.tenant_id == principal.tenant_id, Page.site_id == site_id)
        .order_by(Page.created_at)
        .limit(limit)
        .offset(offset)
    )
    return [PageOut.model_validate(row) for row in rows.scalars()]


@router.get("/pages/{page_id}", response_model=PageOut)
async def get_page(page_id: UUID, principal: Principal, db: Db) -> PageOut:
    page, _site = await _page_and_site(db, principal, page_id)
    return PageOut.model_validate(page)


@router.patch("/pages/{page_id}", response_model=PageOut)
async def update_page(
    page_id: UUID, body: PageUpdate, principal: Principal, db: Db
) -> PageOut:
    page, _site = await _page_and_site(db, principal, page_id)
    _apply_edits(db, principal, page, "page", body.model_dump(exclude_unset=True))
    await db.commit()
    await db.refresh(page)
    return PageOut.model_validate(page)


async def _check_steps(
    db: AsyncSession, tenant_id: UUID, site_id: UUID, steps: list[Any]
) -> list[dict[str, Any]]:
    page_ids = [step.page_id for step in steps]
    if page_ids:
        held = {
            row[0]
            for row in (
                await db.execute(
                    select(Page.id).where(
                        Page.tenant_id == tenant_id,
                        Page.site_id == site_id,
                        Page.id.in_(page_ids),
                    )
                )
            ).all()
        }
        missing = [str(p) for p in page_ids if p not in held]
        if missing:
            raise _refusal(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "flow_step_page_unknown",
                "Every flow step names a page of the flow's own site.",
                page_ids=missing,
            )
    return [step.model_dump(mode="json") for step in steps]


@router.post("/flows", response_model=FlowOut, status_code=status.HTTP_201_CREATED)
async def create_flow(body: FlowCreate, principal: Principal, db: Db) -> FlowOut:
    site = await _site_or_404(db, principal, body.site_id)
    steps = await _check_steps(db, principal.tenant_id, site.id, body.steps)
    flow = Flow(
        tenant_id=principal.tenant_id,
        tier=site.tier,
        site_id=site.id,
        name=body.name,
        goal=body.goal,
        steps=steps,
        tags=body.tags,
    )
    db.add(flow)
    await db.commit()
    await db.refresh(flow)
    return FlowOut.model_validate(flow)


@router.get("/flows", response_model=list[FlowOut])
async def list_flows(site_id: UUID, principal: Principal, db: Db) -> list[FlowOut]:
    await _site_or_404(db, principal, site_id)
    rows = await db.execute(
        select(Flow)
        .where(Flow.tenant_id == principal.tenant_id, Flow.site_id == site_id)
        .order_by(Flow.created_at)
    )
    return [FlowOut.model_validate(row) for row in rows.scalars()]


@router.get("/flows/{flow_id}", response_model=FlowOut)
async def get_flow(flow_id: UUID, principal: Principal, db: Db) -> FlowOut:
    flow = await _owned(db, Flow, principal.tenant_id, flow_id)
    if flow is None:
        raise _not_found("flow")
    await _site_or_404(db, principal, flow.site_id)
    return FlowOut.model_validate(flow)


@router.patch("/flows/{flow_id}", response_model=FlowOut)
async def update_flow(
    flow_id: UUID, body: FlowUpdate, principal: Principal, db: Db
) -> FlowOut:
    flow = await _owned(db, Flow, principal.tenant_id, flow_id)
    if flow is None:
        raise _not_found("flow")
    await _site_or_404(db, principal, flow.site_id)
    edits = body.model_dump(exclude_unset=True)
    if body.steps is not None:
        edits["steps"] = await _check_steps(
            db, principal.tenant_id, flow.site_id, body.steps
        )
    _apply_edits(db, principal, flow, "flow", edits)
    await db.commit()
    await db.refresh(flow)
    return FlowOut.model_validate(flow)


# ═════════════════════════════ captures ═════════════════════════════


@router.post(
    "/captures", response_model=CaptureOut, status_code=status.HTTP_201_CREATED
)
async def create_capture(
    body: CaptureCreate, principal: Principal, db: Db
) -> CaptureOut:
    page, _site = await _page_and_site(db, principal, body.page_id)
    keys = {
        name: getattr(body, name)
        for name in ("screenshot_key", "structure_key", "styles_key", "a11y_key")
    }
    for name, key in keys.items():
        if key is not None:
            await _require_blobs(
                db, principal.tenant_id, [key], tier=page.tier, field=name
            )
    capture = Capture(
        tenant_id=principal.tenant_id, tier=page.tier, **body.model_dump()
    )
    db.add(capture)
    await db.commit()
    await db.refresh(capture)
    return CaptureOut.model_validate(capture)


@router.get("/captures", response_model=list[CaptureOut])
async def list_captures(
    page_id: UUID, principal: Principal, db: Db
) -> list[CaptureOut]:
    await _page_and_site(db, principal, page_id)
    rows = await db.execute(
        select(Capture)
        .where(Capture.tenant_id == principal.tenant_id, Capture.page_id == page_id)
        .order_by(Capture.created_at)
    )
    return [CaptureOut.model_validate(row) for row in rows.scalars()]


@router.get("/captures/{capture_id}", response_model=CaptureOut)
async def get_capture(capture_id: UUID, principal: Principal, db: Db) -> CaptureOut:
    capture = await _owned(db, Capture, principal.tenant_id, capture_id)
    if capture is None:
        raise _not_found("capture")
    await _page_and_site(db, principal, capture.page_id)
    return CaptureOut.model_validate(capture)


@router.post(
    "/capture-sources",
    response_model=CaptureSourceOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_capture_source(
    body: CaptureSourceCreate, principal: Principal, db: Db
) -> CaptureSourceOut:
    page, _site = await _page_and_site(db, principal, body.page_id)
    for name, part in body.parts.items():
        await _require_blobs(
            db, principal.tenant_id, [part.key], tier="private", field=f"parts.{name}"
        )
    parts: dict[str, Any] = {}
    for name, part in body.parts.items():
        blob = await db.get(Blob, part.key)
        assert blob is not None
        parts[name] = {
            **part.model_dump(exclude_none=True),
            "sha256": blob.sha256,
            "size": blob.size,
        }
    row = CaptureSource(
        tenant_id=principal.tenant_id,
        tier=page.tier,
        page_id=page.id,
        run_id=body.run_id,
        viewport=body.viewport,
        parts=parts,
        missing=body.missing,
        logged_in=body.logged_in,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return CaptureSourceOut.model_validate(row)


@router.post(
    "/replay-bundles",
    response_model=ReplayBundleOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_replay_bundle(
    body: ReplayBundleCreate, principal: Principal, db: Db
) -> ReplayBundleOut:
    page, _site = await _page_and_site(db, principal, body.page_id)
    if not body.bundle_key.endswith(".zip"):
        raise _refusal(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "bundle_ext",
            "A replay bundle is a .zip.",
        )
    await _require_blobs(
        db, principal.tenant_id, [body.bundle_key], tier="private", field="bundle_key"
    )
    row = ReplayBundle(
        tenant_id=principal.tenant_id, tier=page.tier, **body.model_dump()
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return ReplayBundleOut.model_validate(row)


_RANGE_RE: Final = re.compile(r"\Abytes=(\d*)-(\d*)\Z")


def _parse_range(header: str | None, size: int) -> tuple[int, int] | None:
    """``(start, end)`` inclusive for one satisfiable byte range, else None
    (no header). An unsatisfiable or multi-range header is a 416."""
    if not header:
        return None
    match = _RANGE_RE.match(header.strip())
    if match is None or (not match[1] and not match[2]):
        raise _refusal(
            status.HTTP_416_RANGE_NOT_SATISFIABLE,
            "range_not_satisfiable",
            "One byte range (bytes=a-b, bytes=a- or bytes=-n) is accepted.",
        )
    if not match[1]:
        length = int(match[2])
        if length == 0:
            raise _refusal(
                status.HTTP_416_RANGE_NOT_SATISFIABLE,
                "range_not_satisfiable",
                "An empty suffix range selects nothing.",
            )
        start, end = max(0, size - length), size - 1
    else:
        start = int(match[1])
        end = int(match[2]) if match[2] else size - 1
        end = min(end, size - 1)
    if start > end or start >= size:
        raise _refusal(
            status.HTTP_416_RANGE_NOT_SATISFIABLE,
            "range_not_satisfiable",
            f"The object is {size} bytes.",
        )
    return start, end


def _open_range(
    storage: ObjectStorageService, key: str, start: int, end: int
) -> BinaryIO:
    backend = storage.backend
    if isinstance(backend, S3Backend):
        response = backend.client.get_object(
            Bucket=backend.bucket_name, Key=key, Range=f"bytes={start}-{end}"
        )
        body: BinaryIO = response["Body"]
        return body
    stream = storage.open_stream(key)
    stream.seek(start)
    return stream


#: Captured third-party bytes (HTML, scripts, styles) are NEVER rendered on
#: this origin: they are served as an opaque download under a sandboxing
#: policy, mirroring the overview file download.
_CAPTURED_BYTES_CSP: Final = "sandbox; default-src 'none'"


async def _stream_blob(
    request: Request,
    storage: ObjectStorageService,
    blob: Blob,
    *,
    filename: str,
    original_type: str | None,
) -> StreamingResponse:
    """A tenant-scoped, Range-capable read of one captured blob, served as
    ``application/octet-stream`` with ``Content-Disposition: attachment`` and
    a sandboxing CSP — the captured content type is reported in
    ``X-Original-Content-Type`` for the client, never used to render."""
    byte_range = _parse_range(request.headers.get("range"), blob.size)
    start, end = byte_range if byte_range is not None else (0, max(blob.size - 1, 0))
    length = 0 if blob.size == 0 else end - start + 1
    try:
        source = await asyncio.to_thread(_open_range, storage, blob.key, start, end)
    except HTTPException as exc:
        if exc.status_code != status.HTTP_404_NOT_FOUND:
            raise
        raise _refusal(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "blob_object_missing",
            "The blob's record exists but its stored bytes do not.",
        ) from exc

    def chunks() -> Iterator[bytes]:
        remaining = length
        try:
            while remaining > 0:
                chunk = source.read(min(_CHUNK, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk
        finally:
            source.close()

    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(length),
        "Cache-Control": "private, no-store",
        "ETag": f'"{blob.sha256}"',
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": f'attachment; filename="{_safe_filename(filename)}"',
        "Content-Security-Policy": _CAPTURED_BYTES_CSP,
    }
    if original_type:
        headers["X-Original-Content-Type"] = _safe_header(original_type)
    code = status.HTTP_200_OK
    if byte_range is not None:
        code = status.HTTP_206_PARTIAL_CONTENT
        headers["Content-Range"] = f"bytes {start}-{end}/{blob.size}"
    return StreamingResponse(
        chunks(),
        status_code=code,
        media_type="application/octet-stream",
        headers=headers,
    )


def _safe_filename(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "_", name)[:200]


def _safe_header(value: str) -> str:
    return re.sub(r"[^ -~]", "", value)[:200]


async def _capture_for_reader(
    db: AsyncSession, principal: MemoryPrincipal, capture_id: UUID
) -> Capture:
    """A capture whose site this reader may see: an assigned holdout's
    source copies and bundle are hidden from every non-operator."""
    capture = await _owned(db, Capture, principal.tenant_id, capture_id)
    if capture is None:
        raise _not_found("capture")
    await _page_and_site(db, principal, capture.page_id)
    return capture


@router.get(
    "/captures/{capture_id}/source/{part}",
    response_class=StreamingResponse,
    summary="Stream one source part (operator or paired device only)",
)
async def get_capture_source(
    capture_id: UUID,
    part: Annotated[str, Path(pattern=r"^[a-z0-9][a-z0-9_-]{0,63}$")],
    request: Request,
    reader: SourceReader,
    db: Db,
    storage: Storage,
) -> StreamingResponse:
    capture = await _capture_for_reader(db, reader, capture_id)
    source = (
        await db.execute(
            select(CaptureSource).where(
                CaptureSource.tenant_id == reader.tenant_id,
                CaptureSource.page_id == capture.page_id,
                CaptureSource.run_id == capture.run_id,
                CaptureSource.viewport == capture.viewport,
            )
        )
    ).scalar_one_or_none()
    entry = (source.parts or {}).get(part) if source is not None else None
    if not isinstance(entry, dict) or not entry.get("key"):
        raise _refusal(
            status.HTTP_404_NOT_FOUND,
            "source_part_not_found",
            "This capture's viewport context has no such source part.",
            available=sorted((source.parts or {}).keys()) if source else [],
        )
    blob = await db.get(Blob, entry["key"])
    if blob is None or blob.tenant_id != reader.tenant_id:
        raise _not_found("source_part")
    return await _stream_blob(
        request,
        storage,
        blob,
        filename=f"{capture.id}-{part}",
        original_type=entry.get("content_type") or blob.content_type,
    )


@router.get(
    "/captures/{capture_id}/bundle",
    response_class=StreamingResponse,
    summary="Stream the capture run's replay bundle (operator or paired device only)",
)
async def get_capture_bundle(
    capture_id: UUID,
    request: Request,
    reader: SourceReader,
    db: Db,
    storage: Storage,
) -> StreamingResponse:
    capture = await _capture_for_reader(db, reader, capture_id)
    bundle = (
        await db.execute(
            select(ReplayBundle).where(
                ReplayBundle.tenant_id == reader.tenant_id,
                ReplayBundle.page_id == capture.page_id,
                ReplayBundle.run_id == capture.run_id,
            )
        )
    ).scalar_one_or_none()
    if bundle is None:
        raise _not_found("replay_bundle")
    blob = await db.get(Blob, bundle.bundle_key)
    if blob is None or blob.tenant_id != reader.tenant_id:
        raise _not_found("replay_bundle")
    return await _stream_blob(
        request,
        storage,
        blob,
        filename=f"{capture.id}-bundle.zip",
        original_type="application/zip",
    )


# ═════════════════════════════ components, fingerprints ═════════════════════════════


@router.post(
    "/components", response_model=ComponentOut, status_code=status.HTTP_201_CREATED
)
async def create_component(
    body: ComponentCreate, principal: Principal, db: Db
) -> ComponentOut:
    page, _site = await _page_and_site(db, principal, body.page_id)
    if body.capture_id is not None:
        capture = await _owned(db, Capture, principal.tenant_id, body.capture_id)
        if capture is None or capture.page_id != page.id:
            raise _not_found("capture")
    if body.crop_key is not None:
        await _require_blobs(
            db, principal.tenant_id, [body.crop_key], tier=page.tier, field="crop_key"
        )
    component = Component(
        tenant_id=principal.tenant_id, tier=page.tier, **body.model_dump()
    )
    db.add(component)
    await db.commit()
    await db.refresh(component)
    return ComponentOut.model_validate(component)


@router.get("/components", response_model=list[ComponentOut])
async def list_components(
    page_id: UUID, principal: Principal, db: Db
) -> list[ComponentOut]:
    await _page_and_site(db, principal, page_id)
    rows = await db.execute(
        select(Component)
        .where(Component.tenant_id == principal.tenant_id, Component.page_id == page_id)
        .order_by(Component.created_at)
    )
    return [ComponentOut.model_validate(row) for row in rows.scalars()]


@router.get("/components/{component_id}", response_model=ComponentOut)
async def get_component(
    component_id: UUID, principal: Principal, db: Db
) -> ComponentOut:
    component = await _owned(db, Component, principal.tenant_id, component_id)
    if component is None:
        raise _not_found("component")
    await _page_and_site(db, principal, component.page_id)
    return ComponentOut.model_validate(component)


@router.patch("/components/{component_id}", response_model=ComponentOut)
async def update_component(
    component_id: UUID, body: ComponentUpdate, principal: Principal, db: Db
) -> ComponentOut:
    component = await _owned(db, Component, principal.tenant_id, component_id)
    if component is None:
        raise _not_found("component")
    await _page_and_site(db, principal, component.page_id)
    _apply_edits(
        db, principal, component, "component", body.model_dump(exclude_unset=True)
    )
    await db.commit()
    await db.refresh(component)
    return ComponentOut.model_validate(component)


@router.post(
    "/asset-fingerprints",
    response_model=FingerprintBatchOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_fingerprints(
    body: FingerprintBatch, principal: Principal, db: Db
) -> FingerprintBatchOut:
    from app.models.design_refs import AssetFingerprint

    capture = await _owned(db, Capture, principal.tenant_id, body.capture_id)
    if capture is None:
        raise _not_found("capture")
    for item in body.items:
        db.add(
            AssetFingerprint(
                tenant_id=principal.tenant_id,
                tier=capture.tier,
                capture_id=capture.id,
                **item.model_dump(),
            )
        )
    await db.commit()
    return FingerprintBatchOut(capture_id=capture.id, stored=len(body.items))


# ═════════════════════════════ descriptions ═════════════════════════════


async def _level_target(
    db: AsyncSession, principal: MemoryPrincipal, level: str, target_id: UUID
) -> tuple[Any, Site]:
    model = svc.LEVEL_MODELS[level]
    row = await _owned(db, model, principal.tenant_id, target_id)
    if row is None:
        raise _not_found(level)
    if model is Site:
        return row, await _site_or_404(db, principal, row.id)
    if model is Component:
        _page, site = await _page_and_site(db, principal, row.page_id)
        return row, site
    return row, await _site_or_404(db, principal, row.site_id)


@router.post(
    "/descriptions", response_model=DescriptionOut, status_code=status.HTTP_201_CREATED
)
async def create_description(
    body: DescriptionCreate, principal: Principal, db: Db
) -> DescriptionOut:
    target, _site = await _level_target(db, principal, body.level, body.target_id)
    row = Description(
        tenant_id=principal.tenant_id, tier=target.tier, **body.model_dump()
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return DescriptionOut.model_validate(row)


@router.get("/descriptions", response_model=list[DescriptionOut])
async def list_descriptions(
    level: Literal["site", "page", "flow", "component"],
    target_id: UUID,
    principal: Principal,
    db: Db,
) -> list[DescriptionOut]:
    await _level_target(db, principal, level, target_id)
    rows = await db.execute(
        select(Description)
        .where(
            Description.tenant_id == principal.tenant_id,
            Description.level == level,
            Description.target_id == target_id,
        )
        .order_by(Description.created_at)
    )
    return [DescriptionOut.model_validate(row) for row in rows.scalars()]


@router.patch("/descriptions/{description_id}", response_model=DescriptionOut)
async def update_description(
    description_id: UUID, body: DescriptionUpdate, principal: Principal, db: Db
) -> DescriptionOut:
    row = await _owned(db, Description, principal.tenant_id, description_id)
    if row is None:
        raise _not_found("description")
    await _level_target(db, principal, row.level, row.target_id)
    _apply_edits(db, principal, row, "description", body.model_dump(exclude_unset=True))
    await db.commit()
    await db.refresh(row)
    return DescriptionOut.model_validate(row)


# ═════════════════════════════ curation ═════════════════════════════

_REVIEWABLE: Final[dict[str, Any]] = {
    "site": Site,
    "page": Page,
    "flow": Flow,
    "component": Component,
    "description": Description,
}


@router.post(
    "/review/{target_kind}/{target_id}",
    response_model=dict[str, Any],
    summary="Set a record's review state and quality (operator only)",
)
async def review_record(
    target_kind: Literal["site", "page", "flow", "component", "description"],
    target_id: UUID,
    body: ReviewWrite,
    principal: Principal,
    db: Db,
) -> dict[str, Any]:
    require_operator(principal, "curate a record")
    row = await _owned(db, _REVIEWABLE[target_kind], principal.tenant_id, target_id)
    if row is None:
        raise _not_found(target_kind)
    edits: dict[str, Any] = {}
    if body.review_state is not None:
        edits["review_state"] = body.review_state
    if body.quality is not None:
        edits["quality"] = body.quality
    elif body.clear_quality:
        edits["quality"] = None
    _apply_edits(db, principal, row, target_kind, edits)
    await db.commit()
    return {
        "target_kind": target_kind,
        "target_id": str(target_id),
        "review_state": row.review_state,
        "quality": row.quality,
    }


@router.get("/corrections", response_model=list[CorrectionOut])
async def list_corrections(
    target_kind: Literal[
        "site",
        "page",
        "flow",
        "component",
        "description",
        "capture_job",
        "site_personality",
        "design_principle",
    ],
    target_id: UUID,
    principal: Principal,
    db: Db,
) -> list[CorrectionOut]:
    """The correction log — operator only. It carries the operator's own
    judgements (an edited personality value, a curated quality, a confirmed
    context), including those of holdout sites, so it is never an agent
    read."""
    require_operator(principal, "read the correction log")
    rows = await db.execute(
        select(Correction)
        .where(
            Correction.tenant_id == principal.tenant_id,
            Correction.target_kind == target_kind,
            Correction.target_id == target_id,
        )
        .order_by(Correction.created_at)
    )
    return [CorrectionOut.model_validate(row) for row in rows.scalars()]


# ═════════════════════════════ capture jobs ═════════════════════════════

#: ``(from, to) -> who may move it``: ``operator`` or ``any``.
_JOB_TRANSITIONS: Final[dict[tuple[str, str], str]] = {
    ("proposed", "queued"): "operator",
    ("proposed", "rejected"): "operator",
    ("proposed", "cancelled"): "operator",
    ("queued", "cancelled"): "operator",
    ("running", "cancelled"): "operator",
    ("failed", "queued"): "operator",
    ("running", "done"): "any",
    ("running", "failed"): "any",
}


@router.post(
    "/capture-jobs", response_model=CaptureJobOut, status_code=status.HTTP_201_CREATED
)
async def create_capture_job(
    body: CaptureJobCreate, principal: Principal, db: Db
) -> CaptureJobOut:
    """Queue a capture. A discovery proposal waits as ``proposed`` for the
    operator; anything else is ``queued``. The tier is NOT a field: the
    worker's pre-check derives it and writes it back."""
    if body.source == "operator" and not is_operator(principal):
        raise _refusal(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "source_operator_requires_operator",
            "source=operator is recorded only for an operator's session.",
        )
    source = body.source
    blocked = await svc.blocked_by_do_not_capture(db, principal.tenant_id, body.url)
    if blocked is not None:
        raise _refusal(
            status.HTTP_409_CONFLICT,
            "do_not_capture",
            "This URL is on the tenant's do-not-capture list.",
            entry=blocked.domain + blocked.path_prefix,
        )
    domain, _path = svc.url_domain_and_path(body.url)
    job = CaptureJob(
        tenant_id=principal.tenant_id,
        url=body.url,
        domain=domain,
        scope_kind=body.scope_kind,
        crawl_depth=body.crawl_depth,
        flow_goal=body.flow_goal,
        notes=body.notes,
        source=source,
        submitter_kind=principal.actor,
        submitter_id=_actor_id(principal),
        is_reproduction=body.is_reproduction,
        state="proposed" if source == "discovery" else "queued",
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    return CaptureJobOut.model_validate(job)


@router.get("/capture-jobs", response_model=list[CaptureJobOut])
async def list_capture_jobs(
    principal: Principal,
    db: Db,
    state: Literal[
        "proposed", "rejected", "queued", "running", "done", "failed", "cancelled"
    ]
    | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[CaptureJobOut]:
    stmt = select(CaptureJob).where(CaptureJob.tenant_id == principal.tenant_id)
    if state is not None:
        stmt = stmt.where(CaptureJob.state == state)
    stmt = stmt.order_by(CaptureJob.created_at.desc()).limit(limit).offset(offset)
    return [
        CaptureJobOut.model_validate(row) for row in (await db.execute(stmt)).scalars()
    ]


@router.get("/capture-jobs/{job_id}", response_model=CaptureJobOut)
async def get_capture_job(job_id: UUID, principal: Principal, db: Db) -> CaptureJobOut:
    job = await _owned(db, CaptureJob, principal.tenant_id, job_id)
    if job is None:
        raise _not_found("capture_job")
    return CaptureJobOut.model_validate(job)


@router.post("/capture-jobs/claim", response_model=CaptureJobOut | None)
async def claim_capture_job(
    body: CaptureJobClaim, principal: Principal, db: Db
) -> CaptureJobOut | None:
    """Lease the oldest queued job — or a running one whose lease lapsed (a
    dead worker's job is re-queued this way). ``null`` when none waits."""
    now = datetime.now(UTC)
    job = (
        await db.execute(
            select(CaptureJob)
            .where(
                CaptureJob.tenant_id == principal.tenant_id,
                or_(
                    CaptureJob.state == "queued",
                    and_(CaptureJob.state == "running", CaptureJob.claimed_until < now),
                ),
            )
            .order_by(CaptureJob.created_at)
            .limit(1)
            .with_for_update(skip_locked=True)
        )
    ).scalar_one_or_none()
    if job is None:
        return None
    job.state = "running"
    job.claimed_by = body.worker
    job.claimed_until = now + timedelta(seconds=body.lease_seconds)
    await db.commit()
    await db.refresh(job)
    return CaptureJobOut.model_validate(job)


@router.patch("/capture-jobs/{job_id}", response_model=CaptureJobOut)
async def update_capture_job(
    job_id: UUID, body: CaptureJobUpdate, principal: Principal, db: Db
) -> CaptureJobOut:
    job = await _owned(db, CaptureJob, principal.tenant_id, job_id)
    if job is None:
        raise _not_found("capture_job")
    if body.state is not None and body.state != job.state:
        who = _JOB_TRANSITIONS.get((job.state, body.state))
        if who is None:
            raise _refusal(
                status.HTTP_409_CONFLICT,
                "invalid_transition",
                f"A capture job cannot move from {job.state} to {body.state}.",
            )
        if who == "operator":
            require_operator(principal, f"move a capture job to {body.state}")
        if is_operator(principal):
            db.add(
                _correction(
                    principal.tenant_id,
                    principal,
                    "capture_job",
                    job.id,
                    "state",
                    job.state,
                    body.state,
                )
            )
        job.state = body.state
        if body.state != "running":
            job.claimed_until = None
    if body.derived_tier is not None:
        if job.is_reproduction and body.derived_tier == "public":
            raise _refusal(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "reproduction_is_private",
                "A reproduction's capture is always private (public rule (h)).",
            )
        job.derived_tier = body.derived_tier
    if body.tier_reason is not None:
        job.tier_reason = body.tier_reason
    if body.error is not None:
        job.error = body.error
    if body.lease_seconds is not None:
        if job.state != "running":
            raise _refusal(
                status.HTTP_409_CONFLICT,
                "not_running",
                "Only a running job's lease is extended.",
            )
        job.claimed_until = datetime.now(UTC) + timedelta(seconds=body.lease_seconds)
    await db.commit()
    await db.refresh(job)
    return CaptureJobOut.model_validate(job)


# ═════════════════════════════ agent-facing reads ═════════════════════════════


@router.post("/search", response_model=SearchResponse, summary="search_examples")
async def search_examples(
    body: SearchRequest, principal: Principal, db: Db
) -> SearchResponse:
    include_holdout = gate_include_holdout(principal, body.include_holdout)
    vector_arm, hits = await svc.search(
        db,
        principal.tenant_id,
        svc.SearchQuery(**{**body.model_dump(), "include_holdout": include_holdout}),
    )
    return SearchResponse(
        vector_arm=vector_arm,  # type: ignore[arg-type]
        results=[
            SearchHit(
                level=hit.level,  # type: ignore[arg-type]
                target_id=hit.target_id,
                site_id=hit.site.id,
                domain=hit.site.domain,
                tier=hit.record.tier,
                review_state=hit.record.review_state,
                quality=hit.record.quality,
                facet_exact=hit.facet_exact,
                text_rank=hit.text_rank,
                vector_similarity=hit.vector_similarity,
                personality_distance=hit.personality_distance,
                personality_basis=hit.personality_basis,  # type: ignore[arg-type]
                labels=hit.labels,
                snippet=hit.snippet,
            )
            for hit in hits
        ],
    )


async def _judgements(
    db: AsyncSession,
    principal: MemoryPrincipal,
    kind: str,
    target_ids: list[UUID],
) -> tuple[list[PerceptionRating], list[Comparison]]:
    """The judgements of ``target_ids`` this caller may see.

    A non-operator never sees an OPERATOR row that touches a site which is
    not a reference (a holdout, or not yet split) — decided per row over
    EVERY target the row names, so a comparison of a reference page against
    a holdout one stays hidden when read through the reference side."""
    if not target_ids:
        return [], []
    rating_stmt = select(PerceptionRating).where(
        PerceptionRating.tenant_id == principal.tenant_id,
        PerceptionRating.target_kind == kind,
        PerceptionRating.target_id.in_(target_ids),
    )
    comparison_stmt = select(Comparison).where(
        Comparison.tenant_id == principal.tenant_id,
        Comparison.target_kind == kind,
        or_(Comparison.a_id.in_(target_ids), Comparison.b_id.in_(target_ids)),
    )
    ratings = list(
        (await db.execute(rating_stmt.order_by(PerceptionRating.created_at))).scalars()
    )
    comparisons = list(
        (await db.execute(comparison_stmt.order_by(Comparison.created_at))).scalars()
    )
    if is_operator(principal):
        return ratings, comparisons
    involved: set[UUID] = {r.target_id for r in ratings if r.rater_kind != "ai"}
    for c in comparisons:
        if c.rater_kind != "ai":
            involved |= {c.a_id, c.b_id}
    sites = await svc.target_sites(db, principal.tenant_id, kind, list(involved))
    splits = await svc.site_splits(db, principal.tenant_id, set(sites.values()))

    def reference(target: UUID) -> bool:
        site = sites.get(target)
        return site is not None and splits.get(site) == "reference"

    ratings = [r for r in ratings if r.rater_kind == "ai" or reference(r.target_id)]
    comparisons = [
        c
        for c in comparisons
        if c.rater_kind == "ai" or (reference(c.a_id) and reference(c.b_id))
    ]
    return ratings, comparisons


def _record_dict(level: str, row: Any) -> dict[str, Any]:
    schemas: dict[str, type[BaseModel]] = {
        "site": SiteOut,
        "page": PageOut,
        "flow": FlowOut,
        "component": ComponentOut,
    }
    schema = schemas[level]
    return dict(schema.model_validate(row).model_dump(mode="json"))


@router.get(
    "/examples/{level}/{target_id}", response_model=ExampleOut, summary="get_example"
)
async def get_example(
    level: Literal["site", "page", "flow", "component"],
    target_id: UUID,
    principal: Principal,
    db: Db,
    include_holdout: bool = False,
) -> ExampleOut:
    include = gate_include_holdout(principal, include_holdout)
    found = await svc.candidate_entities(
        db,
        principal.tenant_id,
        level,
        include_holdout=include,
        include_anti_pattern=True,
        ids=[target_id],
    )
    if not found:
        raise _not_found(level)
    record, site = found[0]
    descriptions = list(
        (
            await db.execute(
                select(Description).where(
                    Description.tenant_id == principal.tenant_id,
                    Description.level == level,
                    Description.target_id == target_id,
                    Description.review_state != "rejected",
                )
            )
        ).scalars()
    )
    captures: list[Capture] = []
    components: list[Component] = []
    if level == "page":
        captures = list(
            (
                await db.execute(
                    select(Capture).where(
                        Capture.tenant_id == principal.tenant_id,
                        Capture.page_id == target_id,
                    )
                )
            ).scalars()
        )
        components = list(
            (
                await db.execute(
                    select(Component).where(
                        Component.tenant_id == principal.tenant_id,
                        Component.page_id == target_id,
                        Component.review_state != "rejected",
                    )
                )
            ).scalars()
        )
    ratings: list[PerceptionRating] = []
    comparisons: list[Comparison] = []
    if level in ("site", "page", "component"):
        ratings, comparisons = await _judgements(
            db,
            principal,
            level,
            [target_id],
        )
    personality = list(
        (
            await db.execute(
                select(SitePersonality)
                .where(
                    SitePersonality.tenant_id == principal.tenant_id,
                    SitePersonality.site_id == site.id,
                )
                .order_by(SitePersonality.created_at)
            )
        ).scalars()
    )
    labels = svc.site_labels(site)
    if record.review_state == "pending":
        labels.append("unreviewed")
    return ExampleOut(
        level=level,
        record=_record_dict(level, record),
        site=SiteOut.model_validate(site),
        labels=labels,
        descriptions=[DescriptionOut.model_validate(d) for d in descriptions],
        captures=[CaptureOut.model_validate(c) for c in captures],
        components=[ComponentOut.model_validate(c) for c in components],
        ratings=[RatingOut.model_validate(r) for r in ratings],
        comparisons=[ComparisonOut.model_validate(c) for c in comparisons],
        personality=[PersonalityOut.model_validate(p) for p in personality],
    )


async def _page_tokens(
    db: AsyncSession, tenant_id: UUID, page_ids: list[UUID]
) -> dict[UUID, dict[str, Any]]:
    """The newest capture's tokens per page."""
    tokens: dict[UUID, dict[str, Any]] = {}
    if not page_ids:
        return tokens
    rows = await db.execute(
        select(Capture.page_id, Capture.tokens)
        .where(Capture.tenant_id == tenant_id, Capture.page_id.in_(page_ids))
        .order_by(Capture.created_at)
    )
    for page_id, value in rows.all():
        tokens[page_id] = value or {}
    return tokens


async def _style_candidates(
    db: AsyncSession,
    principal: MemoryPrincipal,
    level: str,
    role: str | None,
    include_holdout: bool,
) -> list[tuple[Any, Site, dict[str, Any]]]:
    found = await svc.candidate_entities(
        db, principal.tenant_id, level, include_holdout=include_holdout, role=role
    )
    if level == "component":
        return [(row, site, row.tokens or {}) for row, site in found]
    tokens = await _page_tokens(db, principal.tenant_id, [row.id for row, _ in found])
    return [(row, site, tokens.get(row.id, {})) for row, site in found]


@router.post(
    "/similar-by-style",
    response_model=SimilarByStyleResponse,
    summary="similar_by_style",
)
async def similar_by_style(
    body: SimilarByStyleRequest, principal: Principal, db: Db
) -> SimilarByStyleResponse:
    """Rank pages or components by token distance to a supplied token set.
    The UI Bridge ``/design/style-fingerprint`` primitive does not exist yet,
    so the arm is ``tokens_only`` and the response says so."""
    include = gate_include_holdout(principal, body.include_holdout)
    candidates = await _style_candidates(db, principal, body.level, body.role, include)
    ranked = sorted(
        (
            (svc.token_distance(body.tokens, tokens), row, site)
            for row, site, tokens in candidates
            if tokens
        ),
        key=lambda item: (item[0], -item[1].created_at.timestamp()),
    )[: body.limit]
    return SimilarByStyleResponse(
        style_arm="tokens_only",
        results=[
            StyleHit(
                level=body.level,
                target_id=row.id,
                site_id=site.id,
                domain=site.domain,
                role=getattr(row, "role", None),
                token_distance=distance,
                labels=svc.site_labels(site),
            )
            for distance, row, site in ranked
        ],
    )


@router.post(
    "/compare-to-references",
    response_model=CompareResponse,
    summary="compare_to_references",
)
async def compare_to_references(
    body: CompareRequest, principal: Principal, db: Db
) -> CompareResponse:
    """Nearest references to a project's snapshot by role + tokens, with the
    per-token differences. ``/design/compare`` does not exist yet, so the
    fidelity arm is ``tokens_only`` and the response says so."""
    include = gate_include_holdout(principal, body.include_holdout)
    level: Literal["page", "component"] = (
        "component" if body.snapshot.role is not None else "page"
    )
    candidates = await _style_candidates(
        db, principal, level, body.snapshot.role, include
    )
    ranked = sorted(
        (
            (svc.token_distance(body.snapshot.tokens, tokens), row, site, tokens)
            for row, site, tokens in candidates
            if tokens
        ),
        key=lambda item: (item[0], -item[1].created_at.timestamp()),
    )[: body.limit]
    return CompareResponse(
        fidelity_arm="tokens_only",
        results=[
            CompareHit(
                target_id=row.id,
                level=level,
                site_id=site.id,
                domain=site.domain,
                role=getattr(row, "role", None),
                token_distance=distance,
                differences=[
                    TokenDifference(token=name, ours=ours, reference=theirs)
                    for name, ours, theirs in svc.token_differences(
                        body.snapshot.tokens, tokens
                    )
                ],
                labels=svc.site_labels(site),
            )
            for distance, row, site, tokens in ranked
        ],
    )


# ═════════════════════════════ ratings & comparisons ═════════════════════════════


async def _require_target(
    db: AsyncSession, tenant_id: UUID, kind: str, ids: list[UUID]
) -> dict[UUID, UUID]:
    sites = await svc.target_sites(db, tenant_id, kind, ids)
    missing = [str(i) for i in ids if i not in sites]
    if missing:
        raise _refusal(
            status.HTTP_404_NOT_FOUND,
            "judgement_target_not_found",
            f"This tenant has no {kind} with that id.",
            ids=missing,
        )
    return sites


@router.post("/ratings", response_model=RatingOut, status_code=status.HTTP_201_CREATED)
async def create_rating(body: RatingCreate, principal: Principal, db: Db) -> RatingOut:
    """Append one rating. A re-rating is a new row; nothing is overwritten."""
    rater_kind, rater_id = derive_rater(principal, body.model_id, body.prompt_version)
    if rater_kind == "ai" and not (body.positive_evidence or body.negative_evidence):
        raise _refusal(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "ai_rating_needs_evidence",
            "An AI rating carries at least one evidence pointer; it is stored "
            "as evidence, never as a verdict.",
        )
    dim = await _dimension(db, body.dimension_key)
    await _require_target(db, principal.tenant_id, body.target_kind, [body.target_id])
    if body.context_page_id is not None and (
        await _owned(db, Page, principal.tenant_id, body.context_page_id) is None
    ):
        raise _not_found("page")
    row = PerceptionRating(
        tenant_id=principal.tenant_id,
        target_kind=body.target_kind,
        target_id=body.target_id,
        dimension_key=dim.key,
        dimension_version=dim.version,
        score=body.score,
        rater_kind=rater_kind,
        rater_id=rater_id,
        context_page_id=body.context_page_id,
        context_viewport=body.context_viewport,
        confidence=body.confidence,
        positive_evidence=[e.model_dump(mode="json") for e in body.positive_evidence],
        negative_evidence=[e.model_dump(mode="json") for e in body.negative_evidence],
        explanation=body.explanation,
        answer_ms=body.answer_ms if rater_kind == "operator" else None,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return RatingOut.model_validate(row)


def _distributions(ratings: list[PerceptionRating]) -> list[RatingDistribution]:
    """Read-time medians over each rater's LATEST row, per dimension and
    rater kind (plus all kinds). Never stored."""
    import statistics

    latest: dict[tuple[str, str, str], PerceptionRating] = {}
    for row in ratings:
        key = (row.dimension_key, row.rater_kind, row.rater_id)
        if key not in latest or row.created_at >= latest[key].created_at:
            latest[key] = row
    groups: dict[tuple[str, str], list[int]] = defaultdict(list)
    for (dim, kind, _rid), row in latest.items():
        groups[(dim, kind)].append(row.score)
        groups[(dim, "all")].append(row.score)
    return [
        RatingDistribution(
            dimension_key=dim,
            rater_kind=kind,  # type: ignore[arg-type]
            n=len(scores),
            score_median=float(statistics.median(scores)) if scores else None,
            score_spread=(max(scores) - min(scores)) if scores else None,
        )
        for (dim, kind), scores in sorted(groups.items())
    ]


@router.get("/ratings", response_model=RatingList)
async def list_ratings(
    target_kind: Literal["site", "page", "component"],
    target_id: UUID,
    principal: Principal,
    db: Db,
    dimension_key: str | None = None,
) -> RatingList:
    await _require_target(db, principal.tenant_id, target_kind, [target_id])
    ratings, _comparisons = await _judgements(db, principal, target_kind, [target_id])
    if dimension_key is not None:
        ratings = [r for r in ratings if r.dimension_key == dimension_key]
    return RatingList(
        ratings=[RatingOut.model_validate(r) for r in ratings],
        distributions=_distributions(ratings),
    )


@router.post(
    "/comparisons", response_model=ComparisonOut, status_code=status.HTTP_201_CREATED
)
async def create_comparison(
    body: ComparisonCreate, principal: Principal, db: Db
) -> ComparisonOut:
    rater_kind, rater_id = derive_rater(principal, body.model_id, body.prompt_version)
    dim = await _dimension(db, body.dimension_key)
    await _require_target(
        db, principal.tenant_id, body.target_kind, [body.a_id, body.b_id]
    )
    row = Comparison(
        tenant_id=principal.tenant_id,
        target_kind=body.target_kind,
        a_id=body.a_id,
        b_id=body.b_id,
        dimension_key=dim.key,
        dimension_version=dim.version,
        winner=body.winner,
        explanation=body.explanation,
        rater_kind=rater_kind,
        rater_id=rater_id,
        shown_order=body.shown_order,
        context_viewport=body.context_viewport,
        trial_id=body.trial_id,
        answer_ms=body.answer_ms if rater_kind == "operator" else None,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return ComparisonOut.model_validate(row)


@router.get("/comparisons", response_model=list[ComparisonOut])
async def list_comparisons(
    target_kind: Literal["site", "page", "component"],
    target_id: UUID,
    principal: Principal,
    db: Db,
) -> list[ComparisonOut]:
    await _require_target(db, principal.tenant_id, target_kind, [target_id])
    _ratings, comparisons = await _judgements(db, principal, target_kind, [target_id])
    return [ComparisonOut.model_validate(c) for c in comparisons]


# ═════════════════════════════ personality ═════════════════════════════


async def _trait(db: AsyncSession, key: str) -> PersonalityTrait:
    trait = await db.get(PersonalityTrait, key)
    if trait is None or not trait.active:
        raise _refusal(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "unknown_trait",
            "trait_key names no active personality trait.",
        )
    return trait


@router.post(
    "/sites/{site_id}/personality",
    response_model=PersonalityOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_personality(
    site_id: UUID, body: PersonalityCreate, principal: Principal, db: Db
) -> PersonalityOut:
    """Append a personality value. A device's row is ``proposed``; an
    operator's own value is ``confirmed``."""
    site = await _site_or_404(db, principal, site_id)
    await _trait(db, body.trait_key)
    rater_kind, rater_id = derive_rater(principal, body.model_id, body.prompt_version)
    row = SitePersonality(
        tenant_id=principal.tenant_id,
        site_id=site.id,
        trait_key=body.trait_key,
        value=body.value,
        rater_kind=rater_kind,
        rater_id=rater_id,
        state="confirmed" if rater_kind == "operator" else "proposed",
        evidence=[e.model_dump(mode="json") for e in body.evidence],
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return PersonalityOut.model_validate(row)


@router.post(
    "/sites/{site_id}/personality/{row_id}/confirm",
    response_model=PersonalityOut,
    status_code=status.HTTP_201_CREATED,
)
async def confirm_personality(
    site_id: UUID,
    row_id: UUID,
    body: PersonalityConfirm,
    principal: Principal,
    db: Db,
) -> PersonalityOut:
    """The operator confirms a proposed value (optionally edited) by
    appending a confirmed row; an edit is written to the correction log."""
    require_operator(principal, "confirm a personality value")
    site = await _site_or_404(db, principal, site_id)
    proposed = await _owned(db, SitePersonality, principal.tenant_id, row_id)
    if proposed is None or proposed.site_id != site.id:
        raise _not_found("personality_row")
    value = body.value if body.value is not None else proposed.value
    if value != proposed.value:
        db.add(
            _correction(
                principal.tenant_id,
                principal,
                "site_personality",
                proposed.id,
                "value",
                proposed.value,
                value,
            )
        )
    rater_kind, rater_id = derive_rater(principal, None, None)
    row = SitePersonality(
        tenant_id=principal.tenant_id,
        site_id=site.id,
        trait_key=proposed.trait_key,
        value=value,
        rater_kind=rater_kind,
        rater_id=rater_id,
        state="confirmed",
        evidence=proposed.evidence,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return PersonalityOut.model_validate(row)


@router.get("/sites/{site_id}/personality", response_model=list[PersonalityOut])
async def list_personality(
    site_id: UUID, principal: Principal, db: Db
) -> list[PersonalityOut]:
    site = await _site_or_404(db, principal, site_id)
    stmt = select(SitePersonality).where(
        SitePersonality.tenant_id == principal.tenant_id,
        SitePersonality.site_id == site.id,
    )
    if not is_operator(principal) and site.split != "reference":
        stmt = stmt.where(SitePersonality.rater_kind == "ai")
    rows = await db.execute(stmt.order_by(SitePersonality.created_at))
    return [PersonalityOut.model_validate(r) for r in rows.scalars()]


# ═════════════════════════════ principles ═════════════════════════════


async def _principle_out(
    db: AsyncSession, tenant_id: UUID, principle: DesignPrinciple
) -> PrincipleOut:
    evidence = (
        await db.execute(
            select(DesignPrincipleEvidence)
            .where(
                DesignPrincipleEvidence.tenant_id == tenant_id,
                DesignPrincipleEvidence.principle_id == principle.id,
            )
            .order_by(DesignPrincipleEvidence.created_at)
        )
    ).scalars()
    out = PrincipleOut.model_validate(principle)
    out.evidence = [PrincipleEvidenceOut.model_validate(e) for e in evidence]
    return out


@router.post(
    "/principles", response_model=PrincipleOut, status_code=status.HTTP_201_CREATED
)
async def create_principle(
    body: PrincipleCreate, principal: Principal, db: Db
) -> PrincipleOut:
    """Propose a principle. Anyone may propose; only an operator approves."""
    kind, who = derive_rater(principal, None, None)
    row = DesignPrinciple(
        tenant_id=principal.tenant_id,
        statement=body.statement,
        scope=body.scope.model_dump(mode="json"),
        status="proposed",
        proposed_by_kind=kind,
        proposed_by_id=who,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return await _principle_out(db, principal.tenant_id, row)


def _in_scope(scope: dict[str, Any], key: str, value: str | None) -> bool:
    if value is None:
        return True
    listed = scope.get(key) or []
    return not listed or value in listed


@router.get("/principles", response_model=list[PrincipleOut], summary="get_principles")
async def list_principles(
    principal: Principal,
    db: Db,
    industry: str | None = None,
    page_type: str | None = None,
    price_tier: Literal["budget", "mid", "premium", "luxury", "unknown"] | None = None,
    dimension: str | None = None,
    include_unapproved: bool = False,
) -> list[PrincipleOut]:
    """APPROVED principles only, unless an operator's review read asks for
    the proposed and retired ones too."""
    if include_unapproved:
        require_operator(principal, "read unapproved principles")
    stmt = select(DesignPrinciple).where(
        DesignPrinciple.tenant_id == principal.tenant_id
    )
    if not include_unapproved:
        stmt = stmt.where(DesignPrinciple.status == "approved")
    rows = (await db.execute(stmt.order_by(DesignPrinciple.created_at))).scalars()
    out: list[PrincipleOut] = []
    for principle in rows:
        scope = principle.scope or {}
        if not (
            _in_scope(scope, "industries", industry)
            and _in_scope(scope, "page_types", page_type)
            and _in_scope(scope, "price_tiers", price_tier)
            and _in_scope(scope, "dimensions", dimension)
        ):
            continue
        out.append(await _principle_out(db, principal.tenant_id, principle))
    return out


@router.get("/principles/{principle_id}", response_model=PrincipleOut)
async def get_principle(
    principle_id: UUID, principal: Principal, db: Db
) -> PrincipleOut:
    row = await _owned(db, DesignPrinciple, principal.tenant_id, principle_id)
    if row is None or (row.status != "approved" and not is_operator(principal)):
        raise _not_found("principle")
    return await _principle_out(db, principal.tenant_id, row)


@router.post(
    "/principles/{principle_id}/evidence",
    response_model=PrincipleEvidenceOut,
    status_code=status.HTTP_201_CREATED,
)
async def attach_evidence(
    principle_id: UUID, body: EvidenceAttach, principal: Principal, db: Db
) -> PrincipleEvidenceOut:
    """Cite a rating or comparison. ``site_ids`` are derived server-side
    from its targets; evidence touching a holdout (or not-yet-split) site is
    refused here, at insert."""
    principle = await _owned(db, DesignPrinciple, principal.tenant_id, principle_id)
    if principle is None:
        raise _not_found("principle")
    site_ids = await svc.evidence_site_ids(
        db, principal.tenant_id, body.evidence_kind, body.evidence_id
    )
    if not site_ids:
        raise _not_found(body.evidence_kind)
    splits = await svc.site_splits(db, principal.tenant_id, site_ids)
    not_reference = [str(s) for s in site_ids if splits.get(s) != "reference"]
    if not_reference:
        raise _refusal(
            status.HTTP_409_CONFLICT,
            "holdout_evidence_refused",
            "Evidence touching a holdout site, or a site not yet split, is never "
            "cited for a principle.",
            site_ids=not_reference,
        )
    existing = await db.get(
        DesignPrincipleEvidence,
        (principle.id, body.evidence_kind, body.evidence_id, body.role),
    )
    if existing is not None:
        return PrincipleEvidenceOut.model_validate(existing)
    row = DesignPrincipleEvidence(
        principle_id=principle.id,
        evidence_kind=body.evidence_kind,
        evidence_id=body.evidence_id,
        role=body.role,
        tenant_id=principal.tenant_id,
        site_ids=site_ids,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return PrincipleEvidenceOut.model_validate(row)


@router.post("/principles/{principle_id}/approve", response_model=PrincipleOut)
async def approve_principle(
    principle_id: UUID,
    principal: Principal,
    db: Db,
    approver: PrincipleApprover = Depends(get_principle_approver),
) -> PrincipleOut:
    """Only the operator approves: a device or agent credential is refused;
    supporting evidence must span at least two distinct REFERENCE sites; and
    a principle scoped to a dimension or trait in a flagged correlation needs
    at least one counterexample first."""
    require_operator(principal, "approve a design principle")
    principle = await _owned(db, DesignPrinciple, approver.tenant_id, principle_id)
    if principle is None:
        raise _not_found("principle")
    if principle.status != "proposed":
        raise _refusal(
            status.HTTP_409_CONFLICT,
            "principle_not_proposed",
            f"Only a proposed principle is approved; this one is {principle.status}.",
        )
    support = await svc.reference_support(db, approver.tenant_id, principle.id)
    if len(support) < 2:
        raise _refusal(
            status.HTTP_409_CONFLICT,
            "insufficient_reference_support",
            "Supporting evidence must span at least two distinct reference sites.",
            reference_sites=len(support),
        )
    scope = principle.scope or {}
    scoped = set(scope.get("dimensions") or []) | set(scope.get("traits") or [])
    flagged = scoped & svc.flagged_keys(
        await svc.correlation_report(db, approver.tenant_id)
    )
    if flagged:
        counter = (
            await db.execute(
                select(DesignPrincipleEvidence.evidence_id).where(
                    DesignPrincipleEvidence.tenant_id == approver.tenant_id,
                    DesignPrincipleEvidence.principle_id == principle.id,
                    DesignPrincipleEvidence.role == "counterexample",
                )
            )
        ).first()
        if counter is None:
            raise _refusal(
                status.HTTP_409_CONFLICT,
                "counterexample_required",
                "This principle is scoped to a dimension or trait in a flagged "
                "correlation (at risk of being learned); attach at least one "
                "counterexample first.",
                flagged=sorted(flagged),
            )
    principle.status = "approved"
    principle.approved_by = approver.user.id
    principle.approved_at = datetime.now(UTC)
    db.add(
        _correction(
            approver.tenant_id,
            principal,
            "design_principle",
            principle.id,
            "status",
            "proposed",
            "approved",
        )
    )
    await db.commit()
    await db.refresh(principle)
    return await _principle_out(db, approver.tenant_id, principle)


@router.post("/principles/{principle_id}/retire", response_model=PrincipleOut)
async def retire_principle(
    principle_id: UUID,
    body: PrincipleRetire,
    principal: Principal,
    db: Db,
    approver: PrincipleApprover = Depends(get_principle_approver),
) -> PrincipleOut:
    require_operator(principal, "retire a design principle")
    principle = await _owned(db, DesignPrinciple, approver.tenant_id, principle_id)
    if principle is None:
        raise _not_found("principle")
    if principle.status == "retired":
        return await _principle_out(db, approver.tenant_id, principle)
    db.add(
        _correction(
            approver.tenant_id,
            principal,
            "design_principle",
            principle.id,
            "status",
            principle.status,
            "retired",
        )
    )
    principle.status = "retired"
    principle.retired_reason = body.reason
    await db.commit()
    await db.refresh(principle)
    return await _principle_out(db, approver.tenant_id, principle)


@router.get("/corpus-balance", response_model=CorpusBalance, summary="corpus_balance")
async def corpus_balance(principal: Principal, db: Db) -> CorpusBalance:
    from sqlalchemy import func

    rows = await db.execute(
        select(
            Site.style_family, Site.industry, Site.price_tier, Site.split, func.count()
        )
        .where(Site.tenant_id == principal.tenant_id)
        .group_by(Site.style_family, Site.industry, Site.price_tier, Site.split)
        .order_by(Site.style_family, Site.industry, Site.price_tier, Site.split)
    )
    report = await svc.correlation_report(db, principal.tenant_id)
    return CorpusBalance(
        cells=[
            BalanceCell(
                style_family=r[0], industry=r[1], price_tier=r[2], split=r[3], n=r[4]
            )
            for r in rows.all()
        ],
        correlations=[
            CorrelationOut(
                variable_kind=c.variable_kind,  # type: ignore[arg-type]
                key=c.key,
                facet=c.facet,
                n=c.n,
                r=c.r,
                flagged=c.flagged,
            )
            for c in report
        ],
    )


# ═════════════════════════════ judge bench ═════════════════════════════


@router.post(
    "/judge-bench-runs",
    response_model=JudgeBenchRunOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_judge_bench_run(
    body: JudgeBenchRunCreate, principal: Principal, db: Db
) -> JudgeBenchRunOut:
    """Record a judge bench run. Fewer than ``MIN_BENCH_PAIRS`` holdout pairs
    (or no agreement figure) is recorded ``unknown``, never a score."""
    measured = body.n_pairs >= MIN_BENCH_PAIRS and body.pair_agreement is not None
    row = JudgeBenchRun(
        tenant_id=principal.tenant_id,
        model=body.model,
        prompt_version=body.prompt_version,
        n_pairs=body.n_pairs,
        verdict="measured" if measured else "unknown",
        pair_agreement=body.pair_agreement if measured else None,
        pair_agreement_ci_low=body.pair_agreement_ci_low if measured else None,
        pair_agreement_ci_high=body.pair_agreement_ci_high if measured else None,
        unknown_rate=body.unknown_rate,
        rating_spearman=body.rating_spearman,
        krippendorff_alpha=body.krippendorff_alpha,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return JudgeBenchRunOut.model_validate(row)


@router.get("/judge-bench-runs", response_model=list[JudgeBenchRunOut])
async def list_judge_bench_runs(principal: Principal, db: Db) -> list[JudgeBenchRunOut]:
    rows = await db.execute(
        select(JudgeBenchRun)
        .where(JudgeBenchRun.tenant_id == principal.tenant_id)
        .order_by(JudgeBenchRun.created_at.desc())
    )
    return [JudgeBenchRunOut.model_validate(r) for r in rows.scalars()]


# ═════════════════════════════ takedown ═════════════════════════════


@router.post(
    "/takedown", response_model=TakedownResult, summary="Take a domain or record down"
)
async def takedown(
    body: TakedownRequest, principal: Principal, db: Db, storage: Storage
) -> TakedownResult:
    """Delete a domain (every tier) or one record and everything naming it —
    judgements, personality, principle evidence (reverting a principle left
    below two reference sites to ``proposed``) — add a domain to the
    do-not-capture list, and delete each blob no surviving record still
    references. Operator only."""
    require_operator(principal, "take down a record")
    outcome = await svc.takedown(
        db,
        principal.tenant_id,
        actor_id=_actor_id(principal),
        reason=body.reason,
        domain=body.domain,
        target_kind=body.target_kind,
        target_id=body.target_id,
    )
    await db.commit()
    deleted = await svc.delete_objects(
        storage, outcome.object_keys, db=db, tenant_id=principal.tenant_id
    )
    logger.info(
        "design_refs_takedown",
        tenant_id=str(principal.tenant_id),
        domain=body.domain,
        target_kind=body.target_kind,
        objects_deleted=deleted,
        objects_planned=len(outcome.object_keys),
    )
    return TakedownResult(
        sites=outcome.sites,
        pages=outcome.pages,
        flows=outcome.flows,
        captures=outcome.captures,
        components=outcome.components,
        descriptions=outcome.descriptions,
        ratings=outcome.ratings,
        comparisons=outcome.comparisons,
        personality_rows=outcome.personality_rows,
        evidence_rows=outcome.evidence_rows,
        corrections=outcome.corrections,
        principles_reverted=outcome.principles_reverted,
        blobs_deleted=outcome.blobs_deleted,
        blobs_kept=outcome.blobs_kept,
        do_not_capture=outcome.do_not_capture,
    )


@router.get("/do-not-capture", response_model=list[DoNotCaptureOut])
async def list_do_not_capture(principal: Principal, db: Db) -> list[DoNotCaptureOut]:
    rows = await db.execute(
        select(DoNotCapture)
        .where(DoNotCapture.tenant_id == principal.tenant_id)
        .order_by(DoNotCapture.domain, DoNotCapture.path_prefix)
    )
    return [DoNotCaptureOut.model_validate(r) for r in rows.scalars()]


# ═════════════════════════════ vocabularies ═════════════════════════════


@router.get("/vocab", response_model=VocabOut)
async def get_vocab(_principal: Principal, db: Db) -> VocabOut:
    families = (
        await db.execute(select(StyleFamily).order_by(StyleFamily.key))
    ).scalars()
    dims = (
        await db.execute(select(PerceptionDimension).order_by(PerceptionDimension.key))
    ).scalars()
    traits = (
        await db.execute(select(PersonalityTrait).order_by(PersonalityTrait.key))
    ).scalars()
    return VocabOut(
        style_families=[StyleFamilyOut.model_validate(r) for r in families],
        dimensions=[DimensionOut.model_validate(r) for r in dims],
        traits=[TraitOut.model_validate(r) for r in traits],
    )


@router.put("/vocab/style-families", response_model=StyleFamilyOut)
async def put_style_family(
    body: StyleFamilyWrite, db: Db, _admin: User = Depends(current_superuser)
) -> StyleFamilyOut:
    row = await db.get(StyleFamily, body.key)
    if row is None:
        row = StyleFamily(**body.model_dump())
        db.add(row)
    else:
        row.label, row.description, row.active = (
            body.label,
            body.description,
            body.active,
        )
    await db.commit()
    await db.refresh(row)
    return StyleFamilyOut.model_validate(row)


@router.put("/vocab/dimensions", response_model=DimensionOut)
async def put_dimension(
    body: DimensionWrite, db: Db, _admin: User = Depends(current_superuser)
) -> DimensionOut:
    """A changed pole or anchor bumps ``version``: a rating records the
    version it was made against, so old ratings stay interpretable."""
    row = await db.get(PerceptionDimension, body.key)
    anchors: dict[str, str] = {str(k): v for k, v in body.anchors.items()}
    if row is None:
        row = PerceptionDimension(
            key=body.key,
            pole_high=body.pole_high,
            pole_low=body.pole_low,
            anchors=anchors,
            active=body.active,
        )
        db.add(row)
    else:
        if (row.pole_high, row.pole_low, row.anchors) != (
            body.pole_high,
            body.pole_low,
            anchors,
        ):
            row.version += 1
        row.pole_high, row.pole_low, row.anchors = (
            body.pole_high,
            body.pole_low,
            anchors,
        )
        row.active = body.active
    await db.commit()
    await db.refresh(row)
    return DimensionOut.model_validate(row)


@router.put("/vocab/traits", response_model=TraitOut)
async def put_trait(
    body: TraitWrite, db: Db, _admin: User = Depends(current_superuser)
) -> TraitOut:
    row = await db.get(PersonalityTrait, body.key)
    if row is None:
        row = PersonalityTrait(
            key=body.key, description=body.description, active=body.active
        )
        db.add(row)
    else:
        if row.description != body.description:
            row.version += 1
        row.description, row.active = body.description, body.active
    await db.commit()
    await db.refresh(row)
    return TraitOut.model_validate(row)
