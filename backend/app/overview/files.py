"""Uploaded files — the ``files`` resource on the authoring contract.

Plan ``2026-09-20-overview-authoring-layer`` Phase 2 / §5: uploads through the
existing ``object_storage`` service, with a content-type allowlist, a per-file
and a per-project size cap, and a checksum. A file stands alone in Documents or
is attached to a document (``page_id``).

The generic contract serves list, get and delete. Two routes are this module's:

``POST /overview/files``
    Multipart upload. The TYPE is decided by the file's extension against
    :data:`ALLOWED`, then CONFIRMED against its bytes (a PDF must start
    ``%PDF-``, an Office file must be a zip holding that format's parts, a text
    file must be UTF-8). The stored ``content_type`` is the allowlist's, never
    the client's claim. The request body is capped BEFORE anything parses it,
    by :class:`app.middleware.body_limit.BodyLimitMiddleware` (the multipart
    parser would otherwise spool an unbounded body to disk, ahead of
    authentication); the handler then refuses a file part past
    :data:`MAX_FILE_BYTES`. The project quota is checked under a per-project
    lock held to the commit, so parallel uploads cannot all fit in the same
    remaining space.

``GET /overview/files/{id}/content``
    Download, streamed through this backend rather than a presigned URL: the
    project is checked on EVERY download (a presigned URL is a bearer link that
    outlives the reader's access, and the local storage backend's "presigned"
    URL has no signature at all). Streamed from storage in chunks, never held
    whole. Served as an ``attachment`` with ``nosniff`` and a sandboxing
    ``default-src 'none'`` CSP, so nothing uploaded can run in the app's
    origin; only images may be shown inline (``?inline=1``).
"""

from __future__ import annotations

import asyncio
import hashlib
import io
import re
import unicodedata
import zipfile
from collections.abc import AsyncIterator
from datetime import datetime
from typing import Any
from urllib.parse import quote
from uuid import UUID

import structlog
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    Header,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
)
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db
from app.models.overview import OverviewFile, Page
from app.overview import change_log
from app.overview import http as contract_http
from app.overview.permissions import OverviewAccess, get_overview_access, require_edit
from app.overview.resource import (
    ListResult,
    RecordNotFound,
    StaleVersion,
    StoreContext,
)
from app.services.storage import object_storage

logger = structlog.get_logger(__name__)

#: Largest single upload. Delivery plans, contracts and decks sit well under it.
MAX_FILE_BYTES = 25 * 1024 * 1024
#: Total a project may store. A ceiling, not an allotment: the page says how
#: much is used.
MAX_PROJECT_BYTES = 1024 * 1024 * 1024
MAX_FILENAME = 200
#: What the body-limit middleware lets through for one upload request: the
#: file plus room for the multipart framing and the ``page_id`` field.
MAX_UPLOAD_REQUEST_BYTES = MAX_FILE_BYTES + 64 * 1024
_CHUNK = 1024 * 1024

#: extension → (stored content type, signature check name). The plan's list:
#: pdf, docx, xlsx, pptx, png, jpg, md, csv.
ALLOWED: dict[str, tuple[str, str]] = {
    "pdf": ("application/pdf", "pdf"),
    "docx": (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "ooxml:word/",
    ),
    "xlsx": (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ooxml:xl/",
    ),
    "pptx": (
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "ooxml:ppt/",
    ),
    "png": ("image/png", "png"),
    "jpg": ("image/jpeg", "jpeg"),
    "jpeg": ("image/jpeg", "jpeg"),
    "md": ("text/markdown; charset=utf-8", "text"),
    "csv": ("text/csv; charset=utf-8", "text"),
}
INLINE_TYPES = frozenset({"image/png", "image/jpeg"})


class FileRead(BaseModel):
    id: str
    filename: str
    content_type: str
    size_bytes: int
    sha256: str
    page_id: str | None
    uploaded_by: str | None
    created_at: datetime
    #: A file is immutable once uploaded, so its version is always 1; it is
    #: here so a delete names the version like every other write.
    version: int = 1
    #: Where to fetch the bytes — this backend's authenticated route.
    download_path: str


def _to_read(row: OverviewFile) -> FileRead:
    return FileRead(
        id=str(row.id),
        filename=row.filename,
        content_type=row.content_type,
        size_bytes=row.size_bytes,
        sha256=row.sha256,
        page_id=str(row.page_id) if row.page_id else None,
        uploaded_by=row.uploaded_by,
        created_at=row.created_at,
        download_path=f"/api/v1/overview/files/{row.id}/content",
    )


def _parse_id(value: str) -> UUID:
    try:
        return UUID(value)
    except ValueError as exc:
        raise RecordNotFound(value) from exc


class FileStore:
    async def _load(self, ctx: StoreContext, record_id: str) -> OverviewFile:
        row = (
            (
                await ctx.db.execute(
                    select(OverviewFile).where(
                        OverviewFile.id == _parse_id(record_id),
                        OverviewFile.tenant_id == ctx.access.tenant_id,
                    )
                )
            )
            .scalars()
            .first()
        )
        if row is None:
            raise RecordNotFound(record_id)
        return row

    async def list(
        self, ctx: StoreContext, filters: dict[str, list[str]]
    ) -> ListResult:
        stmt = select(OverviewFile).where(
            OverviewFile.tenant_id == ctx.access.tenant_id
        )
        page_ids = []
        for raw in filters.get("page_id", []):
            try:
                page_ids.append(UUID(raw))
            except ValueError:
                return ListResult(items=[])  # names nothing that can exist
        if page_ids:
            stmt = stmt.where(OverviewFile.page_id.in_(page_ids))
        query = " ".join(q.strip() for q in filters.get("q", []) if q.strip())[:200]
        if query:
            escaped = (
                query.replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_")
            )
            stmt = stmt.where(OverviewFile.filename.ilike(f"%{escaped}%"))
        rows = (
            (
                await ctx.db.execute(
                    stmt.order_by(OverviewFile.created_at.desc()).limit(500)
                )
            )
            .scalars()
            .all()
        )
        return ListResult(items=[_to_read(r) for r in rows])

    async def get(self, ctx: StoreContext, record_id: str) -> FileRead:
        return _to_read(await self._load(ctx, record_id))

    async def create(self, ctx: StoreContext, payload: BaseModel) -> FileRead:
        # Uploads are multipart and go through `upload_file` below; the
        # generic JSON create is not routed for this resource.
        raise NotImplementedError

    async def update(
        self,
        ctx: StoreContext,
        record_id: str,
        payload: BaseModel,
        expected_version: int,
    ) -> tuple[FileRead, FileRead]:
        raise NotImplementedError  # files are immutable; not routed

    async def delete(
        self, ctx: StoreContext, record_id: str, expected_version: int
    ) -> FileRead:
        row = await self._load(ctx, record_id)
        before = _to_read(row)
        if expected_version != before.version:
            raise StaleVersion(before)
        key = row.storage_key
        await ctx.db.delete(row)
        await ctx.db.flush()

        async def remove_bytes() -> None:
            # After the commit only: if the commit fails, the row still points
            # at bytes that are still there.
            await asyncio.to_thread(object_storage.delete_file, key)

        ctx.after_commit.append(remove_bytes)
        return before


def file_store() -> FileStore:
    return FileStore()


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

_UNSAFE_NAME = re.compile(r"[\x00-\x1f\x7f/\\]+")


def clean_filename(raw: str | None) -> str:
    """The name to show and to offer on download: the base name only, no
    control characters or path separators, at most :data:`MAX_FILENAME`
    characters, keeping the extension."""
    name = unicodedata.normalize("NFC", raw or "")
    name = name.replace("\\", "/").rsplit("/", 1)[-1]
    # Format characters too (a right-to-left override can make a name's shown
    # extension differ from its real one).
    name = "".join(ch for ch in name if unicodedata.category(ch) != "Cf")
    name = _UNSAFE_NAME.sub("", name).strip().strip(".")
    if len(name) > MAX_FILENAME:
        stem, dot, ext = name.rpartition(".")
        name = (
            (stem[: MAX_FILENAME - len(ext) - 1] + dot + ext)
            if dot
            else name[:MAX_FILENAME]
        )
    return name


def extension_of(name: str) -> str:
    _, dot, ext = name.rpartition(".")
    return ext.lower() if dot else ""


def check_signature(kind: str, data: bytes) -> bool:
    """Whether the bytes are what their extension says."""
    if kind == "pdf":
        return data.startswith(b"%PDF-")
    if kind == "png":
        return data.startswith(b"\x89PNG\r\n\x1a\n")
    if kind == "jpeg":
        return data.startswith(b"\xff\xd8\xff")
    if kind == "text":
        if b"\x00" in data:
            return False
        try:
            data.decode("utf-8")
        except UnicodeDecodeError:
            return False
        return True
    if kind.startswith("ooxml:"):
        folder = kind.split(":", 1)[1]
        if not data.startswith(b"PK\x03\x04"):
            return False
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                names = zf.namelist()
        except Exception:  # noqa: BLE001 — any unreadable zip is simply not one
            return False
        return "[Content_Types].xml" in names and any(
            n.startswith(folder) for n in names
        )
    return False


def _refuse(status: int, error: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status, detail={"error": error, "message": message}
    )


async def _read_capped(upload: UploadFile) -> bytes:
    buf = bytearray()
    while True:
        chunk = await upload.read(_CHUNK)
        if not chunk:
            return bytes(buf)
        buf.extend(chunk)
        if len(buf) > MAX_FILE_BYTES:
            raise _too_large()


# ---------------------------------------------------------------------------
# Routes beyond the contract: upload and download
# ---------------------------------------------------------------------------

router = APIRouter()


class FileItem(BaseModel):
    item: FileRead
    can_edit: bool


@router.post("/files", response_model=FileItem, status_code=201)
async def upload_file(
    request: Request,
    response: Response,
    file: UploadFile = File(...),
    page_id: str | None = Form(default=None),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    access: OverviewAccess = Depends(require_edit("editing_roles")),
    db: AsyncSession = Depends(get_async_db),
) -> Any:
    """Upload one file, optionally attached to a document. See the module
    docstring for what is checked; every refusal names why."""
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_UPLOAD_REQUEST_BYTES:
        raise _too_large()

    key = (idempotency_key or "").strip() or None
    if key is not None and len(key) > 200:
        raise HTTPException(status_code=400, detail="idempotency_key_too_long")
    if key is not None:
        replay = await _replay(request, response, access, db, key)
        if replay is not None:
            return replay

    filename = clean_filename(file.filename)
    ext = extension_of(filename)
    if not filename or ext not in ALLOWED:
        allowed = ", ".join(sorted({e for e in ALLOWED if e != "jpeg"}))
        raise _refuse(
            415,
            "unsupported_type",
            f"Only these file types can be uploaded: {allowed}.",
        )
    content_type, signature = ALLOWED[ext]

    attach: UUID | None = None
    if page_id:
        try:
            attach = UUID(page_id)
        except ValueError as exc:
            raise _refuse(404, "not_found", "There is no such document here.") from exc
        owner = (
            await db.execute(
                select(Page.id).where(
                    Page.id == attach,
                    Page.tenant_id == access.tenant_id,
                    Page.kind == "document",
                )
            )
        ).first()
        if owner is None:
            raise _refuse(404, "not_found", "There is no such document here.")

    data = await _read_capped(file)
    if not data:
        raise _refuse(422, "empty_file", "That file is empty.")
    matches, digest = await asyncio.to_thread(_inspect, signature, data)
    if not matches:
        raise _refuse(
            415,
            "content_mismatch",
            f"That file's contents are not a .{ext} file. Upload the file itself "
            "rather than a renamed one.",
        )
    # Unlocked, so a project that is plainly full is told before any upload.
    # The binding check is the locked one below.
    await _check_quota(db, access.tenant_id, len(data))

    storage_key, _url = await asyncio.to_thread(
        object_storage.upload_bytes,
        data=data,
        prefix=f"overview/{access.tenant_id}",
        filename=f"upload.{ext}",
        content_type=content_type.split(";")[0],
    )
    committed = False
    try:
        # One upload per project at a time from here to the commit, so two
        # cannot both fit in the same remaining space. Taken after the (slow)
        # storage write so the lock is held only for the insert.
        await db.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:lock, 0))"),
            {"lock": f"overview_files:{access.tenant_id}"},
        )
        await _check_quota(db, access.tenant_id, len(data))
        row = OverviewFile(
            tenant_id=access.tenant_id,
            page_id=attach,
            filename=filename,
            content_type=content_type,
            size_bytes=len(data),
            sha256=digest,
            storage_key=storage_key,
            uploaded_by=access.actor,
        )
        try:
            # A savepoint, so a lost Idempotency-Key race leaves the session
            # usable for reading the winner.
            async with db.begin_nested():
                db.add(row)
                await db.flush()
                await db.refresh(row)
                created = _to_read(row)
                await change_log.record(
                    db,
                    tenant_id=access.tenant_id,
                    resource="files",
                    record_id=created.id,
                    action="create",
                    source=change_log.change_source(request),
                    actor=access.actor,
                    actor_user_id=access.user_id,
                    before=None,
                    after=created,
                    version_after=created.version,
                    idempotency_key=key,
                )
        except IntegrityError:
            # A concurrent upload under the same Idempotency-Key committed
            # first: answer with its file, as a replay would have.
            replay = await _replay(request, response, access, db, key) if key else None
            if replay is None:
                raise
            return replay
        await db.commit()
        committed = True
    finally:
        if not committed:
            # Also on cancellation (a client that disconnected mid-commit):
            # bytes whose row never committed are taken back.
            await _discard(storage_key)
    response.headers["ETag"] = contract_http.etag(created.version)
    return FileItem(item=created, can_edit=True)


def _too_large() -> HTTPException:
    return _refuse(
        413,
        "file_too_large",
        f"Files can be at most {MAX_FILE_BYTES // (1024 * 1024)} MB.",
    )


def _inspect(signature: str, data: bytes) -> tuple[bool, str]:
    """Signature check and digest — CPU work on up to 25 MB, so run off the
    event loop."""
    return check_signature(signature, data), hashlib.sha256(data).hexdigest()


async def _check_quota(db: AsyncSession, tenant_id: UUID, size: int) -> None:
    used = (
        await db.execute(
            select(func.coalesce(func.sum(OverviewFile.size_bytes), 0)).where(
                OverviewFile.tenant_id == tenant_id
            )
        )
    ).scalar_one()
    if int(used) + size > MAX_PROJECT_BYTES:
        raise _refuse(
            413,
            "project_storage_full",
            "This project has used its "
            f"{MAX_PROJECT_BYTES // (1024 * 1024 * 1024)} GB of file storage. "
            "Delete files it no longer needs to make room.",
        )


async def _discard(storage_key: str) -> None:
    try:
        await asyncio.shield(asyncio.to_thread(object_storage.delete_file, storage_key))
    except Exception:  # noqa: BLE001 — cleanup must not mask the real error
        # A cancellation propagates; the shielded delete still runs to the end.
        logger.exception("overview_upload_cleanup_failed", key=storage_key)


async def _replay(
    request: Request,
    response: Response,
    access: OverviewAccess,
    db: AsyncSession,
    key: str,
) -> FileItem | None:
    """The file an earlier upload under ``key`` created, or None if none did."""
    prior = await change_log.find_by_idempotency_key(
        db, tenant_id=access.tenant_id, resource="files", key=key
    )
    if prior is None:
        return None
    try:
        existing = await FileStore().get(
            StoreContext(access=access, db=db, request=request), prior.record_id
        )
    except RecordNotFound as exc:
        raise _refuse(
            409,
            "idempotency_key_reused",
            "That Idempotency-Key already uploaded a file which no longer "
            "exists. Use a new key.",
        ) from exc
    response.status_code = 200
    response.headers["Idempotent-Replayed"] = "true"
    response.headers["ETag"] = contract_http.etag(existing.version)
    return FileItem(item=existing, can_edit=True)


#: Served on every download. The app-wide security middleware leaves a CSP a
#: route has already set in place, so this one reaches the browser.
DOWNLOAD_CSP = "default-src 'none'; img-src 'self'; sandbox"


def _disposition(kind: str, filename: str) -> str:
    ascii_name = filename.encode("ascii", "ignore").decode() or "download"
    ascii_name = ascii_name.replace('"', "")
    return f"{kind}; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename)}"


@router.get("/files/{file_id}/content")
async def download_file(
    file_id: str,
    request: Request,
    inline: bool = Query(default=False),
    access: OverviewAccess = Depends(get_overview_access),
    db: AsyncSession = Depends(get_async_db),
) -> Response:
    """The file's bytes, for any member of the project. See the module
    docstring for why this is not a presigned URL."""
    try:
        row = await FileStore()._load(
            StoreContext(access=access, db=db, request=request), file_id
        )
    except RecordNotFound as exc:
        raise _refuse(404, "not_found", "There is no such file here.") from exc
    # End the read transaction now: the request's session is closed only after
    # the last byte is sent, and a slow download must not hold a pooled
    # connection idle in a transaction for all that time.
    await db.commit()
    try:
        stream = await asyncio.to_thread(object_storage.open_stream, row.storage_key)
    except Exception as exc:  # noqa: BLE001
        logger.exception("overview_download_failed", file_id=file_id)
        raise _refuse(
            502, "storage_unavailable", "The stored file could not be read right now."
        ) from exc

    async def chunks() -> AsyncIterator[bytes]:
        try:
            while chunk := await asyncio.to_thread(stream.read, _CHUNK):
                yield chunk
        finally:
            # Not awaited: on a client disconnect this runs in a cancelled
            # scope, where an await would be cancelled before the close.
            stream.close()

    show_inline = inline and row.content_type in INLINE_TYPES
    return StreamingResponse(
        chunks(),
        media_type=row.content_type,
        headers={
            "Content-Length": str(row.size_bytes),
            # Declared so the app's GZip middleware passes the bytes through:
            # the allowed types are already compressed or small, and gzipping
            # 25 MB would block the event loop and drop the Content-Length.
            "Content-Encoding": "identity",
            "Content-Disposition": _disposition(
                "inline" if show_inline else "attachment", row.filename
            ),
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": DOWNLOAD_CSP,
            "Cache-Control": "private, no-store",
        },
    )
