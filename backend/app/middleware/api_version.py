"""
API Versioning Middleware

Reads the Accept-Version header and stores it in request.state for use by endpoints.
Provides a helper function for deprecated endpoints to add deprecation warnings.

Usage:
    In endpoints:
        version = request.state.api_version  # "v1", "v2", etc. (defaults to "v1")

    For deprecated endpoints:
        from app.middleware.api_version import add_deprecation_warning
        add_deprecation_warning(response, sunset_date="2025-12-31", successor="/api/v2/endpoint")
"""

import structlog
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

logger = structlog.get_logger(__name__)


class APIVersionMiddleware(BaseHTTPMiddleware):
    """
    Middleware to read and store API version from Accept-Version header.

    Reads the Accept-Version header (e.g., "v1", "v2", "1.0", "2.0")
    and stores it in request.state.api_version for use by endpoints.

    If no header is provided, defaults to "v1" for backward compatibility.
    """

    DEFAULT_VERSION = "v1"
    SUPPORTED_VERSIONS = ["v1", "v2"]  # Add new versions as they are released

    async def dispatch(self, request: Request, call_next):
        # Read Accept-Version header (case-insensitive)
        version = request.headers.get("Accept-Version", self.DEFAULT_VERSION)

        # Normalize version format (handle both "v1" and "1" formats)
        if version and not version.startswith("v"):
            version = f"v{version}"

        # Validate version
        if version not in self.SUPPORTED_VERSIONS:
            logger.warning(
                "unsupported_api_version_requested",
                requested_version=version,
                supported_versions=self.SUPPORTED_VERSIONS,
                defaulting_to=self.DEFAULT_VERSION,
            )
            version = self.DEFAULT_VERSION

        # Store in request state for use by endpoints
        request.state.api_version = version

        # Log version usage for analytics
        logger.debug(
            "api_version_set",
            version=version,
            path=request.url.path,
            method=request.method,
        )

        # Process request
        response = await call_next(request)

        # Add API-Version response header to inform clients of actual version used
        response.headers["API-Version"] = version

        return response


def add_deprecation_warning(
    response: Response,
    sunset_date: str,
    successor: str | None = None,
) -> None:
    """
    Add deprecation headers to a response.

    This function adds standard deprecation headers as per RFC 8594 (Sunset HTTP Header)
    and draft-ietf-httpapi-deprecation-header specifications.

    Args:
        response: The FastAPI Response object to add headers to
        sunset_date: ISO 8601 date when the endpoint will be removed (e.g., "2025-12-31")
        successor: URL of the replacement endpoint (optional)

    Example:
        @router.get("/old-endpoint")
        async def old_endpoint():
            response = JSONResponse(content={"data": "..."})
            add_deprecation_warning(
                response,
                sunset_date="2025-12-31",
                successor="/api/v2/new-endpoint"
            )
            return response
    """
    # Add Deprecation header (boolean true)
    response.headers["Deprecation"] = "true"

    # Add Sunset header (date when endpoint will be removed)
    response.headers["Sunset"] = sunset_date

    # Add Link header pointing to successor (if provided)
    if successor:
        response.headers["Link"] = f'<{successor}>; rel="successor-version"'

    # Add custom Warning header for human-readable message
    warning_msg = f"This endpoint is deprecated and will be removed after {sunset_date}."
    if successor:
        warning_msg += f" Use {successor} instead."
    response.headers["Warning"] = f'299 - "{warning_msg}"'

    logger.info(
        "deprecation_warning_added",
        sunset_date=sunset_date,
        successor=successor,
    )
