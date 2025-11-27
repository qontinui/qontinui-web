# Quick Reference Guide

A one-page reference for the refactored collaboration contexts.

## Import Statement

```typescript
import {
  // Providers
  CollaborationProvider,
  OrganizationProvider,
  PermissionsProvider,
  PresenceProvider,
  EditLockProvider,
  CommentsProvider,
  ActivityProvider,
  WebSocketProvider,

  // Hooks
  useOrganization,
  usePermissions,
  usePresence,
  useEditLock,
  useComments,
  useActivity,
  useWebSocket,

  // Types
  type Organization,
  type UserPresence,
  type Lock,
  type Comment,
  type Activity,
  type ResourceType,
  type PermissionLevel,
} from '@/contexts/collaboration';
```

---

## Provider Setup

```tsx
<CollaborationProvider projectId="project-123" workflowId="workflow-456">
  <YourApp />
</CollaborationProvider>
```

---

## Hooks Quick Reference

### useOrganization()
```typescript
const {
  currentOrg,              // Organization | null
  organizations,           // Organization[]
  switchOrganization,      // (orgId: string) => Promise<void>
  refreshOrganizations,    // () => Promise<void>
} = useOrganization();
```

### usePermissions()
```typescript
const {
  projectAccess,           // PermissionLevel | null
  setProjectAccess,        // (level: PermissionLevel) => void
  canView,                 // boolean
  canComment,              // boolean
  canEdit,                 // boolean
  canAdmin,                // boolean
  hasPermission,           // (required: PermissionLevel) => boolean
} = usePermissions();
```

### usePresence()
```typescript
const {
  activeUsers,             // UserPresence[]
  setActiveUsers,          // (users: UserPresence[]) => void
  addUser,                 // (user: UserPresence) => void
  removeUser,              // (userId: string) => void
  updateUser,              // (userId: string, updates: Partial<UserPresence>) => void
} = usePresence();
```

### useEditLock()
```typescript
const {
  currentLock,             // Lock | null
  acquireEditLock,         // (resourceType: ResourceType, resourceId: string) => Promise<void>
  releaseEditLock,         // () => Promise<void>
  hasLock,                 // (resourceType: ResourceType, resourceId: string) => boolean
} = useEditLock();
```

### useComments()
```typescript
const {
  comments,                // Comment[]
  addComment,              // (content: string, position?: { x: number; y: number }) => Promise<void>
  updateComment,           // (commentId: string, content: string) => Promise<void>
  deleteComment,           // (commentId: string) => Promise<void>
  refreshComments,         // () => Promise<void>
} = useComments();
```

### useActivity()
```typescript
const {
  activityFeed,            // Activity[]
  refreshActivity,         // () => Promise<void>
  addActivity,             // (activity: Activity) => void
} = useActivity();
```

### useWebSocket()
```typescript
const {
  isConnected,             // boolean
  connect,                 // () => Promise<void>
  disconnect,              // () => void
  registerHandlers,        // (handlers: WebSocketHandlers) => void
} = useWebSocket();
```

---

## Common Usage Patterns

### Check Permission
```tsx
const { canEdit, hasPermission } = usePermissions();

if (canEdit) {
  // User can edit
}

if (hasPermission('admin')) {
  // User is admin
}
```

### Acquire Edit Lock
```tsx
const { acquireEditLock, releaseEditLock, hasLock } = useEditLock();

// Acquire lock
await acquireEditLock('workflow', workflowId);

// Check if has lock
if (hasLock('workflow', workflowId)) {
  // Can edit
}

// Release lock
await releaseEditLock();
```

### Add Comment
```tsx
const { addComment } = useComments();

await addComment('Great work!');

// With position
await addComment('Fix this', { x: 100, y: 200 });
```

### Show Active Users
```tsx
const { activeUsers } = usePresence();

return (
  <div>
    {activeUsers.map(user => (
      <Avatar key={user.id} user={user} />
    ))}
  </div>
);
```

### Connection Status
```tsx
const { isConnected } = useWebSocket();

return (
  <div className={isConnected ? 'connected' : 'disconnected'}>
    {isConnected ? 'Online' : 'Offline'}
  </div>
);
```

---

## Type Definitions

### Organization
```typescript
interface Organization {
  id: string;
  name: string;
  members: OrganizationMember[];
  // ... other fields
}
```

### PermissionLevel
```typescript
type PermissionLevel = 'none' | 'view' | 'comment' | 'edit' | 'admin';
```

### UserPresence
```typescript
interface UserPresence {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  status: 'active' | 'idle' | 'away';
  cursor_position?: { x: number; y: number };
  current_resource_type?: ResourceType;
  current_resource_id?: string;
  // ... other fields
}
```

### Lock
```typescript
interface Lock {
  id: string;
  user_id: string;
  user_name: string;
  resource_type: ResourceType;
  resource_id: string;
  acquired_at: string;
  expires_at: string;
  // ... other fields
}
```

### Comment
```typescript
interface Comment {
  id: string;
  user_id: string;
  user_name: string;
  content: string;
  position?: { x: number; y: number };
  workflow_id?: string;
  resolved: boolean;
  created_at: string;
  updated_at: string;
  // ... other fields
}
```

### Activity
```typescript
interface Activity {
  id: string;
  user_id: string;
  user_name: string;
  type: string;
  description: string;
  resource_type?: ResourceType;
  resource_id?: string;
  created_at: string;
  // ... other fields
}
```

### ResourceType
```typescript
type ResourceType = 'workflow' | 'project' | 'organization' | 'canvas' | 'node';
```

---

## Migration Cheat Sheet

### Old Way (Deprecated)
```tsx
import { useCollaboration } from '@/contexts/collaboration-context';

const {
  currentOrg,
  canEdit,
  activeUsers,
  acquireEditLock,
  comments,
  activityFeed,
  isConnected
} = useCollaboration();
```

### New Way
```tsx
import {
  useOrganization,
  usePermissions,
  usePresence,
  useEditLock,
  useComments,
  useActivity,
  useWebSocket
} from '@/contexts/collaboration';

const { currentOrg } = useOrganization();
const { canEdit } = usePermissions();
const { activeUsers } = usePresence();
const { acquireEditLock } = useEditLock();
const { comments } = useComments();
const { activityFeed } = useActivity();
const { isConnected } = useWebSocket();
```

---

## File Structure

```
collaboration/
├── types.ts                      # Shared types
├── OrganizationContext.tsx       # Organization management
├── PermissionsContext.tsx        # Permissions
├── PresenceContext.tsx           # User presence
├── EditLockContext.tsx           # Edit locks
├── CommentsContext.tsx           # Comments
├── ActivityContext.tsx           # Activity feed
├── WebSocketContext.tsx          # WebSocket
├── CollaborationProvider.tsx     # Combined provider
├── index.tsx                     # Exports
├── README.md                     # Full documentation
├── MIGRATION.md                  # Migration guide
├── COMPARISON.md                 # Before/after
├── EXAMPLES.md                   # Usage examples
├── REFACTORING_SUMMARY.md        # Summary
└── QUICK_REFERENCE.md            # This file
```

---

## Need More Help?

- **Full Documentation:** See [README.md](./README.md)
- **Migration Guide:** See [MIGRATION.md](./MIGRATION.md)
- **Usage Examples:** See [EXAMPLES.md](./EXAMPLES.md)
- **Before/After Comparison:** See [COMPARISON.md](./COMPARISON.md)

---

## Tips

1. **Only import what you need** - Better performance
2. **Each context is independent** - Use separately or together
3. **CollaborationProvider combines all** - One provider for convenience
4. **Tests are simpler** - Mock only what you're testing
5. **Better bundle size** - Tree-shaking works better

---

## Common Mistakes to Avoid

❌ **Don't:** Import everything when you only need one thing
```tsx
const everything = useCollaboration(); // Deprecated!
```

✅ **Do:** Import only what you need
```tsx
const { canEdit } = usePermissions();
```

---

❌ **Don't:** Forget to wrap with provider
```tsx
function Component() {
  const { comments } = useComments(); // Error: No provider!
}
```

✅ **Do:** Use within provider
```tsx
<CollaborationProvider projectId={id}>
  <Component />
</CollaborationProvider>
```

---

❌ **Don't:** Mix old and new imports
```tsx
import { useCollaboration } from '@/contexts/collaboration-context'; // Old
import { useComments } from '@/contexts/collaboration'; // New
```

✅ **Do:** Use only new imports
```tsx
import { useComments, usePermissions } from '@/contexts/collaboration';
```

---

## Quick Start Template

```tsx
import { CollaborationProvider, usePermissions, useComments } from '@/contexts/collaboration';

function App() {
  return (
    <CollaborationProvider projectId="project-123" workflowId="workflow-456">
      <MyComponent />
    </CollaborationProvider>
  );
}

function MyComponent() {
  const { canEdit } = usePermissions();
  const { comments, addComment } = useComments();

  return (
    <div>
      {canEdit && (
        <button onClick={() => addComment('Hello!')}>
          Add Comment
        </button>
      )}
      <CommentList comments={comments} />
    </div>
  );
}
```

---

**Last Updated:** November 25, 2025
