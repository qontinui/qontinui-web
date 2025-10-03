import logging
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog

logger = logging.getLogger(__name__)


class AuditService:
    """Service for audit logging of important user actions"""

    def log_action(
        self,
        db: Session,
        user_id: int,
        action: str,
        resource_type: str | None = None,
        resource_id: int | None = None,
        metadata: dict[str, Any] | None = None,
        ip_address: str | None = None,
    ) -> AuditLog:
        """
        Log an audit event for important user actions

        Args:
            db: Database session
            user_id: User performing the action
            action: Action being performed (login, project_created, project_deleted, settings_changed, etc.)
            resource_type: Type of resource (project, user, state, etc.)
            resource_id: ID of the resource being acted upon
            metadata: Additional metadata as a dictionary
            ip_address: IP address of the user

        Returns:
            Created AuditLog object
        """
        try:
            audit_log = AuditLog(
                user_id=user_id,
                action=action,
                resource_type=resource_type,
                resource_id=resource_id,
                ip_address=ip_address,
                log_metadata=metadata,
                created_at=datetime.utcnow(),
            )

            db.add(audit_log)
            db.commit()
            db.refresh(audit_log)

            logger.info(
                f"Audit log created: user_id={user_id}, action={action}, "
                f"resource_type={resource_type}, resource_id={resource_id}"
            )

            return audit_log

        except Exception as e:
            logger.error(f"Error creating audit log: {e}")
            db.rollback()
            raise

    def log_login(
        self, db: Session, user_id: int, ip_address: str | None = None
    ) -> AuditLog:
        """Log a successful login"""
        return self.log_action(
            db=db,
            user_id=user_id,
            action="login",
            ip_address=ip_address,
            metadata={"timestamp": datetime.utcnow().isoformat()},
        )

    def log_logout(
        self, db: Session, user_id: int, ip_address: str | None = None
    ) -> AuditLog:
        """Log a logout"""
        return self.log_action(
            db=db,
            user_id=user_id,
            action="logout",
            ip_address=ip_address,
            metadata={"timestamp": datetime.utcnow().isoformat()},
        )

    def log_project_created(
        self,
        db: Session,
        user_id: int,
        project_id: int,
        project_name: str,
        ip_address: str | None = None,
    ) -> AuditLog:
        """Log project creation"""
        return self.log_action(
            db=db,
            user_id=user_id,
            action="project_created",
            resource_type="project",
            resource_id=project_id,
            ip_address=ip_address,
            metadata={"project_name": project_name},
        )

    def log_project_deleted(
        self,
        db: Session,
        user_id: int,
        project_id: int,
        project_name: str,
        ip_address: str | None = None,
    ) -> AuditLog:
        """Log project deletion"""
        return self.log_action(
            db=db,
            user_id=user_id,
            action="project_deleted",
            resource_type="project",
            resource_id=project_id,
            ip_address=ip_address,
            metadata={"project_name": project_name},
        )

    def log_settings_changed(
        self,
        db: Session,
        user_id: int,
        changed_fields: list[str],
        ip_address: str | None = None,
    ) -> AuditLog:
        """Log user settings changes"""
        return self.log_action(
            db=db,
            user_id=user_id,
            action="settings_changed",
            resource_type="user",
            resource_id=user_id,
            ip_address=ip_address,
            metadata={"changed_fields": changed_fields},
        )

    def log_password_changed(
        self, db: Session, user_id: int, ip_address: str | None = None
    ) -> AuditLog:
        """Log password change"""
        return self.log_action(
            db=db,
            user_id=user_id,
            action="password_changed",
            resource_type="user",
            resource_id=user_id,
            ip_address=ip_address,
        )

    def get_user_audit_logs(
        self,
        db: Session,
        user_id: int,
        action: str | None = None,
        limit: int = 100,
    ) -> list[AuditLog]:
        """
        Get audit logs for a specific user

        Args:
            db: Database session
            user_id: User ID to get logs for
            action: Optional action filter
            limit: Maximum number of logs to return

        Returns:
            List of AuditLog objects
        """
        query = db.query(AuditLog).filter(AuditLog.user_id == user_id)

        if action:
            query = query.filter(AuditLog.action == action)

        return query.order_by(AuditLog.created_at.desc()).limit(limit).all()

    def get_resource_audit_logs(
        self,
        db: Session,
        resource_type: str,
        resource_id: int,
        limit: int = 100,
    ) -> list[AuditLog]:
        """
        Get audit logs for a specific resource

        Args:
            db: Database session
            resource_type: Type of resource (project, user, etc.)
            resource_id: ID of the resource
            limit: Maximum number of logs to return

        Returns:
            List of AuditLog objects
        """
        return (
            db.query(AuditLog)
            .filter(
                AuditLog.resource_type == resource_type,
                AuditLog.resource_id == resource_id,
            )
            .order_by(AuditLog.timestamp.desc())
            .limit(limit)
            .all()
        )


# Global instance
audit_service = AuditService()
