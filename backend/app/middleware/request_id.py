"""
Request ID middleware for request tracing with structlog.

Adds a unique request ID to each request and binds it to the structlog context.
This allows tracking requests through their entire lifecycle across logs.
"""

import uuid
from collections.abc import Callable

import structlog
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

logger = structlog.get_logger(__name__)


class RequestIDMiddleware(BaseHTTPMiddleware):
    """
    Middleware to add unique request IDs to each request for distributed tracing.

    Features:
    - Generates unique request ID for each request
    - Accepts request ID from X-Request-ID header if provided
    - Binds request ID to structlog context for all logs in that request
    - Adds request ID to response headers
    - Clears context after request to prevent leakage
    """

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Get or generate request ID
        request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))

        # Clear any existing context vars from previous requests
        structlog.contextvars.clear_contextvars()

        # Bind request metadata to structlog context
        structlog.contextvars.bind_contextvars(
            request_id=request_id,
            method=request.method,
            path=request.url.path,
            client_host=request.client.host if request.client else None,
        )

        # Store request ID in request state for access in endpoints
        request.state.request_id = request_id

        # Log the request
        logger.info(
            "request_started",
            query_params=dict(request.query_params) if request.query_params else None,
        )

        # Process the request
        try:
            response = await call_next(request)
        except Exception as e:
            logger.exception(
                "request_failed", error=str(e), error_type=type(e).__name__
            )
            raise
        finally:
            # Clear context after request to prevent leakage to next request
            structlog.contextvars.clear_contextvars()

        # Add request ID to response headers
        response.headers["X-Request-ID"] = request_id

        # Log the response (rebind context since we cleared it)
        structlog.contextvars.bind_contextvars(request_id=request_id)
        logger.info("request_completed", status_code=response.status_code)
        structlog.contextvars.clear_contextvars()

        return response  # type: ignore[no-any-return]
