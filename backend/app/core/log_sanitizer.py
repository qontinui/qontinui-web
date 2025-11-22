"""
Log Sanitizer Module

Prevents logging of sensitive data by detecting and redacting fields
that may contain passwords, tokens, secrets, or other sensitive information.

This module helps comply with security best practices and regulations like
GDPR, PCI-DSS, and HIPAA by ensuring sensitive data is never written to logs.
"""

from typing import Any

# Set of field names/patterns that indicate sensitive data
SENSITIVE_FIELDS = {
    "password",
    "passwd",
    "pwd",
    "secret",
    "token",
    "api_key",
    "apikey",
    "access_token",
    "refresh_token",
    "authorization",
    "auth",
    "private_key",
    "privatekey",
    "key",
    "credential",
    "credentials",
    "session",
    "cookie",
    "csrf",
    "ssn",
    "social_security",
    "credit_card",
    "card_number",
    "cvv",
    "pin",
    "otp",
    "totp",
    "mfa",
    "security_answer",
    "security_question",
    "hashed_password",
}

# Redaction marker
REDACTED_VALUE = "***REDACTED***"


def is_sensitive_field(field_name: str) -> bool:
    """
    Check if a field name indicates sensitive data.

    Args:
        field_name: The name of the field to check

    Returns:
        bool: True if the field is sensitive, False otherwise
    """
    if not isinstance(field_name, str):
        return False

    field_lower = field_name.lower()

    # Check exact matches and substring matches
    return any(sensitive in field_lower for sensitive in SENSITIVE_FIELDS)


def sanitize_value(key: str, value: Any) -> Any:
    """
    Sanitize a single value if its key indicates sensitive data.

    Args:
        key: The field name
        value: The field value

    Returns:
        The original value if not sensitive, otherwise REDACTED_VALUE
    """
    if is_sensitive_field(key):
        return REDACTED_VALUE
    return value


def sanitize_log_data(data: dict) -> dict:
    """
    Recursively sanitize a dictionary of log data.

    Replaces sensitive field values with REDACTED_VALUE while preserving
    the structure of the data. Handles nested dictionaries and lists.

    Args:
        data: Dictionary containing log data

    Returns:
        dict: Sanitized copy of the data with sensitive fields redacted

    Example:
        >>> sanitize_log_data({"username": "john", "password": "secret123"})
        {"username": "john", "password": "***REDACTED***"}
    """
    if not isinstance(data, dict):
        return data

    sanitized = {}

    for key, value in data.items():
        if is_sensitive_field(key):
            # Redact the entire value
            sanitized[key] = REDACTED_VALUE
        elif isinstance(value, dict):
            # Recursively sanitize nested dictionaries
            sanitized[key] = sanitize_log_data(value)
        elif isinstance(value, list):
            # Sanitize list items
            sanitized[key] = [
                sanitize_log_data(item) if isinstance(item, dict) else item
                for item in value
            ]
        else:
            # Keep non-sensitive values as-is
            sanitized[key] = value

    return sanitized


def sanitize_url(url: str) -> str:
    """
    Sanitize URL by removing sensitive query parameters and credentials.

    Args:
        url: URL string that may contain sensitive data

    Returns:
        str: Sanitized URL with sensitive parts redacted

    Example:
        >>> sanitize_url("http://user:pass@example.com/api?token=secret123")
        "http://***REDACTED***@example.com/api?token=***REDACTED***"
    """
    if not isinstance(url, str):
        return url

    from urllib.parse import parse_qs, urlparse, urlunparse

    try:
        parsed = urlparse(url)

        # Redact userinfo (username:password)
        if parsed.username or parsed.password:
            netloc = parsed.hostname or ""
            if parsed.port:
                netloc += f":{parsed.port}"
            # Add redacted credentials marker
            netloc = f"{REDACTED_VALUE}@{netloc}"
        else:
            netloc = parsed.netloc

        # Sanitize query parameters
        if parsed.query:
            query_params = parse_qs(parsed.query)
            sanitized_params = []
            for key, values in query_params.items():
                if is_sensitive_field(key):
                    sanitized_params.append(f"{key}={REDACTED_VALUE}")
                else:
                    for value in values:
                        sanitized_params.append(f"{key}={value}")
            query = "&".join(sanitized_params)
        else:
            query = parsed.query

        # Reconstruct URL
        sanitized_url = urlunparse(
            (parsed.scheme, netloc, parsed.path, parsed.params, query, parsed.fragment)
        )

        return sanitized_url

    except Exception:
        # If parsing fails, return redacted placeholder
        return REDACTED_VALUE


def sanitize_headers(headers: dict) -> dict:
    """
    Sanitize HTTP headers by redacting sensitive values.

    Common sensitive headers:
    - Authorization
    - Cookie
    - Set-Cookie
    - X-API-Key
    - X-Auth-Token

    Args:
        headers: Dictionary of HTTP headers

    Returns:
        dict: Sanitized copy of headers with sensitive values redacted
    """
    if not isinstance(headers, dict):
        return headers

    sanitized = {}

    for key, value in headers.items():
        if is_sensitive_field(key):
            sanitized[key] = REDACTED_VALUE
        else:
            sanitized[key] = value

    return sanitized


def sanitize_request_data(request_data: dict) -> dict:
    """
    Sanitize request data including body, headers, and query parameters.

    This is a convenience function that handles common request structures.

    Args:
        request_data: Dictionary containing request information

    Returns:
        dict: Sanitized copy of request data
    """
    if not isinstance(request_data, dict):
        return request_data

    sanitized = {}

    for key, value in request_data.items():
        if key == "headers":
            sanitized[key] = sanitize_headers(value)
        elif key == "url":
            sanitized[key] = sanitize_url(value)
        elif key in ("body", "data", "json", "form"):
            sanitized[key] = sanitize_log_data(value) if isinstance(value, dict) else value
        elif is_sensitive_field(key):
            sanitized[key] = REDACTED_VALUE
        else:
            sanitized[key] = value

    return sanitized
