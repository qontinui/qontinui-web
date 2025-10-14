"""Stripe checkout session management service."""

import asyncio

import stripe
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.services.stripe.customer_service import StripeCustomerService


class StripeCheckoutService:
    """Handles Stripe checkout session creation."""

    def __init__(
        self,
        customer_service: StripeCustomerService,
        stripe_client: stripe = stripe,
    ):
        """Initialize the checkout service."""
        self.customer_service = customer_service
        self.stripe = stripe_client

    async def create_checkout_session(
        self,
        user: User,
        price_id: str,
        db: AsyncSession,
        success_url: str,
        cancel_url: str,
    ) -> dict:
        """
        Create a Stripe Checkout session for subscription.

        Args:
            user: User model instance
            price_id: Stripe Price ID (price_xxx)
            db: Database session
            success_url: URL to redirect on success
            cancel_url: URL to redirect on cancel

        Returns:
            Dict with checkout session details
        """
        customer_id = await self.customer_service.get_or_create_customer(user, db)

        # Create checkout session (run in thread pool)
        checkout_session = await asyncio.to_thread(
            self.stripe.checkout.Session.create,
            customer=customer_id,
            payment_method_types=["card"],
            mode="subscription",
            line_items=[{"price": price_id, "quantity": 1}],
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={"user_id": str(user.id)},
            allow_promotion_codes=True,
        )

        return {"session_id": checkout_session.id, "url": checkout_session.url}

    async def create_billing_portal_session(
        self, user: User, db: AsyncSession, return_url: str
    ) -> dict:
        """
        Create a Stripe billing portal session for subscription management.

        Args:
            user: User model instance
            db: Database session
            return_url: URL to return to after portal session

        Returns:
            Dict with portal session URL
        """
        customer_id = await self.customer_service.get_or_create_customer(user, db)

        # Create billing portal session (run in thread pool)
        portal_session = await asyncio.to_thread(
            self.stripe.billing_portal.Session.create,
            customer=customer_id,
            return_url=return_url,
        )

        return {"url": portal_session.url}
