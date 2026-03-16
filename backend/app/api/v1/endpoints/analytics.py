import hashlib
from datetime import UTC, datetime, timedelta

import structlog
from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db, get_current_active_user_async
from app.models.user import User
from app.services.analytics_service import analytics_service
from app.services.geolocation_service import geolocation_service
from app.services.metrics_service import metrics_service

logger = structlog.get_logger(__name__)

router = APIRouter()


def anonymize_ip(ip: str | None) -> str | None:
    """
    Anonymize IP address by truncating the last octet (IPv4) or last 80 bits (IPv6).

    This preserves geographic information while preventing individual identification.
    Examples:
        - 192.168.1.45 -> 192.168.1.0
        - 2001:0db8:85a3:0000:0000:8a2e:0370:7334 -> 2001:db8:85a3::
    """
    if not ip:
        return None

    # Handle IPv4
    if "." in ip and ":" not in ip:
        parts = ip.split(".")
        if len(parts) == 4:
            return f"{parts[0]}.{parts[1]}.{parts[2]}.0"

    # Handle IPv6
    if ":" in ip:
        # Expand :: notation and truncate last 80 bits (keep first 48 bits / 3 groups)
        # For simplicity, we hash the full IP to get a consistent anonymized version
        # that still allows counting unique IPs without revealing the actual address
        ip_hash = hashlib.sha256(ip.encode()).hexdigest()[:12]
        return f"ipv6:{ip_hash}"

    return None


def hash_ip_for_uniqueness(ip: str | None) -> str | None:
    """
    Create a hash of the IP for counting unique downloads.
    Cannot be reversed to get the original IP.
    """
    if not ip:
        return None
    return hashlib.sha256(ip.encode()).hexdigest()[:16]


@router.post("/analytics/download")
async def track_download(request: Request, db: AsyncSession = Depends(get_async_db)):
    """
    Track runner download events (public endpoint, no auth required)

    Privacy-friendly approach:
    - IP addresses are anonymized (last octet removed for IPv4)
    - A separate hash is stored for counting unique downloads
    - User agent is captured for browser/OS statistics
    - No cookies or fingerprinting used
    """
    try:
        data = await request.json()

        # Get client IP (handles proxies via X-Forwarded-For)
        forwarded_ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        client_ip: str | None = forwarded_ip if forwarded_ip else None
        if not client_ip:
            client_ip = request.client.host if request.client else None

        # Look up geolocation BEFORE anonymizing (then discard raw IP)
        geo = geolocation_service.lookup(client_ip)

        # Anonymize IP and create hash for uniqueness counting
        # Raw IP is never stored - only anonymized version and hash
        anonymized_ip = anonymize_ip(client_ip)
        ip_hash = hash_ip_for_uniqueness(client_ip)

        # Get other headers
        user_agent = request.headers.get("user-agent", "")
        referer = request.headers.get("referer", "")
        accept_language = request.headers.get("accept-language", "")

        # Parse user agent for high-level stats (without storing full string)
        os_family = "unknown"
        browser_family = "unknown"
        if user_agent:
            ua_lower = user_agent.lower()
            # Detect OS
            if "windows" in ua_lower:
                os_family = "windows"
            elif "mac" in ua_lower:
                os_family = "macos"
            elif "linux" in ua_lower:
                os_family = "linux"
            elif "android" in ua_lower:
                os_family = "android"
            elif "iphone" in ua_lower or "ipad" in ua_lower:
                os_family = "ios"

            # Detect browser
            if "firefox" in ua_lower:
                browser_family = "firefox"
            elif "edg" in ua_lower:
                browser_family = "edge"
            elif "chrome" in ua_lower:
                browser_family = "chrome"
            elif "safari" in ua_lower:
                browser_family = "safari"

        # Extract primary language
        primary_language = None
        if accept_language:
            primary_language = accept_language.split(",")[0].split(";")[0].strip()[:5]

        # Record download event using metrics service
        await metrics_service.track_event(
            db=db,
            user_id=None,  # type: ignore[arg-type]  # Public event, no user
            event_type="runner_download",
            value=1.0,
            metadata={
                # From client-side
                "platform": data.get("platform"),
                "version": data.get("version"),
                "timestamp": data.get("timestamp"),
                "timezone": data.get("timezone"),
                "screen_resolution": data.get("screen_resolution"),
                "referrer": data.get("referrer"),
                "utm_source": data.get("utm_source"),
                "utm_medium": data.get("utm_medium"),
                "utm_campaign": data.get("utm_campaign"),
                # From server-side (anonymized)
                "anonymized_ip": anonymized_ip,
                "ip_hash": ip_hash,  # For counting unique downloads
                "os_family": os_family,
                "browser_family": browser_family,
                "language": primary_language,
                "referer_header": (
                    referer[:200] if referer else None
                ),  # Truncate long referrers
                # Geolocation (looked up before IP anonymization)
                "country_code": geo.country_code if geo else None,
                "country_name": geo.country_name if geo else None,
                "city": geo.city if geo else None,
                "region": geo.region if geo else None,
                "continent": geo.continent if geo else None,
            },
        )

        return {"success": True}
    except Exception as e:
        # Silent fail - don't block download
        logger.warning("download_tracking_error", error=str(e))
        return {"success": False, "error": str(e)}


@router.get("/analytics/usage")
async def get_usage_analytics(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
):
    """
    Get current user's usage analytics

    Returns:
        - api_calls_today: Number of API calls made today
        - projects_count: Total number of projects
        - storage_used: Total storage used in bytes
        - last_active: Timestamp of last activity
    """
    usage = await analytics_service.get_user_usage_summary(current_user.id, db)

    return {
        "api_calls_today": usage.api_calls_today,
        "projects_count": usage.projects_count,
        "storage_used": usage.storage_used,
        "last_active": usage.last_active.isoformat() if usage.last_active else None,
    }


@router.get("/analytics/metrics")
async def get_user_metrics(
    metric_type: str | None = None,
    days: int = 7,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
):
    """
    Get detailed metrics for the current user

    Query params:
        - metric_type: Filter by metric type (api_call, project_created, etc.)
        - days: Number of days to look back (default 7)

    Returns:
        List of metrics with timestamps and values
    """
    start_date = datetime.now(UTC) - timedelta(days=days)

    metrics = await metrics_service.get_user_metrics(
        db=db,
        user_id=current_user.id,
        start_date=start_date,
        metric_type=metric_type,
    )

    return {
        "metrics": [
            {
                "id": metric.id,
                "metric_type": metric.metric_type,
                "value": float(metric.value),
                "timestamp": metric.timestamp.isoformat(),
                "metadata": metric.metric_metadata,
            }
            for metric in metrics
        ],
        "count": len(metrics),
    }


@router.get("/analytics/summary")
async def get_analytics_summary(
    days: int = 30,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_active_user_async),
):
    """
    Get a comprehensive analytics summary for the current user

    Query params:
        - days: Number of days to look back (default 30)

    Returns:
        Summary of all metrics including API calls, projects, states, images, etc.
    """
    summary = await analytics_service.get_analytics_summary(current_user.id, days, db)

    return {
        "period_days": summary.period_days,
        "period_start": summary.period_start.isoformat(),
        "period_end": summary.period_end.isoformat(),
        "api_calls": summary.api_calls,
        "projects_created": summary.projects_created,
        "states_created": summary.states_created,
        "images_uploaded": summary.images_uploaded,
        "total_projects": summary.total_projects,
        "total_storage_bytes": summary.total_storage_bytes,
        "avg_response_time_seconds": summary.avg_response_time_seconds,
        "last_active": summary.last_active.isoformat() if summary.last_active else None,
    }
