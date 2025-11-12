from fastapi import APIRouter

from app.api.v1.endpoints import (
    admin,
    admin_ws,
    analytics,
    analysis,
    annotations,
    auth,
    background_removal,
    billing,
    export,
    images,
    integration_testing,
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
api_router.include_router(images.router, prefix="/projects", tags=["images"])
api_router.include_router(
    integration_testing.router,
    prefix="/integration-testing",
    tags=["integration-testing"],
)
api_router.include_router(pattern_optimization.router, tags=["pattern-optimization"])
api_router.include_router(background_removal.router, tags=["background-removal"])
api_router.include_router(analytics.router, tags=["analytics"])
api_router.include_router(settings.router, prefix="/settings", tags=["settings"])
api_router.include_router(billing.router, prefix="/billing", tags=["billing"])
api_router.include_router(admin.router, prefix="/admin", tags=["admin"])
api_router.include_router(admin_ws.router, prefix="/admin", tags=["admin-websockets"])
api_router.include_router(annotations.router, prefix="/annotations", tags=["annotations"])
api_router.include_router(analysis.router, prefix="/analysis", tags=["analysis"])
