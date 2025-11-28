/**
 * Lock Service
 *
 * Manages resource locking for collaborative editing:
 * - Acquiring and releasing locks
 * - Auto-refresh mechanism
 * - Lock status checking
 */

import type {
  Lock,
  LockResourceType,
  LockStatus,
  AcquireLockRequest,
} from "@/types/collaboration";
import { httpClient } from "./http-client";

const API_BASE = "/api/locks";

// ============================================================================
// Lock Service
// ============================================================================

class LockService {
  private lockRefreshIntervals: Map<string, NodeJS.Timeout> = new Map();
  private readonly REFRESH_INTERVAL = 4 * 60 * 1000; // 4 minutes (locks expire after 5 minutes)

  /**
   * Acquire a lock on a resource
   */
  async acquireLock(
    projectId: string,
    resourceType: LockResourceType,
    resourceId: string,
    autoRefresh: boolean = true
  ): Promise<Lock> {
    const data: AcquireLockRequest = {
      project_id: projectId,
      resource_type: resourceType,
      resource_id: resourceId,
      auto_refresh: autoRefresh,
    };

    const lock = await httpClient.post<Lock>(API_BASE, data);

    // Start auto-refresh if enabled
    if (autoRefresh) {
      this.autoRefreshLock(lock.id);
    }

    return lock;
  }

  /**
   * Release a lock
   */
  async releaseLock(lockId: string): Promise<void> {
    // Stop auto-refresh
    this.stopAutoRefresh(lockId);

    await httpClient.delete(`${API_BASE}/${lockId}`);
  }

  /**
   * Refresh a lock to extend its expiration
   */
  async refreshLock(lockId: string): Promise<Lock> {
    const lock = await httpClient.post<Lock>(`${API_BASE}/${lockId}/refresh`);
    return lock;
  }

  /**
   * Check lock status for a resource
   */
  async getLockStatus(
    projectId: string,
    resourceType: LockResourceType,
    resourceId: string
  ): Promise<LockStatus> {
    const params = new URLSearchParams({
      project_id: projectId,
      resource_type: resourceType,
      resource_id: resourceId,
    });

    const status = await httpClient.get<LockStatus>(
      `${API_BASE}/status?${params}`
    );
    return status;
  }

  /**
   * Get all locks for a project
   */
  async getProjectLocks(projectId: string): Promise<Lock[]> {
    const locks = await httpClient.get<Lock[]>(
      `${API_BASE}/project/${projectId}`
    );
    return locks;
  }

  /**
   * Get all locks held by the current user
   */
  async getMyLocks(): Promise<Lock[]> {
    const locks = await httpClient.get<Lock[]>(`${API_BASE}/me`);
    return locks;
  }

  /**
   * Force release a lock (admin only)
   */
  async forceReleaseLock(lockId: string): Promise<void> {
    await httpClient.post(`${API_BASE}/${lockId}/force-release`);
  }

  /**
   * Start auto-refreshing a lock
   */
  autoRefreshLock(lockId: string): void {
    // Clear any existing interval
    this.stopAutoRefresh(lockId);

    // Set up new refresh interval
    const interval = setInterval(async () => {
      try {
        await this.refreshLock(lockId);
        console.log(`[LockService] Auto-refreshed lock ${lockId}`);
      } catch (error) {
        console.error(
          `[LockService] Failed to auto-refresh lock ${lockId}:`,
          error
        );
        this.stopAutoRefresh(lockId);
      }
    }, this.REFRESH_INTERVAL);

    this.lockRefreshIntervals.set(lockId, interval);
  }

  /**
   * Stop auto-refreshing a lock
   */
  stopAutoRefresh(lockId: string): void {
    const interval = this.lockRefreshIntervals.get(lockId);
    if (interval) {
      clearInterval(interval);
      this.lockRefreshIntervals.delete(lockId);
    }
  }

  /**
   * Stop all auto-refresh intervals
   */
  stopAllAutoRefresh(): void {
    for (const interval of this.lockRefreshIntervals.values()) {
      clearInterval(interval);
    }
    this.lockRefreshIntervals.clear();
  }

  /**
   * Release all locks held by the current user
   */
  async releaseAllMyLocks(): Promise<void> {
    const locks = await this.getMyLocks();
    await Promise.all(locks.map((lock) => this.releaseLock(lock.id)));
  }
}

// Export singleton instance
export const lockService = new LockService();
