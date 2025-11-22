# Permission Management

Complete guide to Qontinui's permission system, access control, and security best practices.

## Overview

Qontinui implements a multi-layered permission system combining organization roles, project-level permissions, and resource-specific access control to provide flexible and secure collaboration.

## Permission Model

### Layered Permission Architecture

```
Organization Level
    ├─ Owner (full control)
    ├─ Admin (manage members & settings)
    ├─ Member (collaborate on projects)
    └─ Viewer (read-only access)
          ↓
Project Level
    ├─ Admin (full project control)
    ├─ Edit (create & modify resources)
    ├─ Comment (add feedback)
    └─ View (read-only)
          ↓
Resource Level
    ├─ Lock (exclusive edit access)
    └─ Custom permissions
```

### Organization Roles

| Role | Can Manage Org | Can Invite | Can Remove | Can Change Roles | Access Projects |
|------|----------------|------------|------------|------------------|-----------------|
| Owner | ✓ | ✓ | ✓ | ✓ | All |
| Admin | Settings only | ✓ | Members/Viewers | Members/Viewers | All |
| Member | ✗ | Based on settings | ✗ | ✗ | Shared |
| Viewer | ✗ | ✗ | ✗ | ✗ | Shared (read-only) |

### Project Permissions

| Permission | View | Comment | Edit | Share | Admin | Delete |
|------------|------|---------|------|-------|-------|--------|
| Admin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Edit | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| Comment | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| View | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |

## Permission Checks

### Backend Permission Validation

```python
# Example from backend/app/services/permission_service.py
from typing import Optional
from app.models import User, Project, Organization, TeamMember, ProjectAccessControl

class PermissionService:
    """Service for checking user permissions"""

    @staticmethod
    async def can_access_project(
        user: User,
        project: Project,
        required_permission: str = "view"
    ) -> bool:
        """Check if user can access project with required permission"""

        # Owner always has access
        if project.owner_id == user.id:
            return True

        # Check direct project access
        access = await ProjectAccessControl.filter(
            project_id=project.id,
            user_id=user.id
        ).first()

        if access and not access.is_expired:
            return check_permission_level(access.permission_level, required_permission)

        # Check organization access
        org_access = await ProjectAccessControl.filter(
            project_id=project.id,
            organization_id__isnull=False
        ).all()

        for oa in org_access:
            member = await TeamMember.filter(
                organization_id=oa.organization_id,
                user_id=user.id
            ).first()

            if member:
                return check_permission_level(oa.permission_level, required_permission)

        return False

    @staticmethod
    async def can_manage_organization(
        user: User,
        organization: Organization,
        action: str
    ) -> bool:
        """Check if user can perform action on organization"""

        # Owner can do everything
        if organization.owner_id == user.id:
            return True

        # Get user's membership
        member = await TeamMember.filter(
            organization_id=organization.id,
            user_id=user.id
        ).first()

        if not member:
            return False

        # Check role permissions
        if action == "delete" and member.role != "owner":
            return False

        if action in ["invite", "remove_member", "change_settings"]:
            return member.role in ["owner", "admin"]

        return True
```

### Frontend Permission Hooks

```typescript
// hooks/use-permissions.ts
import { useAuth } from '@/hooks/use-auth';
import { useProject } from '@/hooks/use-project';

export function usePermissions(projectId: number) {
  const { user } = useAuth();
  const { project, access } = useProject(projectId);

  const can = (action: string): boolean => {
    if (!user || !project) return false;

    // Owner has all permissions
    if (project.owner_id === user.id) return true;

    // Check access level
    const userAccess = access?.users.find(ua => ua.user.id === user.id);
    if (!userAccess) {
      // Check organization access
      const orgAccess = access?.organizations.find(oa =>
        user.organizations?.some(org => org.id === oa.organization.id)
      );
      if (!orgAccess) return false;

      return checkPermission(orgAccess.permission_level, action);
    }

    return checkPermission(userAccess.permission_level, action);
  };

  return {
    canView: can('view'),
    canComment: can('comment'),
    canEdit: can('edit'),
    canShare: can('share'),
    canAdmin: can('admin'),
    canDelete: can('delete'),
    can
  };
}

function checkPermission(level: string, action: string): boolean {
  const hierarchy = {
    view: ['view'],
    comment: ['view', 'comment'],
    edit: ['view', 'comment', 'edit'],
    admin: ['view', 'comment', 'edit', 'share', 'admin', 'delete']
  };

  return hierarchy[level]?.includes(action) ?? false;
}
```

## Inherited Permissions

### Organization to Project Inheritance

When a project is shared with an organization, all members inherit access based on:

1. **Organization Role** - Their role in the organization
2. **Project Permission** - The permission level granted to the organization
3. **Custom Overrides** - Individual user permissions can override organization defaults

```typescript
// Permission resolution order
function resolvePermission(
  user: User,
  project: Project
): PermissionLevel | null {
  // 1. Direct user permission (highest priority)
  const directAccess = project.userAccess.find(a => a.user_id === user.id);
  if (directAccess) return directAccess.permission_level;

  // 2. Organization permission
  const userOrgs = user.organizations.map(m => m.organization_id);
  const orgAccess = project.orgAccess.find(a =>
    userOrgs.includes(a.organization_id)
  );
  if (orgAccess) {
    // Apply role-based filtering
    const membership = user.organizations.find(
      m => m.organization_id === orgAccess.organization_id
    );

    if (membership.role === 'viewer') {
      // Viewers can't have edit or admin
      return downgradePermission(orgAccess.permission_level, 'comment');
    }

    return orgAccess.permission_level;
  }

  // 3. No access
  return null;
}
```

## Custom Permissions

### Fine-Grained Control

```typescript
interface CustomPermissions {
  // Resource operations
  canCreateWorkflow: boolean;
  canDeleteWorkflow: boolean;
  canCreateState: boolean;
  canDeleteState: boolean;
  canUploadImage: boolean;
  canDeleteImage: boolean;

  // Collaboration
  canInviteUsers: boolean;
  canRemoveUsers: boolean;
  canChangePermissions: boolean;

  // Advanced features
  canExportProject: boolean;
  canImportProject: boolean;
  canViewAnalytics: boolean;
  canManageBilling: boolean;
}

// Apply custom permissions
const setCustomPermissions = async (
  userId: string,
  projectId: number,
  permissions: Partial<CustomPermissions>
) => {
  const response = await fetch(
    `/api/v1/projects/${projectId}/access/users/${userId}/permissions`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ custom_permissions: permissions })
    }
  );

  return await response.json();
};
```

## Security Best Practices

### 1. Principle of Least Privilege

```typescript
// ✓ Good: Grant minimal necessary permissions
await shareProject(projectId, user.email, 'view'); // Start with view
// Later upgrade if needed
await updatePermission(projectId, user.id, 'edit');

// ✗ Bad: Grant excessive permissions
await shareProject(projectId, user.email, 'admin'); // Too much access
```

### 2. Regular Audits

```typescript
// Audit project access monthly
async function auditProjectAccess(projectId: number) {
  const access = await getProjectAccess(projectId);

  const report = {
    totalUsers: access.users.length,
    totalOrgs: access.organizations.length,
    byPermission: {
      admin: 0,
      edit: 0,
      comment: 0,
      view: 0
    },
    expiringSoon: [],
    inactive: []
  };

  // Count by permission level
  access.users.forEach(ua => {
    report.byPermission[ua.permission_level]++;

    // Check expiration
    if (ua.expires_at) {
      const daysUntilExpiry = daysBetween(new Date(), new Date(ua.expires_at));
      if (daysUntilExpiry <= 7) {
        report.expiringSoon.push(ua);
      }
    }

    // Check last activity
    if (ua.user.last_active_at) {
      const daysSinceActive = daysBetween(
        new Date(ua.user.last_active_at),
        new Date()
      );
      if (daysSinceActive > 30) {
        report.inactive.push(ua);
      }
    }
  });

  return report;
}
```

### 3. Time-Limited Access

```typescript
// Always set expiration for external users
await shareProject(
  projectId,
  externalUser.email,
  'view',
  { expiresInDays: 7 } // Auto-revoke after 7 days
);

// For contractors
await shareProject(
  projectId,
  contractor.email,
  'edit',
  { expiresInDays: 30 } // Project duration
);
```

### 4. Audit Logging

```typescript
// All permission changes are logged
interface PermissionAuditLog {
  timestamp: string;
  actor_id: string; // Who made the change
  action: 'granted' | 'revoked' | 'modified';
  target_user_id: string;
  project_id: number;
  old_permission?: string;
  new_permission?: string;
  reason?: string;
}

// Query audit logs
const logs = await fetch(`/api/v1/audit/permissions?project_id=${projectId}`);
```

### 5. Two-Factor Authentication

```typescript
// Require 2FA for admin actions
async function requireTwoFactor(action: string) {
  if (sensitiveActions.includes(action)) {
    const verified = await verify2FA();
    if (!verified) {
      throw new Error('2FA verification required');
    }
  }
}

const sensitiveActions = [
  'delete_project',
  'change_owner',
  'revoke_all_access',
  'delete_organization'
];
```

## Related Documentation

- [Organizations](./organizations.md) - Organization roles
- [Project Sharing](./project-sharing.md) - Permission levels
- [Activity Tracking](./activity-tracking.md) - Permission audit logs
- [API Reference](./api-reference.md) - Permission APIs

---

**Last Updated:** 2025-01-14
