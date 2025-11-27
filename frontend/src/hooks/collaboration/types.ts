/**
 * Shared types for collaboration hooks
 */

import {
  Conflict,
  ResolutionStrategy,
  ConflictCheckResult,
  ConflictDetails,
  AutoResolutionResult,
  ResourceType
} from '../../types/collaboration/conflict-types'

// Re-export types from collaboration types
export type {
  Conflict,
  ResolutionStrategy,
  ConflictCheckResult,
  ConflictDetails,
  AutoResolutionResult,
  ResourceType
}

/**
 * Options for useConflictResolution hook
 */
export interface UseConflictResolutionOptions {
  /** Auto-check for conflicts on changes */
  autoCheck?: boolean

  /** Auto-resolve when possible */
  autoResolve?: boolean

  /** Polling interval for checking conflicts (ms) */
  pollingInterval?: number

  /** Enable real-time conflict notifications */
  enableRealtimeNotifications?: boolean
}

/**
 * Return type for useConflictResolution hook
 */
export interface UseConflictResolutionReturn {
  /** Current conflicts */
  conflicts: Conflict[]

  /** Whether there are any conflicts */
  hasConflicts: boolean

  /** Whether currently checking for conflicts */
  isChecking: boolean

  /** Whether currently resolving conflicts */
  isResolving: boolean

  /** Check for conflicts manually */
  checkForConflicts: (localChanges: any) => Promise<ConflictCheckResult>

  /** Resolve a specific conflict */
  resolveConflict: (
    conflictId: string,
    strategy: ResolutionStrategy,
    resolution?: any
  ) => Promise<void>

  /** Auto-resolve all resolvable conflicts */
  autoResolve: () => Promise<AutoResolutionResult>

  /** Get detailed information about a conflict */
  getConflictDetails: (conflictId: string) => Promise<ConflictDetails>

  /** Clear all conflicts */
  clearConflicts: () => void

  /** Refresh conflict state */
  refresh: () => Promise<void>
}

/**
 * Return type for useSyncState hook
 */
export interface UseSyncStateReturn {
  /** Whether currently syncing */
  isSyncing: boolean

  /** Last successful sync timestamp */
  lastSynced: Date | null

  /** Last sync error message */
  syncError: string | null

  /** Perform sync operation */
  sync: (localVersion: any) => Promise<any>
}

/**
 * Return type for useOptimisticUpdate hook
 */
export interface UseOptimisticUpdateReturn {
  /** Current optimistic state */
  optimisticState: any

  /** Whether there are optimistic updates */
  hasOptimistic: boolean

  /** Apply optimistic update */
  applyOptimistic: (change: any) => void

  /** Rollback optimistic update */
  rollback: (changeId: string) => void
}

/**
 * Return type for useOfflineQueue hook
 */
export interface UseOfflineQueueReturn {
  /** Current queue state */
  queueState: any

  /** Whether currently processing queue */
  isProcessing: boolean

  /** Process offline queue */
  processQueue: () => Promise<void>

  /** Clear offline queue */
  clearQueue: () => void
}

/**
 * Return type for useRealtimeCollaboration hook
 */
export interface UseRealtimeCollaborationReturn {
  /** Whether WebSocket is connected */
  isConnected: boolean

  /** Remote changes received */
  remoteChanges: any[]

  /** Clear remote changes buffer */
  clearRemoteChanges: () => void
}
