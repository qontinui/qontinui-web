"""
Security endpoints for handling security-related reports and monitoring.

This module provides endpoints for:
- CSP (Content Security Policy) violation reports
- Security incident tracking
- Security policy enforcement
"""

import structlog
from app.api.deps import get_async_db
from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)

router = APIRouter()


class CSPViolationReport(BaseModel):
    """Content Security Policy violation report."""

    document_uri: str | None = None
    referrer: str | None = None
    violated_directive: str | None = None
    effective_directive: str | None = None
    original_policy: str | None = None
    blocked_uri: str | None = None
    status_code: int | None = None
    source_file: str | None = None
    line_number: int | None = None
    column_number: int | None = None
    disposition: str | None = None  # "enforce" or "report"


class CSPReportWrapper(BaseModel):
    """Wrapper for CSP report (browsers send it with 'csp-report' key)."""

    csp_report: CSPViolationReport


@router.post(
    "/csp-report",
    status_code=status.HTTP_204_NO_CONTENT,
    include_in_schema=False,  # Hide from OpenAPI docs as it's browser-only
)
async def receive_csp_report(
    request: Request,
    db: AsyncSession = Depends(get_async_db),
) -> None:
    """
    Receive and log Content Security Policy violation reports.

    This endpoint is called by browsers when they detect a CSP violation.
    The reports help identify security issues and potential XSS attacks.

    The endpoint accepts both:
    - Standard CSP report format: {"csp-report": {...}}
    - Modern Reporting API format: {...}

    Note:
        This endpoint is configured in the CSP header's report-uri directive.
        Browsers automatically send violation reports to this endpoint.

    Security Considerations:
        - No authentication required (browser-generated reports)
        - Rate limiting should be applied at infrastructure level
        - Reports are logged but don't trigger automatic actions
        - Validate report data to prevent log injection
    """
    try:
        # Get raw body as some browsers send non-standard formats
        body = await request.json()

        # Handle both CSP report formats
        if "csp-report" in body:
            # Standard CSP report format
            report_data = body["csp-report"]
        else:
            # Modern Reporting API format
            report_data = body

        # Extract key violation details
        violated_directive = report_data.get("violated-directive") or report_data.get(
            "violatedDirective"
        )
        blocked_uri = report_data.get("blocked-uri") or report_data.get("blockedURI")
        document_uri = report_data.get("document-uri") or report_data.get("documentURI")
        source_file = report_data.get("source-file") or report_data.get("sourceFile")
        line_number = report_data.get("line-number") or report_data.get("lineNumber")

        # Get client information
        client_ip = request.client.host if request.client else "unknown"
        user_agent = request.headers.get("user-agent", "unknown")

        # Log CSP violation with detailed context
        logger.warning(
            "csp_violation_detected",
            violated_directive=violated_directive,
            blocked_uri=blocked_uri,
            document_uri=document_uri,
            source_file=source_file,
            line_number=line_number,
            client_ip=client_ip,
            user_agent=user_agent,
            full_report=report_data,  # Include full report for debugging
        )

        # Optional: Store in database for analysis
        # This could be used to track recurring violations or identify attacks
        # await store_csp_violation(db, report_data, client_ip, user_agent)

        # Optional: Alert on specific violation patterns
        if _is_suspicious_violation(report_data):
            logger.error(
                "suspicious_csp_violation",
                violated_directive=violated_directive,
                blocked_uri=blocked_uri,
                client_ip=client_ip,
                reason="Potential XSS attack attempt detected",
            )

        return None  # 204 No Content

    except Exception as e:
        # Log error but don't fail the request
        # Browsers don't care about the response anyway
        logger.error(
            "csp_report_processing_error",
            error=str(e),
            error_type=type(e).__name__,
        )
        return None


def _is_suspicious_violation(report_data: dict) -> bool:
    """
    Check if a CSP violation looks suspicious (potential attack).

    Args:
        report_data: CSP violation report data

    Returns:
        bool: True if violation appears suspicious
    """
    blocked_uri = str(report_data.get("blocked-uri", "")).lower()
    violated_directive = (
        str(report_data.get("violated-directive", "")).lower()
        or str(report_data.get("effective-directive", "")).lower()
    )

    # Common XSS patterns
    suspicious_patterns = [
        "javascript:",
        "data:text/html",
        "vbscript:",
        "about:blank",
        "eval",
        "<script",
    ]

    # Check for inline script violations (common in XSS)
    if "script-src" in violated_directive and (
        blocked_uri == "inline" or blocked_uri == "eval"
    ):
        return True

    # Check for data URIs in images or scripts
    if blocked_uri.startswith("data:") and (
        "script" in violated_directive or "img" in violated_directive
    ):
        return True

    # Check for common XSS patterns
    for pattern in suspicious_patterns:
        if pattern in blocked_uri:
            return True

    return False


# Optional: Database model for storing CSP violations
"""
class CSPViolation(Base):
    __tablename__ = "csp_violations"

    id = Column(Integer, primary_key=True, index=True)
    violated_directive = Column(String, nullable=False)
    blocked_uri = Column(String, nullable=True)
    document_uri = Column(String, nullable=True)
    source_file = Column(String, nullable=True)
    line_number = Column(Integer, nullable=True)
    client_ip = Column(String, nullable=True)
    user_agent = Column(String, nullable=True)
    report_data = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(UTC), nullable=False)
    is_suspicious = Column(Boolean, default=False)

async def store_csp_violation(
    db: AsyncSession,
    report_data: dict,
    client_ip: str,
    user_agent: str
) -> None:
    violation = CSPViolation(
        violated_directive=report_data.get("violated-directive"),
        blocked_uri=report_data.get("blocked-uri"),
        document_uri=report_data.get("document-uri"),
        source_file=report_data.get("source-file"),
        line_number=report_data.get("line-number"),
        client_ip=client_ip,
        user_agent=user_agent,
        report_data=report_data,
        is_suspicious=_is_suspicious_violation(report_data),
    )
    db.add(violation)
    await db.commit()
"""
