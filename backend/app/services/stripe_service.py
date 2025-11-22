"""Stripe service - delegates to refactored architecture."""

from app.models.user import User
from app.services.stripe.stripe_facade import stripe_facade
from sqlalchemy.ext.asyncio import AsyncSession


class StripeService:
    """
    Stripe service - delegates to refactored Stripe facade.

    This maintains the original interface while using the new
    split architecture internally.
    """

    @staticmethod
    async def get_or_create_customer(user: User, db: AsyncSession) -> str:
        """Get or create Stripe customer ID."""
        return await stripe_facade.get_or_create_customer(user, db)

    @staticmethod
    async def create_checkout_session(
        user: User, price_id: str, db: AsyncSession, success_url: str, cancel_url: str
    ) -> dict:
        """Create a Stripe checkout session."""
        return await stripe_facade.create_checkout_session(
            user, price_id, db, success_url, cancel_url
        )

    @staticmethod
    async def create_billing_portal_session(
        user: User, db: AsyncSession, return_url: str
    ) -> dict:
        """Create a Stripe billing portal session."""
        return await stripe_facade.create_billing_portal_session(user, db, return_url)

    @staticmethod
    async def get_subscription(user: User, db: AsyncSession) -> dict | None:
        """Get subscription details for user."""
        return await stripe_facade.get_subscription(user, db)

    @staticmethod
    async def handle_webhook_event(event: dict, db: AsyncSession) -> None:
        """Handle Stripe webhook event."""
        await stripe_facade.handle_webhook_event(event, db)

    @staticmethod
    def get_tier_limits(tier: str) -> dict:
        """Get limits for a subscription tier."""
        return stripe_facade.get_tier_limits(tier)
