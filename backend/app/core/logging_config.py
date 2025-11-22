"""
Structured Logging Configuration

Configures structured JSON logging for CloudWatch Logs Insights compatibility.
Uses structlog for structured logging with JSON output.

Features:
- JSON formatted logs for CloudWatch Logs Insights
- Automatic request ID tracking
- Performance metrics (duration, status code)
- Security event logging
- Error tracking with stack traces
"""

import logging
import sys
from typing import Any

import structlog
from structlog.types import EventDict, Processor


def add_app_context(logger: Any, method_name: str, event_dict: EventDict) -> EventDict:
    """Add application context to log events"""
    event_dict["application"] = "qontinui-web"
    event_dict["environment"] = "production"  # Override from env var in production
    return event_dict


def add_log_level_number(
    logger: Any, method_name: str, event_dict: EventDict
) -> EventDict:
    """Add numeric log level for filtering"""
    level_mapping = {
        "debug": 10,
        "info": 20,
        "warning": 30,
        "error": 40,
        "critical": 50,
    }
    if "level" in event_dict:
        event_dict["level_num"] = level_mapping.get(event_dict["level"], 0)
    return event_dict


def censor_sensitive_data(
    logger: Any, method_name: str, event_dict: EventDict
) -> EventDict:
    """Censor sensitive data from logs"""
    sensitive_keys = [
        "password",
        "secret",
        "token",
        "api_key",
        "access_key",
        "private_key",
        "jwt",
        "authorization",
    ]

    def _censor_dict(d: dict) -> dict:
        """Recursively censor sensitive keys"""
        censored = {}
        for key, value in d.items():
            if any(sensitive in key.lower() for sensitive in sensitive_keys):
                censored[key] = "***REDACTED***"
            elif isinstance(value, dict):
                censored[key] = _censor_dict(value)
            elif isinstance(value, list):
                censored[key] = [
                    _censor_dict(item) if isinstance(item, dict) else item
                    for item in value
                ]
            else:
                censored[key] = value
        return censored

    return _censor_dict(event_dict)


def configure_logging(environment: str = "development", log_level: str = "INFO"):
    """
    Configure structured logging for the application

    Args:
        environment: Environment name (development, staging, production)
        log_level: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
    """
    log_level = getattr(logging, log_level.upper(), logging.INFO)

    # Configure standard library logging
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=log_level,
    )

    # Silence noisy loggers
    logging.getLogger("boto3").setLevel(logging.WARNING)
    logging.getLogger("botocore").setLevel(logging.WARNING)
    logging.getLogger("s3transfer").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)

    # Structlog processors
    processors: list[Processor] = [
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        add_app_context,
        add_log_level_number,
        censor_sensitive_data,
        structlog.processors.UnicodeDecoder(),
    ]

    # Use JSON renderer for production, console for development
    if environment == "production":
        processors.append(structlog.processors.JSONRenderer())
    else:
        processors.append(
            structlog.dev.ConsoleRenderer(
                colors=True,
                exception_formatter=structlog.dev.plain_traceback,
            )
        )

    structlog.configure(
        processors=processors,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )


# Convenience logger instance
logger = structlog.get_logger()


# Example usage functions for common log patterns
def log_request(
    method: str,
    path: str,
    status_code: int,
    duration_ms: float,
    user_id: str | None = None,
    ip_address: str | None = None,
):
    """Log HTTP request with performance metrics"""
    logger.info(
        "http_request",
        method=method,
        path=path,
        status_code=status_code,
        duration_ms=round(duration_ms, 2),
        user_id=user_id,
        ip_address=ip_address,
    )


def log_security_event(
    event_type: str,
    user_id: str | None = None,
    email: str | None = None,
    ip_address: str | None = None,
    success: bool = True,
    reason: str | None = None,
):
    """Log security-related events (login, logout, permission denied, etc.)"""
    logger.info(
        "security_event",
        event_type=event_type,
        user_id=user_id,
        email=email,
        ip_address=ip_address,
        success=success,
        reason=reason,
    )


def log_database_query(
    query_type: str,
    table: str,
    duration_ms: float,
    row_count: int | None = None,
):
    """Log slow database queries"""
    logger.info(
        "database_query",
        query_type=query_type,
        table=table,
        duration_ms=round(duration_ms, 2),
        row_count=row_count,
    )


def log_error(
    error_type: str,
    message: str,
    user_id: str | None = None,
    traceback: str | None = None,
    **extra_context,
):
    """Log application errors with context"""
    logger.error(
        "application_error",
        error_type=error_type,
        message=message,
        user_id=user_id,
        traceback=traceback,
        **extra_context,
    )


def log_background_job(
    job_name: str,
    status: str,
    duration_ms: float | None = None,
    records_processed: int | None = None,
    error: str | None = None,
):
    """Log background job execution"""
    logger.info(
        "background_job",
        job_name=job_name,
        status=status,
        duration_ms=round(duration_ms, 2) if duration_ms else None,
        records_processed=records_processed,
        error=error,
    )


def log_external_api_call(
    service: str,
    endpoint: str,
    method: str,
    status_code: int | None,
    duration_ms: float,
    error: str | None = None,
):
    """Log external API calls (S3, SES, Stripe, etc.)"""
    logger.info(
        "external_api_call",
        service=service,
        endpoint=endpoint,
        method=method,
        status_code=status_code,
        duration_ms=round(duration_ms, 2),
        error=error,
    )
