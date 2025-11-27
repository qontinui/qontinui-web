# Collaboration Contexts

This directory contains a refactored collaboration system that follows the **Single Responsibility Principle (SRP)**. The original monolithic `collaboration-context.tsx` has been split into focused, independently usable contexts.

## Architecture Overview

### Original Structure (BEFORE)
```
collaboration-context.tsx (408 lines)
└── Mixed 7 unrelated features:
    ├── Organization management
    ├── Permissions checking
    ├── User presence tracking
    ├── Edit locking
    ├── Comments system
    ├── Activity feed tracking
    └── WebSocket connection management
```

### Refactored Structure (AFTER)
```
collaboration/
├── types.ts                      # Shared TypeScript types
├── OrganizationContext.tsx       # Organization + members only
├── PermissionsContext.tsx        # Permissions + access control only
├── PresenceContext.tsx           # User presence tracking only
├── EditLockContext.tsx           # Edit locks only
├── CommentsContext.tsx           # Comments + threads only
├── ActivityContext.tsx           # Activity feed only
├── WebSocketContext.tsx          # WebSocket connection management
├── CollaborationProvider.tsx     # Composite provider combining all contexts
└── index.tsx                     # Barrel export + documentation
```

## File Descriptions

### Core Files

#### `types.ts`
Shared TypeScript types used across all contexts. Prevents circular dependencies and provides a single source of truth for type definitions.

#### `OrganizationContext.tsx`
**Responsibility:** Organization and member management

**State:**
- `currentOrg: Organization | null`
- `organizations: Organization[]`

**Methods:**
- `switchOrganization(orgId: string): Promise<void>`
- `refreshOrganizations(): Promise<void>`

#### `PermissionsContext.tsx`
**Responsibility:** Permission checking and access control

**State:**
- `projectAccess: PermissionLevel | null`
- `canView: boolean`
- `canComment: boolean`
- `canEdit: boolean`
- `canAdmin: boolean`

**Methods:**
- `setProjectAccess(level: PermissionLevel): void`
- `hasPermission(required: PermissionLevel): boolean`

#### `PresenceContext.tsx`
**Responsibility:** User presence tracking

**State:**
- `activeUsers: UserPresence[]`

**Methods:**
- `setActiveUsers(users: UserPresence[]): void`
- `addUser(user: UserPresence): void`
- `removeUser(userId: string): void`
- `updateUser(userId: string, updates: Partial<UserPresence>): void`

#### `EditLockContext.tsx`
**Responsibility:** Edit lock management

**State:**
- `currentLock: Lock | null`

**Methods:**
- `acquireEditLock(resourceType: ResourceType, resourceId: string): Promise<void>`
- `releaseEditLock(): Promise<void>`
- `hasLock(resourceType: ResourceType, resourceId: string): boolean`

**Features:**
- Automatically releases locks on unmount
- Prevents resource conflicts

#### `CommentsContext.tsx`
**Responsibility:** Comments and threads management

**State:**
- `comments: Comment[]`

**Methods:**
- `addComment(content: string, position?: { x: number; y: number }): Promise<void>`
- `updateComment(commentId: string, content: string): Promise<void>`
- `deleteComment(commentId: string): Promise<void>`
- `refreshComments(): Promise<void>`

**Features:**
- Automatically loads comments when workflow changes
- Supports positioned comments (e.g., canvas annotations)

#### `ActivityContext.tsx`
**Responsibility:** Activity feed tracking

**State:**
- `activityFeed: Activity[]`

**Methods:**
- `refreshActivity(): Promise<void>`
- `addActivity(activity: Activity): void`

**Features:**
- Automatically loads activity on mount
- Configurable limit for feed size

#### `WebSocketContext.tsx`
**Responsibility:** Real-time WebSocket connection management

**State:**
- `isConnected: boolean`

**Methods:**
- `connect(): Promise<void>`
- `disconnect(): void`
- `registerHandlers(handlers: WebSocketHandlers): void`

**Features:**
- Automatically connects/disconnects with project changes
- Provides handler registration for real-time updates
- Coordinates updates across all contexts

#### `CollaborationProvider.tsx`
**Responsibility:** Composite provider that combines all contexts

This provider wraps all individual contexts and includes a `WebSocketIntegration` component that connects WebSocket events to the appropriate context handlers.

**Features:**
- Single provider for easy setup
- Handles inter-context communication
- Manages WebSocket event routing

#### `index.tsx`
Barrel export file that re-exports all contexts, providers, hooks, and types. Includes comprehensive usage documentation.

## Usage

### Quick Start (Recommended)

Use the combined `CollaborationProvider` for convenience:

```tsx
import { CollaborationProvider } from '@/contexts/collaboration';

function App() {
  return (
    <CollaborationProvider projectId="project-123" workflowId="workflow-456">
      <YourComponent />
    </CollaborationProvider>
  );
}
```

### Using Individual Hooks

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

function MyComponent() {
  // Organization management
  const { currentOrg, organizations, switchOrganization } = useOrganization();

  // Permission checking
  const { canEdit, canAdmin, hasPermission } = usePermissions();

  // User presence
  const { activeUsers } = usePresence();

  // Edit locks
  const { currentLock, acquireEditLock, releaseEditLock } = useEditLock();

  // Comments
  const { comments, addComment, deleteComment } = useComments();

  // Activity feed
  const { activityFeed, refreshActivity } = useActivity();

  // WebSocket connection
  const { isConnected } = useWebSocket();

  // ... your component logic
}
```

### Advanced: Using Individual Providers

If you only need specific features, you can use individual providers:

```tsx
import {
  OrganizationProvider,
  PermissionsProvider,
  useOrganization,
  usePermissions
} from '@/contexts/collaboration';

function App() {
  return (
    <OrganizationProvider>
      <PermissionsProvider>
        <YourComponent />
      </PermissionsProvider>
    </OrganizationProvider>
  );
}
```

## Migration Guide

### From Original Context

**Before:**
```tsx
import { useCollaboration } from '@/contexts/collaboration-context';

function Component() {
  const {
    currentOrg,
    canEdit,
    activeUsers,
    acquireEditLock,
    comments,
    activityFeed,
    isConnected
  } = useCollaboration();
}
```

**After:**
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

function Component() {
  const { currentOrg } = useOrganization();
  const { canEdit } = usePermissions();
  const { activeUsers } = usePresence();
  const { acquireEditLock } = useEditLock();
  const { comments } = useComments();
  const { activityFeed } = useActivity();
  const { isConnected } = useWebSocket();
}
```

### Provider Changes

**Before:**
```tsx
<CollaborationProvider projectId={projectId} workflowId={workflowId}>
  <App />
</CollaborationProvider>
```

**After:**
```tsx
// Same API! No changes needed for the provider
<CollaborationProvider projectId={projectId} workflowId={workflowId}>
  <App />
</CollaborationProvider>
```

## Benefits of Refactoring

### 1. Single Responsibility Principle
Each context now has a single, clear responsibility. This makes the code easier to understand, test, and maintain.

### 2. Independent Usability
Contexts can be used independently. If a component only needs comments, it can use just `useComments()` without pulling in all other features.

### 3. Better Code Organization
Related functionality is grouped together, making it easier to find and modify specific features.

### 4. Improved Testability
Each context can be tested in isolation with focused unit tests.

### 5. Reduced Bundle Size
Components only import what they need, potentially reducing bundle size through better tree-shaking.

### 6. Easier Maintenance
Changes to one feature (e.g., comments) don't risk breaking unrelated features (e.g., permissions).

### 7. Better Type Safety
Each context has its own focused types, reducing the complexity of type definitions.

### 8. Scalability
New features can be added as new contexts without modifying existing code.

## Testing

Each context can be tested independently:

```tsx
import { render, screen } from '@testing-library/react';
import { CommentsProvider, useComments } from '@/contexts/collaboration';

describe('CommentsContext', () => {
  it('should add a comment', async () => {
    // Test only the comments functionality
    // without needing to mock all other contexts
  });
});
```

## Performance Considerations

### Re-render Optimization
Each context manages its own state, so components only re-render when the specific state they use changes.

**Example:**
- A component using only `usePermissions()` won't re-render when comments are added
- A component using only `useComments()` won't re-render when presence updates

### Lazy Loading
Individual contexts can be lazy-loaded if needed:

```tsx
const CommentsProvider = lazy(() =>
  import('@/contexts/collaboration').then(mod => ({
    default: mod.CommentsProvider
  }))
);
```

## Future Enhancements

Potential improvements to consider:

1. **Context Selectors:** Add selector support to prevent unnecessary re-renders
2. **Persistence:** Add local storage persistence for certain contexts
3. **Offline Support:** Add offline queuing for actions when WebSocket is disconnected
4. **Optimistic Updates:** Implement optimistic UI updates before server confirmation
5. **Middleware:** Add middleware support for logging, analytics, etc.

## Contributing

When adding new collaboration features:

1. Create a new context file (e.g., `NotificationsContext.tsx`)
2. Follow the existing patterns and structure
3. Add the context to `CollaborationProvider.tsx`
4. Export it from `index.tsx`
5. Update this README
6. Add tests for the new context

## Notes

- The original `collaboration-context.tsx` file can be safely removed once all imports are updated
- All contexts follow the same pattern for consistency
- WebSocket integration is handled automatically when using `CollaborationProvider`
- Each context includes proper cleanup in useEffect hooks
