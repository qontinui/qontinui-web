"""
Structured logging configuration using structlog.

This module sets up structured JSON logging for production environments
and human-readable console logging for development.

Features:
- JSON formatted logs in production
- Pretty console logs in development
- Correlation IDs for request tracking
- Integration with Sentry for error tracking
"""

import logging
import sys

import structlog


def configure_logging(environment: str = "development") -> None:
    """
    Configure structlog for the application.

    Args:
        environment: "development" or "production"
    """

    # Shared processors for all environments
    shared_processors = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
    ]

    if environment == "production":
        # Production: JSON output for log aggregation
        processors = shared_processors + [structlog.processors.JSONRenderer()]
    else:
        # Development: Pretty console output
        processors = shared_processors + [structlog.dev.ConsoleRenderer(colors=True)]

    # Configure structlog
    structlog.configure(
        processors=processors,
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    # Configure standard logging
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=logging.INFO,
    )


def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    """
    Get a structured logger instance.

    Args:
        name: Logger name (typically __name__)

    Returns:
        Configured structlog logger

    Usage:
        logger = get_logger(__name__)
        logger.info("user_login", user_id=123, ip_address="1.2.3.4")
    """
    return structlog.get_logger(name)


# Example middleware for adding correlation IDs
"""
from starlette.middleware.base import BaseHTTPMiddleware
import uuid

class CorrelationIDMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        # Get or generate correlation ID
        correlation_id = request.headers.get("X-Correlation-ID", str(uuid.uuid4()))

        # Add to structlog context
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(
            correlation_id=correlation_id,
            path=request.url.path,
            method=request.method,
        )

        # Add to response headers
        response = await call_next(request)
        response.headers["X-Correlation-ID"] = correlation_id

        return response

# Add to FastAPI app:
# app.add_middleware(CorrelationIDMiddleware)
"""


# Example Sentry integration
"""
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

def configure_sentry(dsn: str, environment: str):
    sentry_sdk.init(
        dsn=dsn,
        environment=environment,
        integrations=[
            FastApiIntegration(),
            SqlalchemyIntegration(),
        ],
        traces_sample_rate=1.0 if environment == "development" else 0.1,
        profiles_sample_rate=1.0 if environment == "development" else 0.1,
    )
"""


# Usage examples
if __name__ == "__main__":
    # Configure logging
    configure_logging("development")

    # Get logger
    logger = get_logger(__name__)

    # Log with structured data
    logger.info("application_started", version="1.0.0")
    logger.warning("high_memory_usage", memory_mb=1024, threshold_mb=800)
    logger.error("database_connection_failed", host="localhost", port=5432)

    # Log with exception
    try:
        raise ValueError("Example error")
    except Exception as e:
        logger.exception("error_processing_request", error=str(e))
