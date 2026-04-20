"""
Comprehensive audit logging utilities for security-critical operations.

Provides functions for logging:
- Permission changes
- Team membership changes
- PII access
- Account modifications
- General audit events

All logs include:
- User ID (actor)
- Action performed
- Resource type and ID
- IP address
- Timestamp
- Event category
- Correlation ID (for request tracing)
- Before/after state (for changes)

Usage:
    from app.core.audit import audit_logger

    await audit_logger.log_permission_change(
        db=db,
        user_id=current_user.id,
        action="grant_project_access",
        project_id=project.id,
        target_user_id=target_user.id,
        permission_level="edit",
        old_level="view",
        ip_address=request.client.host
    )
"""

import uuid
from datetime import UTC, datetime
from uuid import UUID

import structlog
from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit_log import AuditLog

logger = structlog.get_logger(__name__)


class AuditLogger:
    """Central audit logging service for security-critical operations."""

    # Event categories for SOC 2 compliance
    CATEGORY_PERMISSION_CHANGE = "permission_change"
    CATEGORY_MEMBERSHIP_CHANGE = "membership_change"
    CATEGORY_PII_ACCESS = "pii_access"
    CATEGORY_ACCOUNT_MODIFICATION = "account_modification"
    CATEGORY_AUTHENTICATION = "authentication"
    CATEGORY_RESOURCE_ACCESS = "resource_access"
    CATEGORY_SYSTEM_CONFIG = "system_config"

    # PII field names to track
    PII_FIELDS = {
        "email",
        "phone",
        "full_name",
        "phone_number",
        "address",
        "ssn",
        "tax_id",
    }

    @staticmethod
    def get_ip_address(request: Request | None) -> str | None:
        """Extract IP address from request, handling proxies."""
        if not request:
            return None

        # Check for X-Forwarded-For header (proxy/load balancer)
        forwarded_for = request.headers.get("X-Forwarded-For")
        if forwarded_for:
            # Take the first IP in the chain (original client)
            return forwarded_for.split(",")[0].strip()

        # Check for X-Real-IP header
        real_ip = request.headers.get("X-Real-IP")
        if real_ip:
            return real_ip

        # Fall back to direct client host
        if request.client:
            return request.client.host

        return None

    @staticmethod
    def get_correlation_id(request: Request | None) -> str:
        """
        Get or generate correlation ID for request tracing.

        Checks for X-Request-ID header, falls back to generating new UUID.
        """
        if request:
            # Check for existing correlation ID in headers
            correlation_id = request.headers.get("X-Request-ID") or request.headers.get(
                "X-Correlation-ID"
            )
            if correlation_id:
                return correlation_id

        # Generate new correlation ID
        return str(uuid.uuid4())

    async def log_audit_event(
        self,
        db: AsyncSession,
        user_id: UUID | None,
        action: str,
        resource_type: str | None = None,
        resource_id: str | None = None,
        event_category: str | None = None,
        target_user_id: UUID | None = None,
        changes: dict | None = None,
        metadata: dict | None = None,
        ip_address: str | None = None,
        correlation_id: str | None = None,
        request: Request | None = None,
    ) -> AuditLog:
        """
        Log a general audit event.

        Args:
            db: Database session
            user_id: ID of user performing the action (can be None for system actions)
            action: Action performed (e.g., "grant_access", "delete_user")
            resource_type: Type of resource (e.g., "project", "organization")
            resource_id: ID of the resource
            event_category: Category of event (use CATEGORY_* constants)
            target_user_id: User being affected by the action
            changes: Before/after state as {"before": {...}, "after": {...}}
            metadata: Additional metadata
            ip_address: IP address of the actor
            correlation_id: Request correlation ID
            request: FastAPI Request object (for extracting IP/correlation ID)

        Returns:
            Created AuditLog instance
        """
        # Extract IP and correlation ID from request if provided
        if request:
            if not ip_address:
                ip_address = self.get_ip_address(request)
            if not correlation_id:
                correlation_id = self.get_correlation_id(request)

        # Ensure we have a correlation ID
        if not correlation_id:
            correlation_id = str(uuid.uuid4())

        # Sanitize changes to not include sensitive data
        if changes:
            changes = self._sanitize_changes(changes)

        # Create audit log entry
        audit_log = AuditLog(
            user_id=user_id,
            action=action,
            resource_type=resource_type,
            resource_id=str(resource_id) if resource_id else None,
            event_category=event_category,
            target_user_id=target_user_id,
            changes=changes,
            log_metadata=metadata,
            ip_address=ip_address,
            correlation_id=correlation_id,
            created_at=datetime.now(UTC),
        )

        db.add(audit_log)
        await db.flush()

        logger.info(
            "audit_event_logged",
            audit_id=audit_log.id,
            user_id=user_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            event_category=event_category,
            correlation_id=correlation_id,
        )

        return audit_log

    def _sanitize_changes(self, changes: dict) -> dict:
        """
        Remove sensitive data from changes dict.

        Specifically removes password hashes and other credentials.
        """
        sanitized = {}

        for key, value in changes.items():
            if isinstance(value, dict):
                # Recursively sanitize nested dicts
                sanitized_value = {}
                for k, v in value.items():
                    if k in {
                        "password",
                        "hashed_password",
                        "password_hash",
                        "secret",
                        "token",
                        "api_key",
                    }:
                        sanitized_value[k] = "[REDACTED]"
                    else:
                        sanitized_value[k] = v
                sanitized[key] = sanitized_value
            else:
                sanitized[key] = value

        return sanitized

    async def log_permission_change(
        self,
        db: AsyncSession,
        user_id: UUID,
        action: str,
        project_id: UUID,
        target_user_id: UUID,
        permission_level: str,
        old_level: str | None = None,
        ip_address: str | None = None,
        correlation_id: str | None = None,
        request: Request | None = None,
    ) -> AuditLog:
        """
        Log project permission changes.

        Args:
            db: Database session
            user_id: Admin user making the change
            action: "grant_access", "revoke_access", "change_permission"
            project_id: Project ID
            target_user_id: User receiving/losing permission
            permission_level: New permission level
            old_level: Previous permission level (if changing)
            ip_address: IP address
            correlation_id: Request correlation ID
            request: FastAPI Request object

        Returns:
            Created AuditLog instance
        """
        changes = None
        if old_level:
            changes = {
                "before": {"permission_level": old_level},
                "after": {"permission_level": permission_level},
            }

        metadata = {
            "permission_level": permission_level,
            "old_permission_level": old_level,
        }

        return await self.log_audit_event(
            db=db,
            user_id=user_id,
            action=action,
            resource_type="project",
            resource_id=str(project_id),
            event_category=self.CATEGORY_PERMISSION_CHANGE,
            target_user_id=target_user_id,
            changes=changes,
            metadata=metadata,
            ip_address=ip_address,
            correlation_id=correlation_id,
            request=request,
        )

    async def log_team_membership_change(
        self,
        db: AsyncSession,
        user_id: UUID,
        action: str,
        organization_id: UUID,
        target_user_id: UUID,
        role: str,
        old_role: str | None = None,
        ip_address: str | None = None,
        correlation_id: str | None = None,
        request: Request | None = None,
    ) -> AuditLog:
        """
        Log team membership changes.

        Args:
            db: Database session
            user_id: Admin user making the change
            action: "add_member", "remove_member", "change_role"
            organization_id: Organization ID
            target_user_id: User being added/removed/changed
            role: New role (owner, admin, member, viewer)
            old_role: Previous role (if changing)
            ip_address: IP address
            correlation_id: Request correlation ID
            request: FastAPI Request object

        Returns:
            Created AuditLog instance
        """
        changes = None
        if old_role:
            changes = {
                "before": {"role": old_role},
                "after": {"role": role},
            }

        metadata = {
            "role": role,
            "old_role": old_role,
        }

        return await self.log_audit_event(
            db=db,
            user_id=user_id,
            action=action,
            resource_type="organization",
            resource_id=str(organization_id),
            event_category=self.CATEGORY_MEMBERSHIP_CHANGE,
            target_user_id=target_user_id,
            changes=changes,
            metadata=metadata,
            ip_address=ip_address,
            correlation_id=correlation_id,
            request=request,
        )

    async def log_pii_access(
        self,
        db: AsyncSession,
        user_id: UUID,
        resource_type: str,
        resource_id: str,
        fields_accessed: list[str],
        reason: str | None = None,
        ip_address: str | None = None,
        correlation_id: str | None = None,
        request: Request | None = None,
    ) -> AuditLog:
        """
        Log PII data access for compliance.

        Args:
            db: Database session
            user_id: User accessing the PII
            resource_type: Type of resource (e.g., "user", "customer")
            resource_id: ID of the resource
            fields_accessed: List of PII fields accessed (e.g., ["email", "phone"])
            reason: Reason for access (optional)
            ip_address: IP address
            correlation_id: Request correlation ID
            request: FastAPI Request object

        Returns:
            Created AuditLog instance
        """
        metadata = {
            "fields_accessed": fields_accessed,
            "reason": reason,
        }

        return await self.log_audit_event(
            db=db,
            user_id=user_id,
            action="access_pii",
            resource_type=resource_type,
            resource_id=resource_id,
            event_category=self.CATEGORY_PII_ACCESS,
            metadata=metadata,
            ip_address=ip_address,
            correlation_id=correlation_id,
            request=request,
        )

    async def log_account_modification(
        self,
        db: AsyncSession,
        user_id: UUID,
        target_user_id: UUID,
        changes_dict: dict,
        action: str = "update_account",
        ip_address: str | None = None,
        correlation_id: str | None = None,
        request: Request | None = None,
    ) -> AuditLog:
        """
        Log account modifications (profile updates, role changes, deletions).

        Args:
            db: Database session
            user_id: User making the modification
            target_user_id: User being modified
            changes_dict: Dictionary with "before" and "after" states
            action: Specific action (e.g., "update_profile", "delete_account")
            ip_address: IP address
            correlation_id: Request correlation ID
            request: FastAPI Request object

        Returns:
            Created AuditLog instance
        """
        return await self.log_audit_event(
            db=db,
            user_id=user_id,
            action=action,
            resource_type="user",
            resource_id=str(target_user_id),
            event_category=self.CATEGORY_ACCOUNT_MODIFICATION,
            target_user_id=target_user_id,
            changes=changes_dict,
            ip_address=ip_address,
            correlation_id=correlation_id,
            request=request,
        )

    async def log_authentication(
        self,
        db: AsyncSession,
        user_id: UUID | None,
        action: str,
        success: bool,
        metadata: dict | None = None,
        ip_address: str | None = None,
        correlation_id: str | None = None,
        request: Request | None = None,
    ) -> AuditLog:
        """
        Log authentication events (login, logout, failed attempts).

        Args:
            db: Database session
            user_id: User attempting authentication (None for failed attempts)
            action: "login", "logout", "failed_login", "password_reset"
            success: Whether the action succeeded
            metadata: Additional metadata (e.g., failure reason)
            ip_address: IP address
            correlation_id: Request correlation ID
            request: FastAPI Request object

        Returns:
            Created AuditLog instance
        """
        if metadata is None:
            metadata = {}

        metadata["success"] = success

        return await self.log_audit_event(
            db=db,
            user_id=user_id,
            action=action,
            resource_type="authentication",
            event_category=self.CATEGORY_AUTHENTICATION,
            metadata=metadata,
            ip_address=ip_address,
            correlation_id=correlation_id,
            request=request,
        )


# Singleton instance
audit_logger = AuditLogger()
