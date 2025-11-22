"""
Deprecation utilities for API versioning.

Provides helper functions to mark endpoints as deprecated and add appropriate HTTP headers
to inform clients about deprecation status and migration paths.

This module implements the following standards:
- RFC 8594: The Sunset HTTP Header Field
- Draft IETF HTTP API Deprecation Header

Usage:
    from app.core.deprecation import add_deprecation_headers

    @router.get("/api/v1/old-endpoint")
    def old_endpoint(response: Response):
        add_deprecation_headers(
            response,
            sunset_date="2025-12-31",
            successor="/api/v2/new-endpoint"
        )
        return {"data": "..."}
"""

import structlog
from fastapi import Response

logger = structlog.get_logger(__name__)


def add_deprecation_headers(
    response: Response,
    sunset_date: str,
    successor: str | None = None,
) -> None:
    """
    Add deprecation headers to a response.

    This function adds standard deprecation headers to inform API clients that
    an endpoint is deprecated and will be removed in the future.

    Headers added:
    - Deprecation: "true" (indicates the endpoint is deprecated)
    - Sunset: ISO 8601 date when the endpoint will be removed
    - Link: URL to successor endpoint (if provided)
    - Warning: Human-readable deprecation message

    Args:
        response: The FastAPI Response object to add headers to
        sunset_date: ISO 8601 date when the endpoint will be removed (e.g., "2025-12-31")
        successor: URL of the replacement endpoint (optional)

    Example:
        @router.get("/v1/users", deprecated=True)
        async def list_users_v1(response: Response):
            add_deprecation_headers(
                response,
                sunset_date="2025-12-31",
                successor="/api/v2/users"
            )
            return {"users": [...]}

    Reference:
        - RFC 8594: https://datatracker.ietf.org/doc/html/rfc8594
        - Deprecation Header: https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-deprecation-header
    """
    # Add Deprecation header (boolean flag)
    response.headers["Deprecation"] = "true"

    # Add Sunset header (RFC 8594 - date when endpoint will be removed)
    response.headers["Sunset"] = sunset_date

    # Add Link header pointing to successor (RFC 8288 - Web Linking)
    if successor:
        response.headers["Link"] = f'<{successor}>; rel="successor-version"'

    # Add Warning header for human-readable message (RFC 7234)
    warning_msg = f"This endpoint is deprecated and will be removed after {sunset_date}."
    if successor:
        warning_msg += f" Please migrate to {successor}."
    response.headers["Warning"] = f'299 - "{warning_msg}"'

    logger.info(
        "deprecation_headers_added",
        sunset_date=sunset_date,
        successor=successor,
        has_successor=successor is not None,
    )


def is_version_deprecated(version: str) -> tuple[bool, str | None]:
    """
    Check if a specific API version is deprecated.

    Args:
        version: API version string (e.g., "v1", "v2")

    Returns:
        Tuple of (is_deprecated, sunset_date)

    Example:
        is_deprecated, sunset_date = is_version_deprecated("v1")
        if is_deprecated:
            print(f"Version v1 will be sunset on {sunset_date}")
    """
    # Define deprecated versions and their sunset dates
    DEPRECATED_VERSIONS = {
        # "v1": "2025-12-31",  # Example: v1 deprecated, remove after Dec 31, 2025
        # Add deprecated versions here as new versions are released
    }

    sunset_date = DEPRECATED_VERSIONS.get(version)
    return (sunset_date is not None, sunset_date)


def get_successor_version(version: str) -> str | None:
    """
    Get the successor version for a deprecated API version.

    Args:
        version: API version string (e.g., "v1", "v2")

    Returns:
        Successor version string or None if no successor defined

    Example:
        successor = get_successor_version("v1")
        # Returns: "v2"
    """
    # Define version succession mapping
    VERSION_SUCCESSION = {
        # "v1": "v2",  # Example: v1 succeeded by v2
        # Add version mappings as new versions are released
    }

    return VERSION_SUCCESSION.get(version)


def auto_add_deprecation_if_needed(response: Response, version: str) -> None:
    """
    Automatically add deprecation headers if the requested version is deprecated.

    This is a convenience function that can be called from middleware or endpoints
    to automatically add deprecation headers based on the API version.

    Args:
        response: The FastAPI Response object
        version: API version string (e.g., "v1", "v2")

    Example:
        # In middleware or endpoint:
        auto_add_deprecation_if_needed(response, request.state.api_version)
    """
    is_deprecated, sunset_date = is_version_deprecated(version)

    if is_deprecated and sunset_date:
        successor_version = get_successor_version(version)
        successor_url = f"/api/{successor_version}" if successor_version else None

        add_deprecation_headers(
            response=response,
            sunset_date=sunset_date,
            successor=successor_url,
        )

        logger.info(
            "auto_deprecation_applied",
            version=version,
            sunset_date=sunset_date,
            successor_version=successor_version,
        )
