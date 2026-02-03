/**
 * Sync Queue for Offline-First Architecture
 *
 * Manages a queue of operations to be synced with the server when online.
 * Supports automatic retry, conflict resolution, and background sync.
 *
 * Use Cases:
 * - Screenshot uploads (main use case)
 * - Pattern creation/updates
 * - Project configuration changes
 * - Any operation that should work offline
 */

import {
  classifyError,
  DBErrorType,
  handleStorageCorruption,
} from "./db/error-handler";

const SYNC_DB_NAME = "qontinui-sync-queue-db";
const SYNC_STORE_NAME = "sync_queue";
const DB_VERSION = 1;

/**
 * Types of operations that can be queued
 */
export type SyncOperationType =
  | "upload_screenshot"
  | "upload_multiple_screenshots"
  | "delete_screenshot"
  | "update_screenshot"
  | "create_pattern"
  | "update_pattern"
  | "delete_pattern";

/**
 * Status of a sync operation
 */
export type SyncStatus =
  | "pending" // Waiting to be synced
  | "syncing" // Currently being synced
  | "completed" // Successfully synced
  | "failed" // Failed (will retry)
  | "cancelled"; // Cancelled by user

/**
 * Item in the sync queue
 */
export interface SyncQueueItem {
  id: string; // Unique ID
  type: SyncOperationType; // Operation type
  status: SyncStatus; // Current status
  priority: number; // Higher = more important (default: 0)

  // Data
  data: unknown; // Operation-specific data
  metadata: Record<string, unknown>; // Additional metadata

  // Retry logic
  retryCount: number; // Number of retry attempts
  maxRetries: number; // Max retries before giving up
  lastError?: string; // Last error message

  // Timestamps
  createdAt: Date; // When queued
  updatedAt: Date; // Last update
  syncedAt?: Date; // When synced (if completed)
  nextRetryAt?: Date; // When to retry next (if failed)

  // Conflict resolution
  conflictResolution?: "server_wins" | "client_wins" | "merge";
}

/**
 * Screenshot upload sync item data
 */
export interface ScreenshotUploadData {
  file: File; // Screenshot file (stored as blob)
  projectId: number; // Project ID
  name: string; // Screenshot name
  description?: string; // Optional description
  tags?: string[]; // Optional tags
  onProgress?: (progress: number) => void; // Progress callback (not serialized)
}

/**
 * Sync queue statistics
 */
export interface SyncQueueStats {
  total: number;
  pending: number;
  syncing: number;
  completed: number;
  failed: number;
  cancelled: number;
}

class SyncQueue {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private db: IDBDatabase | null = null;
  private syncInProgress = false;
  private syncListeners: Set<(stats: SyncQueueStats) => void> = new Set();
  private recoveryAttempted = false;

  /**
   * Get or create database connection
   */
  private getDB(): Promise<IDBDatabase> {
    // Check if existing connection is still valid
    if (this.db && !this.isConnectionClosed(this.db)) {
      return Promise.resolve(this.db);
    }

    // Reset if connection is closed
    if (this.db && this.isConnectionClosed(this.db)) {
      this.db = null;
      this.dbPromise = null;
    }

    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = this.openDatabase();

    return this.dbPromise;
  }

  private async openDatabase(): Promise<IDBDatabase> {
    if (typeof window === "undefined") {
      throw new Error("IndexedDB not available on server");
    }

    try {
      const db = await this.openDatabaseInternal();
      this.db = db;
      this.recoveryAttempted = false;
      return db;
    } catch (error) {
      const errorType = classifyError(error);
      if (
        errorType === DBErrorType.STORAGE_CORRUPTED &&
        !this.recoveryAttempted
      ) {
        this.recoveryAttempted = true;
        console.warn(
          "[SyncQueue] Storage corruption detected, attempting recovery..."
        );

        const recovered = await handleStorageCorruption(
          SYNC_DB_NAME,
          "openDatabase"
        );

        if (recovered) {
          try {
            const db = await this.openDatabaseInternal();
            this.db = db;
            console.log("[SyncQueue] Successfully recovered and reconnected");
            return db;
          } catch (retryError) {
            console.error(
              "[SyncQueue] Failed to reconnect after recovery:",
              retryError
            );
            throw retryError;
          }
        }
      }

      throw error;
    }
  }

  private openDatabaseInternal(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(SYNC_DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;

        db.onclose = () => {
          this.db = null;
          this.dbPromise = null;
        };

        resolve(db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create object store
        if (!db.objectStoreNames.contains(SYNC_STORE_NAME)) {
          const store = db.createObjectStore(SYNC_STORE_NAME, {
            keyPath: "id",
          });

          // Create indexes for efficient queries
          store.createIndex("status", "status", { unique: false });
          store.createIndex("type", "type", { unique: false });
          store.createIndex("priority", "priority", { unique: false });
          store.createIndex("createdAt", "createdAt", { unique: false });
          store.createIndex("nextRetryAt", "nextRetryAt", { unique: false });
        }
      };
    });
  }

  private isConnectionClosed(db: IDBDatabase): boolean {
    try {
      db.transaction(SYNC_STORE_NAME, "readonly");
      return false;
    } catch {
      return true;
    }
  }

  /**
   * Add item to sync queue
   */
  async enqueue(
    type: SyncOperationType,
    data: unknown,
    options: {
      priority?: number;
      maxRetries?: number;
      metadata?: Record<string, unknown>;
      conflictResolution?: "server_wins" | "client_wins" | "merge";
    } = {}
  ): Promise<SyncQueueItem> {
    const db = await this.getDB();

    const item: SyncQueueItem = {
      id: this.generateId(),
      type,
      status: "pending",
      priority: options.priority ?? 0,
      data,
      metadata: options.metadata ?? {},
      retryCount: 0,
      maxRetries: options.maxRetries ?? 3,
      createdAt: new Date(),
      updatedAt: new Date(),
      conflictResolution: options.conflictResolution,
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(SYNC_STORE_NAME, "readwrite");
      const store = transaction.objectStore(SYNC_STORE_NAME);
      const request = store.add(item);

      request.onsuccess = () => {
        console.log(`[SyncQueue] Enqueued ${type} operation:`, item.id);
        this.notifyListeners();
        resolve(item);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all items in queue
   */
  async getAll(filter?: {
    status?: SyncStatus;
    type?: SyncOperationType;
  }): Promise<SyncQueueItem[]> {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(SYNC_STORE_NAME, "readonly");
      const store = transaction.objectStore(SYNC_STORE_NAME);

      let request: IDBRequest;

      if (filter?.status) {
        const index = store.index("status");
        request = index.getAll(filter.status);
      } else if (filter?.type) {
        const index = store.index("type");
        request = index.getAll(filter.type);
      } else {
        request = store.getAll();
      }

      request.onsuccess = () => {
        let items: SyncQueueItem[] = request.result.map((item: unknown) => {
          const i = item as SyncQueueItem & {
            createdAt: string | Date;
            updatedAt: string | Date;
            syncedAt?: string | Date;
            nextRetryAt?: string | Date;
          };
          return {
            ...i,
            createdAt: new Date(i.createdAt),
            updatedAt: new Date(i.updatedAt),
            syncedAt: i.syncedAt ? new Date(i.syncedAt) : undefined,
            nextRetryAt: i.nextRetryAt ? new Date(i.nextRetryAt) : undefined,
          } as SyncQueueItem;
        });

        // Apply additional filters
        if (filter?.type && filter?.status) {
          items = items.filter((item) => item.type === filter.type);
        }

        // Sort by priority (higher first) then createdAt (older first)
        items.sort((a, b) => {
          if (a.priority !== b.priority) {
            return b.priority - a.priority;
          }
          return a.createdAt.getTime() - b.createdAt.getTime();
        });

        resolve(items);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get single item by ID
   */
  async get(id: string): Promise<SyncQueueItem | null> {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(SYNC_STORE_NAME, "readonly");
      const store = transaction.objectStore(SYNC_STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => {
        const item = request.result;
        if (item) {
          resolve({
            ...item,
            createdAt: new Date(item.createdAt),
            updatedAt: new Date(item.updatedAt),
            syncedAt: item.syncedAt ? new Date(item.syncedAt) : undefined,
            nextRetryAt: item.nextRetryAt
              ? new Date(item.nextRetryAt)
              : undefined,
          });
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Update item in queue
   */
  async update(item: SyncQueueItem): Promise<void> {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(SYNC_STORE_NAME, "readwrite");
      const store = transaction.objectStore(SYNC_STORE_NAME);

      const updatedItem = {
        ...item,
        updatedAt: new Date(),
      };

      const request = store.put(updatedItem);

      request.onsuccess = () => {
        this.notifyListeners();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Remove item from queue
   */
  async remove(id: string): Promise<void> {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(SYNC_STORE_NAME, "readwrite");
      const store = transaction.objectStore(SYNC_STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => {
        console.log(`[SyncQueue] Removed item:`, id);
        this.notifyListeners();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Clear all completed items
   */
  async clearCompleted(): Promise<number> {
    const completed = await this.getAll({ status: "completed" });

    for (const item of completed) {
      await this.remove(item.id);
    }

    console.log(`[SyncQueue] Cleared ${completed.length} completed items`);
    return completed.length;
  }

  /**
   * Clear all items (use with caution!)
   */
  async clearAll(): Promise<void> {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(SYNC_STORE_NAME, "readwrite");
      const store = transaction.objectStore(SYNC_STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => {
        console.log("[SyncQueue] Cleared all items");
        this.notifyListeners();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get queue statistics
   */
  async getStats(): Promise<SyncQueueStats> {
    const allItems = await this.getAll();

    const stats: SyncQueueStats = {
      total: allItems.length,
      pending: 0,
      syncing: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };

    for (const item of allItems) {
      stats[item.status]++;
    }

    return stats;
  }

  /**
   * Get items that are ready to retry
   */
  async getReadyToRetry(): Promise<SyncQueueItem[]> {
    const failed = await this.getAll({ status: "failed" });
    const now = Date.now();

    return failed.filter((item) => {
      // Retry if no nextRetryAt set, or if it's past the retry time
      return !item.nextRetryAt || item.nextRetryAt.getTime() <= now;
    });
  }

  /**
   * Mark item as failed with exponential backoff
   */
  async markFailed(id: string, error: string): Promise<void> {
    const item = await this.get(id);
    if (!item) return;

    const retryCount = item.retryCount + 1;
    const shouldRetry = retryCount < item.maxRetries;

    if (shouldRetry) {
      // Exponential backoff: 2^retryCount seconds
      const backoffSeconds = Math.pow(2, retryCount);
      const nextRetryAt = new Date(Date.now() + backoffSeconds * 1000);

      await this.update({
        ...item,
        status: "failed",
        retryCount,
        lastError: error,
        nextRetryAt,
      });

      console.warn(
        `[SyncQueue] Item ${id} failed, will retry in ${backoffSeconds}s (attempt ${retryCount}/${item.maxRetries})`
      );
    } else {
      await this.update({
        ...item,
        status: "failed",
        retryCount,
        lastError: error,
      });

      console.error(
        `[SyncQueue] Item ${id} failed permanently after ${retryCount} attempts:`,
        error
      );
    }
  }

  /**
   * Mark item as completed
   */
  async markCompleted(
    id: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const item = await this.get(id);
    if (!item) return;

    await this.update({
      ...item,
      status: "completed",
      syncedAt: new Date(),
      metadata: { ...item.metadata, ...metadata },
    });

    console.log(`[SyncQueue] Item ${id} completed successfully`);
  }

  /**
   * Subscribe to queue changes
   */
  subscribe(listener: (stats: SyncQueueStats) => void): () => void {
    this.syncListeners.add(listener);

    // Return unsubscribe function
    return () => {
      this.syncListeners.delete(listener);
    };
  }

  /**
   * Notify all listeners of queue changes
   */
  private async notifyListeners(): Promise<void> {
    const stats = await this.getStats();
    for (const listener of this.syncListeners) {
      try {
        listener(stats);
      } catch (error) {
        console.error("[SyncQueue] Error in listener:", error);
      }
    }
  }

  /**
   * Generate unique ID for queue items
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Check if sync is in progress
   */
  isSyncing(): boolean {
    return this.syncInProgress;
  }

  /**
   * Set sync in progress flag
   */
  setSyncing(syncing: boolean): void {
    this.syncInProgress = syncing;
  }
}

// Export singleton instance
export const syncQueue = new SyncQueue();
