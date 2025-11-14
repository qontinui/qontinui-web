# Project Sharing

Complete guide to sharing automation projects with individual users and organizations.

## Overview

Project sharing in Qontinui enables you to collaborate with team members by granting controlled access to your automation projects. You can share with individual users or entire organizations, with granular permission levels and optional time limits.

## Table of Contents

- [Quick Start](#quick-start)
- [Permission Levels](#permission-levels)
- [Sharing with Users](#sharing-with-users)
- [Sharing with Organizations](#sharing-with-organizations)
- [Managing Collaborators](#managing-collaborators)
- [Time-Limited Access](#time-limited-access)
- [Revoking Access](#revoking-access)
- [Best Practices](#best-practices)

## Quick Start

### Share a Project in 3 Steps

1. **Open Project Settings**
   - Navigate to your project
   - Click the "Share" button or gear icon
   - Select "Manage Access"

2. **Add Collaborator**
   - Enter email address or select organization
   - Choose permission level
   - Click "Share"

3. **Notify Collaborator**
   - Collaborator receives email notification
   - They can immediately access the project
   - Project appears in their project list

### Quick Share Example

```typescript
import { projectSharingService } from '@/services/project-sharing-service';

// Share project with a user
await projectSharingService.shareWithUser({
  projectId: 123,
  email: 'colleague@example.com',
  permissionLevel: 'edit',
  notifyUser: true
});
```

## Permission Levels

### Available Permission Levels

Qontinui provides four permission levels for project sharing:

#### Admin
Full control over the project and its sharing settings.

**Can:**
- View, comment, and edit project
- Share project with others
- Change permissions for other collaborators
- Delete project
- Export project
- Manage project settings

**Cannot:**
- Transfer project ownership

**Use cases:**
- Project co-owners
- Senior team members managing the project
- Trusted collaborators who need full control

#### Edit
Full read-write access without sharing capabilities.

**Can:**
- View and comment on project
- Edit all project resources (workflows, states, images, transitions)
- Create new resources
- Delete resources
- Run automations
- Export project

**Cannot:**
- Share project with others
- Change permissions
- Delete project
- Modify project settings

**Use cases:**
- Active contributors
- Team members building automations
- Developers implementing features

#### Comment
Read access with ability to add comments and feedback.

**Can:**
- View project and all resources
- Add comments and discussions
- Mention other collaborators (@mentions)
- Resolve own comments
- Export project (read-only)

**Cannot:**
- Edit any resources
- Create new resources
- Delete resources
- Share project
- Run automations

**Use cases:**
- Reviewers
- QA team members
- Stakeholders providing feedback
- External consultants

#### View
Read-only access without interaction.

**Can:**
- View project and all resources
- See comments (but not add)
- View activity history

**Cannot:**
- Edit anything
- Add comments
- Share project
- Run automations
- Export project

**Use cases:**
- Observers
- Trainees
- Auditors
- Temporary access for demos

### Permission Level Matrix

| Action | Admin | Edit | Comment | View |
|--------|-------|------|---------|------|
| View project | ✓ | ✓ | ✓ | ✓ |
| View resources | ✓ | ✓ | ✓ | ✓ |
| View comments | ✓ | ✓ | ✓ | ✓ |
| View activity | ✓ | ✓ | ✓ | ✓ |
| Add comments | ✓ | ✓ | ✓ | ✗ |
| Edit resources | ✓ | ✓ | ✗ | ✗ |
| Create resources | ✓ | ✓ | ✗ | ✗ |
| Delete resources | ✓ | ✓ | ✗ | ✗ |
| Run automations | ✓ | ✓ | ✗ | ✗ |
| Export project | ✓ | ✓ | ✓* | ✗ |
| Share project | ✓ | ✗ | ✗ | ✗ |
| Change permissions | ✓ | ✗ | ✗ | ✗ |
| Delete project | ✓ | ✗ | ✗ | ✗ |
| Modify settings | ✓ | ✗ | ✗ | ✗ |

`*` Read-only export

## Sharing with Users

### Share with Individual User

```typescript
// Share project with a specific user
const shareWithUser = async (
  projectId: number,
  email: string,
  permissionLevel: 'admin' | 'edit' | 'comment' | 'view'
) => {
  const response = await fetch(`/api/v1/projects/${projectId}/share`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      permission_level: permissionLevel,
      notify: true, // Send email notification
      message: 'Check out this automation project!'
    })
  });

  return await response.json();
};
```

### Share with Multiple Users

```typescript
// Bulk share with multiple users
const shareWithMultipleUsers = async (
  projectId: number,
  users: Array<{ email: string; permission: string }>
) => {
  const promises = users.map(({ email, permission }) =>
    fetch(`/api/v1/projects/${projectId}/share`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        permission_level: permission,
        notify: true
      })
    })
  );

  return await Promise.all(promises);
};

// Example usage
await shareWithMultipleUsers(123, [
  { email: 'alice@example.com', permission: 'edit' },
  { email: 'bob@example.com', permission: 'comment' },
  { email: 'carol@example.com', permission: 'view' }
]);
```

### User Sharing UI Component

```typescript
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

export function ShareWithUser({ projectId }: { projectId: number }) {
  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState<'edit'>('edit');
  const [loading, setLoading] = useState(false);

  const handleShare = async () => {
    setLoading(true);
    try {
      await shareWithUser(projectId, email, permission);
      toast.success(`Project shared with ${email}`);
      setEmail('');
    } catch (error) {
      toast.error('Failed to share project');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex gap-2">
      <Input
        type="email"
        placeholder="colleague@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Select value={permission} onChange={setPermission}>
        <option value="admin">Admin</option>
        <option value="edit">Edit</option>
        <option value="comment">Comment</option>
        <option value="view">View</option>
      </Select>
      <Button onClick={handleShare} disabled={loading}>
        Share
      </Button>
    </div>
  );
}
```

## Sharing with Organizations

### Share with Entire Organization

When you share a project with an organization, all current and future members of that organization automatically get access based on their role.

```typescript
// Share project with an organization
const shareWithOrganization = async (
  projectId: number,
  organizationId: string,
  permissionLevel: 'admin' | 'edit' | 'comment' | 'view'
) => {
  const response = await fetch(`/api/v1/projects/${projectId}/share/organization`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      organization_id: organizationId,
      permission_level: permissionLevel,
      notify_members: true
    })
  });

  return await response.json();
};
```

### Organization vs. User Sharing

**Share with Organization when:**
- Multiple team members need access
- New team members should automatically get access
- You want centralized permission management
- Team structure is stable

**Share with Individual Users when:**
- Only specific people need access
- External collaborators outside your organization
- Temporary collaboration
- Different permission levels for different users

### Organization Sharing Example

```typescript
import { useOrganizations } from '@/hooks/use-organizations';

export function ShareWithOrganization({ projectId }: { projectId: number }) {
  const { organizations } = useOrganizations();
  const [selectedOrg, setSelectedOrg] = useState<string>('');
  const [permission, setPermission] = useState<'edit'>('edit');

  const handleShare = async () => {
    await shareWithOrganization(projectId, selectedOrg, permission);
    toast.success('Project shared with organization');
  };

  return (
    <div className="space-y-4">
      <Select value={selectedOrg} onChange={setSelectedOrg}>
        <option value="">Select organization...</option>
        {organizations.map(org => (
          <option key={org.id} value={org.id}>
            {org.name}
          </option>
        ))}
      </Select>
      <Select value={permission} onChange={setPermission}>
        <option value="admin">Admin</option>
        <option value="edit">Edit</option>
        <option value="comment">Comment</option>
        <option value="view">View</option>
      </Select>
      <Button onClick={handleShare} disabled={!selectedOrg}>
        Share with Organization
      </Button>
    </div>
  );
}
```

## Managing Collaborators

### List Project Collaborators

```typescript
// Get all collaborators for a project
const getCollaborators = async (projectId: number) => {
  const response = await fetch(`/api/v1/projects/${projectId}/access`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    }
  });

  const access = await response.json();
  return access;
};

// Response structure
interface ProjectAccess {
  users: Array<{
    id: string;
    user: {
      id: string;
      email: string;
      username: string;
      full_name?: string;
      avatar_url?: string;
    };
    permission_level: string;
    created_at: string;
    expires_at?: string;
  }>;
  organizations: Array<{
    id: string;
    organization: {
      id: string;
      name: string;
      slug: string;
      avatar_url?: string;
      member_count: number;
    };
    permission_level: string;
    created_at: string;
    expires_at?: string;
  }>;
}
```

### Update Collaborator Permissions

```typescript
// Change permission level for a user
const updateUserPermission = async (
  projectId: number,
  userId: string,
  newPermission: 'admin' | 'edit' | 'comment' | 'view'
) => {
  const response = await fetch(
    `/api/v1/projects/${projectId}/access/users/${userId}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        permission_level: newPermission
      })
    }
  );

  return await response.json();
};

// Change permission level for an organization
const updateOrganizationPermission = async (
  projectId: number,
  organizationId: string,
  newPermission: 'admin' | 'edit' | 'comment' | 'view'
) => {
  const response = await fetch(
    `/api/v1/projects/${projectId}/access/organizations/${organizationId}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        permission_level: newPermission
      })
    }
  );

  return await response.json();
};
```

### Collaborators UI Component

```typescript
export function CollaboratorsList({ projectId }: { projectId: number }) {
  const { data: access } = useProjectAccess(projectId);

  return (
    <div className="space-y-6">
      {/* User Collaborators */}
      <div>
        <h3 className="text-lg font-semibold mb-3">Individual Users</h3>
        <div className="space-y-2">
          {access?.users.map(userAccess => (
            <div
              key={userAccess.id}
              className="flex items-center justify-between p-3 border rounded"
            >
              <div className="flex items-center gap-3">
                {userAccess.user.avatar_url && (
                  <img
                    src={userAccess.user.avatar_url}
                    alt={userAccess.user.username}
                    className="w-10 h-10 rounded-full"
                  />
                )}
                <div>
                  <div className="font-medium">{userAccess.user.full_name}</div>
                  <div className="text-sm text-muted-foreground">
                    {userAccess.user.email}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <PermissionBadge level={userAccess.permission_level} />
                <PermissionDropdown
                  currentPermission={userAccess.permission_level}
                  onChange={(newPermission) =>
                    updateUserPermission(projectId, userAccess.user.id, newPermission)
                  }
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => revokeUserAccess(projectId, userAccess.user.id)}
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Organization Collaborators */}
      <div>
        <h3 className="text-lg font-semibold mb-3">Organizations</h3>
        <div className="space-y-2">
          {access?.organizations.map(orgAccess => (
            <div
              key={orgAccess.id}
              className="flex items-center justify-between p-3 border rounded"
            >
              <div className="flex items-center gap-3">
                {orgAccess.organization.avatar_url && (
                  <img
                    src={orgAccess.organization.avatar_url}
                    alt={orgAccess.organization.name}
                    className="w-10 h-10 rounded"
                  />
                )}
                <div>
                  <div className="font-medium">{orgAccess.organization.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {orgAccess.organization.member_count} members
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <PermissionBadge level={orgAccess.permission_level} />
                <PermissionDropdown
                  currentPermission={orgAccess.permission_level}
                  onChange={(newPermission) =>
                    updateOrganizationPermission(
                      projectId,
                      orgAccess.organization.id,
                      newPermission
                    )
                  }
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    revokeOrganizationAccess(projectId, orgAccess.organization.id)
                  }
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

## Time-Limited Access

### Setting Expiration Dates

Grant temporary access to projects with automatic expiration.

```typescript
// Share with expiration date
const shareWithExpiration = async (
  projectId: number,
  email: string,
  permissionLevel: string,
  expiresInDays: number
) => {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiresInDays);

  const response = await fetch(`/api/v1/projects/${projectId}/share`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      permission_level: permissionLevel,
      expires_at: expiresAt.toISOString(),
      notify: true
    })
  });

  return await response.json();
};

// Example: Grant 7-day access
await shareWithExpiration(projectId, 'temp@example.com', 'view', 7);
```

### Common Expiration Scenarios

```typescript
// 24-hour demo access
await shareWithExpiration(projectId, 'demo@example.com', 'view', 1);

// 1-week contractor access
await shareWithExpiration(projectId, 'contractor@example.com', 'edit', 7);

// 30-day trial access
await shareWithExpiration(projectId, 'trial@example.com', 'comment', 30);

// 90-day project collaboration
await shareWithExpiration(projectId, 'partner@example.com', 'edit', 90);
```

### Extending Access

```typescript
// Extend existing access
const extendAccess = async (
  projectId: number,
  userId: string,
  additionalDays: number
) => {
  const currentAccess = await getUserAccess(projectId, userId);
  const currentExpiry = new Date(currentAccess.expires_at);
  const newExpiry = new Date(currentExpiry);
  newExpiry.setDate(newExpiry.getDate() + additionalDays);

  await updateUserPermission(projectId, userId, {
    expires_at: newExpiry.toISOString()
  });
};
```

## Revoking Access

### Remove User Access

```typescript
// Revoke user's access to project
const revokeUserAccess = async (projectId: number, userId: string) => {
  await fetch(`/api/v1/projects/${projectId}/access/users/${userId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    }
  });
};
```

### Remove Organization Access

```typescript
// Revoke organization's access to project
const revokeOrganizationAccess = async (
  projectId: number,
  organizationId: string
) => {
  await fetch(
    `/api/v1/projects/${projectId}/access/organizations/${organizationId}`,
    {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      }
    }
  );
};
```

### Bulk Revoke

```typescript
// Remove all collaborators
const revokeAllAccess = async (projectId: number) => {
  const access = await getCollaborators(projectId);

  // Revoke user access
  const userPromises = access.users.map(ua =>
    revokeUserAccess(projectId, ua.user.id)
  );

  // Revoke organization access
  const orgPromises = access.organizations.map(oa =>
    revokeOrganizationAccess(projectId, oa.organization.id)
  );

  await Promise.all([...userPromises, ...orgPromises]);
};
```

### What Happens When Access is Revoked

- User immediately loses access to the project
- Project removed from their project list
- Active locks are released
- Pending comments remain visible
- Activity log entries are preserved
- User is not notified automatically (send manual notification if needed)

## Best Practices

### Permission Assignment

**Start Restrictive**
- Begin with minimal permissions (View or Comment)
- Increase permissions as trust is established
- Review and adjust permissions regularly

**Role-Based Permissions**
- QA Team → Comment permission
- Developers → Edit permission
- Project Leads → Admin permission
- Executives → View permission

### Security Considerations

1. **Regular Audits**
   - Review collaborators monthly
   - Remove inactive collaborators
   - Check for unexpected access

2. **Time-Limited Access**
   - Use expiration dates for contractors
   - Set expiration for demo accounts
   - Review expiring access weekly

3. **Organization Sharing**
   - Prefer organization sharing over individual
   - Ensure organization members are vetted
   - Monitor organization membership changes

4. **Access Logging**
   - Enable activity tracking
   - Review access logs regularly
   - Set up alerts for suspicious activity

### Collaboration Workflows

**Project Review Process**
```typescript
// 1. Share with reviewers (Comment permission)
await shareWithUser(projectId, 'reviewer@example.com', 'comment');

// 2. Reviewers add comments
// (Users add comments through UI)

// 3. Address feedback (Edit permission)
await updateUserPermission(projectId, 'developer@example.com', 'edit');

// 4. Revoke access after review
await revokeUserAccess(projectId, 'reviewer@example.com');
```

**External Collaboration**
```typescript
// 1. Share with time limit
await shareWithExpiration(
  projectId,
  'external@partner.com',
  'edit',
  30 // 30 days
);

// 2. Monitor activity
const activity = await getProjectActivity(projectId);

// 3. Extend if needed
await extendAccess(projectId, userId, 30);

// 4. Auto-revoke on expiration
// (Handled automatically by system)
```

## Related Documentation

- [Organizations](./organizations.md) - Manage team organizations
- [Permissions](./permissions.md) - Detailed permission model
- [Activity Tracking](./activity-tracking.md) - Monitor project access
- [API Reference](./api-reference.md) - Complete API documentation

## Troubleshooting

See the [Troubleshooting Guide](./troubleshooting.md#project-sharing) for common sharing issues.

---

**Last Updated:** 2025-01-14
