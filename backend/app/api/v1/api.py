from fastapi import APIRouter

from app.api.v1.endpoints import (
    admin,
    admin_ws,
    analysis,
    analytics,
    annotations,
    audit_logs,
    auth_endpoints,
    automation,
    automation_ws,
    background_removal,
    billing,
    capture,
    code_execution,
    code_packages,
    collaboration,
    collaboration_ws,
    conflicts,
    custom_functions,
    export,
    extraction,
    feedback,
    health,
    images,
    integration_testing,
    notifications,
    organizations,
    pattern_optimization,
    project_files,
    projects,
    public,
    recordings,
    region_analysis,
    runner_command_ws,
    runner_status_ws,
    runners,
    security,
    settings,
    snapshots,
    state_discovery,
    testing,
    training_datasets,
    users,
    variables,
    versions,
    videos,
)

api_router = APIRouter()

api_router.include_router(health.router, tags=["health"])
api_router.include_router(public.router, prefix="/public", tags=["public"])
api_router.include_router(auth_endpoints.router, prefix="/auth", tags=["auth"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(projects.router, prefix="/projects", tags=["projects"])
api_router.include_router(
    project_files.router, prefix="/projects", tags=["project-files"]
)
api_router.include_router(export.router, prefix="/projects", tags=["export"])
api_router.include_router(images.router, prefix="/projects", tags=["images"])
api_router.include_router(
    integration_testing.router,
    prefix="/integration-testing",
    tags=["integration-testing"],
)
api_router.include_router(snapshots.router, prefix="/snapshots", tags=["snapshots"])
api_router.include_router(pattern_optimization.router, tags=["pattern-optimization"])
api_router.include_router(background_removal.router, tags=["background-removal"])
api_router.include_router(analytics.router, tags=["analytics"])
api_router.include_router(settings.router, prefix="/settings", tags=["settings"])
api_router.include_router(billing.router, prefix="/billing", tags=["billing"])
api_router.include_router(admin.router, prefix="/admin", tags=["admin"])
api_router.include_router(admin_ws.router, prefix="/admin", tags=["admin-websockets"])
api_router.include_router(
    audit_logs.router, prefix="/admin/audit-logs", tags=["audit-logs"]
)
api_router.include_router(automation.router, prefix="/automation", tags=["automation"])
api_router.include_router(
    automation_ws.router, prefix="/automation", tags=["automation-websockets"]
)
api_router.include_router(
    code_execution.router, prefix="/code", tags=["code-execution"]
)
api_router.include_router(
    annotations.router, prefix="/annotations", tags=["annotations"]
)
api_router.include_router(analysis.router, prefix="/analysis", tags=["analysis"])
api_router.include_router(
    region_analysis.router, prefix="/region-analysis", tags=["region-analysis"]
)
api_router.include_router(feedback.router, tags=["feedback"])
api_router.include_router(
    organizations.router, prefix="/organizations", tags=["organizations"]
)
api_router.include_router(
    collaboration.router, prefix="/projects", tags=["collaboration"]
)
api_router.include_router(collaboration_ws.router, tags=["collaboration-websockets"])
api_router.include_router(conflicts.router, tags=["conflicts"])
api_router.include_router(
    notifications.router, prefix="/notifications", tags=["notifications"]
)
api_router.include_router(
    state_discovery.router, prefix="/state-discovery", tags=["state-discovery"]
)
api_router.include_router(videos.router, prefix="/videos", tags=["videos"])
api_router.include_router(runners.router, prefix="/runners", tags=["runners"])
api_router.include_router(versions.router, prefix="/projects", tags=["versions"])
api_router.include_router(security.router, prefix="/security", tags=["security"])
api_router.include_router(variables.router, tags=["variables"])
api_router.include_router(
    code_packages.router, prefix="/code-packages", tags=["code-packages"]
)
api_router.include_router(custom_functions.router, tags=["custom-functions"])
api_router.include_router(capture.router, prefix="/capture", tags=["capture-sessions"])
api_router.include_router(testing.router, prefix="/testing", tags=["testing"])
api_router.include_router(
    training_datasets.router, prefix="/datasets", tags=["training-datasets"]
)
api_router.include_router(recordings.router, prefix="/recordings", tags=["recordings"])
api_router.include_router(extraction.router, tags=["extraction"])
api_router.include_router(
    runner_command_ws.router, prefix="/automation", tags=["runner-command-websockets"]
)
api_router.include_router(runner_status_ws.router, tags=["runner-status-websockets"])
