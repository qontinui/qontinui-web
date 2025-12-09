"""
Logging Middleware

Automatically logs all HTTP requests with performance metrics and context.
Integrates with structlog for structured JSON logging.
"""

import time
from collections.abc import Callable

import structlog
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from app.core.logging_helpers import log_error, log_request

logger = structlog.get_logger(__name__)


class LoggingMiddleware(BaseHTTPMiddleware):
    """
    Middleware to log all HTTP requests and responses with performance metrics

    Logs:
    - Request method, path, query params
    - Response status code
    - Request duration
    - User ID (if authenticated)
    - IP address
    - Errors and exceptions
    """

    def __init__(self, app: ASGIApp):
        super().__init__(app)

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Start timer
        start_time = time.time()

        # Extract request context
        method = request.method
        path = request.url.path
        str(request.url.query) if request.url.query else None
        ip_address = self._get_client_ip(request)

        # Skip health check logging (too noisy)
        if path == "/health":
            return await call_next(request)  # type: ignore[no-any-return]

        # Get user ID if authenticated
        user_id = None
        try:
            if hasattr(request.state, "user") and request.state.user:
                user_id = str(request.state.user.id)
        except Exception:
            pass

        # Process request
        try:
            response = await call_next(request)
            status_code = response.status_code
            duration_ms = (time.time() - start_time) * 1000

            # Log request
            log_request(
                method=method,
                path=path,
                status_code=status_code,
                duration_ms=duration_ms,
                user_id=user_id,
                ip_address=ip_address,
            )

            # Log slow requests (>1 second)
            if duration_ms > 1000:
                logger.warning(
                    "slow_request",
                    method=method,
                    path=path,
                    duration_ms=round(duration_ms, 2),
                    user_id=user_id,
                )

            return response  # type: ignore[no-any-return]

        except Exception as e:
            duration_ms = (time.time() - start_time) * 1000

            # Log error
            log_error(
                error_type=type(e).__name__,
                message=str(e),
                user_id=user_id,
                method=method,
                path=path,
                duration_ms=duration_ms,
                ip_address=ip_address,
            )

            # Re-raise to let FastAPI's exception handlers deal with it
            raise

    def _get_client_ip(self, request: Request) -> str:
        """Extract client IP address from request, handling proxies"""
        # Check X-Forwarded-For header (set by ALB/proxies)
        forwarded_for = request.headers.get("X-Forwarded-For")
        if forwarded_for:
            # Take the first IP (client IP)
            return forwarded_for.split(",")[0].strip()

        # Check X-Real-IP header
        real_ip = request.headers.get("X-Real-IP")
        if real_ip:
            return real_ip

        # Fallback to direct client IP
        if request.client:
            return request.client.host

        return "unknown"
