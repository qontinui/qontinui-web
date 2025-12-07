# Collaboration Hooks

This directory contains focused, single-responsibility hooks for collaboration features. This structure replaces the monolithic `useConflictResolution.ts` file (503 lines) with a modular architecture that follows the Single Responsibility Principle.

## Directory Structure

```
collaboration/
├── index.ts                        # Re-exports all hooks (backward compatibility)
├── types.ts                        # Shared TypeScript types and interfaces
├── useConflictResolution.ts       # Conflict detection & resolution (224 lines)
├── useSyncState.ts                # Synchronization state management (60 lines)
├── useOptimisticUpdate.ts         # Optimistic UI updates (73 lines)
├── useOfflineQueue.ts             # Offline queue processing (49 lines)
├── useRealtimeCollaboration.ts    # WebSocket real-time collaboration (63 lines)
└── README.md                       # This file
```

## Hooks Overview

### 1. `useConflictResolution`

**Purpose:** Conflict detection and resolution

**Responsibilities:**

- Check for conflicts between local and remote changes
- Resolve conflicts using different strategies (KeepLocal, KeepRemote, Merge, Manual)
- Auto-resolve conflicts when possible
- Handle real-time conflict notifications
- Poll for conflicts at intervals

**Usage:**

```typescript
import { useConflictResolution } from "@/hooks/collaboration";

const {
  conflicts,
  hasConflicts,
  isChecking,
  checkForConflicts,
  resolveConflict,
  autoResolve,
} = useConflictResolution(projectId, "workflow", workflowId, {
  autoCheck: true,
  autoResolve: true,
  pollingInterval: 5000,
});
```

### 2. `useSyncState`

**Purpose:** Synchronization state management

**Responsibilities:**

- Track sync operations in progress
- Record last successful sync timestamp
- Capture and display sync errors
- Perform sync operations

**Usage:**

```typescript
import { useSyncState } from "@/hooks/collaboration";

const { isSyncing, lastSynced, syncError, sync } = useSyncState(
  "workflow",
  workflowId
);

await sync(localVersion);
```

### 3. `useOptimisticUpdate`

**Purpose:** Optimistic UI updates

**Responsibilities:**

- Apply changes immediately to UI before server confirmation
- Track optimistic state
- Rollback changes if server update fails
- Listen for rollback events

**Usage:**

```typescript
import { useOptimisticUpdate } from "@/hooks/collaboration";

const { optimisticState, hasOptimistic, applyOptimistic, rollback } =
  useOptimisticUpdate("workflow", workflowId);

// Apply change immediately
applyOptimistic(change);

// Rollback if needed
rollback(changeId);
```

### 4. `useOfflineQueue`

**Purpose:** Offline queue processing

**Responsibilities:**

- Track queued offline operations
- Process queued operations when back online
- Clear queue
- Monitor queue state

**Usage:**

```typescript
import { useOfflineQueue } from '@/hooks/collaboration'

const {
  queueState,
  isProcessing,
  processQueue,
  clearQueue
} = useOfflineQueue()

// Show pending count
{queueState.pending.length > 0 && (
  <button onClick={processQueue}>
    Sync {queueState.pending.length} changes
  </button>
)}
```

### 5. `useRealtimeCollaboration`

**Purpose:** WebSocket-based real-time collaboration

**Responsibilities:**

- Manage WebSocket connection lifecycle
- Track connection status
- Receive and buffer remote changes
- Clean up on unmount

**Usage:**

```typescript
import { useRealtimeCollaboration } from "@/hooks/collaboration";

const { isConnected, remoteChanges, clearRemoteChanges } =
  useRealtimeCollaboration(projectId, "workflow", workflowId);

useEffect(() => {
  remoteChanges.forEach(applyChangeToUI);
  clearRemoteChanges();
}, [remoteChanges]);
```

## Shared Types (`types.ts`)

The `types.ts` file contains all shared TypeScript interfaces and types:

- `Conflict`, `ResolutionStrategy`, `ConflictCheckResult`, etc. (re-exported from collaboration types)
- `UseConflictResolutionOptions` - Configuration for conflict resolution hook
- `UseConflictResolutionReturn` - Return type for conflict resolution hook
- `UseSyncStateReturn` - Return type for sync state hook
- `UseOptimisticUpdateReturn` - Return type for optimistic update hook
- `UseOfflineQueueReturn` - Return type for offline queue hook
- `UseRealtimeCollaborationReturn` - Return type for realtime collaboration hook

## Migration Guide

### Before (Monolithic)

```typescript
import { useConflictResolution } from "@/hooks/useConflictResolution";
import { useSyncState } from "@/hooks/useConflictResolution";
import { useOptimisticUpdate } from "@/hooks/useConflictResolution";
```

### After (Modular)

```typescript
// Option 1: Import from index (recommended)
import {
  useConflictResolution,
  useSyncState,
  useOptimisticUpdate,
} from "@/hooks/collaboration";

// Option 2: Import individual hooks
import { useConflictResolution } from "@/hooks/collaboration/useConflictResolution";
import { useSyncState } from "@/hooks/collaboration/useSyncState";
```

## Benefits of This Structure

1. **Single Responsibility Principle**
   - Each hook has one clear purpose
   - Easier to understand and maintain
   - Simpler unit testing

2. **Better Code Organization**
   - Related functionality grouped together
   - Clear separation of concerns
   - Easier to navigate

3. **Independent Testability**
   - Each hook can be tested in isolation
   - Reduced test complexity
   - Better test coverage

4. **Improved Reusability**
   - Hooks can be used independently
   - No unnecessary dependencies
   - Smaller bundle sizes when tree-shaking

5. **Backward Compatibility**
   - Index file maintains existing import paths
   - No breaking changes for existing code
   - Gradual migration possible

## Design Principles

### Single Responsibility

Each hook manages exactly one aspect of collaboration:

- Conflict resolution → `useConflictResolution`
- Sync state → `useSyncState`
- Optimistic updates → `useOptimisticUpdate`
- Offline queue → `useOfflineQueue`
- Real-time → `useRealtimeCollaboration`

### Separation of Concerns

- UI state management is separate from business logic
- Each hook interacts with services but doesn't implement them
- Types are centralized for consistency

### Composability

Hooks can be used together or independently:

```typescript
// Use all features
const conflict = useConflictResolution(...)
const sync = useSyncState(...)
const optimistic = useOptimisticUpdate(...)

// Or just what you need
const { sync } = useSyncState(...)
```

## Testing

Each hook should have its own test file:

- `useConflictResolution.test.ts`
- `useSyncState.test.ts`
- `useOptimisticUpdate.test.ts`
- `useOfflineQueue.test.ts`
- `useRealtimeCollaboration.test.ts`

## Further Reading

- [Conflict Resolution Documentation](/frontend/src/services/collaboration/CONFLICT_RESOLUTION.md)
- [Quick Start Guide](/frontend/src/services/collaboration/QUICK_START.md)
- [Service Layer Documentation](/frontend/src/services/collaboration/)

## Contributing

When adding new collaboration features:

1. Create a new focused hook if it serves a distinct purpose
2. Update `types.ts` with any new shared types
3. Re-export from `index.ts` for convenience
4. Add documentation to this README
5. Write comprehensive tests
