/**
 * Offline Queue Hook
 *
 * React hook for managing offline operations queue.
 * Handles queueing, processing, and clearing of operations performed while offline.
 */

import { useState, useCallback, useEffect } from "react";
import { UseOfflineQueueReturn } from "./types";
import { syncService } from "../../services/collaboration/sync-service";

/**
 * Hook for offline queue management
 *
 * @returns Offline queue state and methods
 */
export function useOfflineQueue(): UseOfflineQueueReturn {
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

  // Refresh queue state on visibility change (instead of 1s polling)
  useEffect(() => {
    const handleVisibility = () => {
      if (!document.hidden) {
        setQueueState(syncService.getQueueState());
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  return {
    queueState,
    isProcessing,
    processQueue,
    clearQueue,
  };
}
