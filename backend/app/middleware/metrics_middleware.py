import time
from collections.abc import Callable
from uuid import UUID

import structlog
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.db_pool_metrics import observe_async_engine_pool
from app.db.session import AsyncSessionLocal
from app.services.metrics_service import metrics_service

logger = structlog.get_logger(__name__)


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
        # Sample DB pool occupancy on EVERY request — before the exclusion
        # early-return below (whose "/" startswith-entry matches every path,
        # so nothing after it ever runs) and before call_next, so saturation
        # is observed while load is applied rather than after stalled
        # requests finish their up-to-30s pool wait. Emits a debounced
        # db_pool_high_occupancy WARNING when the pool runs hot (>70% of
        # size + max_overflow) — the early signal before checkout timeouts
        # start surfacing as 503s. Observability must never fail a request.
        try:
            observe_async_engine_pool()
        except Exception as e:  # noqa: BLE001 - best-effort observability
            logger.debug(
                "db_pool_observe_failed", error=str(e), error_type=type(e).__name__
            )

        # Skip metrics for excluded paths
        if any(request.url.path.startswith(path) for path in self.EXCLUDED_PATHS):
            response: Response = await call_next(request)
            return response

        # Record start time
        start_time = time.time()

        # Process the request
        response = await call_next(request)

        # Calculate response time
        response_time = time.time() - start_time

        # Try to get user ID from request state (set by auth dependency).
        # The legacy local-HS256 ``decode_token`` Authorization-header
        # fallback was removed with the local token stack — Cognito tokens
        # are not locally decodable, and authenticated routes already set
        # ``request.state.user``.
        user_id: UUID | None = None
        if hasattr(request.state, "user"):
            user_id = getattr(request.state.user, "id", None)

        # Only track metrics for authenticated users
        if user_id:
            try:
                async with AsyncSessionLocal() as db:
                    await metrics_service.track_api_call(
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
            except Exception as e:
                logger.error(
                    "metrics_tracking_failed", error=str(e), error_type=type(e).__name__
                )

        return response
