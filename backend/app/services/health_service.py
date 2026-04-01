"""
Backward-compatible re-export shim for health package.

All logic has moved to app.services.health submodules.
Import from app.services.health directly for new code.
"""

from app.services.health import HealthService, health_service  # noqa: F401
