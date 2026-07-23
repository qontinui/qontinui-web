import time
import traceback
from typing import Any

import structlog
from fastapi import HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import TimeoutError as SQLAlchemyTimeoutError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.config import settings
from app.core.error_codes import ErrorCode, get_default_error_code

logger = structlog.get_logger(__name__)


class AppError(Exception):
    """Base application exception with standardized error codes"""

    def __init__(
        self,
        status_code: int,
        detail: str,
        error_code: ErrorCode | str | None = None,
        metadata: dict | None = None,
    ):
        self.status_code = status_code
        self.detail = detail
        # If error_code is provided, use it; otherwise infer from status_code
        if error_code:
            self.error_code = (
                error_code if isinstance(error_code, str) else error_code.value
            )
        else:
            self.error_code = get_default_error_code(status_code).value
        self.metadata = metadata or {}
        super().__init__(self.detail)


async def app_exception_handler(request: Request, exc: AppError):
    """Handle application exceptions with standardized format"""
    content = {
        "error": exc.error_code,
        "message": exc.detail,
        "timestamp": time.time(),
        "path": str(request.url),
    }
    # Add metadata if present
    if exc.metadata:
        content.update(exc.metadata)

    return JSONResponse(
        status_code=exc.status_code,
        content=content,
    )


async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Handle validation errors with standardized format"""
    errors = []
    for error in exc.errors():
        errors.append(
            {
                "field": ".".join(str(loc) for loc in error["loc"]),
                "message": error["msg"],
                "type": error["type"],
            }
        )

    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "error": ErrorCode.VALIDATION_ERROR.value,
            "message": "Invalid request data",
            "details": errors,
            "timestamp": time.time(),
            "path": str(request.url),
        },
    )


async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    """Handle HTTP exceptions with standardized format"""
    # If detail is a dict with error code, use it; otherwise infer from status
    # Note: exc.detail is typed as str | None but can be dict at runtime
    detail_value: Any = exc.detail
    if isinstance(detail_value, dict) and "error" in detail_value:
        error_code = detail_value["error"]
        message = detail_value.get("message", str(detail_value))
        metadata: dict[str, Any] = {
            k: v for k, v in detail_value.items() if k not in ["error", "message"]
        }
    else:
        error_code = get_default_error_code(exc.status_code).value
        message = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
        metadata = {}

    content = {
        "error": error_code,
        "message": message,
        "timestamp": time.time(),
        "path": str(request.url),
    }
    if metadata:
        content.update(metadata)

    # Propagate HTTPException headers (e.g. Retry-After on 503,
    # WWW-Authenticate on 401) — JSONResponse drops them otherwise.
    return JSONResponse(
        status_code=exc.status_code,
        content=content,
        headers=exc.headers,
    )


# Hint clients send with the DB-unavailable 503s below.
DB_UNAVAILABLE_RETRY_AFTER_SECONDS = "5"


def _db_unavailable_response(request: Request, message: str) -> JSONResponse:
    """Build the standardized DB-unavailable 503 with a Retry-After header."""
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={
            "error": ErrorCode.SERVICE_UNAVAILABLE.value,
            "message": message,
            "timestamp": time.time(),
            "path": str(request.url),
        },
        headers={"Retry-After": DB_UNAVAILABLE_RETRY_AFTER_SECONDS},
    )


async def db_timeout_exception_handler(
    request: Request, exc: SQLAlchemyTimeoutError
) -> JSONResponse:
    """Handle DB connection-pool checkout timeouts with an honest 503.

    ``sqlalchemy.exc.TimeoutError`` is what QueuePool raises when
    ``pool_timeout`` elapses with every connection checked out (pool
    saturation). It MUST stay a TYPED handler: per-class handlers are
    dispatched by ExceptionMiddleware INSIDE the middleware stack, so the
    response passes through CORSMiddleware and reaches browsers with
    ``Access-Control-Allow-Origin``. A generic ``Exception`` catch-all runs
    in ServerErrorMiddleware, OUTSIDE CORSMiddleware — browsers then
    misreport the failure as a CORS error (2026-07-21 prod incident).
    """
    logger.error(
        "db_pool_exhausted",
        error=str(exc),
        error_type=type(exc).__name__,
        method=request.method,
        path=request.url.path,
    )
    return _db_unavailable_response(
        request,
        "Database connection pool is saturated; please retry shortly",
    )


async def db_operational_exception_handler(
    request: Request, exc: Exception
) -> JSONResponse:
    """Handle DB connectivity failures (unreachable/refused/dropped) as 503.

    Registered for the classes the app's drivers ACTUALLY raise (verified
    against SQLAlchemy 2.0 + asyncpg — the asyncpg dialect never translates
    to ``OperationalError``):

    - ``OperationalError`` — psycopg2/sync-engine connectivity failures.
    - ``InterfaceError`` — asyncpg statement-time dropped connections.
    - builtin ``ConnectionRefusedError`` — asyncpg CONNECT-time refusal
      (DB down/unreachable, including the ``pool_pre_ping`` reconnect
      path); it escapes SQLAlchemy untranslated. Outbound HTTP/Redis
      clients wrap their refusals in library-specific classes
      (``httpx.ConnectError``, ``redis.exceptions.ConnectionError``), so a
      bare ``ConnectionRefusedError`` reaching app level is, in practice,
      the DB connect path.

    Same typed-handler requirement as ``db_timeout_exception_handler`` —
    the 503 must be produced inside the middleware stack to carry CORS
    headers.
    """
    logger.error(
        "db_unavailable",
        error=str(exc),
        error_type=type(exc).__name__,
        method=request.method,
        path=request.url.path,
    )
    return _db_unavailable_response(
        request,
        "Database is temporarily unavailable; please retry shortly",
    )


async def general_exception_handler(request: Request, exc: Exception):
    """Handle unexpected exceptions with standardized format"""
    from app.core.log_sanitizer import sanitize_headers, sanitize_url

    # Sanitize request details before logging
    sanitized_headers = sanitize_headers(dict(request.headers))
    sanitized_url = sanitize_url(str(request.url))

    # Log the full traceback with sanitized request details
    logger.exception(
        "unhandled_exception",
        error=str(exc),
        error_type=type(exc).__name__,
        method=request.method,
        url=sanitized_url,
        headers=sanitized_headers,
    )

    # In development, return detailed error
    if settings.ENVIRONMENT == "development":
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "error": ErrorCode.INTERNAL_SERVER_ERROR.value,
                "message": str(exc),
                "traceback": traceback.format_exc(),
                "timestamp": time.time(),
                "path": str(request.url),
            },
        )

    # In production, return generic error
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error": ErrorCode.INTERNAL_SERVER_ERROR.value,
            "message": "An unexpected error occurred",
            "timestamp": time.time(),
            "path": str(request.url),
        },
    )


# ============================================================================
# Business Logic Exception Classes
# ============================================================================
# These provide convenience classes for common errors with specific error codes


class NotFoundError(AppError):
    """Resource not found error"""

    def __init__(
        self, resource: str, error_code: ErrorCode = ErrorCode.RESOURCE_NOT_FOUND
    ):
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"{resource} not found",
            error_code=error_code,
        )


class UnauthorizedError(AppError):
    """Unauthorized access error"""

    def __init__(
        self,
        detail: str = "Unauthorized",
        error_code: ErrorCode = ErrorCode.UNAUTHORIZED,
    ):
        super().__init__(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=detail,
            error_code=error_code,
        )


class ForbiddenError(AppError):
    """Forbidden access error"""

    def __init__(
        self,
        detail: str = "Access forbidden",
        error_code: ErrorCode = ErrorCode.INSUFFICIENT_PERMISSIONS,
    ):
        super().__init__(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=detail,
            error_code=error_code,
        )


class ConflictError(AppError):
    """Resource conflict error"""

    def __init__(
        self, detail: str, error_code: ErrorCode = ErrorCode.RESOURCE_CONFLICT
    ):
        super().__init__(
            status_code=status.HTTP_409_CONFLICT,
            detail=detail,
            error_code=error_code,
        )


class BadRequestError(AppError):
    """Bad request error"""

    def __init__(self, detail: str, error_code: ErrorCode = ErrorCode.BAD_REQUEST):
        super().__init__(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=detail,
            error_code=error_code,
        )


# ============================================================================
# Helper Functions for Common Error Responses
# ============================================================================
# These provide convenient ways to raise standardized errors


def not_found_error(resource: str, resource_type: str | None = None) -> HTTPException:
    """
    Create a standardized 404 not found error.

    Args:
        resource: Name of the resource (e.g., "Project", "User")
        resource_type: Optional specific resource type for more specific error code

    Returns:
        HTTPException with standardized error format

    Example:
        raise not_found_error("Project")
        raise not_found_error("User", "user")
    """
    # Map resource types to specific error codes
    error_code_map = {
        "project": ErrorCode.PROJECT_NOT_FOUND,
        "user": ErrorCode.USER_NOT_FOUND,
        "organization": ErrorCode.ORGANIZATION_NOT_FOUND,
        "image": ErrorCode.IMAGE_NOT_FOUND,
    }

    error_code = error_code_map.get(
        resource_type.lower() if resource_type else "", ErrorCode.RESOURCE_NOT_FOUND
    )

    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={"error": error_code.value, "message": f"{resource} not found"},
    )


def unauthorized_error(
    message: str = "Authentication required",
    error_code: ErrorCode = ErrorCode.UNAUTHORIZED,
) -> HTTPException:
    """
    Create a standardized 401 unauthorized error.

    Args:
        message: Error message
        error_code: Specific error code (e.g., TOKEN_EXPIRED, LOGIN_BAD_CREDENTIALS)

    Returns:
        HTTPException with standardized error format

    Example:
        raise unauthorized_error("Invalid credentials", ErrorCode.LOGIN_BAD_CREDENTIALS)
        raise unauthorized_error("Token expired", ErrorCode.TOKEN_EXPIRED)
    """
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={"error": error_code.value, "message": message},
    )


def forbidden_error(
    message: str = "You do not have permission to perform this action",
    error_code: ErrorCode = ErrorCode.INSUFFICIENT_PERMISSIONS,
) -> HTTPException:
    """
    Create a standardized 403 forbidden error.

    Args:
        message: Error message
        error_code: Specific error code

    Returns:
        HTTPException with standardized error format

    Example:
        raise forbidden_error("Insufficient permissions")
        raise forbidden_error("Account is read-only", ErrorCode.ACCOUNT_READ_ONLY)
    """
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={"error": error_code.value, "message": message},
    )


def validation_error(
    message: str,
    field: str | None = None,
    error_code: ErrorCode = ErrorCode.VALIDATION_ERROR,
) -> HTTPException:
    """
    Create a standardized validation error.

    Args:
        message: Error message
        field: Optional field name that failed validation
        error_code: Specific error code

    Returns:
        HTTPException with standardized error format

    Example:
        raise validation_error("Email is invalid", "email", ErrorCode.INVALID_EMAIL)
        raise validation_error("File too large", "file", ErrorCode.INVALID_FILE_SIZE)
    """
    detail = {"error": error_code.value, "message": message}
    if field:
        detail["field"] = field

    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detail
    )


def conflict_error(
    message: str, error_code: ErrorCode = ErrorCode.RESOURCE_CONFLICT
) -> HTTPException:
    """
    Create a standardized 409 conflict error.

    Args:
        message: Error message
        error_code: Specific error code

    Returns:
        HTTPException with standardized error format

    Example:
        raise conflict_error("Email already registered", ErrorCode.DUPLICATE_EMAIL)
        raise conflict_error("Username already taken", ErrorCode.DUPLICATE_USERNAME)
    """
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={"error": error_code.value, "message": message},
    )


def rate_limit_error(
    message: str = "Too many requests, please try again later",
    retry_after: int | None = None,
) -> HTTPException:
    """
    Create a standardized 429 rate limit error.

    Args:
        message: Error message
        retry_after: Optional seconds until retry is allowed

    Returns:
        HTTPException with standardized error format

    Example:
        raise rate_limit_error("Rate limit exceeded", retry_after=60)
    """
    detail: dict[str, Any] = {
        "error": ErrorCode.RATE_LIMIT_EXCEEDED.value,
        "message": message,
    }
    if retry_after:
        detail["retry_after"] = retry_after

    return HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=detail)


def quota_exceeded_error(
    resource: str,
    current: int | None = None,
    limit: int | None = None,
    error_code: ErrorCode = ErrorCode.QUOTA_EXCEEDED,
) -> HTTPException:
    """
    Create a standardized quota exceeded error.

    Args:
        resource: Resource that exceeded quota (e.g., "storage", "projects")
        current: Current usage amount
        limit: Quota limit
        error_code: Specific error code

    Returns:
        HTTPException with standardized error format

    Example:
        raise quota_exceeded_error("storage", 10000000, 5000000, ErrorCode.STORAGE_QUOTA_EXCEEDED)
    """
    detail: dict[str, Any] = {
        "error": error_code.value,
        "message": f"{resource.capitalize()} quota exceeded",
    }
    if current is not None:
        detail["current"] = current
    if limit is not None:
        detail["limit"] = limit

    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)
