"""
Logging Middleware

Automatically logs all HTTP requests with performance metrics and context.
Integrates with structlog for structured JSON logging.
Writes velocity JSONL entries for response time analysis.
"""

import json
import time
from collections.abc import Callable
from datetime import datetime, UTC
from pathlib import Path

import structlog
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from app.core.logging_helpers import log_error, log_request

logger = structlog.get_logger(__name__)

# Velocity JSONL output path
_VELOCITY_JSONL_PATH: Path | None = None
_VELOCITY_FILE = None


def _get_velocity_file():
    """Lazily open the velocity JSONL file for appending."""
    global _VELOCITY_JSONL_PATH, _VELOCITY_FILE
    if _VELOCITY_FILE is not None:
        return _VELOCITY_FILE

    # Resolve .dev-logs/ relative to the project parent directory
    dev_logs_dir = Path(__file__).resolve().parents[4] / ".dev-logs"
    dev_logs_dir.mkdir(parents=True, exist_ok=True)
    _VELOCITY_JSONL_PATH = dev_logs_dir / "backend-velocity.jsonl"

    try:
        _VELOCITY_FILE = open(_VELOCITY_JSONL_PATH, "a", encoding="utf-8")
    except OSError:
        pass
    return _VELOCITY_FILE


def _write_velocity_entry(entry: dict) -> None:
    """Write a velocity entry to the JSONL file."""
    f = _get_velocity_file()
    if f is None:
        return
    try:
        f.write(json.dumps(entry, default=str) + "\n")
        f.flush()
    except OSError:
        pass


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
        start_dt = datetime.now(UTC)

        # Extract request context
        method = request.method
        path = request.url.path
        ip_address = self._get_client_ip(request)
        request_id = request.headers.get("X-Request-ID", "")

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

            # Write velocity JSONL entry
            end_dt = datetime.now(UTC)
            _write_velocity_entry(
                {
                    "service": "backend",
                    "name": "HTTP request",
                    "start_ts": start_dt.isoformat(),
                    "end_ts": end_dt.isoformat(),
                    "duration_ms": round(duration_ms, 2),
                    "attributes": {
                        "http.method": method,
                        "http.route": path,
                        "http.status_code": status_code,
                        "request_id": request_id,
                    },
                    "success": status_code < 500,
                }
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

            # Write velocity JSONL entry for errors
            end_dt = datetime.now(UTC)
            _write_velocity_entry(
                {
                    "service": "backend",
                    "name": "HTTP request",
                    "start_ts": start_dt.isoformat(),
                    "end_ts": end_dt.isoformat(),
                    "duration_ms": round(duration_ms, 2),
                    "attributes": {
                        "http.method": method,
                        "http.route": path,
                        "http.status_code": 500,
                        "request_id": request_id,
                    },
                    "success": False,
                    "error": f"{type(e).__name__}: {e}",
                }
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
