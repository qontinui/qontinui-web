"""Pydantic schemas for subscription API"""

from pydantic import BaseModel, Field


class SubscriptionResponse(BaseModel):
    """Response schema for subscription details"""

    tier: str = Field(..., description="Subscription tier (free, hobby, pro)")
    status: str = Field(..., description="Subscription status")
    cancel_at_period_end: bool = Field(
        False, description="Whether subscription will cancel at period end"
    )
    current_period_end: str | None = Field(
        None, description="ISO timestamp of when current period ends"
    )
    stripe_status: str | None = Field(
        None, description="Live Stripe subscription status"
    )


class CheckoutSessionRequest(BaseModel):
    """Request schema for creating checkout session"""

    tier: str = Field(..., description="Subscription tier to purchase (hobby or pro)")


class CheckoutSessionResponse(BaseModel):
    """Response schema for checkout session"""

    session_id: str = Field(..., description="Stripe checkout session ID")
    url: str = Field(..., description="Stripe checkout URL")


class BillingPortalResponse(BaseModel):
    """Response schema for billing portal session"""

    url: str = Field(..., description="Stripe billing portal URL")


class TierLimitsResponse(BaseModel):
    """Response schema for tier limits"""

    tier: str = Field(..., description="Subscription tier")
    max_configs: int = Field(
        ..., description="Maximum number of configs (-1 = unlimited)"
    )
    max_images: int = Field(..., description="Maximum number of images")
    max_storage_mb: int = Field(..., description="Maximum storage in MB")
