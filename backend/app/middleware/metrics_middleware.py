import logging
import time
from collections.abc import Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from app.db.session import SessionLocal
from app.services.metrics_service import metrics_service

logger = logging.getLogger(__name__)


class MetricsMiddleware(BaseHTTPMiddleware):
    """Middleware to track API calls and response times for authenticated users"""

    EXCLUDED_PATHS = [
        "/health",
        "/docs",
        "/redoc",
        "/openapi.json",
        "/",
    ]

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Skip metrics for excluded paths
        if any(request.url.path.startswith(path) for path in self.EXCLUDED_PATHS):
            return await call_next(request)

        # Record start time
        start_time = time.time()

        # Process the request
        response = await call_next(request)

        # Calculate response time
        response_time = time.time() - start_time

        # Try to get user ID from request state (set by auth dependency)
        user_id = None
        if hasattr(request.state, "user"):
            user_id = getattr(request.state.user, "id", None)

        # Alternative: Try to extract from Authorization header if needed
        if user_id is None:
            auth_header = request.headers.get("authorization")
            if auth_header and auth_header.startswith("Bearer "):
                try:
                    from app.core.security import decode_token

                    token = auth_header.replace("Bearer ", "")
                    payload = decode_token(token)
                    if payload:
                        user_id = int(payload.get("sub"))
                except Exception as e:
                    logger.debug(f"Could not extract user_id from token: {e}")

        # Only track metrics for authenticated users
        if user_id:
            try:
                db = SessionLocal()
                try:
                    metrics_service.track_api_call(
                        db=db,
                        user_id=user_id,
                        endpoint=request.url.path,
                        method=request.method,
                        response_time=response_time,
                        status_code=response.status_code,
                        metadata={
                            "query_params": dict(request.query_params),
                            "user_agent": request.headers.get("user-agent"),
                        },
                    )
                finally:
                    db.close()
            except Exception as e:
                logger.error(f"Error tracking API call metric: {e}")

        return response
