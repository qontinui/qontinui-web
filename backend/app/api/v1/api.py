from fastapi import APIRouter

from app.api.v1.endpoints import (
    analytics,
    auth,
    export,
    pattern_optimization,
    projects,
    settings,
    users,
)

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(projects.router, prefix="/projects", tags=["projects"])
api_router.include_router(export.router, prefix="/projects", tags=["export"])
api_router.include_router(pattern_optimization.router, tags=["pattern-optimization"])
api_router.include_router(analytics.router, tags=["analytics"])
api_router.include_router(settings.router, prefix="/settings", tags=["settings"])
