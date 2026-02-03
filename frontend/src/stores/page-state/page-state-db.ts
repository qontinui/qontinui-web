/**
 * IndexedDB wrapper for storing page-level state
 * Stores metadata and binary blobs (images, screenshots) with project isolation
 *
 * This enables full session persistence for pages like Image Extraction,
 * Pattern Tests, etc. State persists across navigation and browser restarts
 * until explicit logout.
 */

import {
  classifyError,
  DBErrorType,
  handleStorageCorruption,
} from "@/lib/db/error-handler";

const DB_NAME = "qontinui-page-state-db";
const DB_VERSION = 1;

const STORES = {
  PAGE_METADATA: "page-metadata",
  PAGE_BLOBS: "page-blobs",
} as const;

/** Page state metadata stored in IndexedDB */
export interface PageMetadata {
  /** Composite key: "{projectName}::{pageId}::{userId}" */
  key: string;
  projectName: string;
  pageId: string;
  userId: string;
  /** Page-specific state (JSON serializable, no blobs) */
  state: Record<string, unknown>;
  /** IDs of blobs associated with this page state */
  blobRefs: string[];
  updatedAt: number;
}

/** Binary blob data stored in IndexedDB */
export interface PageBlob {
  id: string;
  /** References PageMetadata.key */
  pageKey: string;
  /** Field name this blob represents, e.g. "currentScreenshot" */
  name: string;
  data: Blob;
  mimeType: string;
  size: number;
  createdAt: number;
}

/**
 * Generate a composite key for page state
 */
export function makePageKey(
  projectName: string,
  pageId: string,
  userId: string
): string {
  return `${projectName}::${pageId}::${userId}`;
}

/**
 * Generate a unique blob ID
 */
function generateBlobId(): string {
  return `blob-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

class PageStateDB {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private db: IDBDatabase | null = null;
  private recoveryAttempted = false;
  // Circuit breaker to prevent repeated access attempts after fatal errors
  private isFatallyFailed = false;
  private fatalError: Error | null = null;

  private getDB(): Promise<IDBDatabase> {
    // Circuit breaker: don't retry after fatal failure
    if (this.isFatallyFailed) {
      return Promise.reject(
        this.fatalError ||
          new Error("IndexedDB unavailable (storage corrupted)")
      );
    }

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
      this.isFatallyFailed = false;
      this.fatalError = null;
      return db;
    } catch (error) {
      const errorType = classifyError(error);
      if (
        errorType === DBErrorType.STORAGE_CORRUPTED &&
        !this.recoveryAttempted
      ) {
        this.recoveryAttempted = true;
        console.warn(
          "[PageStateDB] Storage corruption detected, attempting recovery..."
        );

        const recovered = await handleStorageCorruption(
          DB_NAME,
          "openDatabase"
        );

        if (recovered) {
          try {
            const db = await this.openDatabaseInternal();
            this.db = db;
            this.isFatallyFailed = false;
            this.fatalError = null;
            console.log("[PageStateDB] Successfully recovered and reconnected");
            return db;
          } catch (retryError) {
            console.error(
              "[PageStateDB] Failed to reconnect after recovery:",
              retryError
            );
            // Mark as fatally failed to prevent further retries
            this.isFatallyFailed = true;
            this.fatalError =
              retryError instanceof Error
                ? retryError
                : new Error(String(retryError));
            this.dbPromise = null;
            throw retryError;
          }
        } else {
          // Recovery failed, mark as fatally failed
          console.error(
            "[PageStateDB] Storage recovery failed. Please clear site data manually."
          );
          this.isFatallyFailed = true;
          this.fatalError =
            error instanceof Error ? error : new Error(String(error));
          this.dbPromise = null;
        }
      } else if (errorType === DBErrorType.STORAGE_CORRUPTED) {
        // Already tried recovery once, mark as fatally failed
        this.isFatallyFailed = true;
        this.fatalError =
          error instanceof Error ? error : new Error(String(error));
        this.dbPromise = null;
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

        db.onclose = () => {
          this.db = null;
          this.dbPromise = null;
        };

        resolve(db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create page-metadata store
        if (!db.objectStoreNames.contains(STORES.PAGE_METADATA)) {
          const metaStore = db.createObjectStore(STORES.PAGE_METADATA, {
            keyPath: "key",
          });
          metaStore.createIndex("projectName", "projectName", {
            unique: false,
          });
          metaStore.createIndex("userId", "userId", { unique: false });
          metaStore.createIndex("pageId", "pageId", { unique: false });
        }

        // Create page-blobs store
        if (!db.objectStoreNames.contains(STORES.PAGE_BLOBS)) {
          const blobStore = db.createObjectStore(STORES.PAGE_BLOBS, {
            keyPath: "id",
          });
          blobStore.createIndex("pageKey", "pageKey", { unique: false });
        }
      };
    });
  }

  private isConnectionClosed(db: IDBDatabase): boolean {
    try {
      // Try to create a transaction - will throw if connection is closed
      db.transaction(STORES.PAGE_METADATA, "readonly");
      return false;
    } catch {
      return true;
    }
  }

  // ===== Metadata Operations =====

  async getPageState(
    projectName: string,
    pageId: string,
    userId: string
  ): Promise<PageMetadata | null> {
    try {
      const db = await this.getDB();
      const key = makePageKey(projectName, pageId, userId);

      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORES.PAGE_METADATA, "readonly");
        const store = transaction.objectStore(STORES.PAGE_METADATA);
        const request = store.get(key);

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error("Error getting page state:", error);
      return null;
    }
  }

  async savePageState(metadata: PageMetadata): Promise<void> {
    try {
      const db = await this.getDB();

      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORES.PAGE_METADATA, "readwrite");
        const store = transaction.objectStore(STORES.PAGE_METADATA);
        const request = store.put(metadata);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error("Error saving page state:", error);
      throw error;
    }
  }

  async deletePageState(key: string): Promise<void> {
    try {
      const db = await this.getDB();

      // First delete all associated blobs
      await this.deleteBlobsForPage(key);

      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORES.PAGE_METADATA, "readwrite");
        const store = transaction.objectStore(STORES.PAGE_METADATA);
        const request = store.delete(key);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error("Error deleting page state:", error);
      throw error;
    }
  }

  // ===== Blob Operations =====

  async saveBlob(pageKey: string, name: string, blob: Blob): Promise<string> {
    try {
      const db = await this.getDB();
      const id = generateBlobId();

      const pageBlob: PageBlob = {
        id,
        pageKey,
        name,
        data: blob,
        mimeType: blob.type,
        size: blob.size,
        createdAt: Date.now(),
      };

      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORES.PAGE_BLOBS, "readwrite");
        const store = transaction.objectStore(STORES.PAGE_BLOBS);
        const request = store.add(pageBlob);

        request.onsuccess = () => resolve(id);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error("Error saving blob:", error);
      throw error;
    }
  }

  async getBlob(id: string): Promise<PageBlob | null> {
    try {
      const db = await this.getDB();

      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORES.PAGE_BLOBS, "readonly");
        const store = transaction.objectStore(STORES.PAGE_BLOBS);
        const request = store.get(id);

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error("Error getting blob:", error);
      return null;
    }
  }

  async deleteBlob(id: string): Promise<void> {
    try {
      const db = await this.getDB();

      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORES.PAGE_BLOBS, "readwrite");
        const store = transaction.objectStore(STORES.PAGE_BLOBS);
        const request = store.delete(id);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error("Error deleting blob:", error);
      throw error;
    }
  }

  async getBlobsForPage(pageKey: string): Promise<PageBlob[]> {
    try {
      const db = await this.getDB();

      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORES.PAGE_BLOBS, "readonly");
        const store = transaction.objectStore(STORES.PAGE_BLOBS);
        const index = store.index("pageKey");
        const request = index.getAll(pageKey);

        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error("Error getting blobs for page:", error);
      return [];
    }
  }

  private async deleteBlobsForPage(pageKey: string): Promise<void> {
    try {
      const blobs = await this.getBlobsForPage(pageKey);
      await Promise.all(blobs.map((blob) => this.deleteBlob(blob.id)));
    } catch (error) {
      console.error("Error deleting blobs for page:", error);
    }
  }

  // ===== Cleanup Operations =====

  /**
   * Clear all page state and blobs for a specific user.
   * Called on logout.
   */
  async clearUserData(userId: string): Promise<void> {
    try {
      const db = await this.getDB();

      // Get all page metadata for this user
      const pageStates = await new Promise<PageMetadata[]>(
        (resolve, reject) => {
          const transaction = db.transaction(STORES.PAGE_METADATA, "readonly");
          const store = transaction.objectStore(STORES.PAGE_METADATA);
          const index = store.index("userId");
          const request = index.getAll(userId);

          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
        }
      );

      // Delete all associated blobs and metadata
      for (const pageState of pageStates) {
        await this.deletePageState(pageState.key);
      }

      console.log(`Cleared page state for user ${userId}`);
    } catch (error) {
      console.error("Error clearing user data:", error);
    }
  }

  /**
   * Clear all page state and blobs for a specific project (for a user).
   * Called on project switch if needed.
   */
  async clearProjectData(projectName: string, userId: string): Promise<void> {
    try {
      const db = await this.getDB();

      // Get all page metadata for this project and user
      const pageStates = await new Promise<PageMetadata[]>(
        (resolve, reject) => {
          const transaction = db.transaction(STORES.PAGE_METADATA, "readonly");
          const store = transaction.objectStore(STORES.PAGE_METADATA);
          const index = store.index("projectName");
          const request = index.getAll(projectName);

          request.onsuccess = () => {
            // Filter by userId since we indexed by projectName
            const filtered = (request.result || []).filter(
              (m) => m.userId === userId
            );
            resolve(filtered);
          };
          request.onerror = () => reject(request.error);
        }
      );

      // Delete all associated blobs and metadata
      for (const pageState of pageStates) {
        await this.deletePageState(pageState.key);
      }

      console.log(
        `Cleared page state for project ${projectName} user ${userId}`
      );
    } catch (error) {
      console.error("Error clearing project data:", error);
    }
  }

  /**
   * Clear all data (for testing or full reset)
   */
  async clearAll(): Promise<void> {
    try {
      const db = await this.getDB();

      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(
          [STORES.PAGE_METADATA, STORES.PAGE_BLOBS],
          "readwrite"
        );

        const metaStore = transaction.objectStore(STORES.PAGE_METADATA);
        const blobStore = transaction.objectStore(STORES.PAGE_BLOBS);

        metaStore.clear();
        blobStore.clear();

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });

      console.log("Cleared all page state");
    } catch (error) {
      console.error("Error clearing all data:", error);
      throw error;
    }
  }
}

// Export singleton instance
export const pageStateDB = new PageStateDB();
