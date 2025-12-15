/**
 * Sync State Hook
 *
 * React hook for managing synchronization state between local and remote resources.
 * Handles sync operations, tracking sync status, and error handling.
 */

import { useState, useCallback } from "react";
import { ResourceType, UseSyncStateReturn } from "./types";
import { syncService } from "../../services/collaboration/sync-service";

/**
 * Hook for managing sync state
 *
 * @param resourceType - Type of resource (e.g., 'diagram', 'document')
 * @param resourceId - Unique identifier for the resource
 * @returns Sync state and methods
 */
export function useSyncState(
  resourceType: ResourceType,
  resourceId: string
): UseSyncStateReturn {
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const sync = useCallback(
    async (localVersion: unknown) => {
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
