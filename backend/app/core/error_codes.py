"""
Standardized error codes for consistent API error responses.

This module defines all error codes used across the backend API,
organized by category for easy maintenance and discovery.

Usage:
    from app.core.error_codes import ErrorCode

    raise HTTPException(
        status_code=401,
        detail={
            "error": ErrorCode.LOGIN_BAD_CREDENTIALS,
            "message": "Invalid username or password"
        }
    )
"""

from enum import StrEnum


class ErrorCode(StrEnum):
    """
    Standard error codes for API responses.

    Error codes follow a naming convention:
    - PREFIX describes the category (LOGIN, TOKEN, etc.)
    - Suffix describes the specific error

    All error codes are uppercase with underscores.
    """

    # ========================================================================
    # Authentication Errors (LOGIN_, TOKEN_)
    # ========================================================================

    LOGIN_BAD_CREDENTIALS = "LOGIN_BAD_CREDENTIALS"
    """Invalid username/email or password"""

    LOGIN_USER_NOT_VERIFIED = "LOGIN_USER_NOT_VERIFIED"
    """User account has not been verified via email"""

    TOKEN_EXPIRED = "TOKEN_EXPIRED"
    """JWT token has expired"""

    TOKEN_INVALID = "TOKEN_INVALID"
    """JWT token is malformed or invalid"""

    TOKEN_REVOKED = "TOKEN_REVOKED"
    """JWT token has been revoked/blacklisted"""

    TOKEN_MISSING = "TOKEN_MISSING"
    """No authentication token provided"""

    # ========================================================================
    # Authorization Errors (INSUFFICIENT_, ACCESS_)
    # ========================================================================

    INSUFFICIENT_PERMISSIONS = "INSUFFICIENT_PERMISSIONS"
    """User lacks required permissions for this action"""

    ACCESS_DENIED = "ACCESS_DENIED"
    """Generic access denied error"""

    RESOURCE_LOCKED = "RESOURCE_LOCKED"
    """Resource is locked by another user"""

    ACCOUNT_INACTIVE = "ACCOUNT_INACTIVE"
    """User account is inactive/disabled"""

    ACCOUNT_READ_ONLY = "ACCOUNT_READ_ONLY"
    """Account is in read-only mode (e.g., quota exceeded)"""

    # ========================================================================
    # Resource Errors (RESOURCE_)
    # ========================================================================

    RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND"
    """Requested resource does not exist"""

    PROJECT_NOT_FOUND = "PROJECT_NOT_FOUND"
    """Requested project does not exist"""

    USER_NOT_FOUND = "USER_NOT_FOUND"
    """Requested user does not exist"""

    ORGANIZATION_NOT_FOUND = "ORGANIZATION_NOT_FOUND"
    """Requested organization does not exist"""

    IMAGE_NOT_FOUND = "IMAGE_NOT_FOUND"
    """Requested image does not exist"""

    # ========================================================================
    # Validation Errors (VALIDATION_, INVALID_)
    # ========================================================================

    VALIDATION_ERROR = "VALIDATION_ERROR"
    """Request data failed validation"""

    INVALID_INPUT = "INVALID_INPUT"
    """Input data is invalid or malformed"""

    INVALID_FILE_TYPE = "INVALID_FILE_TYPE"
    """Uploaded file type is not allowed"""

    INVALID_FILE_SIZE = "INVALID_FILE_SIZE"
    """Uploaded file exceeds size limit"""

    INVALID_EMAIL = "INVALID_EMAIL"
    """Email address is invalid"""

    INVALID_PASSWORD = "INVALID_PASSWORD"
    """Password does not meet requirements"""

    # ========================================================================
    # Business Logic Errors (DUPLICATE_, CONFLICT_)
    # ========================================================================

    DUPLICATE_RESOURCE = "DUPLICATE_RESOURCE"
    """Resource with same identifier already exists"""

    DUPLICATE_EMAIL = "DUPLICATE_EMAIL"
    """Email address is already registered"""

    DUPLICATE_USERNAME = "DUPLICATE_USERNAME"
    """Username is already taken"""

    RESOURCE_CONFLICT = "RESOURCE_CONFLICT"
    """Resource state conflicts with requested operation"""

    ALREADY_MEMBER = "ALREADY_MEMBER"
    """User is already a member of organization/team"""

    CANNOT_MODIFY_OWNER = "CANNOT_MODIFY_OWNER"
    """Cannot modify organization owner"""

    # ========================================================================
    # Quota & Limit Errors (QUOTA_, LIMIT_)
    # ========================================================================

    QUOTA_EXCEEDED = "QUOTA_EXCEEDED"
    """User has exceeded their quota limit"""

    STORAGE_QUOTA_EXCEEDED = "STORAGE_QUOTA_EXCEEDED"
    """Storage quota has been exceeded"""

    RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED"
    """Too many requests, rate limit exceeded"""

    LIMIT_REACHED = "LIMIT_REACHED"
    """Feature limit reached for subscription tier"""

    # ========================================================================
    # Server Errors (INTERNAL_, EXTERNAL_)
    # ========================================================================

    INTERNAL_SERVER_ERROR = "INTERNAL_SERVER_ERROR"
    """An unexpected error occurred on the server"""

    DATABASE_ERROR = "DATABASE_ERROR"
    """Database operation failed"""

    STORAGE_ERROR = "STORAGE_ERROR"
    """File storage operation failed"""

    EXTERNAL_SERVICE_ERROR = "EXTERNAL_SERVICE_ERROR"
    """External service (S3, email, etc.) failed"""

    # ========================================================================
    # Device & Session Errors (DEVICE_, SESSION_)
    # ========================================================================

    DEVICE_NOT_VERIFIED = "DEVICE_NOT_VERIFIED"
    """Device has not been verified"""

    DEVICE_NOT_FOUND = "DEVICE_NOT_FOUND"
    """Device session not found"""

    SESSION_EXPIRED = "SESSION_EXPIRED"
    """User session has expired"""

    # ========================================================================
    # Invitation Errors (INVITATION_)
    # ========================================================================

    INVITATION_EXPIRED = "INVITATION_EXPIRED"
    """Invitation has expired"""

    INVITATION_INVALID = "INVITATION_INVALID"
    """Invitation token is invalid"""

    INVITATION_ALREADY_ACCEPTED = "INVITATION_ALREADY_ACCEPTED"
    """Invitation has already been accepted"""

    INVITATION_ALREADY_SENT = "INVITATION_ALREADY_SENT"
    """Invitation already sent to this email"""

    # ========================================================================
    # Generic HTTP Errors (fallback codes)
    # ========================================================================

    BAD_REQUEST = "BAD_REQUEST"
    """Generic bad request error"""

    UNAUTHORIZED = "UNAUTHORIZED"
    """Generic unauthorized error"""

    FORBIDDEN = "FORBIDDEN"
    """Generic forbidden error"""

    NOT_FOUND = "NOT_FOUND"
    """Generic not found error"""

    CONFLICT = "CONFLICT"
    """Generic conflict error"""

    UNPROCESSABLE_ENTITY = "UNPROCESSABLE_ENTITY"
    """Generic unprocessable entity error"""


# Mapping of HTTP status codes to default error codes
DEFAULT_ERROR_CODES = {
    400: ErrorCode.BAD_REQUEST,
    401: ErrorCode.UNAUTHORIZED,
    403: ErrorCode.FORBIDDEN,
    404: ErrorCode.NOT_FOUND,
    409: ErrorCode.CONFLICT,
    422: ErrorCode.VALIDATION_ERROR,
    423: ErrorCode.RESOURCE_LOCKED,
    429: ErrorCode.RATE_LIMIT_EXCEEDED,
    500: ErrorCode.INTERNAL_SERVER_ERROR,
}


def get_default_error_code(status_code: int) -> ErrorCode:
    """
    Get the default error code for a given HTTP status code.

    Args:
        status_code: HTTP status code

    Returns:
        ErrorCode enum value
    """
    return DEFAULT_ERROR_CODES.get(status_code, ErrorCode.INTERNAL_SERVER_ERROR)
