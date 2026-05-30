"""Auth services.

Cognito is the sole user-authentication mechanism, so the local
authentication / token-minting / password / user-management services were
removed. Only the JWT-revocation (logout) blacklist survives.
"""

from app.services.auth.token_blacklist_service import token_blacklist_service

__all__ = [
    "token_blacklist_service",
]
