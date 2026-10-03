"""HTTP read doors for the local storage backend — the narrow replacement for
the unauthenticated ``StaticFiles`` mount ``app/main.py`` used to put on the
whole ``uploads/`` directory.

Two routes, and nothing else under ``uploads/`` is reachable over HTTP:

``GET|HEAD /local-storage/{key}?expires=&signature=``
    Serves one object ONLY against a URL minted by
    ``LocalBackend.generate_presigned_url``: an HMAC signature over
    ``(GET, key, expires)`` keyed from ``SECRET_KEY``, checked in constant time,
    refused once expired. That is S3-presigned-URL semantics — the backend that
    mints the URL is the one that already authorized the caller — so private,
    tenant-scoped objects (screenshots, videos, overview files, frame caches)
    are no longer readable by path alone. ``HEAD`` is checked against the
    ``GET`` signature, as S3 does. 404 when the active storage backend is not
    local, so the route is inert in an S3/MinIO deployment; 503 while
    ``SECRET_KEY`` is the public shipped default (fail closed, see
    ``signing_enabled``).

``GET|HEAD /uploads/avatars/{filename}``
    Avatars written by ``AvatarService`` under local storage, kept PUBLIC and
    at their old URL because they are rendered by ``<img>`` tags across users
    (collaborator lists, comment authors) where no bearer header is sent. The
    exposure is bounded: the filename must be ``<uuid4>.<jpg|jpeg|png|webp>``
    (so no traversal and no enumeration), and ``AvatarService`` re-encodes every
    upload to a 200x200 JPEG, so the directory holds only decoded-and-re-encoded
    image bytes, never what a user sent.
"""

import re
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import FileResponse

from app.services.avatar_service import AvatarService
from app.services.storage import object_storage
from app.services.storage.local_backend import (
    LOCAL_STORAGE_ROUTE,
    InvalidStorageKey,
    LocalBackend,
    signing_enabled,
    verify_object_url,
)

router = APIRouter()

#: Served on every object: nothing stored may be sniffed into, or run as,
#: active content in the backend's origin.
_HARDENING_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cache-Control": "private, no-store",
}

_AVATAR_FILENAME = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
    r"\.(?:jpg|jpeg|png|webp)$"
)

_NOT_FOUND = HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")


@router.api_route(
    LOCAL_STORAGE_ROUTE + "/{key:path}",
    methods=["GET", "HEAD"],
    include_in_schema=False,
)
def read_signed_object(
    key: str,
    expires: int = Query(...),
    signature: str = Query(..., min_length=1, max_length=128),
) -> FileResponse:
    """Serve one local-storage object against a valid, unexpired signature."""
    backend = object_storage.backend
    if not isinstance(backend, LocalBackend):
        raise _NOT_FOUND
    if not signing_enabled():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Local-storage URL signing is disabled: SECRET_KEY is the "
            "shipped default",
        )
    # HEAD is authorised by the GET signature (S3 semantics); the signer only
    # ever mints read URLs for GET.
    if not verify_object_url(key, expires, signature, http_method="GET"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or expired signature",
        )
    try:
        path = backend.resolve_key(key)
    except InvalidStorageKey:
        raise _NOT_FOUND
    if not path.is_file():
        raise _NOT_FOUND
    content_type = backend.get_file_metadata(key).get("content_type")
    return FileResponse(
        path,
        media_type=content_type or "application/octet-stream",
        headers=_HARDENING_HEADERS,
    )


@router.api_route(
    "/uploads/avatars/{filename}", methods=["GET", "HEAD"], include_in_schema=False
)
def read_avatar(filename: str) -> FileResponse:
    """Serve one locally stored avatar (public by design — see module docstring)."""
    if not _AVATAR_FILENAME.fullmatch(filename):
        raise _NOT_FOUND
    avatar_dir = Path(AvatarService.UPLOAD_DIR).resolve()
    path = (avatar_dir / filename).resolve()
    if path.parent != avatar_dir or not path.is_file():
        raise _NOT_FOUND
    return FileResponse(
        path,
        media_type="image/jpeg",
        headers={
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
        },
    )
