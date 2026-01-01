"""Abstract base class for storage backends."""

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
    def file_exists(self, key: str) -> bool:
        """Check if file exists."""
        pass

    @abstractmethod
    def get_file_metadata(self, key: str) -> dict:
        """Get file metadata."""
        pass
