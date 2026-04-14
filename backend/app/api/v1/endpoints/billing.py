"""Billing and subscription API endpoints"""

from typing import Annotated

import stripe
from app.api.deps import get_async_db, get_current_active_user_async
from app.core.config import settings
from app.models.subscription import SubscriptionTier
from app.models.user import User
from app.schemas.subscription import (
    BillingPortalResponse,
    CheckoutSessionRequest,
    CheckoutSessionResponse,
    SubscriptionResponse,
    TierLimitsResponse,
)
from app.services.limit_checker import LimitChecker
from app.services.stripe_service import StripeService
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter()


@router.get("/subscription", response_model=SubscriptionResponse)
async def get_subscription(
    current_user: Annotated[User, Depends(get_current_active_user_async)],
    db: Annotated[AsyncSession, Depends(get_async_db)],
) -> SubscriptionResponse:
    """Get current user's subscription details"""
    subscription = await StripeService.get_subscription(current_user, db)

    if not subscription:
        # Return free tier defaults if no subscription exists
        return SubscriptionResponse(
            tier=SubscriptionTier.FREE.value,
            status="active",
            cancel_at_period_end=False,
            current_period_end=None,
            stripe_status=None,
        )

    return SubscriptionResponse(**subscription)


@router.post(
    "/checkout",
    response_model=CheckoutSessionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_checkout_session(
    request_data: CheckoutSessionRequest,
    current_user: Annotated[User, Depends(get_current_active_user_async)],
    db: Annotated[AsyncSession, Depends(get_async_db)],
) -> CheckoutSessionResponse:
    """Create a Stripe checkout session for subscription purchase"""

    # Validate tier
    if request_data.tier not in [
        SubscriptionTier.HOBBY.value,
        SubscriptionTier.PRO.value,
    ]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid subscription tier. Must be 'hobby' or 'pro'.",
        )

    # Map tier to price ID
    price_id = (
        settings.STRIPE_PRICE_HOBBY
        if request_data.tier == SubscriptionTier.HOBBY.value
        else settings.STRIPE_PRICE_PRO
    )

    if not price_id:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Stripe price ID not configured for this tier",
        )

    # Create checkout session
    success_url = (
        f"{settings.FRONTEND_URL}/billing/success?session_id={{CHECKOUT_SESSION_ID}}"
    )
    cancel_url = f"{settings.FRONTEND_URL}/billing/canceled"

    try:
        session = await StripeService.create_checkout_session(
            user=current_user,
            price_id=price_id,
            db=db,
            success_url=success_url,
            cancel_url=cancel_url,
        )
        return CheckoutSessionResponse(**session)
    except stripe.error.StripeError as e:  # type: ignore[attr-defined]
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Stripe error: {str(e)}",
        )


@router.post("/portal", response_model=BillingPortalResponse)
async def create_billing_portal_session(
    current_user: Annotated[User, Depends(get_current_active_user_async)],
    db: Annotated[AsyncSession, Depends(get_async_db)],
) -> BillingPortalResponse:
    """Create a Stripe billing portal session for subscription management"""

    return_url = f"{settings.FRONTEND_URL}/settings/billing"

    try:
        session = await StripeService.create_billing_portal_session(
            user=current_user, db=db, return_url=return_url
        )
        return BillingPortalResponse(**session)
    except stripe.error.StripeError as e:  # type: ignore[attr-defined]
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Stripe error: {str(e)}",
        )


@router.get("/limits", response_model=TierLimitsResponse)
async def get_tier_limits(
    current_user: Annotated[User, Depends(get_current_active_user_async)],
    db: Annotated[AsyncSession, Depends(get_async_db)],
) -> TierLimitsResponse:
    """Get storage and resource limits for current user's tier"""

    # Get user's subscription
    subscription = await StripeService.get_subscription(current_user, db)
    tier = subscription["tier"] if subscription else SubscriptionTier.FREE.value

    # Get limits
    limits = StripeService.get_tier_limits(tier)

    return TierLimitsResponse(tier=tier, **limits)


@router.get("/usage")
async def get_usage_summary(
    current_user: Annotated[User, Depends(get_current_active_user_async)],
    db: Annotated[AsyncSession, Depends(get_async_db)],
) -> dict:
    """Get detailed usage summary with limits and percentages"""
    return await LimitChecker.get_usage_summary(
        db, current_user.id, current_user.subscription_tier
    )


@router.get("/read-only-status")
async def get_read_only_status(
    current_user: Annotated[User, Depends(get_current_active_user_async)],
    db: Annotated[AsyncSession, Depends(get_async_db)],
) -> dict:
    """Check if user is in read-only mode"""
    is_read_only, reason = await LimitChecker.is_read_only(
        db, current_user.id, current_user.subscription_tier
    )
    return {"is_read_only": is_read_only, "reason": reason}


@router.post("/webhook", status_code=status.HTTP_200_OK)
async def stripe_webhook(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_async_db)],
    stripe_signature: Annotated[str | None, Header(alias="stripe-signature")] = None,
):
    """Handle Stripe webhook events"""

    if not stripe_signature:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing stripe-signature header",
        )

    # Get raw body
    payload = await request.body()

    # Verify webhook signature
    if settings.STRIPE_WEBHOOK_SECRET:
        try:
            event = stripe.Webhook.construct_event(
                payload, stripe_signature, settings.STRIPE_WEBHOOK_SECRET
            )
        except ValueError:
            # Invalid payload
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid payload",
            )
        except stripe.error.SignatureVerificationError:  # type: ignore[attr-defined]
            # Invalid signature
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid signature",
            )
    else:
        # For testing without webhook secret
        event = stripe.Event.construct_from(
            values=await request.json(),
            key=settings.STRIPE_SECRET_KEY,
        )

    # Handle the event
    try:
        await StripeService.handle_webhook_event(event, db)
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Webhook processing error: {str(e)}",
        )
