# Migration Guide: Collaboration Context Refactoring

This guide helps you migrate from the old monolithic `collaboration-context.tsx` to the new modular collaboration contexts.

## Overview

The collaboration context has been split into 7 focused contexts:
1. `OrganizationContext` - Organization management
2. `PermissionsContext` - Permission checking
3. `PresenceContext` - User presence
4. `EditLockContext` - Edit locks
5. `CommentsContext` - Comments system
6. `ActivityContext` - Activity feed
7. `WebSocketContext` - WebSocket connection

## Step-by-Step Migration

### Step 1: Update Imports

**Old Import:**
```tsx
import { useCollaboration, CollaborationProvider } from '@/contexts/collaboration-context';
```

**New Import (Option A - Individual hooks):**
```tsx
import {
  useOrganization,
  usePermissions,
  usePresence,
  useEditLock,
  useComments,
  useActivity,
  useWebSocket,
  CollaborationProvider
} from '@/contexts/collaboration';
```

**New Import (Option B - Keep using combined provider):**
```tsx
import { CollaborationProvider } from '@/contexts/collaboration';
// Then import only the hooks you need in each component
```

### Step 2: Update Hook Usage

The `useCollaboration()` hook has been split into individual hooks. Update your components to use the specific hooks they need.

#### Example 1: Component Using Organization and Permissions

**Before:**
```tsx
function MyComponent() {
  const {
    currentOrg,
    organizations,
    switchOrganization,
    canEdit,
    canAdmin
  } = useCollaboration();

  // ... component logic
}
```

**After:**
```tsx
function MyComponent() {
  const { currentOrg, organizations, switchOrganization } = useOrganization();
  const { canEdit, canAdmin } = usePermissions();

  // ... component logic
}
```

#### Example 2: Component Using Comments and Activity

**Before:**
```tsx
function ActivityPanel() {
  const {
    comments,
    addComment,
    activityFeed
  } = useCollaboration();

  // ... component logic
}
```

**After:**
```tsx
function ActivityPanel() {
  const { comments, addComment } = useComments();
  const { activityFeed } = useActivity();

  // ... component logic
}
```

#### Example 3: Component Using Edit Locks

**Before:**
```tsx
function Editor() {
  const {
    currentLock,
    acquireEditLock,
    releaseEditLock
  } = useCollaboration();

  // ... component logic
}
```

**After:**
```tsx
function Editor() {
  const { currentLock, acquireEditLock, releaseEditLock } = useEditLock();

  // ... component logic
}
```

#### Example 4: Component Using WebSocket Status

**Before:**
```tsx
function StatusIndicator() {
  const { isConnected, activeUsers } = useCollaboration();

  return (
    <div>
      Status: {isConnected ? 'Connected' : 'Disconnected'}
      Users: {activeUsers.length}
    </div>
  );
}
```

**After:**
```tsx
function StatusIndicator() {
  const { isConnected } = useWebSocket();
  const { activeUsers } = usePresence();

  return (
    <div>
      Status: {isConnected ? 'Connected' : 'Disconnected'}
      Users: {activeUsers.length}
    </div>
  );
}
```

### Step 3: Provider Remains the Same

**Good news!** The provider API hasn't changed. Your existing provider setup will continue to work:

```tsx
<CollaborationProvider projectId={projectId} workflowId={workflowId}>
  <App />
</CollaborationProvider>
```

## Complete Mapping Reference

### Property/Method → New Hook Mapping

| Old Property/Method | New Hook | New Location |
|-------------------|----------|--------------|
| `currentOrg` | `useOrganization()` | `.currentOrg` |
| `organizations` | `useOrganization()` | `.organizations` |
| `switchOrganization()` | `useOrganization()` | `.switchOrganization()` |
| `projectAccess` | `usePermissions()` | `.projectAccess` |
| `canView` | `usePermissions()` | `.canView` |
| `canComment` | `usePermissions()` | `.canComment` |
| `canEdit` | `usePermissions()` | `.canEdit` |
| `canAdmin` | `usePermissions()` | `.canAdmin` |
| `hasPermission()` | `usePermissions()` | `.hasPermission()` |
| `activeUsers` | `usePresence()` | `.activeUsers` |
| `currentLock` | `useEditLock()` | `.currentLock` |
| `acquireEditLock()` | `useEditLock()` | `.acquireEditLock()` |
| `releaseEditLock()` | `useEditLock()` | `.releaseEditLock()` |
| `comments` | `useComments()` | `.comments` |
| `addComment()` | `useComments()` | `.addComment()` |
| `activityFeed` | `useActivity()` | `.activityFeed` |
| `isConnected` | `useWebSocket()` | `.isConnected` |
| `connect()` | `useWebSocket()` | `.connect()` |
| `disconnect()` | `useWebSocket()` | `.disconnect()` |

## Advanced Migration Scenarios

### Scenario 1: Complex Component with All Features

**Before:**
```tsx
function ComplexDashboard() {
  const {
    currentOrg,
    canEdit,
    activeUsers,
    currentLock,
    acquireEditLock,
    comments,
    addComment,
    activityFeed,
    isConnected
  } = useCollaboration();

  const handleEdit = async () => {
    if (canEdit && !currentLock) {
      await acquireEditLock('workflow', workflowId);
    }
  };

  return (
    <div>
      <OrgSelector org={currentOrg} />
      <UserList users={activeUsers} />
      <CommentSection comments={comments} onAdd={addComment} />
      <ActivityFeed items={activityFeed} />
      <ConnectionStatus connected={isConnected} />
      {canEdit && <EditButton onClick={handleEdit} />}
    </div>
  );
}
```

**After:**
```tsx
function ComplexDashboard() {
  const { currentOrg } = useOrganization();
  const { canEdit } = usePermissions();
  const { activeUsers } = usePresence();
  const { currentLock, acquireEditLock } = useEditLock();
  const { comments, addComment } = useComments();
  const { activityFeed } = useActivity();
  const { isConnected } = useWebSocket();

  const handleEdit = async () => {
    if (canEdit && !currentLock) {
      await acquireEditLock('workflow', workflowId);
    }
  };

  return (
    <div>
      <OrgSelector org={currentOrg} />
      <UserList users={activeUsers} />
      <CommentSection comments={comments} onAdd={addComment} />
      <ActivityFeed items={activityFeed} />
      <ConnectionStatus connected={isConnected} />
      {canEdit && <EditButton onClick={handleEdit} />}
    </div>
  );
}
```

### Scenario 2: Component with Permission Checks

**Before:**
```tsx
function ProtectedAction() {
  const { hasPermission, canEdit } = useCollaboration();

  if (!canEdit) {
    return <AccessDenied />;
  }

  const canPerformAction = hasPermission('admin');

  return (
    <button disabled={!canPerformAction}>
      Admin Action
    </button>
  );
}
```

**After:**
```tsx
function ProtectedAction() {
  const { hasPermission, canEdit } = usePermissions();

  if (!canEdit) {
    return <AccessDenied />;
  }

  const canPerformAction = hasPermission('admin');

  return (
    <button disabled={!canPerformAction}>
      Admin Action
    </button>
  );
}
```

### Scenario 3: Using Individual Providers

If you want more control and only need specific features:

**Before:**
```tsx
<CollaborationProvider projectId={projectId}>
  <App />
</CollaborationProvider>
```

**After (using only what you need):**
```tsx
import {
  OrganizationProvider,
  PermissionsProvider,
  CommentsProvider
} from '@/contexts/collaboration';

<OrganizationProvider>
  <PermissionsProvider>
    <CommentsProvider projectId={projectId}>
      <App />
    </CommentsProvider>
  </PermissionsProvider>
</OrganizationProvider>
```

## Testing Updates

### Old Tests

**Before:**
```tsx
import { CollaborationProvider } from '@/contexts/collaboration-context';

const wrapper = ({ children }) => (
  <CollaborationProvider projectId="test-id">
    {children}
  </CollaborationProvider>
);

test('should display current organization', () => {
  const { result } = renderHook(() => useCollaboration(), { wrapper });
  expect(result.current.currentOrg).toBeDefined();
});
```

### New Tests

**After:**
```tsx
import { OrganizationProvider } from '@/contexts/collaboration';

const wrapper = ({ children }) => (
  <OrganizationProvider>
    {children}
  </OrganizationProvider>
);

test('should display current organization', () => {
  const { result } = renderHook(() => useOrganization(), { wrapper });
  expect(result.current.currentOrg).toBeDefined();
});
```

## Common Pitfalls

### 1. Forgetting to Import All Needed Hooks

**Problem:**
```tsx
// Only imported useOrganization
import { useOrganization } from '@/contexts/collaboration';

function Component() {
  const { currentOrg } = useOrganization();
  const { canEdit } = usePermissions(); // ❌ Error: usePermissions is not defined
}
```

**Solution:**
```tsx
import { useOrganization, usePermissions } from '@/contexts/collaboration';

function Component() {
  const { currentOrg } = useOrganization();
  const { canEdit } = usePermissions(); // ✅ Works!
}
```

### 2. Using Wrong Context Provider

**Problem:**
```tsx
// Using individual provider but trying to access other contexts
<CommentsProvider projectId={projectId}>
  <Component />
</CommentsProvider>

function Component() {
  const { comments } = useComments(); // ✅ Works
  const { activeUsers } = usePresence(); // ❌ Error: must be within PresenceProvider
}
```

**Solution:**
```tsx
// Use the combined provider
<CollaborationProvider projectId={projectId}>
  <Component />
</CollaborationProvider>

// OR use both providers
<CommentsProvider projectId={projectId}>
  <PresenceProvider>
    <Component />
  </PresenceProvider>
</CommentsProvider>
```

### 3. Assuming All State Updates Together

The refactored contexts are independent. State updates in one context don't trigger re-renders in components only using other contexts.

**This is actually a benefit** - better performance! But be aware when debugging.

## Automated Migration Script

You can use this regex find-replace to help automate some of the migration:

### 1. Update imports
Find:
```
import { useCollaboration } from '@/contexts/collaboration-context';
```

Replace with:
```
import { useOrganization, usePermissions, usePresence, useEditLock, useComments, useActivity, useWebSocket } from '@/contexts/collaboration';
```

### 2. Split destructuring (manual per-component)

This requires manual intervention since each component uses different properties.

## Verification Checklist

After migrating a component, verify:

- [ ] All imports are updated
- [ ] All hook usages are updated
- [ ] Component still compiles without errors
- [ ] Component still functions as expected
- [ ] Tests are updated and passing
- [ ] No performance regressions
- [ ] No console errors or warnings

## Rollback Plan

If you need to rollback temporarily:

1. The old `collaboration-context.tsx` file is still available (just deprecated)
2. You can import from the old location:
   ```tsx
   import { useCollaboration } from '@/contexts/collaboration-context';
   ```
3. The new contexts are in a separate directory and don't conflict

## Getting Help

If you encounter issues during migration:

1. Check the README.md in the collaboration directory
2. Review the examples in this migration guide
3. Look at the TypeScript types for each hook
4. Check the console for helpful error messages

## Benefits After Migration

Once migrated, you'll enjoy:

1. **Better Performance** - Components only re-render when their specific data changes
2. **Clearer Code** - Explicit about which collaboration features are used
3. **Easier Testing** - Test individual features in isolation
4. **Smaller Bundles** - Better tree-shaking of unused features
5. **Better Maintainability** - Changes to one feature don't affect others

## Timeline

Recommended migration timeline:

1. **Week 1**: Migrate simple components (using 1-2 contexts)
2. **Week 2**: Migrate medium complexity components (using 3-4 contexts)
3. **Week 3**: Migrate complex components (using 5+ contexts)
4. **Week 4**: Update tests and remove old context file

Take it one component at a time. The old and new contexts can coexist during migration.
