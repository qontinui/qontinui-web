"""Local filesystem storage backend for development and testing."""

import json
import mimetypes
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import BinaryIO

import structlog
from fastapi import HTTPException, status

from app.core.config import settings
from app.services.storage.base import StorageBackend

logger = structlog.get_logger(__name__)


class LocalBackend(StorageBackend):
    """Local filesystem storage backend for development and testing."""

    def __init__(self, base_path: str | Path = "uploads"):
        """Initialize local storage backend."""
        self.base_path = Path(base_path)
        self.base_path.mkdir(parents=True, exist_ok=True)
        self.backend_url = settings.BACKEND_URL.rstrip("/")
        logger.info(
            "local_storage_initialized",
            path=str(self.base_path.absolute()),
            backend_url=self.backend_url,
        )

    def _get_file_path(self, key: str) -> Path:
        """Get full file path from key."""
        file_path = self.base_path / key
        file_path.parent.mkdir(parents=True, exist_ok=True)
        return file_path

    def upload_file(
        self,
        file_obj: BinaryIO,
        key: str,
        content_type: str | None = None,
        metadata: dict | None = None,
    ) -> str:
        """Upload file to local filesystem."""
        try:
            file_path = self._get_file_path(key)

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
            return f"{self.backend_url}/uploads/{key}"

        except Exception as e:
            logger.error("local_upload_failed", key=key, error=str(e))
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to upload file locally: {str(e)}",
            )

    def download_file(self, key: str) -> bytes:
        """Download file from local filesystem."""
        try:
            file_path = self._get_file_path(key)
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

    def delete_file(self, key: str) -> bool:
        """Delete file from local filesystem."""
        try:
            file_path = self._get_file_path(key)
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
        """Generate a local file URL (no signing needed for local files)."""
        return f"{self.backend_url}/uploads/{key}"

    def file_exists(self, key: str) -> bool:
        """Check if file exists in local filesystem."""
        try:
            file_path = self._get_file_path(key)
            return file_path.exists()
        except Exception:
            return False

    def get_file_metadata(self, key: str) -> dict:
        """Get file metadata from local filesystem."""
        try:
            file_path = self._get_file_path(key)
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
