/**
 * Synchronization Service
 *
 * Handles real-time synchronization of changes between client and server,
 * including offline support, optimistic updates, and conflict handling.
 */

import {
  Change,
  SyncResult,
  SyncOperation,
  RemoteUpdate,
  OptimisticUpdate,
  Conflict,
  ResourceType,
  OfflineQueueState,
  SyncServiceConfig,
} from "../../types/collaboration/conflict-types";
import { operationalTransformService } from "./operational-transform-service";
import { conflictResolutionService } from "./conflict-resolution-service";

/**
 * Synchronization Service
 */
export class SyncService {
  private syncQueue: SyncOperation[] = [];
  private optimisticUpdates: Map<string, OptimisticUpdate> = new Map();
  private ws: WebSocket | null = null;
  private config: SyncServiceConfig;
  private conflictCallbacks: Array<(conflict: Conflict) => void> = [];
  private isOnline: boolean = navigator.onLine;
  private syncInterval: number | null = null;
  private processingQueue: boolean = false;

  constructor(config: Partial<SyncServiceConfig> = {}) {
    this.config = {
      wsUrl: config.wsUrl || `ws://${window.location.host}/ws`,
      syncInterval: config.syncInterval || 5000,
      maxRetries: config.maxRetries || 3,
      retryDelay: config.retryDelay || 1000,
      enableOptimisticUpdates: config.enableOptimisticUpdates ?? true,
      enableOfflineQueue: config.enableOfflineQueue ?? true,
      maxQueueSize: config.maxQueueSize || 100,
    };

    this.setupEventListeners();
    this.startSyncInterval();
  }

  /**
   * Setup event listeners for online/offline status
   */
  private setupEventListeners(): void {
    window.addEventListener("online", () => {
      this.isOnline = true;
      console.log("Connection restored - processing offline queue");
      this.processOfflineQueue();
    });

    window.addEventListener("offline", () => {
      this.isOnline = false;
      console.log("Connection lost - changes will be queued");
    });
  }

  /**
   * Start periodic sync interval
   */
  private startSyncInterval(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    this.syncInterval = window.setInterval(() => {
      if (this.isOnline && !this.processingQueue) {
        this.processOfflineQueue();
      }
    }, this.config.syncInterval);
  }

  /**
   * Connect to WebSocket for real-time updates
   */
  connectWebSocket(projectId: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      this.ws = new WebSocket(`${this.config.wsUrl}/projects/${projectId}`);

      this.ws.onopen = () => {
        console.log("WebSocket connected");
      };

      this.ws.onmessage = (event) => {
        const update: RemoteUpdate = JSON.parse(event.data);
        this.handleRemoteUpdate(update);
      };

      this.ws.onerror = (error) => {
        console.error("WebSocket error:", error);
      };

      this.ws.onclose = () => {
        console.log("WebSocket disconnected - attempting to reconnect...");
        setTimeout(() => this.connectWebSocket(projectId), 5000);
      };
    } catch (error) {
      console.error("Failed to connect WebSocket:", error);
    }
  }

  /**
   * Disconnect WebSocket
   */
  disconnectWebSocket(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Push local changes to server
   */
  async pushChanges(changes: Change[]): Promise<SyncResult> {
    const appliedChanges: Change[] = [];
    const failedChanges: Change[] = [];
    const conflicts: Conflict[] = [];

    for (const change of changes) {
      try {
        const result = await this.syncResource(
          change.resourceType,
          change.resourceId,
          change,
          false
        );

        if (result.success) {
          appliedChanges.push(...result.appliedChanges);
        } else {
          failedChanges.push(change);
          conflicts.push(...result.conflicts);
        }
      } catch (error) {
        console.error("Failed to push change:", error);
        failedChanges.push(change);
      }
    }

    return {
      success: failedChanges.length === 0,
      status:
        conflicts.length > 0
          ? "conflict"
          : failedChanges.length > 0
            ? "error"
            : "success",
      conflicts,
      appliedChanges,
      failedChanges,
      currentVersion: null,
      versionId: "",
    };
  }

  /**
   * Pull server changes
   */
  async pullChanges(since: Date): Promise<Change[]> {
    try {
      const response = await fetch(`/api/changes?since=${since.toISOString()}`);

      if (!response.ok) {
        throw new Error(`Failed to pull changes: ${response.statusText}`);
      }

      const changes: Change[] = await response.json();
      return changes;
    } catch (error) {
      console.error("Error pulling changes:", error);
      throw error;
    }
  }

  /**
   * Sync a specific resource
   */
  async syncResource(
    resourceType: ResourceType,
    resourceId: string,
    localVersion: any,
    forceSync: boolean = false
  ): Promise<SyncResult> {
    try {
      // Check if online
      if (!this.isOnline && !forceSync) {
        // Queue for later
        this.queueOfflineChange({
          id: `change-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          type: "update",
          resourceType,
          resourceId,
          path: [],
          value: localVersion,
          timestamp: new Date(),
          userId: "current-user", // TODO: Get from auth
        });

        return {
          success: false,
          status: "pending",
          conflicts: [],
          appliedChanges: [],
          failedChanges: [],
          currentVersion: localVersion,
          versionId: "",
          errors: ["Offline - change queued for sync"],
        };
      }

      // Fetch current server version
      const response = await fetch(`/api/${resourceType}/${resourceId}`);

      if (!response.ok) {
        throw new Error(
          `Failed to fetch server version: ${response.statusText}`
        );
      }

      const serverData = await response.json();
      const serverVersion = serverData.data;
      const baseVersion = serverData.baseVersion;

      // Check for conflicts
      const conflictCheck = await conflictResolutionService.checkForConflicts(
        serverData.projectId,
        resourceType,
        resourceId,
        localVersion
      );

      if (conflictCheck.hasConflicts && !forceSync) {
        // Notify conflict callbacks
        for (const conflict of conflictCheck.conflicts) {
          this.notifyConflict(conflict);
        }

        return {
          success: false,
          status: "conflict",
          conflicts: conflictCheck.conflicts,
          appliedChanges: [],
          failedChanges: [],
          currentVersion: serverVersion,
          versionId: serverData.versionId,
        };
      }

      // If no conflicts or auto-resolvable, proceed with sync
      let versionToSync = localVersion;

      if (conflictCheck.hasConflicts && conflictCheck.canSave) {
        // Auto-resolve conflicts
        const autoResolution = await conflictResolutionService.autoResolve(
          conflictCheck.conflicts
        );
        if (autoResolution.requiresManual.length > 0) {
          return {
            success: false,
            status: "conflict",
            conflicts: autoResolution.requiresManual,
            appliedChanges: [],
            failedChanges: [],
            currentVersion: serverVersion,
            versionId: serverData.versionId,
          };
        }

        // Use merged version
        const mergeResult = conflictResolutionService
          .getDetector()
          .threeWayMerge(localVersion, serverVersion, baseVersion);
        versionToSync = mergeResult.mergedVersion;
      }

      // Push to server
      const updateResponse = await fetch(`/api/${resourceType}/${resourceId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          data: versionToSync,
          baseVersionId: serverData.versionId,
        }),
      });

      if (!updateResponse.ok) {
        throw new Error(
          `Failed to sync resource: ${updateResponse.statusText}`
        );
      }

      const syncedData = await updateResponse.json();

      // Clear optimistic update if exists
      const optimisticKey = `${resourceType}-${resourceId}`;
      if (this.optimisticUpdates.has(optimisticKey)) {
        this.optimisticUpdates.get(optimisticKey)!.confirmed = true;
      }

      return {
        success: true,
        status: "success",
        conflicts: [],
        appliedChanges: [
          {
            id: syncedData.changeId,
            type: "update",
            resourceType,
            resourceId,
            path: [],
            value: versionToSync,
            timestamp: new Date(),
            userId: "current-user",
          },
        ],
        failedChanges: [],
        currentVersion: syncedData.data,
        versionId: syncedData.versionId,
      };
    } catch (error) {
      console.error("Error syncing resource:", error);

      return {
        success: false,
        status: "error",
        conflicts: [],
        appliedChanges: [],
        failedChanges: [],
        currentVersion: localVersion,
        versionId: "",
        errors: [error instanceof Error ? error.message : "Unknown error"],
      };
    }
  }

  /**
   * Handle incoming WebSocket updates
   */
  handleRemoteUpdate(update: RemoteUpdate): void {
    console.log("Received remote update:", update);

    switch (update.type) {
      case "change":
        this.handleRemoteChange(update);
        break;

      case "conflict":
        this.handleRemoteConflict(update);
        break;

      case "version":
        this.handleRemoteVersion(update);
        break;
    }
  }

  /**
   * Handle remote change update
   */
  private handleRemoteChange(update: RemoteUpdate): void {
    if (!update.change) return;

    // Check if we have an optimistic update for this resource
    const optimisticKey = `${update.resourceType}-${update.resourceId}`;
    const optimistic = this.optimisticUpdates.get(optimisticKey);

    if (optimistic && !optimistic.confirmed) {
      // Transform remote change against our optimistic update
      const localOp = this.changeToOperation(optimistic.change);
      const remoteOp = this.changeToOperation(update.change);

      const [, remoteTransformed] = operationalTransformService.transform(
        localOp,
        remoteOp
      );

      // Apply transformed remote change
      // Emit event for UI to handle
      window.dispatchEvent(
        new CustomEvent("remote-change", {
          detail: {
            resourceType: update.resourceType,
            resourceId: update.resourceId,
            change: this.operationToChange(remoteTransformed),
          },
        })
      );
    } else {
      // No optimistic update - apply remote change directly
      window.dispatchEvent(
        new CustomEvent("remote-change", {
          detail: {
            resourceType: update.resourceType,
            resourceId: update.resourceId,
            change: update.change,
          },
        })
      );
    }
  }

  /**
   * Handle remote conflict notification
   */
  private handleRemoteConflict(update: RemoteUpdate): void {
    if (!update.conflict) return;

    this.notifyConflict(update.conflict);
  }

  /**
   * Handle remote version update
   */
  private handleRemoteVersion(update: RemoteUpdate): void {
    if (!update.version) return;

    window.dispatchEvent(
      new CustomEvent("remote-version", {
        detail: {
          resourceType: update.resourceType,
          resourceId: update.resourceId,
          version: update.version,
        },
      })
    );
  }

  /**
   * Apply optimistic update
   */
  applyOptimisticUpdate(change: Change): void {
    if (!this.config.enableOptimisticUpdates) {
      return;
    }

    const key = `${change.resourceType}-${change.resourceId}`;

    const optimistic: OptimisticUpdate = {
      id: change.id,
      change,
      originalState: null, // TODO: Store original state
      appliedAt: new Date(),
      confirmed: false,
      rollback: false,
    };

    this.optimisticUpdates.set(key, optimistic);

    // Set timeout to rollback if not confirmed
    setTimeout(() => {
      const update = this.optimisticUpdates.get(key);
      if (update && !update.confirmed) {
        this.rollbackOptimisticUpdate(change.id);
      }
    }, 10000); // 10 second timeout
  }

  /**
   * Rollback optimistic update
   */
  rollbackOptimisticUpdate(changeId: string): void {
    // Find the optimistic update
    for (const [key, update] of this.optimisticUpdates.entries()) {
      if (update.id === changeId) {
        update.rollback = true;

        // Emit rollback event
        window.dispatchEvent(
          new CustomEvent("optimistic-rollback", {
            detail: {
              changeId,
              originalState: update.originalState,
            },
          })
        );

        this.optimisticUpdates.delete(key);
        break;
      }
    }
  }

  /**
   * Queue change for offline sync
   */
  queueOfflineChange(change: Change): void {
    if (!this.config.enableOfflineQueue) {
      return;
    }

    // Check queue size limit
    if (this.syncQueue.length >= this.config.maxQueueSize) {
      console.warn("Sync queue is full - removing oldest item");
      this.syncQueue.shift();
    }

    const operation: SyncOperation = {
      id: change.id,
      type: change.type,
      resourceType: change.resourceType,
      resourceId: change.resourceId,
      change,
      priority: 1,
      retryCount: 0,
      queuedAt: new Date(),
      status: "queued",
    };

    this.syncQueue.push(operation);

    // Save to localStorage for persistence
    this.saveQueueToStorage();
  }

  /**
   * Process offline queue
   */
  async processOfflineQueue(): Promise<void> {
    if (!this.isOnline || this.processingQueue || this.syncQueue.length === 0) {
      return;
    }

    this.processingQueue = true;

    console.log(`Processing ${this.syncQueue.length} queued changes...`);

    // Sort by priority (higher first) and timestamp (older first)
    this.syncQueue.sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      return a.queuedAt.getTime() - b.queuedAt.getTime();
    });

    const processedIds: string[] = [];

    for (const operation of this.syncQueue) {
      if (operation.status === "completed") {
        processedIds.push(operation.id);
        continue;
      }

      try {
        operation.status = "processing";

        const result = await this.syncResource(
          operation.resourceType,
          operation.resourceId,
          operation.change.value,
          false
        );

        if (result.success) {
          operation.status = "completed";
          processedIds.push(operation.id);
        } else if (result.status === "conflict") {
          // Keep in queue but notify about conflict
          operation.status = "queued";
          operation.retryCount++;

          if (operation.retryCount >= this.config.maxRetries) {
            operation.status = "failed";
            console.error(
              `Failed to sync operation ${operation.id} after ${this.config.maxRetries} retries`
            );
          }
        } else {
          operation.status = "queued";
          operation.retryCount++;

          if (operation.retryCount >= this.config.maxRetries) {
            operation.status = "failed";
          }

          // Wait before next retry
          await new Promise((resolve) =>
            setTimeout(resolve, this.config.retryDelay)
          );
        }
      } catch (error) {
        console.error(`Error processing operation ${operation.id}:`, error);
        operation.status = "queued";
        operation.retryCount++;

        if (operation.retryCount >= this.config.maxRetries) {
          operation.status = "failed";
        }
      }
    }

    // Remove completed operations
    this.syncQueue = this.syncQueue.filter(
      (op) => !processedIds.includes(op.id)
    );

    // Save updated queue
    this.saveQueueToStorage();

    this.processingQueue = false;

    console.log(
      `Processed ${processedIds.length} changes, ${this.syncQueue.length} remaining`
    );
  }

  /**
   * Register callback for conflict notifications
   */
  onConflictDetected(callback: (conflict: Conflict) => void): void {
    this.conflictCallbacks.push(callback);
  }

  /**
   * Notify all conflict callbacks
   */
  private notifyConflict(conflict: Conflict): void {
    for (const callback of this.conflictCallbacks) {
      try {
        callback(conflict);
      } catch (error) {
        console.error("Error in conflict callback:", error);
      }
    }
  }

  /**
   * Get current queue state
   */
  getQueueState(): OfflineQueueState {
    return {
      pending: this.syncQueue.filter((op) => op.status === "queued"),
      failed: this.syncQueue.filter((op) => op.status === "failed"),
      size: this.syncQueue.length,
      processing: this.processingQueue,
      lastSyncAttempt: undefined,
      nextSync: undefined,
    };
  }

  /**
   * Clear the sync queue
   */
  clearQueue(): void {
    this.syncQueue = [];
    this.saveQueueToStorage();
  }

  /**
   * Save queue to localStorage
   */
  private saveQueueToStorage(): void {
    try {
      localStorage.setItem("sync-queue", JSON.stringify(this.syncQueue));
    } catch (error) {
      console.error("Failed to save queue to storage:", error);
    }
  }

  /**
   * Load queue from localStorage
   */
  loadQueueFromStorage(): void {
    try {
      const stored = localStorage.getItem("sync-queue");
      if (stored) {
        this.syncQueue = JSON.parse(stored);
        console.log(`Loaded ${this.syncQueue.length} operations from storage`);
      }
    } catch (error) {
      console.error("Failed to load queue from storage:", error);
    }
  }

  /**
   * Convert change to operation
   */
  private changeToOperation(change: Change): any {
    return {
      type: change.type,
      path: change.path,
      value: change.value,
      oldValue: change.oldValue,
      timestamp: change.timestamp,
      userId: change.userId,
      operationId: change.id,
    };
  }

  /**
   * Convert operation to change
   */
  private operationToChange(operation: any): Change {
    return {
      id: operation.operationId,
      type: operation.type,
      resourceType: "workflow", // TODO: Infer from context
      resourceId: "",
      path: operation.path,
      value: operation.value,
      oldValue: operation.oldValue,
      timestamp: operation.timestamp,
      userId: operation.userId,
    };
  }

  /**
   * Cleanup and disconnect
   */
  destroy(): void {
    this.disconnectWebSocket();

    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }

    this.saveQueueToStorage();
  }
}

// Export singleton instance
export const syncService = new SyncService();
