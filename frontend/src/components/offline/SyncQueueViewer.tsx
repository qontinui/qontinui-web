/**
 * Sync Queue Viewer Component
 *
 * Shows detailed view of sync queue items for debugging/monitoring.
 */

"use client";

import { useEffect, useState } from "react";
import { syncQueue, SyncQueueItem, SyncQueueStats } from "@/lib/sync-queue";
import { syncProcessor } from "@/lib/sync-processor";
import {
  retryScreenshotUpload,
  cancelScreenshotUpload,
} from "@/lib/offline-screenshot-upload";
import {
  RefreshCw,
  X,
  RotateCcw,
  CheckCircle,
  XCircle,
  Clock,
  Loader,
} from "lucide-react";

export function SyncQueueViewer() {
  const [items, setItems] = useState<SyncQueueItem[]>([]);
  const [stats, setStats] = useState<SyncQueueStats>({
    total: 0,
    pending: 0,
    syncing: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  });
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    // Subscribe to queue changes (event-driven — no polling needed for stats)
    const unsubscribe = syncQueue.subscribe((newStats) => {
      setStats(newStats);
      // Reload items when stats change and panel is open
      if (isOpen) {
        loadItems();
      }
    });

    // Load initial stats (lightweight)
    syncQueue.getStats().then(setStats);

    return () => {
      unsubscribe();
    };
  }, [isOpen]);

  // Only poll for item details when the panel is open
  useEffect(() => {
    if (!isOpen) return;
    loadItems();
    const interval = setInterval(loadItems, 10000);
    return () => clearInterval(interval);
  }, [isOpen]);

  const loadItems = async () => {
    const allItems = await syncQueue.getAll();
    setItems(allItems);

    const newStats = await syncQueue.getStats();
    setStats(newStats);
  };

  const handleRetry = async (itemId: string) => {
    await retryScreenshotUpload(itemId);
    await loadItems();
  };

  const handleCancel = async (itemId: string) => {
    await cancelScreenshotUpload(itemId);
    await loadItems();
  };

  const handleClearCompleted = async () => {
    await syncQueue.clearCompleted();
    await loadItems();
  };

  const handleSyncNow = async () => {
    await syncProcessor.processQueue();
  };

  // Don't show if queue is empty
  if (stats.total === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-20 right-4 z-50">
      {/* Toggle button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="rounded-lg shadow-lg px-4 py-2 bg-white dark:bg-surface-raised text-sm font-medium hover:bg-surface-raised/80 dark:hover:bg-surface-raised/80 flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Sync Queue ({stats.total})
        </button>
      )}

      {/* Queue viewer */}
      {isOpen && (
        <div className="rounded-lg shadow-xl bg-white dark:bg-surface-raised w-96 max-h-96 overflow-hidden flex flex-col">
          {/* Header */}
          <div className="px-4 py-3 border-b dark:border-border-default flex items-center justify-between">
            <h3 className="font-semibold">Sync Queue</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSyncNow}
                disabled={syncProcessor.isProcessing()}
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
              >
                Sync Now
              </button>
              <button
                onClick={handleClearCompleted}
                className="text-sm text-text-muted dark:text-text-muted hover:underline"
              >
                Clear Completed
              </button>
              <button onClick={() => setIsOpen(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Stats */}
          <div className="px-4 py-2 border-b dark:border-border-default grid grid-cols-5 gap-2 text-xs">
            <div className="text-center">
              <div className="font-semibold text-text-muted dark:text-text-muted">
                Pending
              </div>
              <div className="text-lg">{stats.pending}</div>
            </div>
            <div className="text-center">
              <div className="font-semibold text-text-muted dark:text-text-muted">
                Syncing
              </div>
              <div className="text-lg">{stats.syncing}</div>
            </div>
            <div className="text-center">
              <div className="font-semibold text-text-muted dark:text-text-muted">
                Done
              </div>
              <div className="text-lg">{stats.completed}</div>
            </div>
            <div className="text-center">
              <div className="font-semibold text-text-muted dark:text-text-muted">
                Failed
              </div>
              <div className="text-lg">{stats.failed}</div>
            </div>
            <div className="text-center">
              <div className="font-semibold text-text-muted dark:text-text-muted">
                Cancelled
              </div>
              <div className="text-lg">{stats.cancelled}</div>
            </div>
          </div>

          {/* Items list */}
          <div className="flex-1 overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center text-text-muted dark:text-text-muted">
                No items in queue
              </div>
            ) : (
              <div className="divide-y dark:divide-border-subtle">
                {items.map((item) => (
                  <div key={item.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {/* Status icon */}
                          {item.status === "completed" && (
                            <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                          )}
                          {item.status === "failed" && (
                            <XCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
                          )}
                          {item.status === "syncing" && (
                            <Loader className="w-4 h-4 text-blue-600 flex-shrink-0 animate-spin" />
                          )}
                          {item.status === "pending" && (
                            <Clock className="w-4 h-4 text-text-muted flex-shrink-0" />
                          )}

                          {/* Type */}
                          <span className="text-sm font-medium truncate">
                            {item.type.replace(/_/g, " ")}
                          </span>
                        </div>

                        {/* Error message */}
                        {item.lastError && (
                          <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                            {item.lastError}
                          </p>
                        )}

                        {/* Retry info */}
                        {item.status === "failed" && item.retryCount > 0 && (
                          <p className="text-xs text-text-muted dark:text-text-muted mt-1">
                            Retry {item.retryCount}/{item.maxRetries}
                            {item.nextRetryAt &&
                              ` - Next: ${new Date(item.nextRetryAt).toLocaleTimeString()}`}
                          </p>
                        )}

                        {/* Timestamp */}
                        <p className="text-xs text-text-muted dark:text-text-muted mt-1">
                          {new Date(item.createdAt).toLocaleString()}
                        </p>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1">
                        {item.status === "failed" && (
                          <button
                            onClick={() => handleRetry(item.id)}
                            className="p-1 hover:bg-surface-raised dark:hover:bg-surface-raised/80 rounded"
                            title="Retry"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        )}

                        {(item.status === "pending" ||
                          item.status === "failed") && (
                          <button
                            onClick={() => handleCancel(item.id)}
                            className="p-1 hover:bg-surface-raised dark:hover:bg-surface-raised/80 rounded"
                            title="Cancel"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
