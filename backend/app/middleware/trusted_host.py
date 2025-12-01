"""Custom TrustedHost middleware that exempts health check endpoints.

This middleware extends Starlette's TrustedHostMiddleware to allow health check
endpoints to bypass host validation. This is necessary for AWS ELB health checks
which use internal IP addresses in the Host header.
"""

from starlette.middleware.trustedhost import (
    TrustedHostMiddleware as StarletteTrustedHostMiddleware,
)
from starlette.types import ASGIApp, Receive, Scope, Send


class TrustedHostMiddleware:
    """TrustedHost middleware with health check exemption.

    This middleware validates the Host header for all requests except those
    to health check endpoints (/health, /api/health).

    Args:
        app: The ASGI application
        allowed_hosts: List of allowed host patterns. Supports wildcards (*.example.com)
        exempt_paths: List of paths that bypass host validation (default: ["/health"])
    """

    def __init__(
        self,
        app: ASGIApp,
        allowed_hosts: list[str] | None = None,
        exempt_paths: list[str] | None = None,
    ) -> None:
        """Initialize the middleware with the ASGI app and configuration."""
        self.app = app
        self.allowed_hosts = allowed_hosts or []
        self.exempt_paths = exempt_paths or ["/health"]

        # Create the underlying Starlette middleware if hosts are configured
        self.trusted_host_middleware: StarletteTrustedHostMiddleware | None
        if self.allowed_hosts:
            self.trusted_host_middleware = StarletteTrustedHostMiddleware(
                app, allowed_hosts=self.allowed_hosts
            )
        else:
            self.trusted_host_middleware = None

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Process the request through the middleware."""
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Check if this is an exempt path (health check)
        path = scope.get("path", "")
        if path in self.exempt_paths:
            # Bypass host validation for health checks
            await self.app(scope, receive, send)
            return

        # If no allowed hosts configured, allow all
        if not self.trusted_host_middleware:
            await self.app(scope, receive, send)
            return

        # Apply host validation for all other requests
        await self.trusted_host_middleware(scope, receive, send)
