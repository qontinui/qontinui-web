/**
 * Collaboration Hooks
 *
 * Centralized export for all collaboration-related hooks.
 * This module provides hooks for conflict resolution, synchronization,
 * optimistic updates, offline queue management, and real-time collaboration.
 */

// Export hooks
export { useConflictResolution } from "./useConflictResolution";
export { useSyncState } from "./useSyncState";
export { useOptimisticUpdate } from "./useOptimisticUpdate";
export { useOfflineQueue } from "./useOfflineQueue";
export { useRealtimeCollaboration } from "./useRealtimeCollaboration";

// Export types
export type {
  Conflict,
  ResolutionStrategy,
  ConflictCheckResult,
  ConflictDetails,
  AutoResolutionResult,
  ResourceType,
  UseConflictResolutionOptions,
  UseConflictResolutionReturn,
  UseSyncStateReturn,
  UseOptimisticUpdateReturn,
  UseOfflineQueueReturn,
  UseRealtimeCollaborationReturn,
} from "./types";

// Default export for backward compatibility
export { useConflictResolution as default } from "./useConflictResolution";
