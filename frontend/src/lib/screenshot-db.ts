/**
 * IndexedDB wrapper for storing screenshots
 *
 * IMPORTANT: This is a TEMPORARY CLIENT-SIDE CACHE, not permanent storage.
 *
 * Purpose:
 * - Temporary browser-side cache for uploaded screenshots
 * - Local working storage for state discovery workflow
 * - Project-scoped storage for UI components
 *
 * NOT used for:
 * - Long-term persistent storage (use S3/MinIO via backend API)
 * - Cross-device synchronization (use server API)
 * - Automation screenshot storage (use PostgreSQL/S3 via backend)
 * - Offline access (presigned URLs expire)
 *
 * Data Lifecycle:
 * 1. User uploads screenshot → stored in IndexedDB temporarily
 * 2. Screenshot uploaded to S3 → presigned URL stored in IndexedDB
 * 3. Presigned URL expires after 7 days → auto-refresh on access
 * 4. Screenshot older than 7 days → cleaned up automatically
 *
 * Server is the source of truth for all screenshot data.
 */

import {
  classifyError,
  DBErrorType,
  handleStorageCorruption,
} from "./db/error-handler";
import { createLogger } from "@/lib/logger";

const log = createLogger("ScreenshotDB");

const DB_NAME = "qontinui-screenshots-db";
const STORE_NAME = "screenshots";
const DB_VERSION = 3; // Version 3: Added s3Key, projectId, urlExpiresAt for URL refresh

/**
 * Get the backend URL from environment or default
 */
const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/**
 * Normalize a URL to ensure it's absolute
 * Converts relative URLs like "/uploads/..." to absolute URLs
 */
export function normalizeUrl(url: string | undefined | null): string {
  // Handle undefined/null URLs
  if (!url) {
    return "";
  }

  // Skip base64 data URLs
  if (url.startsWith("data:")) {
    return url;
  }

  // Skip URLs that are already absolute
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }

  // Convert relative URLs to absolute URLs using the backend URL
  if (url.startsWith("/")) {
    return `${BACKEND_URL}${url}`;
  }

  // Return as-is for unknown formats
  return url;
}

/**
 * Screenshot stored in IndexedDB (temporary client-side cache)
 */
export interface StoredScreenshot {
  id: string;
  name: string;
  url: string; // base64 data URL or presigned URL from S3
  size: number;
  uploadedAt: Date;
  description?: string;
  tags?: string[];
  projectName?: string;

  // Added in v3: For presigned URL refresh
  s3Key?: string; // S3 object key (e.g., "automation/user-id/session-id/screenshot.png")
  projectId?: number; // Project ID for API calls
  urlExpiresAt?: Date; // When the presigned URL expires (null for base64 URLs)
}

class ScreenshotDB {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private db: IDBDatabase | null = null;
  private recoveryAttempted: boolean = false;

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
      this.recoveryAttempted = false; // Reset on successful connection
      return db;
    } catch (error) {
      // Check if this is a storage corruption error
      const errorType = classifyError(error);
      if (
        errorType === DBErrorType.STORAGE_CORRUPTED &&
        !this.recoveryAttempted
      ) {
        this.recoveryAttempted = true;
        console.warn(
          "[ScreenshotDB] Storage corruption detected, attempting recovery..."
        );

        // Attempt recovery by deleting the corrupted database
        const recovered = await handleStorageCorruption(
          DB_NAME,
          "openDatabase"
        );

        if (recovered) {
          // Retry opening after recovery
          try {
            const db = await this.openDatabaseInternal();
            this.db = db;
            log.debug("Successfully recovered and reconnected");
            return db;
          } catch (retryError) {
            console.error(
              "[ScreenshotDB] Failed to reconnect after recovery:",
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
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;

        // Handle connection close events
        db.onclose = () => {
          this.db = null;
          this.dbPromise = null;
        };

        resolve(db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const oldVersion = event.oldVersion;

        // Create object store if it doesn't exist
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("name", "name", { unique: false });
          store.createIndex("uploadedAt", "uploadedAt", { unique: false });
          store.createIndex("projectName", "projectName", { unique: false });
        } else {
          // Handle incremental upgrades
          const transaction = (event.target as IDBOpenDBRequest).transaction;
          if (transaction) {
            const store = transaction.objectStore(STORE_NAME);

            // Version 1 → 2: add projectName index
            if (oldVersion < 2 && !store.indexNames.contains("projectName")) {
              store.createIndex("projectName", "projectName", {
                unique: false,
              });
            }

            // Version 2 → 3: No new indexes needed (just added optional fields)
            // New fields: s3Key, projectId, urlExpiresAt
            // These are automatically supported by IndexedDB (no schema change needed)
          }
        }
      };
    });
  }

  private isConnectionClosed(db: IDBDatabase): boolean {
    try {
      // Try to create a transaction - will throw if connection is closed
      db.transaction(STORE_NAME, "readonly");
      return false;
    } catch {
      return true;
    }
  }

  async getAll(): Promise<StoredScreenshot[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => {
          const screenshots = request.result.map((s: unknown) => {
            const screenshot = s as StoredScreenshot & {
              uploadedAt: string | Date;
            };
            return {
              ...screenshot,
              url: normalizeUrl(screenshot.url),
              uploadedAt: new Date(screenshot.uploadedAt),
            };
          });
          resolve(screenshots);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error("Error getting screenshots from IndexedDB:", error);
      return [];
    }
  }

  async getByProject(projectName: string): Promise<StoredScreenshot[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index("projectName");
        const request = index.getAll(projectName);

        request.onsuccess = () => {
          const screenshots = request.result.map((s: unknown) => {
            const screenshot = s as StoredScreenshot & {
              uploadedAt: string | Date;
            };
            return {
              ...screenshot,
              url: normalizeUrl(screenshot.url),
              uploadedAt: new Date(screenshot.uploadedAt),
            };
          });
          resolve(screenshots);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error(
        `Error getting screenshots for project ${projectName} from IndexedDB:`,
        error
      );
      return [];
    }
  }

  async get(id: string): Promise<StoredScreenshot | null> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(id);

        request.onsuccess = () => {
          const screenshot = request.result;
          if (screenshot) {
            screenshot.url = normalizeUrl(screenshot.url);
            screenshot.uploadedAt = new Date(screenshot.uploadedAt);
          }
          resolve(screenshot || null);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error(`Error getting screenshot ${id} from IndexedDB:`, error);
      return null;
    }
  }

  async add(screenshot: StoredScreenshot): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.add(screenshot);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error("Error adding screenshot to IndexedDB:", error);
      throw error;
    }
  }

  async update(screenshot: StoredScreenshot): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(screenshot);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error("Error updating screenshot in IndexedDB:", error);
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error(`Error deleting screenshot ${id} from IndexedDB:`, error);
      throw error;
    }
  }

  async clear(): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.clear();

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error("Error clearing screenshots from IndexedDB:", error);
      throw error;
    }
  }

  async count(): Promise<number> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.count();

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error("Error counting screenshots in IndexedDB:", error);
      return 0;
    }
  }

  async renameProject(
    oldProjectName: string,
    newProjectName: string
  ): Promise<void> {
    try {
      const screenshots = await this.getByProject(oldProjectName);

      for (const screenshot of screenshots) {
        await this.update({
          ...screenshot,
          projectName: newProjectName,
        });
      }
    } catch (error) {
      console.error(
        `Error renaming project from ${oldProjectName} to ${newProjectName}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get screenshot with fresh presigned URL (refreshes if expired or near expiration)
   *
   * @param id Screenshot ID
   * @returns Screenshot with fresh URL, or null if not found
   */
  async getWithFreshUrl(id: string): Promise<StoredScreenshot | null> {
    try {
      const screenshot = await this.get(id);
      if (!screenshot) return null;

      // Skip refresh for base64 data URLs
      if (screenshot.url.startsWith("data:")) {
        return screenshot;
      }

      // Check if URL needs refresh
      const needsRefresh = this.shouldRefreshUrl(screenshot);

      if (needsRefresh && screenshot.s3Key && screenshot.projectId) {
        try {
          // Dynamically import apiClient to avoid circular dependencies
          const { apiClient } = await import("./api-client");

          // Refresh presigned URL from server
          const refreshed = await apiClient.refreshPresignedUrl(
            screenshot.projectId,
            screenshot.s3Key
          );

          // Update screenshot with fresh URL
          const updatedScreenshot = {
            ...screenshot,
            url: refreshed.url,
            urlExpiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
          };

          await this.update(updatedScreenshot);
          return updatedScreenshot;
        } catch (error) {
          console.warn(`Failed to refresh URL for screenshot ${id}:`, error);
          // Return original screenshot even if refresh fails
          return screenshot;
        }
      }

      return screenshot;
    } catch (error) {
      console.error(`Error getting screenshot ${id} with fresh URL:`, error);
      return null;
    }
  }

  /**
   * Check if screenshot URL should be refreshed
   *
   * @param screenshot Screenshot to check
   * @returns True if URL should be refreshed
   */
  private shouldRefreshUrl(screenshot: StoredScreenshot): boolean {
    // No refresh needed for base64 URLs
    if (screenshot.url.startsWith("data:")) {
      return false;
    }

    // No expiration data - needs refresh to be safe
    if (!screenshot.urlExpiresAt) {
      return true;
    }

    // Refresh if expires within 24 hours (86400000 ms)
    const expiresAt = new Date(screenshot.urlExpiresAt).getTime();
    const now = Date.now();
    const oneDayFromNow = now + 86400000;

    return expiresAt < oneDayFromNow;
  }

  /**
   * Clean up expired screenshots from cache
   *
   * Removes screenshots that are:
   * - Older than 7 days (for base64 URLs)
   * - Have expired presigned URLs and are older than 1 day
   *
   * Should be called on app startup or periodically.
   *
   * @returns Number of screenshots deleted
   */
  async cleanupExpired(): Promise<number> {
    try {
      const allScreenshots = await this.getAll();
      const now = Date.now();
      const sevenDaysAgo = now - 7 * 86400000; // 7 days in ms
      const oneDayAgo = now - 86400000; // 1 day in ms

      let deletedCount = 0;

      for (const screenshot of allScreenshots) {
        const uploadedAt = new Date(screenshot.uploadedAt).getTime();
        let shouldDelete = false;

        // Delete base64 URLs older than 7 days
        if (screenshot.url.startsWith("data:") && uploadedAt < sevenDaysAgo) {
          shouldDelete = true;
        }

        // Delete presigned URLs that are expired and older than 1 day
        if (!screenshot.url.startsWith("data:")) {
          const urlExpired = screenshot.urlExpiresAt
            ? new Date(screenshot.urlExpiresAt).getTime() < now
            : true; // Treat unknown expiration as expired

          if (urlExpired && uploadedAt < oneDayAgo) {
            shouldDelete = true;
          }
        }

        if (shouldDelete) {
          await this.delete(screenshot.id);
          deletedCount++;
        }
      }

      if (deletedCount > 0) {
        log.debug(
          `Cleaned up ${deletedCount} expired screenshots from IndexedDB`
        );
      }

      return deletedCount;
    } catch (error) {
      console.error("Error cleaning up expired screenshots:", error);
      return 0;
    }
  }
}

// Export singleton instance
export const screenshotDB = new ScreenshotDB();
