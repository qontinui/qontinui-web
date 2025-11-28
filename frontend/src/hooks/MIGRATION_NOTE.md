# Collaboration Hooks Migration

## Important Notice

The file `useConflictResolution.ts` (503 lines) has been refactored into focused, single-responsibility hooks following the Single Responsibility Principle.

## New Location

All collaboration hooks are now located in:

```
/frontend/src/hooks/collaboration/
```

## Migration Path

### Old Import (Deprecated)

```typescript
import { useConflictResolution } from "@/hooks/useConflictResolution";
import { useSyncState } from "@/hooks/useConflictResolution";
import { useOptimisticUpdate } from "@/hooks/useConflictResolution";
import { useOfflineQueue } from "@/hooks/useConflictResolution";
import { useRealtimeCollaboration } from "@/hooks/useConflictResolution";
```

### New Import (Recommended)

```typescript
import {
  useConflictResolution,
  useSyncState,
  useOptimisticUpdate,
  useOfflineQueue,
  useRealtimeCollaboration,
} from "@/hooks/collaboration";
```

## What Changed?

### Before: Monolithic File (503 lines)

- Single file with 5 different hooks
- Mixed responsibilities
- Difficult to maintain and test
- Large bundle size

### After: Modular Structure

```
collaboration/
├── index.ts                      # Re-exports (backward compatible)
├── types.ts                      # Shared types
├── useConflictResolution.ts     # 263 lines - Conflict resolution only
├── useSyncState.ts              # 64 lines - Sync state only
├── useOptimisticUpdate.ts       # 75 lines - Optimistic updates only
├── useOfflineQueue.ts           # 53 lines - Offline queue only
└── useRealtimeCollaboration.ts  # 61 lines - Real-time collab only
```

## Benefits

1. **Single Responsibility** - Each hook has one clear purpose
2. **Better Testing** - Isolated, focused unit tests
3. **Improved Maintainability** - Easier to understand and modify
4. **Tree Shaking** - Smaller bundles (only import what you need)
5. **Backward Compatible** - No breaking changes via index.ts

## No Breaking Changes

The refactored hooks maintain 100% API compatibility. All function signatures, return types, and behaviors remain identical.

## Documentation

- Full documentation: `/frontend/src/hooks/collaboration/README.md`
- Quick start: `/frontend/src/services/collaboration/QUICK_START.md`
- Detailed guide: `/frontend/src/services/collaboration/CONFLICT_RESOLUTION.md`

## Next Steps

1. Update imports to use `@/hooks/collaboration`
2. The old file can be safely removed after all imports are updated
3. No code changes required - only import path updates

## Questions?

Refer to the comprehensive README at `/frontend/src/hooks/collaboration/README.md`
