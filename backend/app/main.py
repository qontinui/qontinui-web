import time

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi.errors import RateLimitExceeded
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.v1.api import api_router
from app.config.logging_config import configure_logging, get_logger
from app.core.config import settings
from app.db.init_db import init_db
from app.db.session import AsyncSessionLocal
from app.middleware.database_timing import (
    DatabaseTimingMiddleware,
    init_database_timing,
)
from app.middleware.error_handler import (
    AppError,
    app_exception_handler,
    general_exception_handler,
    http_exception_handler,
    validation_exception_handler,
)
from app.middleware.metrics_middleware import MetricsMiddleware
from app.middleware.rate_limit import limiter, rate_limit_exceeded_handler
from app.middleware.request_id import RequestIDMiddleware
from app.middleware.security_headers import SecurityHeadersMiddleware
from app.middleware.sliding_window_session import SlidingWindowSessionMiddleware

# Configure structured logging
configure_logging(environment=settings.ENVIRONMENT)
logger = get_logger(__name__)

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    openapi_url=(
        f"{settings.API_V1_STR}/openapi.json"
        if settings.ENVIRONMENT == "development"
        else None
    ),
    docs_url="/docs" if settings.ENVIRONMENT == "development" else None,
    redoc_url="/redoc" if settings.ENVIRONMENT == "development" else None,
    redirect_slashes=False,  # Prevent 307 redirects that break proxy
)

# Add exception handlers
app.add_exception_handler(AppError, app_exception_handler)  # type: ignore
app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore
app.add_exception_handler(StarletteHTTPException, http_exception_handler)  # type: ignore
if settings.ENVIRONMENT == "development":
    app.add_exception_handler(Exception, general_exception_handler)

# Add rate limiting
if settings.RATE_LIMIT_ENABLED:
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)  # type: ignore

# Add trusted host middleware for production
# TEMPORARILY DISABLED: TrustedHostMiddleware blocks ELB health checks from internal IPs
# TODO: Re-enable with proper configuration after fixing health check Host headers
# if settings.ENVIRONMENT == "production":
#     app.add_middleware(
#         TrustedHostMiddleware,
#         allowed_hosts=[
#             "qontinui.io",
#             "www.qontinui.io",
#             "api.qontinui.io",  # API subdomain for backend
#             "qontinui.com",
#             "www.qontinui.com",
#             "app.qontinui.com",
#             "qontinui-prod-py.eba-km2u4s23.eu-central-1.elasticbeanstalk.com",  # ELB hostname
#             "*.elasticbeanstalk.com",  # ELB health checks
#         ],
#     )

# Set up CORS
# TEMPORARY FIX: Hardcode for production while debugging env var parsing
if settings.ENVIRONMENT == "production":
    origins = [
        "https://qontinui.io",
        "https://www.qontinui.io",
        "https://qontinui.com",
        "https://app.qontinui.com",
        "https://www.qontinui.com",
    ]
    logger.info(
        "Using hardcoded production CORS origins",
        origins=origins,
        environment=settings.ENVIRONMENT,
    )
elif settings.BACKEND_CORS_ORIGINS:
    # Convert AnyHttpUrl objects to strings and strip trailing slashes
    origins = [str(origin).rstrip("/") for origin in settings.BACKEND_CORS_ORIGINS]
    logger.info("Using CORS origins from settings", origins=origins)
else:
    origins = [
        "http://localhost:3001",
        "http://localhost:3000",
        "http://localhost:3002",
        "http://localhost:3003",
        "http://localhost:3004",
        "http://localhost:1420",  # qontinui-runner Tauri app
        "tauri://localhost",  # Tauri custom protocol
        "https://tauri.localhost",  # Tauri HTTPS protocol
        # Allow frontend on Windows to access WSL backend
        # Note: WSL IP may change, consider using localhost instead
        "http://172.27.67.252:3001",
        "http://172.27.67.252:3000",
        "http://172.24.89.15:3001",
        "http://172.24.89.15:3000",
    ]
    logger.info("Using development CORS origins", origins=origins)

# Add database query timing middleware (if enabled)
if settings.ENABLE_QUERY_LOGGING:
    app.add_middleware(DatabaseTimingMiddleware)
    logger.info(
        "database_timing_middleware_enabled",
        slow_query_threshold_ms=settings.SLOW_QUERY_THRESHOLD_MS,
        max_queries_per_request=settings.MAX_QUERIES_PER_REQUEST,
    )

# Add HTTP request logging middleware
from app.middleware.logging_middleware import LoggingMiddleware

app.add_middleware(LoggingMiddleware)
logger.info("http_request_logging_enabled")

# Add metrics tracking middleware
app.add_middleware(MetricsMiddleware)

# Add sliding window session middleware (before metrics for accurate activity tracking)
if settings.SLIDING_WINDOW_ENABLED:
    app.add_middleware(SlidingWindowSessionMiddleware)
    logger.info(
        "sliding_window_session_enabled",
        threshold_minutes=settings.SLIDING_WINDOW_THRESHOLD_MINUTES,
    )

# Add request ID tracking middleware (should be first for proper context binding)
app.add_middleware(RequestIDMiddleware)

# Add security headers middleware (executes after CORS in request flow)
app.add_middleware(SecurityHeadersMiddleware)
logger.info("security_headers_middleware_enabled", environment=settings.ENVIRONMENT)

# CORS middleware must be added LAST so it executes FIRST (middleware order is reversed)
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["*"],
    expose_headers=[
        "X-Total-Count",
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
        "X-RateLimit-Reset",
        "X-Request-ID",
    ],
)

app.include_router(api_router, prefix=settings.API_V1_STR)

# Mount static files for avatars
from pathlib import Path

uploads_dir = Path("uploads")
uploads_dir.mkdir(exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")


@app.on_event("startup")
async def startup_event():
    logger.info(
        "application_starting",
        version=settings.VERSION,
        environment=settings.ENVIRONMENT,
        project=settings.PROJECT_NAME,
    )

    # Initialize Sentry for error tracking
    import os

    from app.core.sentry_config import configure_sentry

    sentry_dsn = os.getenv("SENTRY_DSN")
    if sentry_dsn:
        configure_sentry(
            dsn=sentry_dsn,
            environment=settings.ENVIRONMENT,
            release=f"qontinui-backend@{settings.VERSION}",
            traces_sample_rate=0.1 if settings.ENVIRONMENT == "production" else 0.0,
            profiles_sample_rate=0.1 if settings.ENVIRONMENT == "production" else 0.0,
        )
        logger.info("sentry_configured", environment=settings.ENVIRONMENT)
    else:
        logger.info("sentry_not_configured", reason="SENTRY_DSN not set")

    # Initialize Redis connection (optional)
    if settings.REDIS_ENABLED:
        try:
            from app.config.redis_config import RedisConfig

            await RedisConfig.get_client()
            logger.info("redis_initialized", status="connected")
        except Exception as e:
            logger.warning(
                "redis_initialization_failed",
                error=str(e),
                note="Continuing without Redis",
            )
    else:
        logger.info("redis_disabled", note="Redis is disabled via configuration")

    # Initialize database
    try:
        async with AsyncSessionLocal() as db:
            await init_db(db)
        logger.info("database_initialized", status="success")
    except Exception as e:
        logger.error(
            "database_initialization_failed",
            error=str(e),
            error_type=type(e).__name__,
            exc_info=True,
        )
        # Re-raise to prevent app from starting with broken DB
        raise

    # Initialize database query timing
    if settings.ENABLE_QUERY_LOGGING:
        from app.db.session import async_engine, sync_engine

        init_database_timing(async_engine, sync_engine)

    # Initialize ARQ connection pool (optional, requires Redis)
    if settings.REDIS_ENABLED:
        try:
            from app.worker.arq_pool import get_arq_pool

            await get_arq_pool()
            logger.info("arq_pool_initialized", status="connected")
        except Exception as e:
            logger.warning(
                "arq_initialization_failed",
                error=str(e),
                note="Continuing without task queue",
            )
    else:
        logger.info("arq_pool_disabled", note="Task queue disabled (Redis not enabled)")


@app.on_event("shutdown")
async def shutdown_event():
    logger.info("application_shutting_down")

    # Close Redis connection
    if settings.REDIS_ENABLED:
        try:
            from app.config.redis_config import RedisConfig

            await RedisConfig.close()
            logger.info("redis_closed")
        except Exception as e:
            logger.warning("redis_close_error", error=str(e))

        # Close ARQ connection pool
        try:
            from app.worker.arq_pool import close_arq_pool

            await close_arq_pool()
            logger.info("arq_pool_closed")
        except Exception as e:
            logger.warning("arq_close_error", error=str(e))

    # Flush any pending metrics before shutdown
    from app.db.session import AsyncSessionLocal
    from app.services.metrics_service import metrics_service

    if AsyncSessionLocal is not None:
        async with AsyncSessionLocal() as db:
            try:
                await metrics_service.force_flush(db)
                logger.info("metrics_flushed")
            except Exception as e:
                logger.error("error_flushing_metrics", error=str(e))


@app.get("/")
def root():
    return {"message": "Qontinui API", "version": settings.VERSION}


@app.get("/health")
async def health_check():
    """Health check endpoint with database connectivity check"""
    health_status = {
        "status": "healthy",
        "timestamp": time.time(),
        "version": settings.VERSION,
        "environment": settings.ENVIRONMENT,
    }

    # Check async database connectivity
    try:
        from sqlalchemy import text

        from app.db.session import AsyncSessionLocal

        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
        health_status["database"] = "connected"
        health_status["database_driver"] = "asyncpg"
        logger.debug("health_check_success", database="connected", driver="asyncpg")
    except Exception as e:
        health_status["status"] = "degraded"
        health_status["database"] = f"error: {str(e)}"
        logger.error("health_check_database_error", error=str(e))

    # Check Redis connectivity (if enabled)
    if settings.REDIS_ENABLED:
        try:
            from app.config.redis_config import RedisConfig

            redis_client = await RedisConfig.get_client()
            await redis_client.ping()
            health_status["redis"] = "connected"
            logger.debug("health_check_redis_success")
        except Exception as e:
            health_status["redis"] = f"error: {str(e)}"
            logger.warning("health_check_redis_error", error=str(e))
    else:
        health_status["redis"] = "disabled"

    return health_status


@app.get("/favicon.ico")
async def favicon():
    """Return 204 No Content for favicon requests"""
    from fastapi.responses import Response

    return Response(status_code=204)
