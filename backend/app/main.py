import sys
import time

print("STARTUP LOG: Importing FastAPI modules...", file=sys.stderr, flush=True)

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi.errors import RateLimitExceeded
from starlette.exceptions import HTTPException as StarletteHTTPException

print("STARTUP LOG: Importing app modules...", file=sys.stderr, flush=True)

from app.api.v1.api import api_router
from app.config.logging_config import configure_logging, get_logger
from app.core.config import settings

print(
    f"STARTUP LOG: Settings loaded, environment={settings.ENVIRONMENT}",
    file=sys.stderr,
    flush=True,
)

from app.db.init_db import init_db
from app.db.session import SessionLocal

print("STARTUP LOG: Database modules imported", file=sys.stderr, flush=True)

from app.middleware.error_handler import (
    AppError,
    app_exception_handler,
    general_exception_handler,
    http_exception_handler,
    validation_exception_handler,
)
from app.middleware.metrics_middleware import MetricsMiddleware
from app.middleware.rate_limit import limiter, rate_limit_exceeded_handler

print("STARTUP LOG: Middleware modules imported", file=sys.stderr, flush=True)

# Configure structured logging
configure_logging(environment=settings.ENVIRONMENT)
logger = get_logger(__name__)

print("STARTUP LOG: Logging configured", file=sys.stderr, flush=True)

print("STARTUP LOG: Creating FastAPI app...", file=sys.stderr, flush=True)

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
)

print("STARTUP LOG: FastAPI app created", file=sys.stderr, flush=True)

# Add exception handlers
app.add_exception_handler(AppError, app_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)
app.add_exception_handler(StarletteHTTPException, http_exception_handler)
if settings.ENVIRONMENT == "development":
    app.add_exception_handler(Exception, general_exception_handler)

# Add rate limiting
if settings.RATE_LIMIT_ENABLED:
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)

# Add trusted host middleware for production
if settings.ENVIRONMENT == "production":
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=[
            "qontinui.com",
            "*.qontinui.com",
            "localhost",
            "*.elasticbeanstalk.com",
        ],
    )

# Set up CORS
origins = [
    "http://localhost:3001",
    "http://localhost:3000",
    "http://localhost:3002",
    "http://localhost:3003",
    "http://localhost:3004",
]

if settings.ENVIRONMENT == "production":
    origins = [
        "https://qontinui.com",
        "https://app.qontinui.com",
        "https://www.qontinui.com",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=[
        "X-Total-Count",
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
        "X-RateLimit-Reset",
    ],
)

# Add metrics tracking middleware
app.add_middleware(MetricsMiddleware)

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

    logger.info("startup_step_1", note="Starting database initialization")

    # Initialize database
    try:
        logger.info("startup_step_2", note="Creating SessionLocal")
        db = SessionLocal()
        logger.info("startup_step_3", note="SessionLocal created, calling init_db")
        init_db(db)
        logger.info("startup_step_4", note="init_db completed, closing session")
        db.close()
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

    logger.info("startup_step_5", note="Startup event completed successfully")


@app.on_event("shutdown")
async def shutdown_event():
    logger.info("application_shutting_down")

    # Close Redis connection
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

        if AsyncSessionLocal is not None:
            async with AsyncSessionLocal() as session:
                await session.execute(text("SELECT 1"))
            health_status["database"] = "connected"
            health_status["database_driver"] = "asyncpg"
            logger.debug("health_check_success", database="connected", driver="asyncpg")
        else:
            # Fall back to sync engine for SQLite
            db = SessionLocal()
            db.execute(text("SELECT 1"))
            db.close()
            health_status["database"] = "connected"
            health_status["database_driver"] = "sync (SQLite)"
            logger.debug("health_check_success", database="connected", driver="sync")
    except Exception as e:
        health_status["status"] = "degraded"
        health_status["database"] = f"error: {str(e)}"
        logger.error("health_check_database_error", error=str(e))

    # Check Redis connectivity
    try:
        from app.config.redis_config import RedisConfig

        redis_client = await RedisConfig.get_client()
        await redis_client.ping()
        health_status["redis"] = "connected"
        logger.debug("health_check_redis_success")
    except Exception as e:
        health_status["redis"] = f"error: {str(e)}"
        logger.warning("health_check_redis_error", error=str(e))

    return health_status


@app.get("/favicon.ico")
async def favicon():
    """Return 204 No Content for favicon requests"""
    from fastapi.responses import Response

    return Response(status_code=204)


print("STARTUP LOG: main.py module loaded successfully", file=sys.stderr, flush=True)
