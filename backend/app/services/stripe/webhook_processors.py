"""Webhook event processors for Stripe events."""

import asyncio
from datetime import datetime

import stripe
from app.models.subscription import Subscription, SubscriptionStatus, SubscriptionTier
from app.models.user import User
from app.services.stripe.tier_service import TierService
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


class CheckoutCompletedProcessor:
    """Processes checkout.session.completed events."""

    def __init__(self, tier_service: TierService, stripe_client: stripe = stripe):
        """Initialize the processor."""
        self.tier_service = tier_service
        self.stripe = stripe_client

    async def process(self, session: dict, db: AsyncSession) -> None:
        """
        Handle successful checkout session completion.

        Args:
            session: Stripe checkout session object
            db: Database session
        """
        user_id = int(session["metadata"]["user_id"])
        subscription_id = session["subscription"]

        # Retrieve the subscription from Stripe (run in thread pool)
        stripe_sub = await asyncio.to_thread(
            self.stripe.Subscription.retrieve, subscription_id
        )

        # Determine tier based on price ID
        price_id = stripe_sub["items"]["data"][0]["price"]["id"]
        tier = self.tier_service.get_tier_from_price_id(price_id)

        # Update subscription in database
        result = await db.execute(
            select(Subscription).filter(Subscription.user_id == user_id)
        )
        subscription = result.scalar_one_or_none()

        if subscription:
            subscription.stripe_subscription_id = subscription_id
            subscription.stripe_price_id = price_id
            subscription.tier = tier
            subscription.status = SubscriptionStatus.ACTIVE.value
            subscription.current_period_start = datetime.fromtimestamp(
                stripe_sub["current_period_start"]
            )
            subscription.current_period_end = datetime.fromtimestamp(
                stripe_sub["current_period_end"]
            )
            subscription.cancel_at_period_end = stripe_sub["cancel_at_period_end"]

            # Also update user subscription_tier
            result_user = await db.execute(select(User).filter(User.id == user_id))
            user = result_user.scalar_one_or_none()
            if user:
                user.subscription_tier = tier

            await db.commit()


class SubscriptionUpdatedProcessor:
    """Processes customer.subscription.updated events."""

    async def process(self, stripe_sub: dict, db: AsyncSession) -> None:
        """
        Handle subscription update events.

        Args:
            stripe_sub: Stripe subscription object
            db: Database session
        """
        result = await db.execute(
            select(Subscription).filter(
                Subscription.stripe_subscription_id == stripe_sub["id"]
            )
        )
        subscription = result.scalar_one_or_none()

        if subscription:
            subscription.status = stripe_sub["status"]
            subscription.current_period_start = datetime.fromtimestamp(
                stripe_sub["current_period_start"]
            )
            subscription.current_period_end = datetime.fromtimestamp(
                stripe_sub["current_period_end"]
            )
            subscription.cancel_at_period_end = stripe_sub["cancel_at_period_end"]

            if stripe_sub["cancel_at_period_end"]:
                subscription.canceled_at = datetime.utcnow()

            await db.commit()


class SubscriptionDeletedProcessor:
    """Processes customer.subscription.deleted events."""

    async def process(self, stripe_sub: dict, db: AsyncSession) -> None:
        """
        Handle subscription deletion (cancellation).

        Args:
            stripe_sub: Stripe subscription object
            db: Database session
        """
        result = await db.execute(
            select(Subscription).filter(
                Subscription.stripe_subscription_id == stripe_sub["id"]
            )
        )
        subscription = result.scalar_one_or_none()

        if subscription:
            subscription.status = SubscriptionStatus.CANCELED.value
            subscription.tier = SubscriptionTier.FREE.value
            subscription.canceled_at = datetime.utcnow()

            # Also update user subscription_tier
            result_user = await db.execute(
                select(User).filter(User.id == subscription.user_id)
            )
            user = result_user.scalar_one_or_none()
            if user:
                user.subscription_tier = SubscriptionTier.FREE.value

            await db.commit()


class PaymentFailedProcessor:
    """Processes invoice.payment_failed events."""

    async def process(self, invoice: dict, db: AsyncSession) -> None:
        """
        Handle failed payment events.

        Args:
            invoice: Stripe invoice object
            db: Database session
        """
        customer_id = invoice["customer"]

        result = await db.execute(
            select(Subscription).filter(Subscription.stripe_customer_id == customer_id)
        )
        subscription = result.scalar_one_or_none()

        if subscription:
            subscription.status = SubscriptionStatus.PAST_DUE.value
            await db.commit()
