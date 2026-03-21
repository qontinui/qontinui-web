/**
 * Offline-First Screenshot Upload
 *
 * Handles screenshot uploads with offline support.
 * Works immediately offline, syncs when online.
 */

import { syncQueue } from "./sync-queue";
import { syncProcessor } from "./sync-processor";
import { screenshotDB, StoredScreenshot } from "./screenshot-db";
import { serviceWorkerManager } from "./service-worker";
import { createLogger } from "@/lib/logger";

const log = createLogger("OfflineScreenshotUpload");

/**
 * Upload result (immediate, works offline)
 */
export interface OfflineUploadResult {
  // Local screenshot data (available immediately)
  screenshot: StoredScreenshot;

  // Sync queue item ID
  syncItemId: string;

  // Whether upload was queued (offline) or completed immediately (online)
  queued: boolean;

  // Promise that resolves when upload completes
  whenSynced: Promise<{
    imageId: string;
    url: string;
    s3Key: string;
  }>;
}

/**
 * Upload progress callback
 */
export type UploadProgressCallback = (progress: number, status: string) => void;

/**
 * Upload a screenshot with offline support
 *
 * @param file Screenshot file to upload
 * @param projectId Project ID
 * @param options Upload options
 * @returns Upload result (immediate)
 */
export async function uploadScreenshotOffline(
  file: File,
  projectId: number,
  options: {
    name?: string;
    description?: string;
    tags?: string[];
    onProgress?: UploadProgressCallback;
    priority?: number;
  } = {}
): Promise<OfflineUploadResult> {
  const screenshotId = generateId();
  const name = options.name || file.name;

  // Create local screenshot entry immediately
  const screenshot: StoredScreenshot = {
    id: screenshotId,
    name,
    url: await fileToDataURL(file), // Store as base64 temporarily
    size: file.size,
    uploadedAt: new Date(),
    description: options.description,
    tags: options.tags,
    projectId,
  };

  // Save to IndexedDB immediately (works offline)
  await screenshotDB.add(screenshot);

  log.debug("Saved screenshot locally:", screenshotId);

  // Report initial progress
  options.onProgress?.(0, "Queued for upload");

  // Add to sync queue
  const syncItem = await syncQueue.enqueue(
    "upload_screenshot",
    {
      file,
      projectId,
      name,
      description: options.description,
      tags: options.tags,
    },
    {
      priority: options.priority ?? 0,
      metadata: {
        screenshotId,
        localUrl: screenshot.url.substring(0, 50) + "...", // Store preview
      },
    }
  );

  log.debug("Added to sync queue:", syncItem.id);

  // Track upload progress
  if (options.onProgress) {
    syncProcessor.onProgress(syncItem.id, (_itemId, progress) => {
      options.onProgress?.(progress, "Uploading");
    });
  }

  // Create promise that resolves when synced
  const whenSynced = new Promise<{
    imageId: string;
    url: string;
    s3Key: string;
  }>((resolve, reject) => {
    // Poll sync queue for completion
    const checkInterval = setInterval(async () => {
      const item = await syncQueue.get(syncItem.id);

      if (!item) {
        clearInterval(checkInterval);
        reject(new Error("Sync item not found"));
        return;
      }

      if (item.status === "completed") {
        clearInterval(checkInterval);
        options.onProgress?.(100, "Uploaded");

        // Clean up progress callback
        syncProcessor.offProgress(syncItem.id);

        resolve({
          imageId: item.metadata.imageId as string,
          url: item.metadata.url as string,
          s3Key: item.metadata.s3Key as string,
        });
      }

      if (item.status === "failed" && item.retryCount >= item.maxRetries) {
        clearInterval(checkInterval);
        options.onProgress?.(0, `Failed: ${item.lastError}`);

        // Clean up progress callback
        syncProcessor.offProgress(syncItem.id);

        reject(new Error(item.lastError || "Upload failed"));
      }
    }, 500); // Check every 500ms
  });

  // Try to sync immediately if online
  const isOnline = navigator.onLine;
  let queued = true;

  if (isOnline) {
    // Process queue immediately
    syncProcessor.processQueue().catch((error) => {
      console.error("[OfflineUpload] Immediate sync failed:", error);
    });

    queued = false;
  } else {
    // Request background sync when online
    serviceWorkerManager.requestBackgroundSync().catch((error) => {
      console.error("[OfflineUpload] Background sync request failed:", error);
    });
  }

  return {
    screenshot,
    syncItemId: syncItem.id,
    queued,
    whenSynced,
  };
}

/**
 * Upload multiple screenshots with offline support (batch)
 *
 * @param files Screenshot files to upload
 * @param projectId Project ID
 * @param options Upload options
 * @returns Upload results for each file
 */
export async function uploadScreenshotsOffline(
  files: File[],
  projectId: number,
  options: {
    onProgress?: UploadProgressCallback;
    priority?: number;
  } = {}
): Promise<OfflineUploadResult[]> {
  const results: OfflineUploadResult[] = [];

  // Process files individually to provide immediate feedback
  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    const result = await uploadScreenshotOffline(file!, projectId, {
      ...options,
      onProgress: (progress, status) => {
        // Calculate overall progress
        const overallProgress = ((i + progress / 100) / files.length) * 100;
        options.onProgress?.(
          overallProgress,
          `${status} (${i + 1}/${files.length})`
        );
      },
    });

    results.push(result);
  }

  return results;
}

/**
 * Delete screenshot with offline support
 *
 * @param screenshotId Screenshot ID
 * @param projectId Project ID
 */
export async function deleteScreenshotOffline(
  screenshotId: string,
  projectId: number
): Promise<void> {
  // Delete from IndexedDB immediately
  await screenshotDB.delete(screenshotId);

  log.debug("Deleted screenshot locally:", screenshotId);

  // Queue deletion for server sync
  await syncQueue.enqueue("delete_screenshot", {
    screenshotId,
    projectId,
  });

  // Try to sync immediately if online
  if (navigator.onLine) {
    syncProcessor.processQueue().catch((error) => {
      console.error("[OfflineUpload] Immediate delete sync failed:", error);
    });
  }
}

/**
 * Get sync status for a screenshot
 *
 * @param screenshotId Screenshot ID
 * @returns Sync status or null if not in queue
 */
export async function getScreenshotSyncStatus(screenshotId: string): Promise<{
  status: string;
  progress?: number;
  error?: string;
} | null> {
  const allItems = await syncQueue.getAll();

  const item = allItems.find(
    (item) => item.metadata.screenshotId === screenshotId
  );

  if (!item) {
    return null;
  }

  return {
    status: item.status,
    error: item.lastError,
  };
}

/**
 * Retry failed screenshot upload
 *
 * @param syncItemId Sync queue item ID
 */
export async function retryScreenshotUpload(syncItemId: string): Promise<void> {
  const item = await syncQueue.get(syncItemId);

  if (!item) {
    throw new Error("Sync item not found");
  }

  // Reset retry count and mark as pending
  await syncQueue.update({
    ...item,
    status: "pending",
    retryCount: 0,
    lastError: undefined,
    nextRetryAt: undefined,
  });

  log.debug("Reset item for retry:", syncItemId);

  // Try to sync immediately
  if (navigator.onLine) {
    await syncProcessor.processQueue();
  }
}

/**
 * Cancel screenshot upload
 *
 * @param syncItemId Sync queue item ID
 */
export async function cancelScreenshotUpload(
  syncItemId: string
): Promise<void> {
  const item = await syncQueue.get(syncItemId);

  if (!item) {
    return;
  }

  // Mark as cancelled
  await syncQueue.update({
    ...item,
    status: "cancelled",
  });

  log.debug("Cancelled upload:", syncItemId);

  // Optionally delete from IndexedDB
  if (item.metadata.screenshotId) {
    await screenshotDB.delete(item.metadata.screenshotId as string);
  }
}

/**
 * Helper: Convert File to data URL
 */
async function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to read file"));
      }
    };

    reader.onerror = () => {
      reject(reader.error);
    };

    reader.readAsDataURL(file);
  });
}

/**
 * Helper: Generate unique ID
 */
function generateId(): string {
  return `screenshot-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
