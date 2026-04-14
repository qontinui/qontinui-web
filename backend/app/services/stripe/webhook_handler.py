"""Stripe webhook event handler."""

from app.services.stripe.webhook_processors import (
    CheckoutCompletedProcessor, PaymentFailedProcessor,
    SubscriptionDeletedProcessor, SubscriptionUpdatedProcessor)
from sqlalchemy.ext.asyncio import AsyncSession


class StripeWebhookHandler:
    """Routes Stripe webhook events to appropriate processors."""

    def __init__(
        self,
        checkout_processor: CheckoutCompletedProcessor,
        subscription_updated_processor: SubscriptionUpdatedProcessor,
        subscription_deleted_processor: SubscriptionDeletedProcessor,
        payment_failed_processor: PaymentFailedProcessor,
    ):
        """Initialize the webhook handler with processors."""
        self.checkout_processor = checkout_processor
        self.subscription_updated_processor = subscription_updated_processor
        self.subscription_deleted_processor = subscription_deleted_processor
        self.payment_failed_processor = payment_failed_processor

    async def handle_event(self, event: dict, db: AsyncSession) -> None:
        """
        Handle Stripe webhook events by routing to appropriate processor.

        Args:
            event: Stripe event object
            db: Database session
        """
        event_type = event["type"]
        event_data = event["data"]["object"]

        if event_type == "checkout.session.completed":
            await self.checkout_processor.process(event_data, db)
        elif event_type == "customer.subscription.updated":
            await self.subscription_updated_processor.process(event_data, db)
        elif event_type == "customer.subscription.deleted":
            await self.subscription_deleted_processor.process(event_data, db)
        elif event_type == "invoice.payment_failed":
            await self.payment_failed_processor.process(event_data, db)
