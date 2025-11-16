# Permission Utilities - Quick Reference

## Import Paths

```typescript
// Permission utilities
import {
  hasPermission,
  canUserEdit,
  getPermissionLevel
} from '@/lib/permissions';

// Permission hook
import { useProjectPermissions } from '@/hooks/useProjectPermissions';

// Permission gate component
import { PermissionGate } from '@/components/collaboration/PermissionGate';

// Collaboration context
import { useCollaboration } from '@/contexts/collaboration-context';

// Auth context
import { useAuth } from '@/contexts/auth-context';
```

## Permission Levels (Hierarchy)

```
none < view < comment < edit < admin < owner
```

## Common Patterns

### Check if User Can Edit

```tsx
// Using hook (recommended)
const { canEdit } = useProjectPermissions(project);

// Using function
const canEdit = canUserEdit(project, currentUser);

// Using collaboration context
const { canEdit } = useCollaboration();
```

### Conditionally Render Component

```tsx
// Using hook
function Component({ project }) {
  const { canEdit } = useProjectPermissions(project);

  return canEdit ? <Editor /> : <ReadOnly />;
}

// Using PermissionGate
function Component({ project }) {
  return (
    <PermissionGate project={project} requiredPermission="edit">
      <Editor />
    </PermissionGate>
  );
}
```

### Show Different UI Based on Permission

```tsx
function Component({ project }) {
  const { canView, canComment, canEdit, canAdmin, isOwner } =
    useProjectPermissions(project);

  return (
    <div>
      {canView && <ViewPanel />}
      {canComment && <CommentPanel />}
      {canEdit && <EditPanel />}
      {canAdmin && <AdminPanel />}
      {isOwner && <OwnerPanel />}
    </div>
  );
}
```

### Permission Selector Dropdown

```tsx
import { getPermissionLevelOptions } from '@/lib/permissions';

function PermissionDropdown({ value, onChange }) {
  const options = getPermissionLevelOptions();

  return (
    <select value={value} onChange={e => onChange(e.target.value)}>
      {options.map(({ value, label, description }) => (
        <option key={value} value={value}>{label}</option>
      ))}
    </select>
  );
}
```

### Display Permission Level

```tsx
import { getPermissionLabel, getPermissionDescription } from '@/lib/permissions';

function PermissionBadge({ level }) {
  return (
    <span title={getPermissionDescription(level)}>
      {getPermissionLabel(level)}
    </span>
  );
}
```

### Dynamic Permission Checking

```tsx
function Component({ project }) {
  const { hasPermission } = useProjectPermissions(project);

  // Check any permission level at runtime
  if (hasPermission('admin')) {
    return <AdminFeature />;
  }

  if (hasPermission('edit')) {
    return <EditFeature />;
  }

  return <ViewFeature />;
}
```

## All Available Functions

### From `@/lib/permissions`

```typescript
// Type
type PermissionLevel = 'none' | 'view' | 'comment' | 'edit' | 'admin' | 'owner';

// Checking functions
hasPermission(requiredLevel, userLevel): boolean
getPermissionLevel(project, currentUser): PermissionLevel
canUserView(project, currentUser): boolean
canUserComment(project, currentUser): boolean
canUserEdit(project, currentUser): boolean
canUserAdmin(project, currentUser): boolean
isProjectOwner(project, currentUser): boolean

// Display functions
getPermissionLabel(level): string
getPermissionDescription(level): string
getAvailablePermissionLevels(): PermissionLevel[]
getPermissionLevelOptions(): Array<{value, label, description}>

// Validation functions
isValidPermissionLevel(level): boolean
parsePermissionLevel(level): PermissionLevel
```

### From `useProjectPermissions` Hook

```typescript
const {
  permissionLevel,     // Current permission level
  canView,            // Can view project
  canComment,         // Can comment on project
  canEdit,            // Can edit project
  canAdmin,           // Has admin permissions
  isOwner,            // Is project owner
  hasPermission,      // Function to check specific level
  currentUser,        // Current user
  isLoading,          // Loading state
} = useProjectPermissions(project);
```

### Convenience Hooks

```typescript
const canEdit = useCanEditProject(project);
const canComment = useCanCommentProject(project);
const canAdmin = useCanAdminProject(project);
const isOwner = useIsProjectOwner(project);
```

### From `useCollaboration` Context

```typescript
const {
  projectAccess,      // PermissionLevel | null
  canView,           // boolean
  canComment,        // boolean
  canEdit,           // boolean
  canAdmin,          // boolean
  hasPermission,     // (level) => boolean
  // ... other collaboration features
} = useCollaboration();
```

## Component Props

### PermissionGate

```typescript
interface PermissionGateProps {
  // New API (recommended)
  project?: ProjectWithPermissions;
  requiredPermission?: PermissionLevel | Permission | Array<...>;

  // Legacy API (still supported)
  userPermissions?: Permission[];
  userRole?: string;

  // Display options
  fallback?: React.ReactNode;
  showMessage?: boolean;
  className?: string;

  children: React.ReactNode;
}
```

## TypeScript Types

```typescript
// Permission level
type PermissionLevel = 'none' | 'view' | 'comment' | 'edit' | 'admin' | 'owner';

// Project with permissions
interface ProjectWithPermissions {
  id: string;
  name: string;
  owner_id: string;
  permission_level?: PermissionLevel;
  [key: string]: any;
}

// Project (from schema)
interface Project {
  id: string;
  name: string;
  description: string | null;
  configuration: Record<string, unknown>;
  owner_id: string;
  created_at: string;
  updated_at: string;
  permission_level?: PermissionLevel;
}

// User (from schema)
interface User {
  id: string;
  email: string;
  username: string;
  // ... other fields
}
```

## Decision Tree

**When to use what?**

- **Simple boolean check in component**: Use `useProjectPermissions` hook
- **Conditionally render JSX**: Use `PermissionGate` component
- **Permission check in utility function**: Use `canUserEdit()` etc functions
- **Within collaboration features**: Use `useCollaboration` context
- **Just need one specific check**: Use convenience hooks like `useCanEditProject`
- **Complex permission logic**: Use `hasPermission()` with custom logic

## Examples by Use Case

### 1. Hide/Show Edit Button

```tsx
const { canEdit } = useProjectPermissions(project);
return canEdit ? <EditButton /> : null;
```

### 2. Disable Button if No Permission

```tsx
const { canEdit } = useProjectPermissions(project);
return <button disabled={!canEdit}>Edit</button>;
```

### 3. Show Different View Based on Permission

```tsx
const { canEdit } = useProjectPermissions(project);
return canEdit ? <EditorView /> : <ReadOnlyView />;
```

### 4. Permission-based Navigation

```tsx
const { canAdmin } = useProjectPermissions(project);

return (
  <nav>
    <Link to="/view">View</Link>
    {canAdmin && <Link to="/settings">Settings</Link>}
  </nav>
);
```

### 5. Form Submit with Permission Check

```tsx
const { canEdit } = useProjectPermissions(project);

const handleSubmit = async () => {
  if (!canEdit) {
    toast.error('You do not have permission to edit');
    return;
  }

  await saveChanges();
};
```

### 6. Multiple Permission Levels

```tsx
const { permissionLevel } = useProjectPermissions(project);

const features = {
  view: ['read'],
  comment: ['read', 'comment'],
  edit: ['read', 'comment', 'edit'],
  admin: ['read', 'comment', 'edit', 'manage'],
  owner: ['read', 'comment', 'edit', 'manage', 'delete'],
}[permissionLevel] || [];
```

## Best Practices

1. **Use the hook for component logic**: `useProjectPermissions(project)`
2. **Use PermissionGate for JSX**: Cleaner than conditional rendering
3. **Check permissions early**: Fail fast and show appropriate UI
4. **Handle loading states**: `isLoading` from the hook
5. **Provide fallbacks**: Show locked state instead of hiding completely
6. **Be consistent**: Use the same pattern across your app
7. **Don't duplicate logic**: Reuse the utilities instead of custom checks

## Common Gotchas

1. **Project can be null/undefined**: Always handle loading state
2. **currentUser can be null**: Hook handles this, but functions need manual check
3. **Owner vs Admin**: Owner has all permissions, Admin doesn't have delete
4. **Permission level is optional**: May not be included in API response
5. **Fallback behavior**: If no permission_level, checks if user is owner
