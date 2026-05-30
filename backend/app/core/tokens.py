"""Token-blacklist convenience wrappers.

The local FastAPI-Users token stack (HS256 access/refresh minting, local
password hashing, password-reset tokens, and the retired runner-bearer
token) was removed when Cognito became the sole user-authentication
mechanism. What remains here are thin async wrappers around
:mod:`app.services.auth.token_blacklist_service`, kept as a stable import
surface for logout-style revocation.

Cognito owns token issuance, lifetime, and refresh; the backend only
*verifies* Cognito JWTs (see :mod:`app.auth.cognito_user`).
"""

from datetime import UTC, datetime
from typing import Any

from app.services.auth.token_blacklist_service import token_blacklist_service


async def blacklist_token(token: str, expiry: datetime | None = None) -> bool:
    """Add a token's ``jti`` to the blacklist (for logout / revocation).

    Args:
        token: A JWT whose ``jti``/``exp`` claims drive the blacklist TTL.
            Parsed without verification (only the ``jti``/``exp`` claims
            are used, and only to revoke).
        expiry: Token expiration datetime (used for TTL in Redis). When
            omitted, the token's ``exp`` claim is used.

    Returns:
        ``True`` if the token carried a ``jti`` and was blacklisted.
    """
    try:
        import jwt as pyjwt

        payload: dict[str, Any] = pyjwt.decode(
            token, options={"verify_signature": False}
        )
        if payload and "jti" in payload:
            if not expiry and "exp" in payload:
                expiry = datetime.fromtimestamp(payload["exp"], tz=UTC)
            await token_blacklist_service.blacklist_token(payload["jti"], expiry)
            return True
        return False
    except Exception:
        return False


async def is_token_blacklisted(jti: str) -> bool:
    """Check whether a token ``jti`` is blacklisted."""
    return await token_blacklist_service.is_blacklisted(jti)


async def clean_expired_tokens() -> int:
    """Remove expired tokens from the blacklist.

    For Redis this is handled automatically by TTL (returns 0); for the
    in-memory store this manually evicts expired entries.
    """
    return await token_blacklist_service.clean_expired_tokens()
