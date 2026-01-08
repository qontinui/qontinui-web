/**
 * Offline Indicator Component
 *
 * Shows connection status and sync queue status in the UI.
 */

"use client";

import { useEffect, useState } from "react";
import { syncQueue, SyncQueueStats } from "@/lib/sync-queue";
import { syncProcessor } from "@/lib/sync-processor";
import { WifiOff, CloudOff, Cloud, RefreshCw } from "lucide-react";

export function OfflineIndicator() {
  // Start with null to prevent hydration mismatch - only render after mount
  const [isMounted, setIsMounted] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [stats, setStats] = useState<SyncQueueStats>({
    total: 0,
    pending: 0,
    syncing: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  });
  const [isSyncing, setIsSyncing] = useState(false);

  // Set initial online status after mount to prevent hydration mismatch
  useEffect(() => {
    setIsMounted(true);
    setIsOnline(navigator.onLine);
  }, []);

  useEffect(() => {
    if (!isMounted) return;
    // Monitor online/offline status
    const handleOnline = () => {
      setIsOnline(true);
      // Trigger sync when coming online
      syncProcessor.processQueue();
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Subscribe to sync queue changes
    const unsubscribe = syncQueue.subscribe((newStats) => {
      setStats(newStats);
    });

    // Load initial stats
    syncQueue.getStats().then(setStats);

    // Monitor sync status
    const syncInterval = setInterval(() => {
      setIsSyncing(syncProcessor.isProcessing());
    }, 500);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      unsubscribe();
      clearInterval(syncInterval);
    };
  }, [isMounted]);

  // Don't render until mounted (prevents hydration mismatch)
  if (!isMounted) {
    return null;
  }

  // Don't show if everything is synced and online
  if (
    isOnline &&
    stats.pending === 0 &&
    stats.syncing === 0 &&
    stats.failed === 0
  ) {
    return null;
  }

  const hasPending = stats.pending > 0 || stats.syncing > 0;
  const hasFailed = stats.failed > 0;

  return (
    <div
      className={`fixed bottom-4 right-4 z-50 rounded-lg shadow-lg px-4 py-3 flex items-center gap-3 ${
        !isOnline
          ? "bg-yellow-100 dark:bg-yellow-900 text-yellow-900 dark:text-yellow-100"
          : hasFailed
            ? "bg-red-100 dark:bg-red-900 text-red-900 dark:text-red-100"
            : hasPending
              ? "bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100"
              : "bg-green-100 dark:bg-green-900 text-green-900 dark:text-green-100"
      }`}
    >
      {/* Icon */}
      <div className="flex-shrink-0">
        {!isOnline ? (
          <WifiOff className="w-5 h-5" />
        ) : isSyncing ? (
          <RefreshCw className="w-5 h-5 animate-spin" />
        ) : hasPending ? (
          <CloudOff className="w-5 h-5" />
        ) : (
          <Cloud className="w-5 h-5" />
        )}
      </div>

      {/* Message */}
      <div className="flex-1 text-sm font-medium">
        {!isOnline ? (
          <span>Offline - Changes will sync when online</span>
        ) : isSyncing ? (
          <span>Syncing {stats.syncing} items...</span>
        ) : hasFailed ? (
          <span>
            {stats.failed} failed uploads -{" "}
            <button
              className="underline"
              onClick={() => syncProcessor.processQueue()}
            >
              Retry
            </button>
          </span>
        ) : hasPending ? (
          <span>{stats.pending} items pending sync</span>
        ) : (
          <span>All changes synced</span>
        )}
      </div>

      {/* Sync button */}
      {isOnline && hasPending && !isSyncing && (
        <button
          onClick={() => syncProcessor.processQueue()}
          className="flex-shrink-0 px-3 py-1 rounded bg-white dark:bg-surface-raised text-sm font-medium hover:bg-surface-canvas dark:hover:bg-surface-raised"
        >
          Sync Now
        </button>
      )}
    </div>
  );
}
