from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.services.auth.password_service import password_service
from app.services.auth.token_blacklist_service import token_blacklist_service
from app.services.auth.token_service import token_service


class AuthenticationService:
    def __init__(self):
        self.password_service = password_service
        self.token_service = token_service
        self.blacklist_service = token_blacklist_service

    async def authenticate_user(
        self, db: AsyncSession, username: str, password: str
    ) -> User | None:
        from app.crud.user import get_user_by_email, get_user_by_username

        user = await get_user_by_username(db, username)
        if not user:
            user = await get_user_by_email(db, username)

        if not user:
            return None

        if not self.password_service.verify_password(password, user.hashed_password):
            return None

        return user

    def create_user_tokens(self, user_id: UUID) -> dict:
        access_token = self.token_service.create_access_token(user_id)
        refresh_token = self.token_service.create_refresh_token(user_id)

        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "bearer",
        }

    async def refresh_user_tokens(self, refresh_token: str) -> dict | None:
        payload = self.token_service.decode_token(refresh_token)

        if not payload or payload.get("type") != "refresh":
            return None

        token_jti = payload.get("jti")
        if token_jti and await self.blacklist_service.is_blacklisted(token_jti):
            return None

        user_id = payload.get("sub")
        if not user_id:
            return None

        # Get expiry from payload for TTL
        expiry = None
        if "exp" in payload:
            expiry = datetime.fromtimestamp(payload["exp"], tz=UTC)

        await self.blacklist_service.blacklist_token(token_jti, expiry)  # type: ignore[arg-type]

        return self.create_user_tokens(user_id)

    async def logout_user(
        self, access_token: str | None = None, refresh_token: str | None = None
    ) -> bool:
        success = False

        if access_token:
            payload = self.token_service.decode_token(access_token)
            token_jti = payload.get("jti") if payload else None
            if token_jti:
                # Get expiry from payload for TTL
                expiry = None
                if "exp" in payload:
                    expiry = datetime.fromtimestamp(payload["exp"], tz=UTC)
                await self.blacklist_service.blacklist_token(token_jti, expiry)
                success = True

        if refresh_token:
            payload = self.token_service.decode_token(refresh_token)
            token_jti = payload.get("jti") if payload else None
            if token_jti:
                # Get expiry from payload for TTL
                expiry = None
                if "exp" in payload:
                    expiry = datetime.fromtimestamp(payload["exp"], tz=UTC)
                await self.blacklist_service.blacklist_token(token_jti, expiry)
                success = True

        return success

    async def validate_access_token(self, token: str) -> dict | None:
        payload = self.token_service.decode_token(token)

        if not payload or payload.get("type") != "access":
            return None

        token_jti = payload.get("jti")
        if token_jti and await self.blacklist_service.is_blacklisted(token_jti):
            return None

        return payload


authentication_service = AuthenticationService()
