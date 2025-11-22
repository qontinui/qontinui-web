"""
Sentry Configuration

Integrates Sentry for error tracking and performance monitoring.
Free tier: 5,000 events/month

Features:
- Automatic error tracking with stack traces
- Performance monitoring (10% sample rate)
- User context tracking
- Release tracking
- Breadcrumbs for debugging
"""

import os
from typing import Any

import structlog

logger = structlog.get_logger(__name__)


def configure_sentry(
    dsn: str | None = None,
    environment: str = "development",
    release: str | None = None,
    traces_sample_rate: float = 0.1,
    profiles_sample_rate: float = 0.1,
):
    """
    Configure Sentry for error tracking and APM

    Args:
        dsn: Sentry DSN (Data Source Name)
        environment: Environment name (development, staging, production)
        release: Release version (e.g., "qontinui-web@1.0.0")
        traces_sample_rate: % of transactions to trace (0.1 = 10%)
        profiles_sample_rate: % of transactions to profile (0.1 = 10%)
    """
    # Skip Sentry in tests
    if os.getenv("TESTING") == "1":
        logger.info("sentry_disabled", reason="testing mode")
        return

    # Skip if no DSN provided
    if not dsn:
        logger.warning(
            "sentry_not_configured",
            reason="SENTRY_DSN not set",
            message="Set SENTRY_DSN environment variable to enable error tracking",
        )
        return

    try:
        import sentry_sdk
        from sentry_sdk.integrations.asyncio import AsyncioIntegration
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.logging import LoggingIntegration
        from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

        # Logging integration (capture ERROR and CRITICAL logs)
        logging_integration = LoggingIntegration(
            level=None,  # Don't capture logs as breadcrumbs
            event_level="ERROR",  # Capture ERROR and CRITICAL as events
        )

        sentry_sdk.init(
            dsn=dsn,
            environment=environment,
            release=release,
            # Integrations
            integrations=[
                FastApiIntegration(transaction_style="endpoint"),
                SqlalchemyIntegration(),
                AsyncioIntegration(),
                logging_integration,
            ],
            # Performance monitoring
            traces_sample_rate=traces_sample_rate,
            profiles_sample_rate=profiles_sample_rate,
            # Privacy
            send_default_pii=False,  # Don't send user data automatically
            # Filtering
            before_send=before_send_filter,
            before_breadcrumb=before_breadcrumb_filter,
            # Debug
            debug=environment == "development",
        )

        logger.info(
            "sentry_initialized",
            environment=environment,
            release=release,
            traces_sample_rate=traces_sample_rate,
        )

    except ImportError:
        logger.warning(
            "sentry_not_installed",
            message="Install with: pip install sentry-sdk[fastapi]",
        )


def before_send_filter(
    event: dict[str, Any], hint: dict[str, Any]
) -> dict[str, Any] | None:
    """
    Filter events before sending to Sentry

    Args:
        event: Sentry event dict
        hint: Additional context about the event

    Returns:
        Filtered event or None to drop the event
    """
    # Don't send health check errors
    if event.get("request", {}).get("url", "").endswith("/health"):
        return None

    # Don't send 404 errors (client-side issues)
    if event.get("exception"):
        for exception in event["exception"].get("values", []):
            if "404" in str(exception.get("value", "")):
                return None

    # Don't send rate limit errors (expected behavior)
    if event.get("exception"):
        for exception in event["exception"].get("values", []):
            if "rate limit" in str(exception.get("value", "")).lower():
                return None

    return event


def before_breadcrumb_filter(
    crumb: dict[str, Any], hint: dict[str, Any]
) -> dict[str, Any] | None:
    """
    Filter breadcrumbs before adding to Sentry

    Args:
        crumb: Breadcrumb dict
        hint: Additional context about the breadcrumb

    Returns:
        Filtered breadcrumb or None to drop it
    """
    # Don't track query parameters in URLs (may contain sensitive data)
    if crumb.get("category") == "httplib" and "?" in crumb.get("data", {}).get(
        "url", ""
    ):
        url = crumb["data"]["url"]
        crumb["data"]["url"] = url.split("?")[0] + "?<filtered>"

    return crumb


def set_user_context(user_id: str, email: str | None = None, **extra_context):
    """
    Set user context for Sentry events

    Args:
        user_id: User ID
        email: User email (optional)
        **extra_context: Additional user context
    """
    try:
        import sentry_sdk

        sentry_sdk.set_user({"id": user_id, "email": email, **extra_context})
    except ImportError:
        pass


def clear_user_context():
    """Clear user context (e.g., on logout)"""
    try:
        import sentry_sdk

        sentry_sdk.set_user(None)
    except ImportError:
        pass


def capture_exception(exception: Exception, **extra_context):
    """
    Manually capture an exception to Sentry

    Args:
        exception: Exception to capture
        **extra_context: Additional context to attach
    """
    try:
        import sentry_sdk

        with sentry_sdk.push_scope() as scope:
            for key, value in extra_context.items():
                scope.set_extra(key, value)
            sentry_sdk.capture_exception(exception)

    except ImportError:
        logger.error(
            "sentry_capture_failed",
            error=str(exception),
            reason="sentry-sdk not installed",
        )


def capture_message(message: str, level: str = "info", **extra_context):
    """
    Manually capture a message to Sentry

    Args:
        message: Message to capture
        level: Severity level (debug, info, warning, error, fatal)
        **extra_context: Additional context to attach
    """
    try:
        import sentry_sdk

        with sentry_sdk.push_scope() as scope:
            for key, value in extra_context.items():
                scope.set_extra(key, value)
            sentry_sdk.capture_message(message, level=level)

    except ImportError:
        logger.warning(
            "sentry_capture_failed", message=message, reason="sentry-sdk not installed"
        )
