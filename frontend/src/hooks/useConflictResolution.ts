/**
 * Conflict Resolution Hook
 *
 * React hook for managing conflict detection and resolution in components.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Conflict,
  ResolutionStrategy,
  ConflictCheckResult,
  ConflictDetails,
  AutoResolutionResult,
  ResourceType,
} from "../types/collaboration/conflict-types";
import { conflictResolutionService } from "../services/collaboration/conflict-resolution-service";
import { syncService } from "../services/collaboration/sync-service";

interface UseConflictResolutionOptions {
  /** Auto-check for conflicts on changes */
  autoCheck?: boolean;

  /** Auto-resolve when possible */
  autoResolve?: boolean;

  /** Polling interval for checking conflicts (ms) */
  pollingInterval?: number;

  /** Enable real-time conflict notifications */
  enableRealtimeNotifications?: boolean;
}

interface UseConflictResolutionReturn {
  /** Current conflicts */
  conflicts: Conflict[];

  /** Whether there are any conflicts */
  hasConflicts: boolean;

  /** Whether currently checking for conflicts */
  isChecking: boolean;

  /** Whether currently resolving conflicts */
  isResolving: boolean;

  /** Check for conflicts manually */
  checkForConflicts: (localChanges: any) => Promise<ConflictCheckResult>;

  /** Resolve a specific conflict */
  resolveConflict: (
    conflictId: string,
    strategy: ResolutionStrategy,
    resolution?: any
  ) => Promise<void>;

  /** Auto-resolve all resolvable conflicts */
  autoResolve: () => Promise<AutoResolutionResult>;

  /** Get detailed information about a conflict */
  getConflictDetails: (conflictId: string) => Promise<ConflictDetails>;

  /** Clear all conflicts */
  clearConflicts: () => void;

  /** Refresh conflict state */
  refresh: () => Promise<void>;
}

/**
 * Hook for managing conflict resolution
 */
export function useConflictResolution(
  projectId: string,
  resourceType: ResourceType,
  resourceId: string,
  options: UseConflictResolutionOptions = {}
): UseConflictResolutionReturn {
  const {
    autoCheck = false,
    autoResolve: autoResolveEnabled = false,
    pollingInterval = 5000,
    enableRealtimeNotifications = true,
  } = options;

  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [hasConflicts, setHasConflicts] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isResolving, setIsResolving] = useState(false);

  const pollingIntervalRef = useRef<number | null>(null);
  const lastCheckRef = useRef<Date>(new Date());

  /**
   * Check for conflicts
   */
  const checkForConflicts = useCallback(
    async (localChanges: any): Promise<ConflictCheckResult> => {
      setIsChecking(true);

      try {
        const result = await conflictResolutionService.checkForConflicts(
          projectId,
          resourceType,
          resourceId,
          localChanges
        );

        if (result.conflicts.length > 0) {
          setConflicts(result.conflicts);
          setHasConflicts(true);

          // Auto-resolve if enabled and possible
          if (autoResolveEnabled && result.canSave) {
            await autoResolveConflicts();
          }
        } else {
          setConflicts([]);
          setHasConflicts(false);
        }

        lastCheckRef.current = new Date();
        return result;
      } catch (error) {
        console.error("Error checking for conflicts:", error);
        throw error;
      } finally {
        setIsChecking(false);
      }
    },
    [projectId, resourceType, resourceId, autoResolveEnabled]
  );

  /**
   * Resolve a specific conflict
   */
  const resolveConflict = useCallback(
    async (
      conflictId: string,
      strategy: ResolutionStrategy,
      resolution?: any
    ): Promise<void> => {
      setIsResolving(true);

      try {
        await conflictResolutionService.resolveConflict(
          conflictId,
          strategy,
          resolution
        );

        // Remove resolved conflict from state
        setConflicts((prev) => prev.filter((c) => c.id !== conflictId));

        // Update hasConflicts flag
        if (conflicts.length === 1) {
          setHasConflicts(false);
        }
      } catch (error) {
        console.error("Error resolving conflict:", error);
        throw error;
      } finally {
        setIsResolving(false);
      }
    },
    [conflicts.length]
  );

  /**
   * Auto-resolve all resolvable conflicts
   */
  const autoResolveConflicts =
    useCallback(async (): Promise<AutoResolutionResult> => {
      setIsResolving(true);

      try {
        const result = await conflictResolutionService.autoResolve(conflicts);

        // Update conflicts to only show those requiring manual resolution
        setConflicts(result.requiresManual);
        setHasConflicts(result.requiresManual.length > 0);

        return result;
      } catch (error) {
        console.error("Error auto-resolving conflicts:", error);
        throw error;
      } finally {
        setIsResolving(false);
      }
    }, [conflicts]);

  /**
   * Get detailed information about a conflict
   */
  const getConflictDetails = useCallback(
    async (conflictId: string): Promise<ConflictDetails> => {
      try {
        return await conflictResolutionService.getConflictDetails(conflictId);
      } catch (error) {
        console.error("Error fetching conflict details:", error);
        throw error;
      }
    },
    []
  );

  /**
   * Clear all conflicts
   */
  const clearConflicts = useCallback(() => {
    setConflicts([]);
    setHasConflicts(false);
  }, []);

  /**
   * Refresh conflict state
   */
  const refresh = useCallback(async (): Promise<void> => {
    // Re-check for conflicts by fetching latest server version
    // This would need to be implemented based on current state
    console.log("Refreshing conflict state...");
  }, []);

  /**
   * Handle real-time conflict notifications
   */
  useEffect(() => {
    if (!enableRealtimeNotifications) {
      return;
    }

    const handleConflict = (conflict: Conflict) => {
      // Check if this conflict is for our resource
      if (
        conflict.resourceType === resourceType &&
        conflict.resourceId === resourceId
      ) {
        setConflicts((prev) => {
          // Check if conflict already exists
          const exists = prev.some((c) => c.id === conflict.id);
          if (exists) {
            return prev.map((c) => (c.id === conflict.id ? conflict : c));
          }
          return [...prev, conflict];
        });
        setHasConflicts(true);
      }
    };

    // Register with sync service
    syncService.onConflictDetected(handleConflict);

    return () => {
      // Cleanup would go here if we had an unregister method
    };
  }, [resourceType, resourceId, enableRealtimeNotifications]);

  /**
   * Setup polling for conflict checking
   */
  useEffect(() => {
    if (!autoCheck || pollingInterval <= 0) {
      return;
    }

    pollingIntervalRef.current = window.setInterval(() => {
      // Only check if not currently checking or resolving
      if (!isChecking && !isResolving) {
        // This would need current state to check against
        // For now, we just track that polling is active
        console.log("Polling for conflicts...");
      }
    }, pollingInterval);

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [autoCheck, pollingInterval, isChecking, isResolving]);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  return {
    conflicts,
    hasConflicts,
    isChecking,
    isResolving,
    checkForConflicts,
    resolveConflict,
    autoResolve: autoResolveConflicts,
    getConflictDetails,
    clearConflicts,
    refresh,
  };
}

/**
 * Hook for managing sync state
 */
export function useSyncState(resourceType: ResourceType, resourceId: string) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const sync = useCallback(
    async (localVersion: any) => {
      setIsSyncing(true);
      setSyncError(null);

      try {
        const result = await syncService.syncResource(
          resourceType,
          resourceId,
          localVersion,
          false
        );

        if (result.success) {
          setLastSynced(new Date());
        } else {
          setSyncError(result.errors?.[0] || "Sync failed");
        }

        return result;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        setSyncError(errorMessage);
        throw error;
      } finally {
        setIsSyncing(false);
      }
    },
    [resourceType, resourceId]
  );

  return {
    isSyncing,
    lastSynced,
    syncError,
    sync,
  };
}

/**
 * Hook for optimistic updates
 */
export function useOptimisticUpdate(
  resourceType: ResourceType,
  resourceId: string
) {
  const [optimisticState, setOptimisticState] = useState<any>(null);
  const [hasOptimistic, setHasOptimistic] = useState(false);

  const applyOptimistic = useCallback(
    (change: any) => {
      setOptimisticState(change);
      setHasOptimistic(true);

      syncService.applyOptimisticUpdate({
        id: `optimistic-${Date.now()}`,
        type: "update",
        resourceType,
        resourceId,
        path: [],
        value: change,
        timestamp: new Date(),
        userId: "current-user",
        optimistic: true,
      });
    },
    [resourceType, resourceId]
  );

  const rollback = useCallback((changeId: string) => {
    syncService.rollbackOptimisticUpdate(changeId);
    setOptimisticState(null);
    setHasOptimistic(false);
  }, []);

  // Listen for rollback events
  useEffect(() => {
    const handleRollback = (event: CustomEvent) => {
      if (event.detail.changeId.startsWith("optimistic-")) {
        setOptimisticState(null);
        setHasOptimistic(false);
      }
    };

    window.addEventListener(
      "optimistic-rollback",
      handleRollback as EventListener
    );

    return () => {
      window.removeEventListener(
        "optimistic-rollback",
        handleRollback as EventListener
      );
    };
  }, []);

  return {
    optimisticState,
    hasOptimistic,
    applyOptimistic,
    rollback,
  };
}

/**
 * Hook for offline queue management
 */
export function useOfflineQueue() {
  const [queueState, setQueueState] = useState(syncService.getQueueState());
  const [isProcessing, setIsProcessing] = useState(false);

  const processQueue = useCallback(async () => {
    setIsProcessing(true);
    try {
      await syncService.processOfflineQueue();
      setQueueState(syncService.getQueueState());
    } catch (error) {
      console.error("Error processing queue:", error);
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const clearQueue = useCallback(() => {
    syncService.clearQueue();
    setQueueState(syncService.getQueueState());
  }, []);

  // Refresh queue state periodically
  useEffect(() => {
    const interval = setInterval(() => {
      setQueueState(syncService.getQueueState());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return {
    queueState,
    isProcessing,
    processQueue,
    clearQueue,
  };
}

/**
 * Hook for real-time collaboration
 */
export function useRealtimeCollaboration(
  projectId: string,
  resourceType: ResourceType,
  resourceId: string
) {
  const [isConnected, setIsConnected] = useState(false);
  const [remoteChanges, setRemoteChanges] = useState<any[]>([]);

  useEffect(() => {
    // Connect to WebSocket
    syncService.connectWebSocket(projectId);
    setIsConnected(true);

    // Listen for remote changes
    const handleRemoteChange = (event: CustomEvent) => {
      if (
        event.detail.resourceType === resourceType &&
        event.detail.resourceId === resourceId
      ) {
        setRemoteChanges((prev) => [...prev, event.detail.change]);
      }
    };

    window.addEventListener(
      "remote-change",
      handleRemoteChange as EventListener
    );

    return () => {
      syncService.disconnectWebSocket();
      setIsConnected(false);
      window.removeEventListener(
        "remote-change",
        handleRemoteChange as EventListener
      );
    };
  }, [projectId, resourceType, resourceId]);

  const clearRemoteChanges = useCallback(() => {
    setRemoteChanges([]);
  }, []);

  return {
    isConnected,
    remoteChanges,
    clearRemoteChanges,
  };
}

export default useConflictResolution;
