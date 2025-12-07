/**
 * Lock Service
 *
 * Handles edit locking to prevent concurrent modifications:
 * - Acquiring and releasing locks on resources
 * - Checking lock status
 * - Automatic lock refresh to keep locks active
 * - Lock expiration handling
 */

import { HttpClient } from "../http-client";
import { ApiConfig } from "../api-config";
import type {
  Lock,
  LockAcquireRequest,
  ResourceType,
} from "@/types/collaboration";

export class LockService {
  private httpClient: HttpClient;
  private apiUrl: string;
  private activeLocks: Map<string, Lock> = new Map();
  private refreshIntervals: Map<string, NodeJS.Timeout> = new Map();
  private currentUserId: string | null = null;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
    this.apiUrl = ApiConfig.API_BASE_URL;
  }

  // ============================================================================
  // Lock Management
  // ============================================================================

  /**
   * Acquire a lock on a resource
   */
  async acquireLock(
    projectId: string,
    resourceType: ResourceType,
    resourceId: string,
    timeoutSeconds: number = 300
  ): Promise<Lock> {
    const data: LockAcquireRequest = {
      resource_type: resourceType,
      resource_id: resourceId,
      timeout_seconds: timeoutSeconds,
    };

    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/projects/${projectId}/locks`,
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || "Failed to acquire lock");
    }

    const lock: Lock = await response.json();

    // Store the lock locally
    this.activeLocks.set(lock.id, lock);

    // Set up automatic refresh
    this.autoRefreshLock(lock.id);

    return lock;
  }

  /**
   * Release a lock
   */
  async releaseLock(lockId: string): Promise<void> {
    // Stop auto-refresh
    this.stopAutoRefresh(lockId);

    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/locks/${lockId}`,
      {
        method: "DELETE",
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || "Failed to release lock");
    }

    // Remove from local storage
    this.activeLocks.delete(lockId);
  }

  /**
   * Get the current status of a lock on a resource
   */
  async getLockStatus(
    projectId: string,
    resourceType: ResourceType,
    resourceId: string
  ): Promise<Lock | null> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/projects/${projectId}/locks/${resourceType}/${resourceId}`
    );

    if (response.status === 404) {
      // No lock exists
      return null;
    }

    if (!response.ok) {
      throw new Error("Failed to fetch lock status");
    }

    return response.json();
  }

  /**
   * Get all active locks for a project
   */
  async getProjectLocks(projectId: string): Promise<Lock[]> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/projects/${projectId}/locks`
    );

    if (!response.ok) {
      throw new Error("Failed to fetch project locks");
    }

    return response.json();
  }

  /**
   * Refresh a lock to extend its expiration
   */
  async refreshLock(lockId: string): Promise<void> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/locks/${lockId}/refresh`,
      {
        method: "POST",
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || "Failed to refresh lock");
    }

    const updatedLock: Lock = await response.json();
    this.activeLocks.set(lockId, updatedLock);
  }

  // ============================================================================
  // Lock Status Checks
  // ============================================================================

  /**
   * Check if a lock is held by the current user
   */
  isLockedByMe(lock: Lock): boolean {
    if (!this.currentUserId) {
      // Try to get current user ID from token or other source
      // This is a simplified implementation
      return false;
    }
    return lock.user_id === this.currentUserId;
  }

  /**
   * Check if a lock is held by another user
   */
  isLockedByOther(lock: Lock): boolean {
    if (!this.currentUserId) {
      return true; // Assume it's locked by someone else if we don't know who we are
    }
    return lock.user_id !== this.currentUserId;
  }

  /**
   * Check if a lock is expired
   */
  isLockExpired(lock: Lock): boolean {
    const expiresAt = new Date(lock.expires_at).getTime();
    const now = Date.now();
    return expiresAt <= now;
  }

  /**
   * Get lock by ID from local cache
   */
  getLock(lockId: string): Lock | undefined {
    return this.activeLocks.get(lockId);
  }

  /**
   * Get all locally tracked active locks
   */
  getActiveLocks(): Lock[] {
    return Array.from(this.activeLocks.values());
  }

  // ============================================================================
  // Auto-Refresh
  // ============================================================================

  /**
   * Set up automatic lock refresh
   * Refreshes the lock at half the timeout interval to ensure it doesn't expire
   */
  autoRefreshLock(lockId: string): void {
    // Stop any existing refresh for this lock
    this.stopAutoRefresh(lockId);

    // Refresh every 2 minutes (lock timeout is typically 5 minutes)
    const refreshInterval = 120000; // 2 minutes in milliseconds

    const intervalId = setInterval(async () => {
      try {
        await this.refreshLock(lockId);
        console.log(`[LockService] Lock ${lockId} refreshed successfully`);
      } catch (error) {
        console.error(`[LockService] Failed to refresh lock ${lockId}:`, error);
        // Lock might have been released or expired
        this.stopAutoRefresh(lockId);
        this.activeLocks.delete(lockId);
      }
    }, refreshInterval);

    this.refreshIntervals.set(lockId, intervalId);
  }

  /**
   * Stop auto-refresh for a lock
   */
  private stopAutoRefresh(lockId: string): void {
    const intervalId = this.refreshIntervals.get(lockId);
    if (intervalId) {
      clearInterval(intervalId);
      this.refreshIntervals.delete(lockId);
    }
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  /**
   * Release all active locks
   */
  async releaseAllLocks(): Promise<void> {
    const lockIds = Array.from(this.activeLocks.keys());
    await Promise.all(lockIds.map((id) => this.releaseLock(id)));
  }

  /**
   * Clean up all resources
   */
  cleanup(): void {
    // Stop all auto-refresh intervals
    for (const intervalId of this.refreshIntervals.values()) {
      clearInterval(intervalId);
    }
    this.refreshIntervals.clear();
    this.activeLocks.clear();
  }

  // ============================================================================
  // User Management
  // ============================================================================

  /**
   * Set the current user ID for lock ownership checks
   */
  setCurrentUserId(userId: string): void {
    this.currentUserId = userId;
  }

  /**
   * Clear the current user ID
   */
  clearCurrentUserId(): void {
    this.currentUserId = null;
  }
}
