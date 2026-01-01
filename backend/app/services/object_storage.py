"""
Object storage service - Re-exports from app.services.storage.

This file provides backward compatibility. For new code, import directly from:
    from app.services.storage import object_storage, ObjectStorageService
"""

from app.services.storage import (
    LocalBackend,
    ObjectStorageService,
    S3Backend,
    StorageBackend,
    object_storage,
)

__all__ = [
    "StorageBackend",
    "S3Backend",
    "LocalBackend",
    "ObjectStorageService",
    "object_storage",
]
