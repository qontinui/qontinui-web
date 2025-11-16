# Organizations

Complete guide to creating and managing organizations for team collaboration.

## Overview

Organizations in Qontinui are team workspaces that allow multiple users to collaborate on automation projects. Each organization has an owner, members with different roles, and shared projects.

## Table of Contents

- [Creating an Organization](#creating-an-organization)
- [Organization Settings](#organization-settings)
- [Team Member Management](#team-member-management)
- [Inviting Users](#inviting-users)
- [Role-Based Access Control](#role-based-access-control)
- [Switching Between Organizations](#switching-between-organizations)
- [Organization Best Practices](#organization-best-practices)

## Creating an Organization

### Step-by-Step Guide

1. **Navigate to Organizations**
   - Click on your profile menu
   - Select "Organizations"
   - Click "Create New Organization"

2. **Set Organization Details**
   ```typescript
   {
     name: "Your Team Name",
     slug: "your-team-slug",  // URL-friendly identifier
     description: "Description of your team's purpose"
   }
   ```

3. **Configure Initial Settings**
   - Upload organization avatar (optional)
   - Set default permissions for new members
   - Configure notification preferences

4. **Create Organization**
   - Review details
   - Click "Create Organization"
   - You're now the organization owner

### Using the API

```typescript
// Create organization via API
const createOrganization = async () => {
  const response = await fetch('/api/v1/organizations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'Acme Automation Team',
      slug: 'acme-automation',
      description: 'Team workspace for automation projects',
      settings: {
        defaultMemberRole: 'member',
        allowMemberInvites: true,
        requireApproval: false
      }
    })
  });

  const organization = await response.json();
  console.log('Created organization:', organization);
};
```

### Code Example

```typescript
import { organizationService } from '@/services/organization-service';

// Create a new organization
const organization = await organizationService.create({
  name: 'Engineering Team',
  slug: 'engineering',
  description: 'Main engineering team workspace',
  avatar_url: 'https://example.com/avatar.png',
  settings: {
    defaultMemberRole: 'member',
    allowMemberInvites: true,
    requireApproval: false,
    maxMembers: 50
  }
});
```

## Organization Settings

### General Settings

**Organization Name**
- Display name for your organization
- Can be changed at any time
- Visible to all members

**Slug**
- URL-friendly identifier
- Must be unique across all organizations
- Used in URLs: `/org/{slug}`
- Can only contain lowercase letters, numbers, and hyphens

**Description**
- Explains the purpose of the organization
- Shown on the organization page
- Helps members understand the team's focus

**Avatar**
- Organization logo or image
- Supports PNG, JPG, GIF formats
- Recommended size: 256x256 pixels
- Optional but recommended

### Advanced Settings

```typescript
interface OrganizationSettings {
  // Member management
  defaultMemberRole: 'member' | 'viewer';
  allowMemberInvites: boolean;
  requireApproval: boolean;
  maxMembers?: number;

  // Project defaults
  defaultProjectPermission: 'view' | 'comment' | 'edit';
  allowProjectCreation: boolean;

  // Notifications
  notifyOnNewMember: boolean;
  notifyOnProjectShared: boolean;
  activityDigestFrequency: 'daily' | 'weekly' | 'never';

  // Security
  requireTwoFactor: boolean;
  allowedEmailDomains?: string[];
  sessionTimeout?: number; // minutes
}
```

### Updating Settings

```typescript
// Update organization settings
const updateSettings = async (orgId: string, settings: Partial<OrganizationSettings>) => {
  const response = await fetch(`/api/v1/organizations/${orgId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ settings })
  });

  return await response.json();
};
```

## Team Member Management

### Viewing Members

```typescript
// Get organization members
const getMembers = async (orgId: string) => {
  const response = await fetch(`/api/v1/organizations/${orgId}/members`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    }
  });

  const members = await response.json();
  return members;
};
```

### Member List Interface

```typescript
interface TeamMember {
  id: string;
  organization_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  permissions: Record<string, any>;
  invited_by: string;
  joined_at: string;
  last_active_at: string;
  user: {
    email: string;
    username: string;
    full_name?: string;
    avatar_url?: string;
  };
}
```

### Changing Member Roles

```typescript
// Update member role
const updateMemberRole = async (
  orgId: string,
  memberId: string,
  newRole: 'admin' | 'member' | 'viewer'
) => {
  const response = await fetch(
    `/api/v1/organizations/${orgId}/members/${memberId}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ role: newRole })
    }
  );

  return await response.json();
};
```

### Removing Members

```typescript
// Remove member from organization
const removeMember = async (orgId: string, memberId: string) => {
  await fetch(`/api/v1/organizations/${orgId}/members/${memberId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    }
  });
};
```

**Warning:** Removing a member:
- Revokes all their access to organization projects
- Removes them from organization channels
- Does not delete their personal projects
- Cannot be undone (they must be re-invited)

## Inviting Users

### Email Invitations

1. **Navigate to Members Tab**
   - Go to Organization Settings
   - Click "Members" tab
   - Click "Invite Member"

2. **Enter Invitation Details**
   - Email address of the user
   - Role to assign (Admin, Member, or Viewer)
   - Optional personal message

3. **Send Invitation**
   - Click "Send Invite"
   - User receives email with invitation link
   - Invitation expires in 7 days by default

### Invitation API

```typescript
// Send organization invitation
const inviteUser = async (
  orgId: string,
  email: string,
  role: 'admin' | 'member' | 'viewer'
) => {
  const response = await fetch(`/api/v1/organizations/${orgId}/invitations`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      role,
      message: 'Join our team on Qontinui!',
      expiresIn: 7 // days
    })
  });

  return await response.json();
};
```

### Invitation Model

```typescript
interface OrganizationInvitation {
  id: string;
  organization_id: string;
  email: string;
  role: 'admin' | 'member' | 'viewer';
  invited_by: string;
  token: string; // Secure random token
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}
```

### Managing Invitations

```typescript
// List pending invitations
const getPendingInvitations = async (orgId: string) => {
  const response = await fetch(
    `/api/v1/organizations/${orgId}/invitations?status=pending`,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      }
    }
  );

  return await response.json();
};

// Resend invitation
const resendInvitation = async (orgId: string, invitationId: string) => {
  await fetch(
    `/api/v1/organizations/${orgId}/invitations/${invitationId}/resend`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      }
    }
  );
};

// Revoke invitation
const revokeInvitation = async (orgId: string, invitationId: string) => {
  await fetch(
    `/api/v1/organizations/${orgId}/invitations/${invitationId}`,
    {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      }
    }
  );
};
```

### Accepting Invitations

```typescript
// Accept organization invitation
const acceptInvitation = async (token: string) => {
  const response = await fetch(`/api/v1/invitations/${token}/accept`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    }
  });

  return await response.json();
};
```

## Role-Based Access Control

### Organization Roles

#### Owner
- **Full Control**: Complete control over the organization
- **Cannot be removed**: Must transfer ownership first
- **Unique**: Only one owner per organization

**Permissions:**
- Delete organization
- Transfer ownership
- Manage all settings
- Invite/remove all members
- Change member roles
- Access all projects
- Manage billing (if applicable)

#### Admin
- **High-level management**: Can manage most aspects of the organization
- **Cannot**: Delete organization or transfer ownership

**Permissions:**
- Invite/remove members (except owner)
- Change member roles (except owner)
- Manage organization settings
- Create and delete projects
- Share projects
- Access all organization projects

#### Member
- **Standard collaboration**: Can work on shared projects
- **Default role**: Usually assigned to new members

**Permissions:**
- View organization members
- Access shared projects (based on project permissions)
- Create projects (if enabled in settings)
- Comment on projects
- View activity feed

#### Viewer
- **Read-only access**: Can view but not modify
- **Limited interaction**: Cannot create or edit

**Permissions:**
- View organization members
- View shared projects (read-only)
- View activity feed
- Add comments (if project allows)

### Role Hierarchy

```
Owner
  └─ Can manage: Admins, Members, Viewers
     Admin
       └─ Can manage: Members, Viewers
          Member
            └─ Can manage: (none)
               Viewer
                 └─ Can manage: (none)
```

### Role Comparison Table

| Permission | Owner | Admin | Member | Viewer |
|------------|-------|-------|--------|--------|
| Delete organization | ✓ | ✗ | ✗ | ✗ |
| Transfer ownership | ✓ | ✗ | ✗ | ✗ |
| Manage settings | ✓ | ✓ | ✗ | ✗ |
| Invite members | ✓ | ✓ | * | ✗ |
| Remove members | ✓ | ✓ | ✗ | ✗ |
| Change roles | ✓ | ✓ | ✗ | ✗ |
| Create projects | ✓ | ✓ | * | ✗ |
| Share projects | ✓ | ✓ | ✓ | ✗ |
| Edit projects | ✓ | ✓ | ✓ | ✗ |
| View projects | ✓ | ✓ | ✓ | ✓ |
| Comment | ✓ | ✓ | ✓ | * |

`*` = Depends on organization settings

### Custom Permissions

```typescript
// Set custom permissions for a member
const setCustomPermissions = async (
  orgId: string,
  memberId: string,
  permissions: Record<string, boolean>
) => {
  const response = await fetch(
    `/api/v1/organizations/${orgId}/members/${memberId}/permissions`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ permissions })
    }
  );

  return await response.json();
};

// Example: Grant specific permissions
await setCustomPermissions(orgId, memberId, {
  canInviteMembers: true,
  canCreateProjects: true,
  canDeleteComments: false,
  canExportProjects: true,
  canViewAnalytics: false
});
```

## Switching Between Organizations

### Organization Switcher

Users can be members of multiple organizations and easily switch between them.

```typescript
// Get user's organizations
const getUserOrganizations = async () => {
  const response = await fetch('/api/v1/me/organizations', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    }
  });

  return await response.json();
};

// Switch active organization
const switchOrganization = async (orgId: string) => {
  // Update user's active organization context
  localStorage.setItem('activeOrgId', orgId);

  // Refresh UI to show org-specific data
  window.location.reload();
};
```

### UI Component Example

```typescript
import { Select } from '@/components/ui/select';
import { useOrganizations } from '@/hooks/use-organizations';

export function OrganizationSwitcher() {
  const { organizations, activeOrg, setActiveOrg } = useOrganizations();

  return (
    <Select
      value={activeOrg?.id}
      onValueChange={setActiveOrg}
    >
      {organizations.map(org => (
        <SelectItem key={org.id} value={org.id}>
          <div className="flex items-center gap-2">
            {org.avatar_url && (
              <img
                src={org.avatar_url}
                alt={org.name}
                className="w-6 h-6 rounded"
              />
            )}
            <span>{org.name}</span>
          </div>
        </SelectItem>
      ))}
    </Select>
  );
}
```

## Organization Best Practices

### Naming Conventions

**Organization Name**
- Use your company or team name
- Keep it professional and recognizable
- Examples: "Acme Engineering", "Design Team", "QA Department"

**Slug**
- Keep it short and memorable
- Use hyphens for multi-word names
- Examples: "acme-eng", "design-team", "qa-dept"

### Team Structure

**Small Teams (2-10 people)**
- One organization is sufficient
- Most members should be "Members"
- 1-2 Admins to help with management

**Medium Teams (10-50 people)**
- Consider sub-teams within organization
- Use project-level permissions for team isolation
- Multiple Admins for distributed management

**Large Teams (50+ people)**
- Multiple organizations for departments
- Strict role assignments
- Regular audit of members and permissions

### Security Best Practices

1. **Regular Audits**
   - Review member list monthly
   - Remove inactive members
   - Verify role assignments

2. **Principle of Least Privilege**
   - Grant minimum necessary permissions
   - Use Viewer role for read-only users
   - Promote to higher roles only when needed

3. **Invitation Management**
   - Set short expiration times for invitations
   - Use email domain restrictions when possible
   - Review pending invitations regularly

4. **Owner Management**
   - Have a designated backup owner
   - Document ownership transfer process
   - Use admin accounts for day-to-day operations

### Collaboration Tips

1. **Clear Communication**
   - Set organization description
   - Document team processes
   - Use comments for discussions

2. **Project Organization**
   - Use consistent naming for projects
   - Tag projects by type or department
   - Archive completed projects

3. **Activity Monitoring**
   - Enable activity notifications
   - Review activity feed regularly
   - Address issues promptly

4. **Member Onboarding**
   - Create onboarding documentation
   - Assign mentors to new members
   - Start new members as Viewers or Members

## Related Documentation

- [Project Sharing](./project-sharing.md) - Share projects with organizations
- [Permissions](./permissions.md) - Detailed permission model
- [Activity Tracking](./activity-tracking.md) - Monitor organization activity
- [API Reference](./api-reference.md) - Complete API documentation

## Troubleshooting

See the [Troubleshooting Guide](./troubleshooting.md#organizations) for common organization issues.

---

**Last Updated:** 2025-01-14
