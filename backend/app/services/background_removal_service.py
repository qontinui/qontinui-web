"""Background Removal Service.

NOTE: As of plan-2026-05-17-web-image-slim, the underlying qontinui background
removal module no longer ships with the web image. Constructing this service
now raises HTTPException(503) directly; FastAPI propagates it from whichever
route handler instantiates the service. The runner-bridge replacement is tracked
under plan-2026-05-17-ws-bridge-for-violating-routers.
"""

from typing import Any

import structlog
from fastapi import HTTPException, status

logger = structlog.get_logger(__name__)


class BackgroundRemovalService:
    """Service for removing backgrounds from screenshots using base64 strings.

    DEFERRED: ws-bridge — raising HTTPException(503) here is the lean choice
    per plan §3 implementation approach. FastAPI propagates the exception
    through the calling route handler so the client sees a proper 503 envelope.
    """

    def __init__(self, config_dict: dict[str, Any] | None = None):
        """Initialize the background removal service.

        Raises HTTPException(503) until the runner-bridge ships — qontinui.discovery
        no longer lives in the web image.
        """
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": "endpoint_requires_runner_bridge",
                "message": (
                    "This endpoint depends on qontinui runtime functionality that lives on "
                    "the runner. The web - runner WebSocket bridge for this functionality is "
                    "not yet implemented. See architectural-decisions.md "
                    "'Web - runner WebSocket boundary'."
                ),
                "runner_module": "qontinui.discovery.background_removal",
                "endpoint": "background_removal_service",
                "tracking": "plan-2026-05-17-ws-bridge-for-violating-routers (TBD)",
            },
        )

    def remove_backgrounds_base64(
        self, base64_screenshots: list[str], debug: bool = False
    ) -> tuple[list[str], dict[str, Any]]:
        """Remove backgrounds from base64-encoded screenshots.

        Unreachable: __init__ raises 503 before this can be called. Kept on the
        class so that if a stale caller constructs the service via some sentinel
        path, the second 503 surfaces here too.
        """
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": "endpoint_requires_runner_bridge",
                "message": (
                    "This endpoint depends on qontinui runtime functionality that lives on "
                    "the runner. The web - runner WebSocket bridge for this functionality is "
                    "not yet implemented. See architectural-decisions.md "
                    "'Web - runner WebSocket boundary'."
                ),
                "runner_module": "qontinui.discovery.background_removal",
                "endpoint": "background_removal_service.remove_backgrounds_base64",
                "tracking": "plan-2026-05-17-ws-bridge-for-violating-routers (TBD)",
            },
        )
