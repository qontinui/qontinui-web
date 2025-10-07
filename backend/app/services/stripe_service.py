"""Stripe service for handling subscription payments."""

from datetime import datetime

import stripe
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.subscription import Subscription, SubscriptionStatus, SubscriptionTier
from app.models.user import User

# Initialize Stripe
stripe.api_key = settings.STRIPE_SECRET_KEY


class StripeService:
    """Service for managing Stripe subscriptions"""

    @staticmethod
    def get_or_create_customer(user: User, db: Session) -> str:
        """
        Get existing Stripe customer ID or create a new customer.

        Args:
            user: User model instance
            db: Database session

        Returns:
            Stripe customer ID
        """
        # Check if user already has a subscription with customer ID
        subscription = db.query(Subscription).filter_by(user_id=user.id).first()

        if subscription and subscription.stripe_customer_id:
            return subscription.stripe_customer_id

        # Create new Stripe customer
        customer = stripe.Customer.create(
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

        db.commit()

        return customer.id

    @staticmethod
    def create_checkout_session(
        user: User, price_id: str, db: Session, success_url: str, cancel_url: str
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
        customer_id = StripeService.get_or_create_customer(user, db)

        # Create checkout session
        checkout_session = stripe.checkout.Session.create(
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

    @staticmethod
    def create_billing_portal_session(user: User, db: Session, return_url: str) -> dict:
        """
        Create a Stripe billing portal session for subscription management.

        Args:
            user: User model instance
            db: Database session
            return_url: URL to return to after portal session

        Returns:
            Dict with portal session URL
        """
        customer_id = StripeService.get_or_create_customer(user, db)

        portal_session = stripe.billing_portal.Session.create(
            customer=customer_id, return_url=return_url
        )

        return {"url": portal_session.url}

    @staticmethod
    def get_subscription(user: User, db: Session) -> dict | None:
        """
        Get subscription details for a user.

        Args:
            user: User model instance
            db: Database session

        Returns:
            Dict with subscription details or None
        """
        subscription = db.query(Subscription).filter_by(user_id=user.id).first()

        if not subscription:
            return None

        result = {
            "tier": subscription.tier,
            "status": subscription.status,
            "cancel_at_period_end": subscription.cancel_at_period_end,
            "current_period_end": subscription.current_period_end.isoformat()
            if subscription.current_period_end
            else None,
        }

        # If there's a Stripe subscription, fetch live details
        if subscription.stripe_subscription_id:
            try:
                stripe_sub = stripe.Subscription.retrieve(
                    subscription.stripe_subscription_id
                )
                result["stripe_status"] = stripe_sub.status
                result["cancel_at_period_end"] = stripe_sub.cancel_at_period_end
            except stripe.error.StripeError:
                pass

        return result

    @staticmethod
    def handle_webhook_event(event: dict, db: Session) -> None:
        """
        Handle Stripe webhook events.

        Args:
            event: Stripe event object
            db: Database session
        """
        event_type = event["type"]

        if event_type == "checkout.session.completed":
            StripeService._handle_checkout_completed(event["data"]["object"], db)
        elif event_type == "customer.subscription.updated":
            StripeService._handle_subscription_updated(event["data"]["object"], db)
        elif event_type == "customer.subscription.deleted":
            StripeService._handle_subscription_deleted(event["data"]["object"], db)
        elif event_type == "invoice.payment_failed":
            StripeService._handle_payment_failed(event["data"]["object"], db)

    @staticmethod
    def _handle_checkout_completed(session: dict, db: Session) -> None:
        """Handle successful checkout session completion"""
        user_id = int(session["metadata"]["user_id"])
        subscription_id = session["subscription"]

        # Retrieve the subscription from Stripe
        stripe_sub = stripe.Subscription.retrieve(subscription_id)

        # Determine tier based on price ID
        price_id = stripe_sub["items"]["data"][0]["price"]["id"]
        tier = StripeService._get_tier_from_price_id(price_id)

        # Update subscription in database
        subscription = db.query(Subscription).filter_by(user_id=user_id).first()

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
            user = db.query(User).filter_by(id=user_id).first()
            if user:
                user.subscription_tier = tier

            db.commit()

    @staticmethod
    def _handle_subscription_updated(stripe_sub: dict, db: Session) -> None:
        """Handle subscription update events"""
        subscription = (
            db.query(Subscription)
            .filter_by(stripe_subscription_id=stripe_sub["id"])
            .first()
        )

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

            db.commit()

    @staticmethod
    def _handle_subscription_deleted(stripe_sub: dict, db: Session) -> None:
        """Handle subscription deletion (cancellation)"""
        subscription = (
            db.query(Subscription)
            .filter_by(stripe_subscription_id=stripe_sub["id"])
            .first()
        )

        if subscription:
            subscription.status = SubscriptionStatus.CANCELED.value
            subscription.tier = SubscriptionTier.FREE.value
            subscription.canceled_at = datetime.utcnow()

            # Also update user subscription_tier
            user = db.query(User).filter_by(id=subscription.user_id).first()
            if user:
                user.subscription_tier = SubscriptionTier.FREE.value

            db.commit()

    @staticmethod
    def _handle_payment_failed(invoice: dict, db: Session) -> None:
        """Handle failed payment events"""
        customer_id = invoice["customer"]

        subscription = (
            db.query(Subscription).filter_by(stripe_customer_id=customer_id).first()
        )

        if subscription:
            subscription.status = SubscriptionStatus.PAST_DUE.value
            db.commit()

    @staticmethod
    def _get_tier_from_price_id(price_id: str) -> str:
        """Map Stripe Price ID to subscription tier"""
        if price_id == settings.STRIPE_PRICE_HOBBY:
            return SubscriptionTier.HOBBY.value
        elif price_id == settings.STRIPE_PRICE_PRO:
            return SubscriptionTier.PRO.value
        return SubscriptionTier.FREE.value

    @staticmethod
    def get_tier_limits(tier: str) -> dict:
        """
        Get storage and resource limits for a subscription tier.

        Args:
            tier: Subscription tier (free, hobby, pro)

        Returns:
            Dict with tier limits
        """
        limits = {
            SubscriptionTier.FREE.value: {
                "max_configs": 5,
                "max_images": 50,
                "max_storage_mb": 25,
            },
            SubscriptionTier.HOBBY.value: {
                "max_configs": 100,
                "max_images": 500,
                "max_storage_mb": 200,
            },
            SubscriptionTier.PRO.value: {
                "max_configs": -1,  # unlimited
                "max_images": 5000,
                "max_storage_mb": 2048,  # 2 GB
            },
        }

        return limits.get(tier, limits[SubscriptionTier.FREE.value])
