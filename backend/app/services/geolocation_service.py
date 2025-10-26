"""
Geolocation service for determining location from IP addresses.

Uses ipapi.co free API with Redis caching for improved performance.
"""

import httpx
import structlog

logger = structlog.get_logger(__name__)


class GeolocationData:
    """Data class for geolocation information."""

    def __init__(
        self,
        country: str | None = None,
        city: str | None = None,
        timezone: str | None = None,
    ):
        self.country = country
        self.city = city
        self.timezone = timezone

    def __repr__(self) -> str:
        return f"GeolocationData(country={self.country}, city={self.city}, timezone={self.timezone})"


class GeolocationService:
    """Service for IP-based geolocation with Redis caching."""

    # Cache TTL: 24 hours (86400 seconds)
    CACHE_TTL = 86400
    # Request timeout
    REQUEST_TIMEOUT = 5.0

    def __init__(self):
        """Initialize the geolocation service."""
        self._redis_client = None
        self._redis_initialized = False

    async def _get_redis_client(self):
        """Get Redis client for caching (lazy initialization)."""
        if self._redis_initialized:
            return self._redis_client

        try:
            from app.core.config import settings

            if not settings.REDIS_ENABLED:
                logger.info("redis_disabled_for_geolocation")
                self._redis_initialized = True
                return None

            import redis.asyncio as redis

            self._redis_client = redis.Redis(
                host=settings.REDIS_HOST,
                port=settings.REDIS_PORT,
                db=settings.REDIS_DB,
                decode_responses=True,
            )
            # Test connection
            await self._redis_client.ping()
            logger.info("redis_connected_for_geolocation")
        except Exception as e:
            logger.warning(
                "redis_unavailable_for_geolocation",
                error=str(e),
                error_type=type(e).__name__,
            )
            self._redis_client = None

        self._redis_initialized = True
        return self._redis_client

    async def _get_from_cache(self, ip_address: str) -> GeolocationData | None:
        """
        Get geolocation data from Redis cache.

        Args:
            ip_address: IP address to lookup

        Returns:
            GeolocationData if found in cache, None otherwise
        """
        redis = await self._get_redis_client()
        if not redis:
            return None

        try:
            cache_key = f"geo:{ip_address}"
            cached_data = await redis.hgetall(cache_key)

            if cached_data:
                logger.debug("geolocation_cache_hit", ip_address=ip_address)
                return GeolocationData(
                    country=cached_data.get("country"),
                    city=cached_data.get("city"),
                    timezone=cached_data.get("timezone"),
                )

            logger.debug("geolocation_cache_miss", ip_address=ip_address)
            return None
        except Exception as e:
            logger.warning(
                "geolocation_cache_read_error",
                ip_address=ip_address,
                error=str(e),
                error_type=type(e).__name__,
            )
            return None

    async def _save_to_cache(self, ip_address: str, geo_data: GeolocationData) -> None:
        """
        Save geolocation data to Redis cache.

        Args:
            ip_address: IP address
            geo_data: Geolocation data to cache
        """
        redis = await self._get_redis_client()
        if not redis:
            return

        try:
            cache_key = f"geo:{ip_address}"
            cache_data = {}

            if geo_data.country:
                cache_data["country"] = geo_data.country
            if geo_data.city:
                cache_data["city"] = geo_data.city
            if geo_data.timezone:
                cache_data["timezone"] = geo_data.timezone

            if cache_data:
                await redis.hset(cache_key, mapping=cache_data)
                await redis.expire(cache_key, self.CACHE_TTL)
                logger.debug(
                    "geolocation_cached",
                    ip_address=ip_address,
                    ttl=self.CACHE_TTL,
                )
        except Exception as e:
            logger.warning(
                "geolocation_cache_write_error",
                ip_address=ip_address,
                error=str(e),
                error_type=type(e).__name__,
            )

    async def _fetch_from_api(self, ip_address: str) -> GeolocationData | None:
        """
        Fetch geolocation data from ipapi.co API.

        Args:
            ip_address: IP address to lookup

        Returns:
            GeolocationData if successful, None otherwise
        """
        # Don't try to geolocate private/local IPs
        if self._is_private_ip(ip_address):
            logger.debug("geolocation_skipped_private_ip", ip_address=ip_address)
            return GeolocationData(
                country="Local",
                city="Local",
                timezone=None,
            )

        try:
            async with httpx.AsyncClient() as client:
                # ipapi.co free tier allows 1000 requests/day without API key
                # Format: https://ipapi.co/{ip}/json/
                url = f"https://ipapi.co/{ip_address}/json/"

                response = await client.get(url, timeout=self.REQUEST_TIMEOUT)

                if response.status_code == 200:
                    data = response.json()

                    # Check if we got an error from the API
                    if "error" in data:
                        logger.warning(
                            "geolocation_api_error",
                            ip_address=ip_address,
                            error=data.get("reason", "Unknown error"),
                        )
                        return None

                    geo_data = GeolocationData(
                        country=data.get("country_name"),
                        city=data.get("city"),
                        timezone=data.get("timezone"),
                    )

                    logger.info(
                        "geolocation_fetched",
                        ip_address=ip_address,
                        country=geo_data.country,
                        city=geo_data.city,
                    )
                    return geo_data
                else:
                    logger.warning(
                        "geolocation_api_error",
                        ip_address=ip_address,
                        status_code=response.status_code,
                    )
                    return None

        except TimeoutError:
            logger.warning("geolocation_timeout", ip_address=ip_address)
            return None
        except Exception as e:
            logger.error(
                "geolocation_api_error",
                ip_address=ip_address,
                error=str(e),
                error_type=type(e).__name__,
            )
            return None

    def _is_private_ip(self, ip_address: str) -> bool:
        """
        Check if IP address is private/local.

        Args:
            ip_address: IP address to check

        Returns:
            True if private/local, False otherwise
        """
        # Common local/private IP patterns
        private_patterns = [
            "127.",
            "localhost",
            "10.",
            "192.168.",
            "172.16.",
            "172.17.",
            "172.18.",
            "172.19.",
            "172.20.",
            "172.21.",
            "172.22.",
            "172.23.",
            "172.24.",
            "172.25.",
            "172.26.",
            "172.27.",
            "172.28.",
            "172.29.",
            "172.30.",
            "172.31.",
            "::1",
            "fe80:",
        ]

        return any(ip_address.startswith(pattern) for pattern in private_patterns)

    async def get_location_from_ip(self, ip_address: str) -> GeolocationData:
        """
        Get geolocation data for an IP address.

        Checks Redis cache first, then fetches from API if not cached.
        Results are cached in Redis for 24 hours.

        Args:
            ip_address: IP address to lookup

        Returns:
            GeolocationData with country, city, and timezone (fields may be None)
        """
        # Try cache first
        cached_data = await self._get_from_cache(ip_address)
        if cached_data:
            return cached_data

        # Fetch from API
        geo_data = await self._fetch_from_api(ip_address)

        # Return empty data if API fetch failed
        if not geo_data:
            geo_data = GeolocationData()

        # Cache the result (even if empty, to avoid repeated API calls)
        await self._save_to_cache(ip_address, geo_data)

        return geo_data


# Global instance
geolocation_service = GeolocationService()
