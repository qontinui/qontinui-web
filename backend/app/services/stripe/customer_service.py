"""Stripe customer management service."""

import asyncio

import stripe
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.subscription import Subscription, SubscriptionTier
from app.models.user import User


class StripeCustomerService:
    """Handles Stripe customer creation and retrieval."""

    def __init__(self, stripe_client: stripe = stripe):
        """Initialize the customer service with a Stripe client."""
        self.stripe = stripe_client

    async def get_or_create_customer(self, user: User, db: AsyncSession) -> str:
        """
        Get existing Stripe customer ID or create a new customer.

        Args:
            user: User model instance
            db: Database session

        Returns:
            Stripe customer ID
        """
        # Check if user already has a subscription with customer ID
        result = await db.execute(
            select(Subscription).filter(Subscription.user_id == user.id)
        )
        subscription = result.scalar_one_or_none()

        if subscription and subscription.stripe_customer_id:
            return subscription.stripe_customer_id

        # Create new Stripe customer (run in thread pool since Stripe SDK is sync)
        customer = await asyncio.to_thread(
            self.stripe.Customer.create,
            email=user.email,
            name=user.full_name or user.username,
            metadata={"user_id": str(user.id), "username": user.username},
        )

        # Create or update subscription record
        if not subscription:
            subscription = Subscription(
                user_id=user.id,
                stripe_customer_id=customer.id,
                tier=SubscriptionTier.FREE.value,
            )
            db.add(subscription)
        else:
            subscription.stripe_customer_id = customer.id

        await db.commit()

        return customer.id

    async def get_customer_id(self, user: User, db: AsyncSession) -> str | None:
        """
        Get existing Stripe customer ID without creating one.

        Args:
            user: User model instance
            db: Database session

        Returns:
            Stripe customer ID or None
        """
        result = await db.execute(
            select(Subscription).filter(Subscription.user_id == user.id)
        )
        subscription = result.scalar_one_or_none()
        return subscription.stripe_customer_id if subscription else None
