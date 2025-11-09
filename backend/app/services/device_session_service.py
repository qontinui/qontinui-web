"""
Device session service for managing user device sessions.

Provides CRUD operations and business logic for device session tracking.
"""

import secrets
import uuid
from datetime import datetime, timedelta

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.device_session import DeviceSession

# Try to import geolocation service (requires httpx)
# If not available, geolocation features will be disabled
try:
    from app.services.geolocation_service import geolocation_service
    GEOLOCATION_AVAILABLE = True
except ImportError:
    geolocation_service = None
    GEOLOCATION_AVAILABLE = False

logger = structlog.get_logger(__name__)


class DeviceSessionService:
    """Service for managing device sessions and detecting suspicious activity."""

    async def create_device_session(
        self,
        db: AsyncSession,
        user_id: uuid.UUID,
        device_fingerprint: str,
        ip_address: str,
        user_agent: str,
        accept_language: str | None = None,
        is_trusted: bool = False,
    ) -> DeviceSession:
        """
        Create a new device session.

        Args:
            db: Database session
            user_id: User ID
            device_fingerprint: Device fingerprint hash
            ip_address: IP address
            user_agent: User-Agent header
            accept_language: Accept-Language header
            is_trusted: Whether device is automatically trusted

        Returns:
            Created DeviceSession
        """
        # Get geolocation from IP address if available
        if GEOLOCATION_AVAILABLE:
            geo_data = await geolocation_service.get_location_from_ip(ip_address)
            country = geo_data.country
            city = geo_data.city
        else:
            country = None
            city = None

        device_session = DeviceSession(
            id=uuid.uuid4(),
            user_id=user_id,
            device_fingerprint=device_fingerprint,
            ip_address=ip_address,
            user_agent=user_agent,
            accept_language=accept_language,
            is_trusted=is_trusted,
            last_ip=ip_address,
            country=country,
            city=city,
            email_verified=False,
        )

        db.add(device_session)
        await db.commit()
        await db.refresh(device_session)

        logger.info(
            "device_session_created",
            user_id=str(user_id),
            device_fingerprint=device_fingerprint,
            ip_address=ip_address,
            country=geo_data.country,
            city=geo_data.city,
        )

        return device_session

    async def get_device_session(
        self,
        db: AsyncSession,
        user_id: uuid.UUID,
        device_fingerprint: str,
    ) -> DeviceSession | None:
        """
        Get device session by user ID and fingerprint.

        Args:
            db: Database session
            user_id: User ID
            device_fingerprint: Device fingerprint hash

        Returns:
            DeviceSession if found, None otherwise
        """
        result = await db.execute(
            select(DeviceSession)
            .where(DeviceSession.user_id == user_id)
            .where(DeviceSession.device_fingerprint == device_fingerprint)
        )
        return result.scalar_one_or_none()

    async def get_device_session_by_id(
        self,
        db: AsyncSession,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> DeviceSession | None:
        """
        Get device session by ID (with user ownership verification).

        Args:
            db: Database session
            session_id: Device session ID
            user_id: User ID (for ownership verification)

        Returns:
            DeviceSession if found and owned by user, None otherwise
        """
        result = await db.execute(
            select(DeviceSession)
            .where(DeviceSession.id == session_id)
            .where(DeviceSession.user_id == user_id)
        )
        return result.scalar_one_or_none()

    async def get_user_device_sessions(
        self,
        db: AsyncSession,
        user_id: uuid.UUID,
    ) -> list[DeviceSession]:
        """
        Get all device sessions for a user.

        Args:
            db: Database session
            user_id: User ID

        Returns:
            List of DeviceSessions
        """
        result = await db.execute(
            select(DeviceSession)
            .where(DeviceSession.user_id == user_id)
            .order_by(DeviceSession.last_seen.desc())
        )
        return list(result.scalars().all())

    async def update_device_session_activity(
        self,
        db: AsyncSession,
        device_session: DeviceSession,
        ip_address: str,
    ) -> DeviceSession:
        """
        Update device session last seen and IP address.

        Args:
            db: Database session
            device_session: DeviceSession to update
            ip_address: Current IP address

        Returns:
            Updated DeviceSession
        """
        device_session.last_seen = datetime.utcnow()
        device_session.last_ip = ip_address

        await db.commit()
        await db.refresh(device_session)

        return device_session

    async def trust_device(
        self,
        db: AsyncSession,
        device_session: DeviceSession,
    ) -> DeviceSession:
        """
        Mark a device as trusted.

        If DEVICE_VERIFICATION_REQUIRED_FOR_TRUSTED is enabled,
        the device must be email verified before it can be trusted.

        Args:
            db: Database session
            device_session: DeviceSession to trust

        Returns:
            Updated DeviceSession

        Raises:
            ValueError: If device verification is required but device is not verified
        """
        from app.core.config import settings

        # Check if verification is required before trusting
        if (
            settings.DEVICE_VERIFICATION_REQUIRED_FOR_TRUSTED
            and not device_session.email_verified
        ):
            raise ValueError(
                "Device must be email verified before it can be marked as trusted. "
                "Please verify the device via email first."
            )

        device_session.is_trusted = True
        await db.commit()
        await db.refresh(device_session)

        logger.info(
            "device_trusted",
            user_id=str(device_session.user_id),
            device_fingerprint=device_session.device_fingerprint,
        )

        return device_session

    async def delete_device_session(
        self,
        db: AsyncSession,
        device_session: DeviceSession,
    ) -> None:
        """
        Delete a device session.

        Args:
            db: Database session
            device_session: DeviceSession to delete
        """
        logger.info(
            "device_session_deleted",
            user_id=str(device_session.user_id),
            device_fingerprint=device_session.device_fingerprint,
        )

        await db.delete(device_session)
        await db.commit()

    async def get_or_create_device_session(
        self,
        db: AsyncSession,
        user_id: uuid.UUID,
        device_fingerprint: str,
        ip_address: str,
        user_agent: str,
        accept_language: str | None = None,
    ) -> tuple[DeviceSession, bool]:
        """
        Get existing device session or create new one.

        Args:
            db: Database session
            user_id: User ID
            device_fingerprint: Device fingerprint hash
            ip_address: IP address
            user_agent: User-Agent header
            accept_language: Accept-Language header

        Returns:
            Tuple of (DeviceSession, is_new_device)
        """
        # Check if device already exists
        existing_session = await self.get_device_session(
            db, user_id, device_fingerprint
        )

        if existing_session:
            # Update existing session
            await self.update_device_session_activity(db, existing_session, ip_address)
            return existing_session, False

        # Create new device session
        new_session = await self.create_device_session(
            db=db,
            user_id=user_id,
            device_fingerprint=device_fingerprint,
            ip_address=ip_address,
            user_agent=user_agent,
            accept_language=accept_language,
            is_trusted=False,  # New devices are not trusted by default
        )

        return new_session, True

    async def is_device_trusted(
        self,
        db: AsyncSession,
        user_id: uuid.UUID,
        device_fingerprint: str,
    ) -> bool:
        """
        Check if a device is trusted.

        Args:
            db: Database session
            user_id: User ID
            device_fingerprint: Device fingerprint hash

        Returns:
            True if device is trusted, False otherwise
        """
        device_session = await self.get_device_session(db, user_id, device_fingerprint)

        if not device_session:
            return False

        return device_session.is_trusted

    async def generate_verification_token(
        self,
        db: AsyncSession,
        device_session: DeviceSession,
    ) -> str:
        """
        Generate and store a verification token for a device session.

        Args:
            db: Database session
            device_session: DeviceSession to generate token for

        Returns:
            Verification token string
        """
        # Generate a secure random token
        verification_token = secrets.token_urlsafe(32)

        device_session.verification_token = verification_token
        device_session.verification_sent_at = datetime.utcnow()

        await db.commit()
        await db.refresh(device_session)

        logger.info(
            "device_verification_token_generated",
            user_id=str(device_session.user_id),
            device_id=str(device_session.id),
        )

        return verification_token

    async def verify_device_by_token(
        self,
        db: AsyncSession,
        verification_token: str,
    ) -> DeviceSession | None:
        """
        Verify a device using a verification token.

        Args:
            db: Database session
            verification_token: Verification token

        Returns:
            DeviceSession if verified successfully, None otherwise
        """
        # Find device session by token
        result = await db.execute(
            select(DeviceSession).where(
                DeviceSession.verification_token == verification_token
            )
        )
        device_session = result.scalar_one_or_none()

        if not device_session:
            logger.warning(
                "device_verification_failed",
                reason="token_not_found",
            )
            return None

        # Check if token is expired (24 hours)
        if device_session.verification_sent_at:
            token_age = datetime.utcnow() - device_session.verification_sent_at
            if token_age > timedelta(hours=24):
                logger.warning(
                    "device_verification_failed",
                    reason="token_expired",
                    user_id=str(device_session.user_id),
                    device_id=str(device_session.id),
                )
                return None

        # Mark device as verified
        device_session.email_verified = True
        device_session.verification_token = None  # Clear token after use

        await db.commit()
        await db.refresh(device_session)

        logger.info(
            "device_verified",
            user_id=str(device_session.user_id),
            device_id=str(device_session.id),
        )

        return device_session

    async def get_device_session_by_token(
        self,
        db: AsyncSession,
        verification_token: str,
    ) -> DeviceSession | None:
        """
        Get device session by verification token.

        Args:
            db: Database session
            verification_token: Verification token

        Returns:
            DeviceSession if found, None otherwise
        """
        result = await db.execute(
            select(DeviceSession).where(
                DeviceSession.verification_token == verification_token
            )
        )
        return result.scalar_one_or_none()

    async def is_device_verified(
        self,
        db: AsyncSession,
        user_id: uuid.UUID,
        device_fingerprint: str,
    ) -> bool:
        """
        Check if a device is email verified.

        Args:
            db: Database session
            user_id: User ID
            device_fingerprint: Device fingerprint hash

        Returns:
            True if device is verified, False otherwise
        """
        device_session = await self.get_device_session(db, user_id, device_fingerprint)

        if not device_session:
            return False

        return device_session.email_verified


# Global instance
device_session_service = DeviceSessionService()
