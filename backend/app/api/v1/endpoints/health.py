"""
Health check endpoints for Kubernetes liveness and readiness probes.

These endpoints provide different levels of health checks:
- /health: Comprehensive health check with all dependencies
- /health/live: Liveness probe (is the service alive?)
- /health/ready: Readiness probe (can the service handle traffic?)
"""

from datetime import datetime, timezone

import structlog
from fastapi import APIRouter, Depends, status
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db
from app.config.redis_config import RedisConfig
from app.core.config import settings

logger = structlog.get_logger(__name__)

router = APIRouter()


@router.get("/health")
async def health_check(db: AsyncSession = Depends(get_async_db)) -> JSONResponse:
    """
    Comprehensive health check with all dependencies.

    Returns 200 if healthy, 503 if any critical dependency is unhealthy.

    Response format:
    {
        "status": "healthy" | "degraded" | "unhealthy",
        "timestamp": "2025-11-21T10:30:00Z",
        "checks": {
            "database": "healthy" | "unhealthy",
            "redis": "healthy" | "degraded",
            "version": "0.1.0"
        }
    }
    """
    timestamp = datetime.now(timezone.utc).isoformat()
    checks = {"version": settings.VERSION}
    overall_status = "healthy"
    http_status = status.HTTP_200_OK

    # Check database connectivity
    try:
        await db.execute(text("SELECT 1"))
        checks["database"] = "healthy"
        logger.debug("health_check_database_success")
    except Exception as e:
        checks["database"] = "unhealthy"
        overall_status = "unhealthy"
        http_status = status.HTTP_503_SERVICE_UNAVAILABLE
        logger.error("health_check_database_failed", error=str(e))

    # Check Redis connectivity (if enabled)
    if settings.REDIS_ENABLED:
        try:
            redis_client = await RedisConfig.get_client()
            await redis_client.ping()
            checks["redis"] = "healthy"
            logger.debug("health_check_redis_success")
        except Exception as e:
            checks["redis"] = "degraded"
            # Redis failure doesn't make service unhealthy, just degraded
            if overall_status == "healthy":
                overall_status = "degraded"
            logger.warning("health_check_redis_failed", error=str(e))
    else:
        checks["redis"] = "disabled"

    response = {
        "status": overall_status,
        "timestamp": timestamp,
        "checks": checks,
    }

    return JSONResponse(content=response, status_code=http_status)


@router.get("/health/live")
async def liveness_probe() -> JSONResponse:
    """
    Liveness probe - checks if the service is alive.

    This endpoint checks if the FastAPI application is running and responsive.
    It does NOT check dependencies like database or Redis.

    Kubernetes uses this to determine if the pod should be restarted.

    Returns:
        200: Service is alive
        503: Service is not alive (will trigger pod restart)

    Response format:
    {
        "status": "healthy",
        "timestamp": "2025-11-21T10:30:00Z",
        "checks": {
            "service": "healthy",
            "version": "0.1.0"
        }
    }
    """
    timestamp = datetime.now(timezone.utc).isoformat()

    response = {
        "status": "healthy",
        "timestamp": timestamp,
        "checks": {
            "service": "healthy",
            "version": settings.VERSION,
        },
    }

    logger.debug("liveness_probe_success")
    return JSONResponse(content=response, status_code=status.HTTP_200_OK)


@router.get("/health/ready")
async def readiness_probe(db: AsyncSession = Depends(get_async_db)) -> JSONResponse:
    """
    Readiness probe - checks if the service can handle traffic.

    This endpoint checks if all critical dependencies are available:
    - Database connectivity
    - Redis connectivity (if enabled)

    Kubernetes uses this to determine if the pod should receive traffic.

    Returns:
        200: Service is ready to handle traffic
        503: Service is not ready (will be removed from load balancer)

    Response format:
    {
        "status": "healthy" | "unhealthy",
        "timestamp": "2025-11-21T10:30:00Z",
        "checks": {
            "database": "healthy" | "unhealthy",
            "redis": "healthy" | "degraded" | "disabled",
            "version": "0.1.0"
        }
    }
    """
    timestamp = datetime.now(timezone.utc).isoformat()
    checks = {"version": settings.VERSION}
    overall_status = "healthy"
    http_status = status.HTTP_200_OK

    # Check database connectivity (critical for readiness)
    try:
        await db.execute(text("SELECT 1"))
        checks["database"] = "healthy"
        logger.debug("readiness_probe_database_success")
    except Exception as e:
        checks["database"] = "unhealthy"
        overall_status = "unhealthy"
        http_status = status.HTTP_503_SERVICE_UNAVAILABLE
        logger.error("readiness_probe_database_failed", error=str(e))

    # Check Redis connectivity (if enabled)
    if settings.REDIS_ENABLED:
        try:
            redis_client = await RedisConfig.get_client()
            await redis_client.ping()
            checks["redis"] = "healthy"
            logger.debug("readiness_probe_redis_success")
        except Exception as e:
            checks["redis"] = "degraded"
            # Redis failure doesn't prevent readiness, but is noted
            logger.warning("readiness_probe_redis_degraded", error=str(e))
    else:
        checks["redis"] = "disabled"

    response = {
        "status": overall_status,
        "timestamp": timestamp,
        "checks": checks,
    }

    return JSONResponse(content=response, status_code=http_status)
