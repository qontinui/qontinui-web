# Collaboration UI Components

Comprehensive collaboration components for qontinui-web, including real-time presence, permissions, commenting, and review workflows.

> **Cloud-only components (slot-registered):** the four org/team
> components — `OrganizationSwitcher`, `CreateOrganizationDialog`,
> `TeamMemberList`, `InviteMemberDialog` — are no longer importable
> from `@/components/collaboration` or have OSS-side stub files. They
> are React components registered by `@qontinui/cloud-control` into
> the `getComponent(name)` slot via
> `registerCloudExtensions({ components: { ... } })`. OSS consumers
> retrieve them with `getComponent<P>(slotName)` and render
> conditionally — `undefined` means single-tenant deploy with nothing
> to render. Prop contracts live in
> `frontend/src/lib/cloud-component-slots.ts`. See `orgs/index.ts` for
> the type re-exports. The "Usage" snippets below for those four
> components show the legacy direct-import shape and are kept for
> historical reference only — actual integration goes through
> `getComponent`.

## Components Overview

### 1. OrganizationSwitcher

Dropdown component to switch between organizations.

**Features:**

- Shows current organization with avatar
- Lists all user's organizations with member counts
- "Create New Organization" action
- Keyboard navigation support

**Usage:**

```tsx
import { OrganizationSwitcher } from "@/components/collaboration";

<OrganizationSwitcher
  organizations={organizations}
  currentOrganization={currentOrg}
  onOrganizationChange={(orgId) => switchOrg(orgId)}
  onCreateOrganization={() => openCreateDialog()}
  loading={isLoading}
/>;
```

### 2. TeamMemberList

Table view of team members with role management.

**Features:**

- Search and filter members
- Role management (for admins)
- Remove members
- Pagination for large teams
- Invite button
- Shows last active time

**Usage:**

```tsx
import { TeamMemberList } from "@/components/collaboration";

<TeamMemberList
  members={members}
  currentUserId={user.id}
  currentUserRole="admin"
  onInvite={() => openInviteDialog()}
  onRoleChange={async (memberId, role) => await updateRole(memberId, role)}
  onRemove={async (memberId) => await removeMember(memberId)}
/>;
```

### 3. InviteMemberDialog

Dialog for inviting new team members.

**Features:**

- Email validation
- Role selection (viewer/member/admin)
- Pending invitations list
- Resend/cancel actions
- Loading states

**Usage:**

```tsx
import { InviteMemberDialog } from "@/components/collaboration";

<InviteMemberDialog
  open={isOpen}
  onOpenChange={setIsOpen}
  pendingInvitations={pending}
  onInvite={async (email, role) => await sendInvite(email, role)}
  onResend={async (id) => await resendInvite(id)}
  onCancel={async (id) => await cancelInvite(id)}
/>;
```

### 4. ProjectSharingDialog

Share projects with users or organizations.

**Features:**

- Share with specific users (email input)
- Share with organizations
- Permission levels (view/comment/edit/admin)
- Current collaborators list
- Change permissions inline
- Copy share link
- Revoke access

**Usage:**

```tsx
import { ProjectSharingDialog } from "@/components/collaboration";

<ProjectSharingDialog
  open={isOpen}
  onOpenChange={setIsOpen}
  projectId={project.id}
  collaborators={collaborators}
  organizations={organizations}
  shareLink={shareLink}
  onAddUser={async (email, permission) =>
    await shareWithUser(email, permission)
  }
  onAddOrganization={async (orgId, permission) =>
    await shareWithOrg(orgId, permission)
  }
  onChangePermission={async (id, permission) =>
    await updatePermission(id, permission)
  }
  onRevoke={async (id) => await revokeAccess(id)}
  onGenerateLink={async () => await generateShareLink()}
/>;
```

### 5. CollaboratorAvatars

Stack of avatar circles showing active collaborators.

**Features:**

- Shows first 3-5 avatars, "+N more" for rest
- Hover tooltips with full names
- Color-coded presence status
- Click to see full list dialog
- Configurable size (sm/md/lg)

**Usage:**

```tsx
import { CollaboratorAvatars } from "@/components/collaboration";

<CollaboratorAvatars
  collaborators={activeUsers}
  maxVisible={5}
  size="md"
  showStatus={true}
  onAvatarClick={(user) => focusOnUser(user)}
/>;
```

### 6. PresenceIndicator

Real-time presence sidebar showing who's online.

**Features:**

- Shows avatar, name, status (active/viewing/editing)
- What they're editing
- Optional cursor indicators
- Collapsible
- Auto-updates

**Usage:**

```tsx
import { PresenceIndicator } from "@/components/collaboration";

<PresenceIndicator
  users={presenceData}
  currentUserId={user.id}
  showCursors={true}
  collapsible={true}
  onUserClick={(user) => goToUser(user)}
/>;
```

### 7. EditLockBanner

Banner shown when resource is locked by another user.

**Features:**

- Shows who's editing
- Countdown timer until lock expires
- Request edit access button
- Override lock (admin only)
- Different styling for own lock vs others

**Usage:**

```tsx
import { EditLockBanner } from "@/components/collaboration";

<EditLockBanner
  lock={currentLock}
  currentUserId={user.id}
  onRequestAccess={() => requestEditAccess()}
  onOverride={() => overrideLock()}
  canOverride={user.isAdmin}
/>;
```

### 8. CommentThread

Threaded comment discussion component.

**Features:**

- Rich text comments
- Reply to comments
- Edit/delete own comments
- Resolve/unresolve threads
- @ mentions with autocomplete
- Timestamps
- Real-time updates

**Usage:**

```tsx
import { CommentThread } from "@/components/collaboration";

<CommentThread
  thread={commentThread}
  currentUserId={user.id}
  currentUserName={user.name}
  availableUsers={teamMembers}
  onAddComment={async (content, parentId) =>
    await addComment(content, parentId)
  }
  onEditComment={async (id, content) => await updateComment(id, content)}
  onDeleteComment={async (id) => await deleteComment(id)}
  onResolve={async () => await resolveThread()}
  onReopen={async () => await reopenThread()}
/>;
```

### 9. ActivityFeed

Timeline of project activities with filtering.

**Features:**

- Grouped by date (Today/Yesterday/Date)
- Filter by user, action type, resource type
- Real-time updates indicator
- Load more pagination
- Click to navigate to resource
- Action icons and colors

**Usage:**

```tsx
import { ActivityFeed } from "@/components/collaboration";

<ActivityFeed
  activities={activities}
  onLoadMore={async () => await loadMoreActivities()}
  hasMore={hasMore}
  loading={isLoading}
  realtime={true}
  onActivityClick={(activity) => navigateToResource(activity)}
/>;
```

### 10. PermissionGate

HOC/wrapper to show content based on permissions.

**Features:**

- Check single or multiple permissions
- Role-based or permission-based
- Custom fallback component
- Optional message display
- usePermission hook for programmatic checks

**Usage:**

```tsx
import { PermissionGate, usePermission } from '@/components/collaboration';

// As component wrapper
<PermissionGate requiredPermission="edit" userRole="editor">
  <EditButton />
</PermissionGate>

// With custom fallback
<PermissionGate
  requiredPermission={['edit', 'delete']}
  userPermissions={userPerms}
  fallback={<LockedMessage />}
>
  <DangerZone />
</PermissionGate>

// As hook
const { hasPermission } = usePermission(userRole);
if (hasPermission('edit')) {
  // Show edit UI
}
```

### 11. ConflictResolutionDialog

Resolve conflicts when multiple users edit simultaneously.

**Features:**

- Side-by-side or unified diff view
- Keep Mine / Keep Theirs / Merge options
- Field-by-field conflict resolution
- Visual diff highlighting
- Multi-conflict navigation
- Resolve all conflicts at once

**Usage:**

```tsx
import { ConflictResolutionDialog } from "@/components/collaboration";

<ConflictResolutionDialog
  open={hasConflicts}
  onOpenChange={setHasConflicts}
  conflicts={conflicts}
  currentConflictIndex={0}
  onResolve={async (id, resolution, mergedData) =>
    await resolveConflict(id, resolution, mergedData)
  }
  onResolveAll={async (resolution) => await resolveAllConflicts(resolution)}
/>;
```

### 12. ReviewRequestPanel

Create and manage review requests.

**Features:**

- Create review request with multiple reviewers
- Submit review with approve/request changes
- Review comments and decisions
- Status badges
- Cancel review request
- Shows all reviewer statuses

**Usage:**

```tsx
import { ReviewRequestPanel } from "@/components/collaboration";

<ReviewRequestPanel
  reviewRequest={currentReview}
  availableReviewers={reviewers}
  currentUserId={user.id}
  isRequester={isRequester}
  isReviewer={isReviewer}
  onCreateReview={async (data) => await createReview(data)}
  onSubmitReview={async (data) => await submitReview(data)}
  onCancelReview={async () => await cancelReview()}
/>;
```

## Installation Requirements

These components use:

- **shadcn/ui** components (Button, Dialog, Input, Select, etc.)
- **lucide-react** icons
- **date-fns** for date formatting
- **react-hook-form** + **zod** for form validation
- **sonner** for toast notifications

## Dark Mode Support

All components support dark mode through Tailwind CSS classes and `next-themes`.

## Accessibility

All components include:

- ARIA labels and roles
- Keyboard navigation
- Screen reader support
- Focus management
- Semantic HTML

## Responsive Design

Components are fully responsive with:

- Mobile-first design
- Flexible layouts
- Touch-friendly targets
- Adaptive content

## TypeScript

Full TypeScript support with:

- Exported types and interfaces
- Generic components
- Type-safe props
- IntelliSense support

## Example Integration

```tsx
"use client";

import { useState } from "react";
import {
  OrganizationSwitcher,
  TeamMemberList,
  CollaboratorAvatars,
  PresenceIndicator,
  ActivityFeed,
  PermissionGate,
} from "@/components/collaboration";

export function CollaborationDashboard() {
  const [currentOrg, setCurrentOrg] = useState(null);

  return (
    <div className="p-6 space-y-6">
      {/* Organization Switcher */}
      <OrganizationSwitcher
        organizations={organizations}
        currentOrganization={currentOrg}
        onOrganizationChange={setCurrentOrg}
        onCreateOrganization={() => {}}
      />

      {/* Main Content with Permission Gate */}
      <PermissionGate requiredPermission="view" userRole="member">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column */}
          <div className="lg:col-span-2 space-y-6">
            <TeamMemberList
              members={members}
              currentUserId={user.id}
              currentUserRole="admin"
              onInvite={() => {}}
              onRoleChange={async () => {}}
              onRemove={async () => {}}
            />

            <ActivityFeed
              activities={activities}
              onLoadMore={async () => {}}
              hasMore={true}
              realtime={true}
            />
          </div>

          {/* Right Sidebar */}
          <div className="space-y-6">
            <CollaboratorAvatars
              collaborators={activeUsers}
              maxVisible={5}
              showStatus={true}
            />

            <PresenceIndicator
              users={presenceData}
              currentUserId={user.id}
              showCursors={false}
            />
          </div>
        </div>
      </PermissionGate>
    </div>
  );
}
```

## API Integration

These components are designed to work with a backend collaboration service. Example API methods:

```typescript
// Organization management
await api.organizations.list();
await api.organizations.create(data);
await api.organizations.switch(orgId);

// Team members
await api.members.list(orgId);
await api.members.invite(email, role);
await api.members.updateRole(memberId, role);
await api.members.remove(memberId);

// Project sharing
await api.projects.share(projectId, userId, permission);
await api.projects.updatePermission(projectId, userId, permission);
await api.projects.revokeAccess(projectId, userId);

// Real-time features
await api.presence.subscribe(resourceId);
await api.presence.update(status, location);
await api.locks.acquire(resourceId);
await api.locks.release(resourceId);

// Comments and reviews
await api.comments.create(threadId, content);
await api.reviews.create(resourceId, reviewers, description);
await api.reviews.submit(reviewId, decision, comment);
```

## License

Part of qontinui-web project.
