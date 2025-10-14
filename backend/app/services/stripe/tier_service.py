"""Subscription tier mapping and limits service."""

from app.core.config import settings
from app.models.subscription import SubscriptionTier


class TierService:
    """Handles subscription tier mapping and limit definitions."""

    @staticmethod
    def get_tier_from_price_id(price_id: str) -> str:
        """
        Map Stripe Price ID to subscription tier.

        Args:
            price_id: Stripe Price ID

        Returns:
            Subscription tier value
        """
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
