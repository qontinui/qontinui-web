# Frontend Permission Utilities - Implementation Summary

## Overview

Created frontend utilities for permission enforcement in the UI, matching the backend permission model defined in `backend/app/models/organization.py`.

## Files Created

### 1. `/frontend/src/lib/permissions.ts`

Core permission utilities library providing:

- **Permission Types**: `PermissionLevel` type matching backend enum (`'none' | 'view' | 'comment' | 'edit' | 'admin' | 'owner'`)
- **Permission Checking Functions**:
  - `hasPermission(requiredLevel, userLevel)` - Compare permission levels
  - `getPermissionLevel(project, currentUser)` - Get effective permission level
  - `canUserView(project, currentUser)` - Check view permission
  - `canUserComment(project, currentUser)` - Check comment permission
  - `canUserEdit(project, currentUser)` - Check edit permission
  - `canUserAdmin(project, currentUser)` - Check admin permission
  - `isProjectOwner(project, currentUser)` - Check if user is owner
- **Display Utilities**:
  - `getPermissionLabel(level)` - Human-readable label
  - `getPermissionDescription(level)` - Permission description
  - `getPermissionLevelOptions()` - Options for UI dropdowns
- **Validation**:
  - `isValidPermissionLevel(level)` - Type guard
  - `parsePermissionLevel(level)` - Safe parsing

### 2. `/frontend/src/hooks/useProjectPermissions.ts`

React hook for checking user permissions on a project.

**Returns**:

```typescript
{
  permissionLevel: PermissionLevel;
  canView: boolean;
  canComment: boolean;
  canEdit: boolean;
  canAdmin: boolean;
  isOwner: boolean;
  hasPermission: (required: PermissionLevel) => boolean;
  currentUser: User | null;
  isLoading: boolean;
}
```

**Convenience Hooks**:

- `useCanEditProject(project)` - Returns boolean
- `useCanCommentProject(project)` - Returns boolean
- `useCanAdminProject(project)` - Returns boolean
- `useIsProjectOwner(project)` - Returns boolean

### 3. `/frontend/src/components/collaboration/PermissionGate.tsx` (Updated)

Updated existing component to support both new and legacy APIs:

**New API** (recommended):

```tsx
<PermissionGate project={project} requiredPermission="edit">
  <EditButton />
</PermissionGate>
```

**Legacy API** (still supported):

```tsx
<PermissionGate requiredPermission="edit" userRole="editor">
  <EditButton />
</PermissionGate>
```

**Features**:

- Backward compatible with existing usage
- Supports custom fallback content
- Optional error messages
- Permission hierarchy enforcement

### 4. `/frontend/src/contexts/collaboration-context.tsx` (Updated)

Updated collaboration context to include permission utilities:

**Added**:

- `canView: boolean` - New permission check
- `hasPermission(required: PermissionLevel) => boolean` - Dynamic permission checking
- Uses new permission utilities from `@/lib/permissions`

**Updated**:

- Permission checks now use `hasPermission()` function instead of hardcoded logic
- More maintainable and consistent with backend model

### 5. `/frontend/src/lib/schemas/api-schemas.ts` (Updated)

Updated Project schema to include permission information:

**Added**:

- `PermissionLevelSchema` - Zod enum for permission validation
- `permission_level?: PermissionLevel` field to `ProjectSchema`

## Permission Hierarchy

```
none < view < comment < edit < admin < owner
  0      1       2        3      4       5
```

- **none**: No access
- **view**: Can view workflows and configurations
- **comment**: Can view and add comments
- **edit**: Can view, comment, and edit workflows
- **admin**: Can manage project settings and permissions
- **owner**: Full control (project owner)

## Example Usage

### 1. Using the Hook

```tsx
import { useProjectPermissions } from "@/hooks/useProjectPermissions";

function ProjectEditor({ project }) {
  const { canEdit, canComment, canAdmin, permissionLevel, isLoading } =
    useProjectPermissions(project);

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (!canEdit) {
    return <ReadOnlyView project={project} />;
  }

  return (
    <div>
      <Editor project={project} />
      {canComment && <CommentPanel />}
      {canAdmin && <SettingsButton />}
      <PermissionBadge level={permissionLevel} />
    </div>
  );
}
```

### 2. Using PermissionGate Component

```tsx
import { PermissionGate } from "@/components/collaboration/PermissionGate";

function ProjectActions({ project }) {
  return (
    <div>
      {/* Always visible */}
      <ViewButton />

      {/* Only visible if user can comment */}
      <PermissionGate project={project} requiredPermission="comment">
        <CommentButton />
      </PermissionGate>

      {/* Only visible if user can edit */}
      <PermissionGate project={project} requiredPermission="edit">
        <EditButton />
        <SaveButton />
      </PermissionGate>

      {/* Only visible if user can admin */}
      <PermissionGate project={project} requiredPermission="admin">
        <ShareButton />
        <SettingsButton />
      </PermissionGate>

      {/* Only visible if user is owner */}
      <PermissionGate project={project} requiredPermission="owner">
        <DeleteButton />
      </PermissionGate>
    </div>
  );
}
```

### 3. Using with Fallback Content

```tsx
<PermissionGate
  project={project}
  requiredPermission="edit"
  fallback={<ReadOnlyBanner />}
>
  <WorkflowEditor />
</PermissionGate>
```

### 4. Using with Error Messages

```tsx
<PermissionGate project={project} requiredPermission="admin" showMessage={true}>
  <DangerZone />
</PermissionGate>
```

### 5. Using Direct Permission Functions

```tsx
import { canUserEdit, getPermissionLevel } from "@/lib/permissions";
import { useAuth } from "@/contexts/auth-context";

function MyComponent({ project }) {
  const { user } = useAuth();

  const level = getPermissionLevel(project, user);
  const hasEditAccess = canUserEdit(project, user);

  return (
    <div>
      <p>Your permission: {level}</p>
      {hasEditAccess && <EditForm />}
    </div>
  );
}
```

### 6. Using Collaboration Context

```tsx
import { useCollaboration } from "@/contexts/collaboration-context";

function CollaborativeEditor() {
  const {
    canView,
    canComment,
    canEdit,
    canAdmin,
    hasPermission,
    projectAccess,
  } = useCollaboration();

  return (
    <div>
      <p>Current permission: {projectAccess}</p>

      {canView && <ViewPanel />}
      {canComment && <CommentPanel />}
      {canEdit && <EditorPanel />}
      {canAdmin && <AdminPanel />}

      {/* Dynamic permission checking */}
      {hasPermission("edit") && <SaveButton />}
    </div>
  );
}
```

### 7. Using Convenience Hooks

```tsx
import { useCanEditProject } from "@/hooks/useProjectPermissions";

function QuickEditButton({ project }) {
  const canEdit = useCanEditProject(project);

  if (!canEdit) return null;

  return <button>Quick Edit</button>;
}
```

### 8. Conditional Rendering

```tsx
function ProjectDashboard({ project }) {
  const { canEdit, canAdmin, isOwner } = useProjectPermissions(project);

  return (
    <div>
      <h1>{project.name}</h1>

      {/* Multiple permission levels */}
      {canEdit && (
        <section>
          <h2>Editor Tools</h2>
          <EditTools />
        </section>
      )}

      {canAdmin && (
        <section>
          <h2>Admin Tools</h2>
          <UserManagement />
          <PermissionSettings />
        </section>
      )}

      {isOwner && (
        <section>
          <h2>Owner Tools</h2>
          <TransferOwnership />
          <DeleteProject />
        </section>
      )}
    </div>
  );
}
```

### 9. Permission Dropdown

```tsx
import { getPermissionLevelOptions } from "@/lib/permissions";

function PermissionSelector({ value, onChange }) {
  const options = getPermissionLevelOptions();

  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(({ value, label, description }) => (
        <option key={value} value={value} title={description}>
          {label}
        </option>
      ))}
    </select>
  );
}
```

## Integration with Existing Code

### CollaborationProvider

The `CollaborationProvider` now includes permission utilities:

```tsx
import { CollaborationProvider } from "@/contexts/collaboration-context";

function App() {
  return (
    <CollaborationProvider projectId={projectId}>
      <YourApp />
    </CollaborationProvider>
  );
}
```

Inside the provider, you can use `useCollaboration()` to access permissions.

### Project Data

When fetching projects from the API, ensure the response includes `permission_level`:

```typescript
// API response example
{
  id: "project-123",
  name: "My Project",
  owner_id: "user-456",
  permission_level: "edit", // User's permission level
  // ... other fields
}
```

If not provided, the system falls back to checking if user is owner.

## Backend Integration

The frontend permission model matches the backend:

**Backend** (`backend/app/models/organization.py`):

```python
class PermissionLevel(str, Enum):
    VIEW = "view"
    COMMENT = "comment"
    EDIT = "edit"
    ADMIN = "admin"
```

**Frontend** (`frontend/src/lib/permissions.ts`):

```typescript
export type PermissionLevel =
  | "none"
  | "view"
  | "comment"
  | "edit"
  | "admin"
  | "owner";
```

Note: Frontend adds `'none'` and `'owner'` for UI convenience.

## Testing

Example test cases:

```typescript
import { hasPermission, canUserEdit } from "@/lib/permissions";

describe("Permission Utilities", () => {
  it("should check permission hierarchy", () => {
    expect(hasPermission("view", "edit")).toBe(true);
    expect(hasPermission("edit", "view")).toBe(false);
    expect(hasPermission("edit", "edit")).toBe(true);
  });

  it("should check user edit permission", () => {
    const project = { id: "1", owner_id: "user-1", permission_level: "edit" };
    const user = { id: "user-2" };
    expect(canUserEdit(project, user)).toBe(true);
  });

  it("should recognize project owner", () => {
    const project = { id: "1", owner_id: "user-1" };
    const user = { id: "user-1" };
    expect(canUserEdit(project, user)).toBe(true);
  });
});
```

## Migration Guide

### For Existing Code Using Legacy API

No changes required! The `PermissionGate` component maintains backward compatibility:

```tsx
// Old code - still works
<PermissionGate requiredPermission="edit" userRole="editor">
  <EditButton />
</PermissionGate>
```

### Recommended Migration Path

1. Update to new API when convenient:

```tsx
// New code - recommended
<PermissionGate project={project} requiredPermission="edit">
  <EditButton />
</PermissionGate>
```

2. Use the new hook for more complex permission logic:

```tsx
// Instead of checking roles manually
const isEditor = userRole === "editor" || userRole === "admin";

// Use the hook
const { canEdit } = useProjectPermissions(project);
```

## Benefits

1. **Type Safety**: TypeScript types match backend model
2. **Consistency**: Single source of truth for permission logic
3. **Maintainability**: Centralized permission utilities
4. **Flexibility**: Multiple ways to check permissions (hooks, components, functions)
5. **Backward Compatible**: Doesn't break existing code
6. **Well Documented**: Clear examples and JSDoc comments
7. **Testable**: Pure functions easy to unit test

## Next Steps

1. Update API endpoints to include `permission_level` in project responses
2. Implement backend permission checking for project access
3. Add permission management UI for project owners
4. Extend to other resources (workflows, states, transitions)
5. Add audit logging for permission changes
