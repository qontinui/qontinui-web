"""
Permission service package.

Provides centralized access control split into focused modules:
- project_access: Project-level permission checks
- organization_access: Organization membership and role checks
- helpers: Permission and role hierarchy utilities
- permission_service: Facade composing all access control

All classes and the singleton instance are re-exported here.
"""

from app.services.permissions.helpers import (
    PERMISSION_HIERARCHY,
    ROLE_HIERARCHY,
    check_permission_level,
    check_role_level,
)
from app.services.permissions.organization_access import (
    can_user_manage_organization,
    check_organization_membership,
    get_personal_organization,
    get_user_organization_role,
)
from app.services.permissions.permission_service import (
    PermissionService,
    permission_service,
)
from app.services.permissions.project_access import (
    can_user_access_project,
    get_user_accessible_projects,
    get_user_permission_level,
)

__all__ = [
    # Service class and singleton
    "PermissionService",
    "permission_service",
    # Hierarchy constants
    "PERMISSION_HIERARCHY",
    "ROLE_HIERARCHY",
    # Helper functions
    "check_permission_level",
    "check_role_level",
    # Project access functions
    "can_user_access_project",
    "get_user_permission_level",
    "get_user_accessible_projects",
    # Organization access functions
    "get_personal_organization",
    "check_organization_membership",
    "can_user_manage_organization",
    "get_user_organization_role",
]
