"""Stripe facade - unified interface to all Stripe services."""

import stripe
from app.core.config import settings
from app.models.user import User
from app.services.stripe.checkout_service import StripeCheckoutService
from app.services.stripe.customer_service import StripeCustomerService
from app.services.stripe.subscription_service import StripeSubscriptionService
from app.services.stripe.tier_service import TierService
from app.services.stripe.webhook_handler import StripeWebhookHandler
from app.services.stripe.webhook_processors import (
    CheckoutCompletedProcessor,
    PaymentFailedProcessor,
    SubscriptionDeletedProcessor,
    SubscriptionUpdatedProcessor,
)
from sqlalchemy.ext.asyncio import AsyncSession

# Initialize Stripe
stripe.api_key = settings.STRIPE_SECRET_KEY


class StripeFacade:
    """
    Unified facade for all Stripe operations.

    Provides a clean interface to customer, checkout, subscription,
    tier, and webhook services.
    """

    def __init__(self):
        """Initialize all Stripe services."""
        # Core services
        self.tier_service = TierService()
        self.customer_service = StripeCustomerService()
        self.checkout_service = StripeCheckoutService(self.customer_service)
        self.subscription_service = StripeSubscriptionService()

        # Webhook processors
        checkout_processor = CheckoutCompletedProcessor(self.tier_service)
        subscription_updated_processor = SubscriptionUpdatedProcessor()
        subscription_deleted_processor = SubscriptionDeletedProcessor()
        payment_failed_processor = PaymentFailedProcessor()

        # Webhook handler
        self.webhook_handler = StripeWebhookHandler(
            checkout_processor,
            subscription_updated_processor,
            subscription_deleted_processor,
            payment_failed_processor,
        )

    # Customer operations
    async def get_or_create_customer(self, user: User, db: AsyncSession) -> str:
        """Get or create Stripe customer ID for user."""
        return await self.customer_service.get_or_create_customer(user, db)

    # Checkout operations
    async def create_checkout_session(
        self,
        user: User,
        price_id: str,
        db: AsyncSession,
        success_url: str,
        cancel_url: str,
    ) -> dict:
        """Create a Stripe checkout session."""
        return await self.checkout_service.create_checkout_session(
            user, price_id, db, success_url, cancel_url
        )

    async def create_billing_portal_session(
        self, user: User, db: AsyncSession, return_url: str
    ) -> dict:
        """Create a Stripe billing portal session."""
        return await self.checkout_service.create_billing_portal_session(
            user, db, return_url
        )

    # Subscription operations
    async def get_subscription(self, user: User, db: AsyncSession) -> dict | None:
        """Get subscription details for user."""
        return await self.subscription_service.get_subscription(user, db)

    # Tier operations
    def get_tier_limits(self, tier: str) -> dict:
        """Get limits for a subscription tier."""
        return self.tier_service.get_tier_limits(tier)

    def get_tier_from_price_id(self, price_id: str) -> str:
        """Map Stripe price ID to subscription tier."""
        return self.tier_service.get_tier_from_price_id(price_id)

    # Webhook operations
    async def handle_webhook_event(self, event: dict, db: AsyncSession) -> None:
        """Handle Stripe webhook event."""
        await self.webhook_handler.handle_event(event, db)


# Create singleton instance
stripe_facade = StripeFacade()
