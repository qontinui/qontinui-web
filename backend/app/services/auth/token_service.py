import secrets
from datetime import datetime, timedelta
from typing import Any

from app.core.config import settings
from jose import JWTError, jwt


class TokenService:
    def __init__(self):
        self.secret_key = settings.SECRET_KEY
        self.algorithm = settings.ALGORITHM
        self.access_token_expire_minutes = settings.ACCESS_TOKEN_EXPIRE_MINUTES
        self.refresh_token_expire_days = settings.REFRESH_TOKEN_EXPIRE_DAYS

    def create_access_token(
        self,
        subject: str | Any,
        expires_delta: timedelta | None = None,
        additional_claims: dict | None = None,
    ) -> str:
        if expires_delta:
            expire = datetime.utcnow() + expires_delta
        else:
            expire = datetime.utcnow() + timedelta(
                minutes=self.access_token_expire_minutes
            )

        to_encode = {
            "exp": expire,
            "sub": str(subject),
            "type": "access",
            "iat": datetime.utcnow(),
            "jti": secrets.token_urlsafe(16),
        }

        if additional_claims:
            to_encode.update(additional_claims)

        return jwt.encode(to_encode, self.secret_key, algorithm=self.algorithm)

    def create_refresh_token(
        self, subject: str | Any, expires_delta: timedelta | None = None
    ) -> str:
        if expires_delta:
            expire = datetime.utcnow() + expires_delta
        else:
            expire = datetime.utcnow() + timedelta(days=self.refresh_token_expire_days)

        to_encode = {
            "exp": expire,
            "sub": str(subject),
            "type": "refresh",
            "iat": datetime.utcnow(),
            "jti": secrets.token_urlsafe(16),
        }

        return jwt.encode(to_encode, self.secret_key, algorithm=self.algorithm)

    def create_password_reset_token(self, email: str, hours: int = 1) -> str:
        expire = datetime.utcnow() + timedelta(hours=hours)
        to_encode = {
            "exp": expire,
            "sub": email,
            "type": "password_reset",
            "iat": datetime.utcnow(),
        }
        return jwt.encode(to_encode, self.secret_key, algorithm=self.algorithm)

    def decode_token(self, token: str) -> dict:
        try:
            payload = jwt.decode(token, self.secret_key, algorithms=[self.algorithm])
            return payload
        except JWTError:
            return {}

    def verify_password_reset_token(self, token: str) -> str | None:
        try:
            payload = jwt.decode(token, self.secret_key, algorithms=[self.algorithm])
            if payload.get("type") != "password_reset":
                return None
            return payload.get("sub")
        except JWTError:
            return None

    def create_email_verification_token(self, email: str, hours: int = 24) -> str:
        """Create a token for email verification (valid for 24 hours by default)"""
        expire = datetime.utcnow() + timedelta(hours=hours)
        to_encode = {
            "exp": expire,
            "sub": email,
            "type": "email_verification",
            "iat": datetime.utcnow(),
        }
        return jwt.encode(to_encode, self.secret_key, algorithm=self.algorithm)

    def verify_email_verification_token(self, token: str) -> str | None:
        """Verify email verification token and return email if valid"""
        try:
            payload = jwt.decode(token, self.secret_key, algorithms=[self.algorithm])
            if payload.get("type") != "email_verification":
                return None
            return payload.get("sub")
        except JWTError:
            return None

    def extract_token_id(self, token: str) -> str | None:
        payload = self.decode_token(token)
        return payload.get("jti") if payload else None


token_service = TokenService()
