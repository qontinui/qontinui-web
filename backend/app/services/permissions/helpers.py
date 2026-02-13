"""
Permission and role hierarchy helper functions.

Provides level-checking utilities used by both project and
organization access services.
"""

from app.models.organization import PermissionLevel, TeamRole

# Permission level hierarchy (lower value = less access)
PERMISSION_HIERARCHY = {
    PermissionLevel.VIEW: 0,
    PermissionLevel.COMMENT: 1,
    PermissionLevel.EDIT: 2,
    PermissionLevel.ADMIN: 3,
}

# Team role hierarchy (for organization management)
ROLE_HIERARCHY = {
    TeamRole.VIEWER: 0,
    TeamRole.MEMBER: 1,
    TeamRole.ADMIN: 2,
    TeamRole.OWNER: 3,
}


def check_permission_level(current: PermissionLevel, required: PermissionLevel) -> bool:
    """
    Check if current permission level meets or exceeds required level.

    Permission hierarchy: VIEW < COMMENT < EDIT < ADMIN

    Args:
        current: Current permission level
        required: Required permission level

    Returns:
        True if current >= required in the hierarchy
    """
    current_value = PERMISSION_HIERARCHY.get(current, -1)
    required_value = PERMISSION_HIERARCHY.get(required, 999)
    return current_value >= required_value


def check_role_level(current: TeamRole, required: TeamRole) -> bool:
    """
    Check if current role meets or exceeds required role.

    Role hierarchy: VIEWER < MEMBER < ADMIN < OWNER

    Args:
        current: Current role
        required: Required role

    Returns:
        True if current >= required in the hierarchy
    """
    current_value = ROLE_HIERARCHY.get(current, -1)
    required_value = ROLE_HIERARCHY.get(required, 999)
    return current_value >= required_value
