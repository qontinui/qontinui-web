import secrets
from datetime import UTC, datetime, timedelta
from typing import Any, cast

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings
from app.services.auth.token_blacklist_service import token_blacklist_service

pwd_context = CryptContext(schemes=["argon2", "bcrypt"], deprecated="auto")


def create_access_token(
    subject: str | Any,
    expires_delta: timedelta | None = None,
    additional_claims: dict | None = None,
) -> str:
    if expires_delta:
        expire = datetime.now(UTC) + expires_delta
    else:
        expire = datetime.now(UTC) + timedelta(
            seconds=settings.ACCESS_TOKEN_EXPIRE_SECONDS
        )

    to_encode = {
        "exp": expire,
        "sub": str(subject),
        "type": "access",
        "iat": datetime.now(UTC),
        "jti": secrets.token_urlsafe(16),  # JWT ID for blacklisting
        "aud": ["fastapi-users:auth"],  # Required by fastapi-users JWTStrategy
    }

    if additional_claims:
        to_encode.update(additional_claims)

    # Use ACCESS_SECRET_KEY to match fastapi-users JWT strategy
    # ACCESS_SECRET_KEY is guaranteed to be str by the config validator
    encoded_jwt = cast(
        str,
        jwt.encode(
            to_encode,
            cast(str, settings.ACCESS_SECRET_KEY),
            algorithm=settings.ALGORITHM,
        ),
    )
    return encoded_jwt


def create_refresh_token(
    subject: str | Any,
    expires_delta: timedelta | None = None,
    long_lived: bool = False,
) -> str:
    if expires_delta:
        expire = datetime.now(UTC) + expires_delta
    else:
        # Use long-lived expiry for "remember me" tokens, otherwise standard expiry
        expiry_days = (
            settings.REMEMBER_ME_TOKEN_EXPIRE_DAYS
            if long_lived
            else settings.REFRESH_TOKEN_EXPIRE_DAYS
        )
        expire = datetime.now(UTC) + timedelta(days=expiry_days)

    to_encode = {
        "exp": expire,
        "sub": str(subject),
        "type": "refresh",
        "iat": datetime.now(UTC),
        "jti": secrets.token_urlsafe(16),
        "long_lived": long_lived,  # Track if this is a remember-me token
    }
    encoded_jwt = cast(
        str,
        jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM),
    )
    return encoded_jwt


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return cast(bool, pwd_context.verify(plain_password, hashed_password))


def get_password_hash(password: str) -> str:
    return cast(str, pwd_context.hash(password))


def decode_token(token: str) -> dict[Any, Any]:
    """
    Decode a JWT token without checking blacklist.

    Note: This function does NOT check if the token is blacklisted.
    For blacklist checking, use the async token_blacklist_service.is_blacklisted()
    or the authentication_service methods.

    This is a legacy function kept for backward compatibility with synchronous code.
    """
    try:
        # Try decoding with ACCESS_SECRET_KEY first (for access tokens)
        # ACCESS_SECRET_KEY is guaranteed to be str by the config validator
        payload = jwt.decode(
            token,
            cast(str, settings.ACCESS_SECRET_KEY),
            algorithms=[settings.ALGORITHM],
        )
        return cast(dict[Any, Any], payload)
    except JWTError:
        return {}


async def blacklist_token(token: str, expiry: datetime | None = None) -> bool:
    """
    Add a token to the blacklist (for logout).

    Args:
        token: JWT token to blacklist
        expiry: Token expiration datetime (used for TTL in Redis)

    Returns:
        True if token was blacklisted successfully
    """
    try:
        payload = decode_token(token)
        if payload and "jti" in payload:
            # Get expiry from payload if not provided
            if not expiry and "exp" in payload:
                expiry = datetime.fromtimestamp(payload["exp"], tz=UTC)

            await token_blacklist_service.blacklist_token(payload["jti"], expiry)
            return True
        return False
    except Exception:
        return False


async def is_token_blacklisted(jti: str) -> bool:
    """
    Check if a token ID is blacklisted.

    Args:
        jti: JWT ID to check

    Returns:
        True if token is blacklisted
    """
    return await token_blacklist_service.is_blacklisted(jti)


async def clean_expired_tokens() -> int:
    """
    Remove expired tokens from blacklist.

    For Redis: This is handled automatically by TTL, returns 0.
    For in-memory: Manually removes expired tokens.

    Returns:
        Number of tokens removed (only for in-memory storage)
    """
    return await token_blacklist_service.clean_expired_tokens()


def create_password_reset_token(email: str) -> str:
    """Create a password reset token"""
    expire = datetime.now(UTC) + timedelta(hours=1)  # Token valid for 1 hour
    to_encode = {
        "exp": expire,
        "sub": email,
        "type": "password_reset",
        "iat": datetime.now(UTC),
    }
    encoded_jwt = cast(
        str,
        jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM),
    )
    return encoded_jwt


def verify_password_reset_token(token: str) -> str | None:
    """Verify password reset token and return email"""
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
        )
        if payload.get("type") != "password_reset":
            return None
        sub = payload.get("sub")
        return cast(str, sub) if sub is not None else None
    except JWTError:
        return None


def decode_refresh_token(token: str) -> dict[Any, Any]:
    """
    Decode a refresh token specifically (uses SECRET_KEY).

    Note: This function does NOT check if the token is blacklisted.
    Use authentication_service methods for blacklist checking.

    Returns:
        Payload dict with keys: sub, exp, iat, jti, type, long_lived (optional)
        Empty dict if invalid
    """
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
        )

        # Check token type
        if payload.get("type") != "refresh":
            return {}

        return cast(dict[Any, Any], payload)
    except JWTError:
        return {}


def get_token_expiry_time(token_payload: dict) -> datetime | None:
    """
    Get the expiry datetime from a decoded token payload.

    Args:
        token_payload: Decoded JWT payload

    Returns:
        datetime object or None if invalid
    """
    exp = token_payload.get("exp")
    if not exp:
        return None
    return datetime.fromtimestamp(exp, tz=UTC)


def is_token_expiring_soon(token_payload: dict, threshold_minutes: int) -> bool:
    """
    Check if an access token will expire within the threshold time.

    Args:
        token_payload: Decoded access token payload
        threshold_minutes: Minutes before expiry to consider "expiring soon"

    Returns:
        True if token expires within threshold, False otherwise
    """
    expiry = get_token_expiry_time(token_payload)
    if not expiry:
        return False

    threshold = datetime.now(UTC) + timedelta(minutes=threshold_minutes)
    return expiry <= threshold


def get_session_jti_from_refresh_token(refresh_token: str) -> str | None:
    """
    Extract the JTI from a refresh token for session tracking.

    Args:
        refresh_token: Encoded refresh token

    Returns:
        JTI string or None if invalid
    """
    payload = decode_refresh_token(refresh_token)
    return payload.get("jti") if payload else None
