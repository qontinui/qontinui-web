"""
Admin endpoints package.

Provides admin-only endpoints for platform management:
- User management
- Project management
- Analytics and statistics
- Health monitoring
- Download analytics
- Notification settings
- Cleanup operations
"""

from fastapi import APIRouter

# Import sub-routers
from app.api.v1.endpoints.admin.analytics import router as analytics_router
from app.api.v1.endpoints.admin.bootstrap import router as bootstrap_router
from app.api.v1.endpoints.admin.cleanup import router as cleanup_router

# Import and re-export the require_admin dependency for other modules
from app.api.v1.endpoints.admin.dependencies import require_admin
from app.api.v1.endpoints.admin.download_analytics import (
    router as download_analytics_router,
)
from app.api.v1.endpoints.admin.health import router as health_router
from app.api.v1.endpoints.admin.notifications import router as notifications_router
from app.api.v1.endpoints.admin.projects import router as projects_router
from app.api.v1.endpoints.admin.users import router as users_router

# Main admin router
router = APIRouter()

# Include all sub-routers
router.include_router(bootstrap_router, tags=["admin-bootstrap"])
router.include_router(users_router, tags=["admin-users"])
router.include_router(projects_router, tags=["admin-projects"])
router.include_router(analytics_router, tags=["admin-analytics"])
router.include_router(health_router, tags=["admin-health"])
router.include_router(download_analytics_router, tags=["admin-downloads"])
router.include_router(notifications_router, tags=["admin-notifications"])
router.include_router(cleanup_router, tags=["admin-cleanup"])

# Export require_admin for backward compatibility
__all__ = ["router", "require_admin"]
