/**
 * Conflict Resolution Hook
 *
 * React hook for managing conflict detection and resolution in components.
 * Handles conflict checking, resolution, auto-resolution, and real-time notifications.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Conflict,
  ResolutionStrategy,
  ConflictCheckResult,
  ConflictDetails,
  AutoResolutionResult,
  ResourceType,
  UseConflictResolutionOptions,
  UseConflictResolutionReturn,
} from "./types";
import { conflictResolutionService } from "../../services/collaboration/conflict-resolution-service";
import { syncService } from "../../services/collaboration/sync-service";

/**
 * Hook for managing conflict resolution
 *
 * @param projectId - The project ID
 * @param resourceType - Type of resource (e.g., 'diagram', 'document')
 * @param resourceId - Unique identifier for the resource
 * @param options - Configuration options
 * @returns Conflict resolution state and methods
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
    async (localChanges: unknown): Promise<ConflictCheckResult> => {
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
      resolution?: unknown
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
