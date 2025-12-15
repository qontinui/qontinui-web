/**
 * Sync Processor - Processes sync queue items
 *
 * Handles actual syncing of queued operations with the server.
 * Supports retry logic, error handling, and progress tracking.
 */

import { syncQueue, SyncQueueItem } from "./sync-queue";
import { apiClient } from "./api-client";
import { screenshotDB } from "./screenshot-db";

/**
 * Result of processing a sync item
 */
export interface SyncResult {
  success: boolean;
  error?: string;
  data?: unknown;
}

/**
 * Progress callback for sync operations
 */
export type SyncProgressCallback = (itemId: string, progress: number) => void;

class SyncProcessor {
  private processing = false;
  private progressCallbacks: Map<string, SyncProgressCallback> = new Map();

  /**
   * Process all pending items in the queue
   *
   * @param force Force sync even if already processing
   * @returns Number of items processed
   */
  async processQueue(force = false): Promise<number> {
    // Prevent concurrent processing
    if (this.processing && !force) {
      console.log("[SyncProcessor] Already processing queue, skipping");
      return 0;
    }

    // Check if online
    if (!navigator.onLine) {
      console.log("[SyncProcessor] Offline, skipping sync");
      return 0;
    }

    this.processing = true;
    syncQueue.setSyncing(true);

    try {
      console.log("[SyncProcessor] Starting queue processing...");

      // Get pending items
      const pending = await syncQueue.getAll({ status: "pending" });

      // Get items ready to retry
      const retryReady = await syncQueue.getReadyToRetry();

      // Combine and sort by priority
      const itemsToProcess = [...pending, ...retryReady];

      console.log(
        `[SyncProcessor] Found ${itemsToProcess.length} items to process (${pending.length} pending, ${retryReady.length} retry)`
      );

      let processedCount = 0;

      for (const item of itemsToProcess) {
        try {
          // Mark as syncing
          await syncQueue.update({
            ...item,
            status: "syncing",
          });

          // Process the item
          const result = await this.processItem(item);

          if (result.success) {
            // Mark as completed
            await syncQueue.markCompleted(item.id, result.data);
            processedCount++;
          } else {
            // Mark as failed
            await syncQueue.markFailed(
              item.id,
              result.error || "Unknown error"
            );
          }
        } catch (error) {
          console.error(
            `[SyncProcessor] Error processing item ${item.id}:`,
            error
          );
          await syncQueue.markFailed(
            item.id,
            error instanceof Error ? error.message : "Unknown error"
          );
        }
      }

      console.log(
        `[SyncProcessor] Processed ${processedCount} items successfully`
      );

      return processedCount;
    } finally {
      this.processing = false;
      syncQueue.setSyncing(false);
    }
  }

  /**
   * Process a single queue item
   */
  private async processItem(item: SyncQueueItem): Promise<SyncResult> {
    console.log(`[SyncProcessor] Processing ${item.type}:`, item.id);

    try {
      switch (item.type) {
        case "upload_screenshot":
          return await this.processScreenshotUpload(item);

        case "upload_multiple_screenshots":
          return await this.processMultipleScreenshotUploads(item);

        case "delete_screenshot":
          return await this.processScreenshotDelete(item);

        case "update_screenshot":
          return await this.processScreenshotUpdate(item);

        default:
          return {
            success: false,
            error: `Unknown operation type: ${item.type}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Process screenshot upload
   */
  private async processScreenshotUpload(
    item: SyncQueueItem
  ): Promise<SyncResult> {
    const { file, projectId, name, description, tags } = item.data;

    try {
      // Upload to server with progress tracking
      const result = await apiClient.uploadProjectImage(
        projectId,
        file,
        (progress) => {
          const callback = this.progressCallbacks.get(item.id);
          if (callback) {
            callback(item.id, progress);
          }
        }
      );

      // Use presigned_url from backend response (fallback to presigned_urls.original for legacy compatibility)
      const uploadUrl =
        result.presigned_url || result.presigned_urls?.original || result.url;

      // Update IndexedDB with server response
      await screenshotDB.update({
        id: result.image_id,
        name: name || file.name,
        url: uploadUrl || "",
        size: result.size || 0,
        uploadedAt: result.created_at
          ? new Date(result.created_at)
          : new Date(),
        description,
        tags,
        projectId,
        s3Key: result.s3_key,
        urlExpiresAt: new Date(Date.now() + 7 * 86400000), // 7 days
      });

      return {
        success: true,
        data: {
          imageId: result.image_id,
          url: uploadUrl || "",
          s3Key: result.s3_key,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Upload failed",
      };
    }
  }

  /**
   * Process multiple screenshot uploads (batch)
   */
  private async processMultipleScreenshotUploads(
    item: SyncQueueItem
  ): Promise<SyncResult> {
    const { files, projectId } = item.data;
    const results = [];
    const errors = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      try {
        const result = await apiClient.uploadProjectImage(
          projectId,
          file,
          (fileProgress) => {
            // Calculate overall progress
            const overallProgress =
              ((i + fileProgress / 100) / files.length) * 100;
            const callback = this.progressCallbacks.get(item.id);
            if (callback) {
              callback(item.id, overallProgress);
            }
          }
        );

        results.push(result);

        // Use presigned_url from backend response (fallback to presigned_urls.original for legacy compatibility)
        const batchUploadUrl =
          result.presigned_url || result.presigned_urls?.original || result.url;

        // Update IndexedDB
        await screenshotDB.update({
          id: result.image_id,
          name: file.name,
          url: batchUploadUrl || "",
          size: result.size || 0,
          uploadedAt: result.created_at
            ? new Date(result.created_at)
            : new Date(),
          projectId,
          s3Key: result.s3_key,
          urlExpiresAt: new Date(Date.now() + 7 * 86400000),
        });
      } catch (error) {
        errors.push({
          file: file.name,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    if (errors.length > 0) {
      return {
        success: false,
        error: `Failed to upload ${errors.length}/${files.length} files`,
        data: { results, errors },
      };
    }

    return {
      success: true,
      data: { results },
    };
  }

  /**
   * Process screenshot deletion
   */
  private async processScreenshotDelete(
    item: SyncQueueItem
  ): Promise<SyncResult> {
    const { screenshotId, projectId } = item.data;

    try {
      // Delete from server
      await apiClient.deleteProjectImage(projectId, screenshotId);

      // Delete from IndexedDB
      await screenshotDB.delete(screenshotId);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Delete failed",
      };
    }
  }

  /**
   * Process screenshot update
   */
  private async processScreenshotUpdate(
    item: SyncQueueItem
  ): Promise<SyncResult> {
    const { screenshotId, updates } = item.data;

    try {
      // Update on server (if API exists)
      // For now, we just update local IndexedDB
      const screenshot = await screenshotDB.get(screenshotId);
      if (!screenshot) {
        return { success: false, error: "Screenshot not found" };
      }

      await screenshotDB.update({
        ...screenshot,
        ...updates,
      });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Update failed",
      };
    }
  }

  /**
   * Register progress callback for a sync item
   */
  onProgress(itemId: string, callback: SyncProgressCallback): void {
    this.progressCallbacks.set(itemId, callback);
  }

  /**
   * Unregister progress callback
   */
  offProgress(itemId: string): void {
    this.progressCallbacks.delete(itemId);
  }

  /**
   * Check if processor is currently processing
   */
  isProcessing(): boolean {
    return this.processing;
  }
}

// Export singleton instance
export const syncProcessor = new SyncProcessor();

/**
 * Auto-process queue on network connectivity change
 */
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    console.log("[SyncProcessor] Network online, processing queue...");
    syncProcessor.processQueue();
  });
}
