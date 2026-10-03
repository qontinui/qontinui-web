"""Local filesystem storage backend for development and testing.

Objects are NOT publicly served. The only way to read one over HTTP is a URL
from :meth:`LocalBackend.generate_presigned_url`: an HMAC-signed, expiring
link to ``GET /local-storage/{key}`` (``app/api/local_storage.py``) — the same
bearer-capability semantics an S3 presigned URL has. The URL
:meth:`LocalBackend.upload_file` returns is the unsigned object address, which
that route refuses, exactly as a private bucket refuses a bare object URL.

Until 2026-10-03 ``app/main.py`` mounted the whole ``uploads/`` directory as
``StaticFiles`` with no authentication, so every object (screenshots, overview
files, videos, frame caches) was readable by anyone holding its path.
"""

import base64
import hashlib
import hmac
import json
import mimetypes
import os
import shutil
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import BinaryIO
from urllib.parse import quote, unquote, urlencode, urlsplit

import structlog
from fastapi import HTTPException, status

from app.core.config import SHIPPED_DEFAULT_SECRET_KEY, settings
from app.services.storage.base import StorageBackend

logger = structlog.get_logger(__name__)

#: Route prefix that serves signed local-storage URLs (``app/api/local_storage.py``).
LOCAL_STORAGE_ROUTE = "/local-storage"

#: Domain-separation label, so a signature minted here can never be confused
#: with any other HMAC the backend computes from ``SECRET_KEY``.
_SIGNING_LABEL = b"qontinui-local-storage-url-v1"

#: Longest lifetime a signed URL may carry — S3's SigV4 presign ceiling.
MAX_SIGNED_URL_SECONDS = 7 * 24 * 3600

#: The prefix the retired ``StaticFiles`` mount served objects under. Rows
#: written before 2026-10-03 stored URLs in this form; ``key_from_object_url``
#: still inverts them so those rows can be presigned on read.
_RETIRED_UPLOADS_PREFIX = "/uploads/"


class InvalidStorageKey(ValueError):
    """A key that would resolve outside the storage root."""


class SigningDisabled(RuntimeError):
    """``SECRET_KEY`` is the public shipped default, so no URL may be signed."""


def signing_enabled() -> bool:
    """False when ``SECRET_KEY`` is the shipped default outside a test run.

    The default is public, so a signature keyed from it is forgeable by
    anyone; minting or honouring one would make every object world-readable
    again. Fails closed: refuse to sign AND refuse to serve.
    """
    return (
        settings.SECRET_KEY != SHIPPED_DEFAULT_SECRET_KEY or os.getenv("TESTING") == "1"
    )


def _signing_key() -> bytes:
    if not signing_enabled():
        raise SigningDisabled(
            "SECRET_KEY is the shipped default; local-storage URL signing is off"
        )
    return hmac.new(
        settings.SECRET_KEY.encode(), _SIGNING_LABEL, hashlib.sha256
    ).digest()


def sign_object_url(key: str, expires: int, http_method: str = "GET") -> str:
    """The signature over ``(method, key, expires)``, base64url without padding."""
    message = f"{http_method.upper()}\n{key}\n{expires}".encode()
    digest = hmac.new(_signing_key(), message, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def verify_object_url(
    key: str, expires: int, signature: str, http_method: str = "GET"
) -> bool:
    """True iff ``signature`` is valid for this key/method and not yet expired.

    Always False while signing is disabled, and for an expiry further out than
    :data:`MAX_SIGNED_URL_SECONDS`.
    """
    now = int(time.time())
    if not signing_enabled() or expires < now or expires > now + MAX_SIGNED_URL_SECONDS:
        return False
    expected = sign_object_url(key, expires, http_method)
    return hmac.compare_digest(expected, signature)


class LocalBackend(StorageBackend):
    """Local filesystem storage backend for development and testing."""

    def __init__(self, base_path: str | Path = "uploads"):
        """Initialize local storage backend."""
        self.base_path = Path(base_path).resolve()
        self.base_path.mkdir(parents=True, exist_ok=True)
        self.backend_url = settings.BACKEND_URL.rstrip("/")
        logger.info(
            "local_storage_initialized",
            path=str(self.base_path.absolute()),
            backend_url=self.backend_url,
        )

    def resolve_key(self, key: str) -> Path:
        """The file a key names, refusing any key that escapes the storage root.

        Rejects absolute keys, backslashes, NULs, empty / ``.`` / ``..``
        segments, and (after resolving symlinks) anything not under
        ``base_path``. Segments are split on the raw key, so a ``.`` that a
        path library would normalise away is refused rather than ignored.
        """
        if (
            not key
            or "\\" in key
            or "\x00" in key
            or any(part in ("", ".", "..") for part in key.split("/"))
        ):
            raise InvalidStorageKey(key)
        file_path = (self.base_path / key).resolve()
        if not file_path.is_relative_to(self.base_path):
            raise InvalidStorageKey(key)
        return file_path

    def _get_file_path(self, key: str) -> Path:
        """Get full file path from key (HTTP 400 on a key outside the root)."""
        try:
            return self.resolve_key(key)
        except InvalidStorageKey:
            logger.warning("local_storage_invalid_key", key=key)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid storage key",
            )

    def object_url(self, key: str) -> str:
        """The unsigned address of an object. Not servable: see module docstring."""
        return f"{self.backend_url}{LOCAL_STORAGE_ROUTE}/{quote(key)}"

    def upload_file(
        self,
        file_obj: BinaryIO,
        key: str,
        content_type: str | None = None,
        metadata: dict | None = None,
    ) -> str:
        """Upload file to local filesystem."""
        file_path = self._get_file_path(key)
        try:
            file_path.parent.mkdir(parents=True, exist_ok=True)
            with open(file_path, "wb") as f:
                shutil.copyfileobj(file_obj, f)

            if metadata:
                metadata_path = file_path.with_suffix(file_path.suffix + ".meta.json")
                metadata_with_type = {
                    "content_type": content_type,
                    "uploaded_at": datetime.now(UTC).isoformat(),
                    **metadata,
                }
                with open(metadata_path, "w") as f:
                    json.dump(metadata_with_type, f)

            logger.info("file_uploaded_locally", key=key, path=str(file_path))
            return self.object_url(key)

        except Exception as e:
            logger.error("local_upload_failed", key=key, error=str(e))
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to upload file locally: {str(e)}",
            )

    def download_file(self, key: str) -> bytes:
        """Download file from local filesystem."""
        file_path = self._get_file_path(key)
        try:
            if not file_path.exists():
                raise FileNotFoundError(f"File not found: {key}")

            with open(file_path, "rb") as f:
                return f.read()

        except FileNotFoundError:
            logger.error("local_download_failed", key=key, error="File not found")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"File not found: {key}",
            )
        except Exception as e:
            logger.error("local_download_failed", key=key, error=str(e))
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to download file: {str(e)}",
            )

    def open_stream(self, key: str) -> BinaryIO:
        """The file, opened for reading."""
        file_path = self._get_file_path(key)
        if not file_path.exists():
            logger.error("local_download_failed", key=key, error="File not found")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"File not found: {key}",
            )
        return open(file_path, "rb")

    def delete_file(self, key: str) -> bool:
        """Delete file from local filesystem."""
        try:
            file_path = self.resolve_key(key)
            if file_path.exists():
                file_path.unlink()
                metadata_path = file_path.with_suffix(file_path.suffix + ".meta.json")
                if metadata_path.exists():
                    metadata_path.unlink()
                logger.info("file_deleted_locally", key=key)
                return True
            return False
        except Exception as e:
            logger.error("local_delete_failed", key=key, error=str(e))
            return False

    def generate_presigned_url(
        self, key: str, expiration: int = 3600, http_method: str = "GET"
    ) -> str:
        """An HMAC-signed URL to ``GET /local-storage/{key}`` valid for ``expiration`` s.

        The signature covers the method, so a URL minted for ``PUT`` is not a
        read capability (the route only serves ``GET``/``HEAD``). The lifetime
        is capped at :data:`MAX_SIGNED_URL_SECONDS`, like S3's. HTTP 503 while
        ``SECRET_KEY`` is the shipped default (see :func:`signing_enabled`).
        """
        self._get_file_path(key)  # refuse a traversal key up front
        expires = int(time.time()) + min(expiration, MAX_SIGNED_URL_SECONDS)
        try:
            signature = sign_object_url(key, expires, http_method)
        except SigningDisabled as exc:
            logger.error("local_storage_signing_disabled", key=key)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(exc),
            )
        query = urlencode({"expires": expires, "signature": signature})
        return f"{self.object_url(key)}?{query}"

    def key_from_object_url(self, url: str) -> str | None:
        """Invert :meth:`object_url` / a signed URL / a retired ``/uploads/`` URL.

        Only a relative URL or one whose origin is ``BACKEND_URL``'s counts;
        a foreign host's ``/local-storage/...`` is not this backend's object
        and is left alone. The key still has to pass :meth:`resolve_key`.
        """
        parts = urlsplit(url)
        if parts.scheme or parts.netloc:
            own = urlsplit(self.backend_url)
            if (parts.scheme, parts.netloc) != (own.scheme, own.netloc):
                return None
        path = parts.path
        for prefix in (f"{LOCAL_STORAGE_ROUTE}/", _RETIRED_UPLOADS_PREFIX):
            if path.startswith(prefix):
                key = unquote(path[len(prefix) :])
                try:
                    self.resolve_key(key)
                except InvalidStorageKey:
                    return None
                return key
        return None

    def file_exists(self, key: str) -> bool:
        """Check if file exists in local filesystem."""
        try:
            file_path = self.resolve_key(key)
            return file_path.is_file()
        except Exception:
            return False

    def get_file_metadata(self, key: str) -> dict:
        """Get file metadata from local filesystem."""
        file_path = self._get_file_path(key)
        try:
            if not file_path.exists():
                raise FileNotFoundError(f"File not found: {key}")

            stat = file_path.stat()

            metadata_path = file_path.with_suffix(file_path.suffix + ".meta.json")
            extra_metadata = {}
            content_type = None

            if metadata_path.exists():
                with open(metadata_path) as f:
                    meta = json.load(f)
                    content_type = meta.pop("content_type", None)
                    meta.pop("uploaded_at", None)
                    extra_metadata = meta

            if not content_type:
                content_type = mimetypes.guess_type(str(file_path))[0]

            return {
                "size": stat.st_size,
                "content_type": content_type,
                "last_modified": datetime.fromtimestamp(stat.st_mtime),
                "metadata": extra_metadata,
            }

        except FileNotFoundError:
            logger.error("local_metadata_failed", key=key, error="File not found")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"File not found: {key}",
            )
        except Exception as e:
            logger.error("local_metadata_failed", key=key, error=str(e))
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to get file metadata: {str(e)}",
            )
