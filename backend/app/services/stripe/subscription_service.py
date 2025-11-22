"""Stripe subscription retrieval service."""

import asyncio

import stripe
from app.models.subscription import Subscription
from app.models.user import User
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


class StripeSubscriptionService:
    """Handles subscription retrieval and details."""

    def __init__(self, stripe_client: stripe = stripe):
        """Initialize the subscription service."""
        self.stripe = stripe_client

    async def get_subscription(self, user: User, db: AsyncSession) -> dict | None:
        """
        Get subscription details for a user.

        Args:
            user: User model instance
            db: Database session

        Returns:
            Dict with subscription details or None
        """
        result_db = await db.execute(
            select(Subscription).filter(Subscription.user_id == user.id)
        )
        subscription = result_db.scalar_one_or_none()

        if not subscription:
            return None

        result = {
            "tier": subscription.tier,
            "status": subscription.status,
            "cancel_at_period_end": subscription.cancel_at_period_end,
            "current_period_end": (
                subscription.current_period_end.isoformat()
                if subscription.current_period_end
                else None
            ),
        }

        # If there's a Stripe subscription, fetch live details
        if subscription.stripe_subscription_id:
            try:
                # Run Stripe API call in thread pool
                stripe_sub = await asyncio.to_thread(
                    self.stripe.Subscription.retrieve,
                    subscription.stripe_subscription_id,
                )
                result["stripe_status"] = stripe_sub.status
                result["cancel_at_period_end"] = stripe_sub.cancel_at_period_end
            except stripe.error.StripeError:
                pass

        return result
