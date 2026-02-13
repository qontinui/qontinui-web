"""
Backward-compatible re-export shim for permissions package.

All logic has moved to app.services.permissions submodules.
Import from app.services.permissions directly for new code.
"""

from app.services.permissions import (  # noqa: F401
    PermissionService,
    permission_service,
)
