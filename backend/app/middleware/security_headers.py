"""
Security Headers Middleware

Adds security-related HTTP headers to all responses to protect against
common web vulnerabilities:
- XSS attacks
- Clickjacking
- MIME-sniffing
- Protocol downgrade attacks

Reference: https://owasp.org/www-project-secure-headers/
"""

from app.core.config import settings
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """
    Middleware that adds security headers to all HTTP responses.

    Headers added:
    - X-Content-Type-Options: Prevents MIME-sniffing
    - X-Frame-Options: Prevents clickjacking
    - X-XSS-Protection: Enables browser XSS filter (legacy browsers)
    - Strict-Transport-Security: Enforces HTTPS (production only)
    - Content-Security-Policy: Restricts resource loading
    - Referrer-Policy: Controls referrer information
    - Permissions-Policy: Controls browser features
    """

    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)

        # Prevent MIME-sniffing
        # Ensures browsers respect Content-Type header
        response.headers["X-Content-Type-Options"] = "nosniff"

        # Prevent clickjacking
        # Denies rendering page in iframe/frame
        response.headers["X-Frame-Options"] = "DENY"

        # Enable XSS filter (legacy browsers)
        # Modern browsers have this by default, but include for older browsers
        response.headers["X-XSS-Protection"] = "1; mode=block"

        # Enforce HTTPS (production only)
        # Forces browsers to use HTTPS for all future requests
        if settings.ENVIRONMENT == "production":
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains; preload"
            )

        # Content Security Policy
        # Restricts which resources can be loaded
        # Note: Adjust directives based on your frontend needs
        csp_directives = [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'",  # Allow inline scripts (Next.js needs this)
            "style-src 'self' 'unsafe-inline'",  # Allow inline styles
            "img-src 'self' data: https: blob:",  # Allow images from self, data URIs, HTTPS, and blob
            "font-src 'self' data:",  # Allow fonts from self and data URIs
            "connect-src 'self' https://api.stripe.com",  # Allow API calls to self and Stripe
            "frame-ancestors 'none'",  # Equivalent to X-Frame-Options: DENY
            "base-uri 'self'",  # Restrict base URL
            "form-action 'self'",  # Restrict form submissions
            "upgrade-insecure-requests",  # Upgrade HTTP to HTTPS
        ]

        # Add CSP violation reporting endpoint
        # This allows browsers to send violation reports to our security endpoint
        # The endpoint logs violations for security monitoring and debugging
        csp_report_uri = f"{settings.BACKEND_URL}/api/v1/security/csp-report"
        csp_directives.append(f"report-uri {csp_report_uri}")

        response.headers["Content-Security-Policy"] = "; ".join(csp_directives)

        # Referrer Policy
        # Controls how much referrer information is sent
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        # Permissions Policy (formerly Feature-Policy)
        # Controls which browser features can be used
        permissions = [
            "geolocation=()",  # Disable geolocation
            "microphone=()",  # Disable microphone
            "camera=()",  # Disable camera
            "payment=()",  # Disable payment API
            "usb=()",  # Disable USB
            "magnetometer=()",  # Disable magnetometer
            "gyroscope=()",  # Disable gyroscope
            "accelerometer=()",  # Disable accelerometer
        ]
        response.headers["Permissions-Policy"] = ", ".join(permissions)

        return response
