"""
Geolocation service using MaxMind GeoLite2 database.

This service provides IP-to-location lookups for analytics purposes.
The lookup happens BEFORE IP anonymization, then the raw IP is discarded.

Setup:
1. Create a free MaxMind account at https://www.maxmind.com/en/geolite2/signup
2. Download GeoLite2-City.mmdb from your account
3. Place it in backend/data/GeoLite2-City.mmdb
   OR set GEOIP_DATABASE_PATH environment variable

The service gracefully handles missing database files.
"""

from dataclasses import dataclass
from pathlib import Path

import structlog

logger = structlog.get_logger(__name__)

# Try to import geoip2, but don't fail if not available
try:
    import geoip2.database
    import geoip2.errors

    GEOIP2_AVAILABLE = True
except ImportError:
    GEOIP2_AVAILABLE = False
    logger.warning("geoip2_not_installed", message="Install geoip2 for geolocation")


@dataclass
class GeoLocation:
    """Geolocation data for an IP address."""

    country_code: str | None = None  # ISO 3166-1 alpha-2 (e.g., "US", "DE")
    country_name: str | None = None  # Full country name
    city: str | None = None  # City name
    region: str | None = None  # State/province/region
    continent: str | None = None  # Continent code (e.g., "EU", "NA")
    latitude: float | None = None
    longitude: float | None = None


class GeolocationService:
    """
    Service for looking up geographic location from IP addresses.

    Uses MaxMind GeoLite2-City database for lookups.
    Gracefully handles missing database or lookup failures.
    """

    def __init__(self) -> None:
        self._reader: geoip2.database.Reader | None = None
        self._initialized = False
        self._database_path: Path | None = None

    def _get_database_path(self) -> Path | None:
        """Find the GeoLite2 database file."""
        import os

        # Check environment variable first
        env_path = os.environ.get("GEOIP_DATABASE_PATH")
        if env_path:
            path = Path(env_path)
            if path.exists():
                return path

        # Check default locations
        default_paths = [
            Path(__file__).parent.parent.parent / "data" / "GeoLite2-City.mmdb",
            Path("/var/lib/GeoIP/GeoLite2-City.mmdb"),  # Linux standard
            Path("C:/ProgramData/MaxMind/GeoLite2-City.mmdb"),  # Windows
        ]

        for path in default_paths:
            if path.exists():
                return path

        return None

    def _ensure_initialized(self) -> bool:
        """Initialize the database reader if not already done."""
        if self._initialized:
            return self._reader is not None

        self._initialized = True

        if not GEOIP2_AVAILABLE:
            logger.info("geolocation_disabled", reason="geoip2 not installed")
            return False

        self._database_path = self._get_database_path()
        if not self._database_path:
            logger.info(
                "geolocation_disabled",
                reason="GeoLite2-City.mmdb not found",
                hint="Download from MaxMind and place in backend/data/",
            )
            return False

        try:
            self._reader = geoip2.database.Reader(str(self._database_path))
            logger.info(
                "geolocation_enabled",
                database_path=str(self._database_path),
            )
            return True
        except Exception as e:
            logger.warning(
                "geolocation_init_failed",
                error=str(e),
                database_path=str(self._database_path),
            )
            return False

    def lookup(self, ip: str | None) -> GeoLocation | None:
        """
        Look up geographic location for an IP address.

        Args:
            ip: IPv4 or IPv6 address string

        Returns:
            GeoLocation with available data, or None if lookup failed
        """
        if not ip:
            return None

        if not self._ensure_initialized():
            return None

        if not self._reader:
            return None

        try:
            response = self._reader.city(ip)

            return GeoLocation(
                country_code=response.country.iso_code,
                country_name=response.country.name,
                city=response.city.name,
                region=(
                    response.subdivisions.most_specific.name
                    if response.subdivisions
                    else None
                ),
                continent=response.continent.code,
                latitude=response.location.latitude,
                longitude=response.location.longitude,
            )
        except geoip2.errors.AddressNotFoundError:
            # IP not in database (e.g., private IP, localhost)
            return None
        except Exception as e:
            logger.warning("geolocation_lookup_failed", ip=ip[:10], error=str(e))
            return None

    def close(self) -> None:
        """Close the database reader."""
        if self._reader:
            self._reader.close()
            self._reader = None

    @property
    def is_available(self) -> bool:
        """Check if geolocation is available."""
        return self._ensure_initialized()


# Singleton instance
geolocation_service = GeolocationService()
