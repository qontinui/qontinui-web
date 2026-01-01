"""
Repository for download analytics operations.

Provides queries for analyzing runner download metrics.
"""

from datetime import datetime, timedelta
from typing import Any

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.usage_metric import UsageMetric

logger = structlog.get_logger(__name__)


class DownloadAnalyticsRepository:
    """
    Repository for download analytics operations.

    Provides specialized queries for:
    - Aggregating download statistics
    - Breaking down by country, platform, browser
    - Daily trends and UTM attribution
    """

    async def get_download_analytics(
        self,
        db: AsyncSession,
        days: int = 30,
    ) -> dict[str, Any]:
        """
        Get aggregated runner download analytics.

        Args:
            db: Async database session
            days: Number of days to look back

        Returns:
            Dict with aggregated download statistics
        """
        start_date = datetime.utcnow() - timedelta(days=days)

        # Get all download metrics
        result = await db.execute(
            select(UsageMetric)
            .where(UsageMetric.metric_type == "runner_download")
            .where(UsageMetric.timestamp >= start_date)
            .order_by(UsageMetric.timestamp.desc())
        )
        metrics = result.scalars().all()

        # Aggregate the data
        total_downloads = len(metrics)

        unique_hashes: set[str] = set()
        downloads_by_country: dict[str, int] = {}
        downloads_by_platform: dict[str, int] = {}
        downloads_by_browser: dict[str, int] = {}
        downloads_by_day: dict[str, int] = {}
        downloads_by_utm_source: dict[str, int] = {}
        recent_downloads: list[dict[str, Any]] = []

        for metric in metrics:
            metadata: dict[str, Any] = (
                dict(metric.metric_metadata) if metric.metric_metadata else {}
            )

            # Unique downloads by ip_hash
            ip_hash = metadata.get("ip_hash")
            if ip_hash:
                unique_hashes.add(ip_hash)

            # By country
            country = (
                metadata.get("country_code")
                or metadata.get("country_name")
                or "Unknown"
            )
            downloads_by_country[country] = downloads_by_country.get(country, 0) + 1

            # By platform
            platform = metadata.get("platform") or "Unknown"
            downloads_by_platform[platform] = downloads_by_platform.get(platform, 0) + 1

            # By browser
            browser = metadata.get("browser_family") or "Unknown"
            downloads_by_browser[browser] = downloads_by_browser.get(browser, 0) + 1

            # By day
            day = (
                metric.timestamp.strftime("%Y-%m-%d") if metric.timestamp else "Unknown"
            )
            downloads_by_day[day] = downloads_by_day.get(day, 0) + 1

            # By UTM source
            utm_source = metadata.get("utm_source")
            if utm_source:
                downloads_by_utm_source[utm_source] = (
                    downloads_by_utm_source.get(utm_source, 0) + 1
                )

            # Recent downloads (last 20)
            if len(recent_downloads) < 20:
                recent_downloads.append(
                    {
                        "timestamp": (
                            metric.timestamp.isoformat() if metric.timestamp else None
                        ),
                        "platform": metadata.get("platform"),
                        "country_code": metadata.get("country_code"),
                        "country_name": metadata.get("country_name"),
                        "city": metadata.get("city"),
                        "region": metadata.get("region"),
                        "browser": metadata.get("browser_family"),
                        "os": metadata.get("os_family"),
                        "version": metadata.get("version"),
                        "utm_source": metadata.get("utm_source"),
                        "utm_medium": metadata.get("utm_medium"),
                        "utm_campaign": metadata.get("utm_campaign"),
                        "referrer": (
                            metadata.get("referrer") or metadata.get("referer_header")
                        ),
                    }
                )

        # Sort aggregations by count (descending)
        def sort_dict(d: dict[str, int]) -> list[dict[str, Any]]:
            return [
                {"name": k, "count": v}
                for k, v in sorted(d.items(), key=lambda x: x[1], reverse=True)
            ]

        # Sort daily downloads by date (ascending for chart)
        daily_trend = [
            {"date": k, "count": v} for k, v in sorted(downloads_by_day.items())
        ]

        logger.debug(
            "get_download_analytics_completed",
            period_days=days,
            total_downloads=total_downloads,
            unique_downloads=len(unique_hashes),
        )

        return {
            "period_days": days,
            "total_downloads": total_downloads,
            "unique_downloads": len(unique_hashes),
            "downloads_by_country": sort_dict(downloads_by_country)[:20],
            "downloads_by_platform": sort_dict(downloads_by_platform),
            "downloads_by_browser": sort_dict(downloads_by_browser),
            "downloads_by_utm_source": sort_dict(downloads_by_utm_source)[:10],
            "daily_trend": daily_trend,
            "recent_downloads": recent_downloads,
        }


# Singleton instance
download_analytics_repository = DownloadAnalyticsRepository()
