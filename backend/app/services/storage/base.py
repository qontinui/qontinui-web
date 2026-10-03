"""Abstract base class for storage backends."""

import io
from abc import ABC, abstractmethod
from typing import BinaryIO


class StorageBackend(ABC):
    """Abstract base class for storage backends."""

    @abstractmethod
    def upload_file(
        self,
        file_obj: BinaryIO,
        key: str,
        content_type: str | None = None,
        metadata: dict | None = None,
    ) -> str:
        """Upload file and return public URL."""
        pass

    @abstractmethod
    def download_file(self, key: str) -> bytes:
        """Download file and return bytes."""
        pass

    def open_stream(self, key: str) -> BinaryIO:
        """Open a stored file for reading in chunks; the caller closes it.

        This default reads the whole file; a backend that can hand back a
        stream overrides it so a large file is never held in memory whole.
        """
        return io.BytesIO(self.download_file(key))

    @abstractmethod
    def delete_file(self, key: str) -> bool:
        """Delete file, return True if successful."""
        pass

    @abstractmethod
    def generate_presigned_url(
        self, key: str, expiration: int = 3600, http_method: str = "GET"
    ) -> str:
        """Generate presigned URL for temporary access."""
        pass

    @abstractmethod
    def key_from_object_url(self, url: str) -> str | None:
        """The storage key an object URL from this backend names, else ``None``.

        The inverse of :meth:`upload_file`'s return value (and of
        :meth:`generate_presigned_url`, whose query string is ignored), so a
        row that stored the URL rather than the key can still be presigned on
        read. ``None`` for any URL this backend did not mint.
        """
        pass

    @abstractmethod
    def file_exists(self, key: str) -> bool:
        """Check if file exists."""
        pass

    @abstractmethod
    def get_file_metadata(self, key: str) -> dict:
        """Get file metadata."""
        pass
