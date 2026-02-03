/**
 * IndexedDB storage service for Pattern Optimization images
 * Stores large image data separately from session metadata
 */

import {
  classifyError,
  DBErrorType,
  handleStorageCorruption,
} from "./db/error-handler";

const DB_NAME = "PatternOptimizationDB";
const DB_VERSION = 1;
const IMAGES_STORE = "images";
const SESSIONS_STORE = "sessions";

class PatternOptimizationStorage {
  private db: IDBDatabase | null = null;
  private recoveryAttempted = false;

  async init(): Promise<void> {
    if (this.db) return;

    try {
      this.db = await this.openDatabaseInternal();
      this.recoveryAttempted = false;
    } catch (error) {
      const errorType = classifyError(error);
      if (errorType === DBErrorType.STORAGE_CORRUPTED && !this.recoveryAttempted) {
        this.recoveryAttempted = true;
        console.warn("[PatternOptimizationStorage] Storage corruption detected, attempting recovery...");

        const recovered = await handleStorageCorruption(DB_NAME, "init");

        if (recovered) {
          try {
            this.db = await this.openDatabaseInternal();
            console.log("[PatternOptimizationStorage] Successfully recovered and reconnected");
            return;
          } catch (retryError) {
            console.error("[PatternOptimizationStorage] Failed to reconnect after recovery:", retryError);
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
        resolve(request.result);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create images store if it doesn't exist
        if (!db.objectStoreNames.contains(IMAGES_STORE)) {
          db.createObjectStore(IMAGES_STORE, { keyPath: "id" });
        }

        // Create sessions store if it doesn't exist
        if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
          db.createObjectStore(SESSIONS_STORE, { keyPath: "id" });
        }
      };
    });
  }

  async storeImage(id: string, imageData: string): Promise<void> {
    // Validate inputs
    if (!id) {
      console.warn(
        "[PatternOptimizationStorage] storeImage called with empty id"
      );
      return;
    }
    if (!imageData) {
      console.warn(
        "[PatternOptimizationStorage] storeImage called with empty imageData"
      );
      return;
    }

    await this.init();
    if (!this.db) throw new Error("Database not initialized");

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([IMAGES_STORE], "readwrite");
      const store = transaction.objectStore(IMAGES_STORE);
      const request = store.put({ id, data: imageData, timestamp: Date.now() });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getImage(id: string): Promise<string | null> {
    // Validate id before querying IndexedDB
    if (!id) {
      console.warn(
        "[PatternOptimizationStorage] getImage called with empty id"
      );
      return null;
    }

    await this.init();
    if (!this.db) throw new Error("Database not initialized");

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([IMAGES_STORE], "readonly");
      const store = transaction.objectStore(IMAGES_STORE);
      const request = store.get(id);

      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.data : null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async deleteImage(id: string): Promise<void> {
    // Validate id before querying IndexedDB
    if (!id) {
      console.warn(
        "[PatternOptimizationStorage] deleteImage called with empty id"
      );
      return;
    }

    await this.init();
    if (!this.db) throw new Error("Database not initialized");

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([IMAGES_STORE], "readwrite");
      const store = transaction.objectStore(IMAGES_STORE);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async clearImages(): Promise<void> {
    await this.init();
    if (!this.db) throw new Error("Database not initialized");

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([IMAGES_STORE], "readwrite");
      const store = transaction.objectStore(IMAGES_STORE);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getAllImageIds(): Promise<string[]> {
    await this.init();
    if (!this.db) throw new Error("Database not initialized");

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([IMAGES_STORE], "readonly");
      const store = transaction.objectStore(IMAGES_STORE);
      const request = store.getAllKeys();

      request.onsuccess = () => resolve(request.result as string[]);
      request.onerror = () => reject(request.error);
    });
  }

  async cleanupOldImages(
    maxAgeMs: number = 24 * 60 * 60 * 1000
  ): Promise<void> {
    await this.init();
    if (!this.db) throw new Error("Database not initialized");

    const cutoffTime = Date.now() - maxAgeMs;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([IMAGES_STORE], "readwrite");
      const store = transaction.objectStore(IMAGES_STORE);
      const request = store.openCursor();

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          if (cursor.value.timestamp < cutoffTime) {
            cursor.delete();
          }
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getStorageSize(): Promise<{ used: number; quota: number }> {
    if ("storage" in navigator && "estimate" in navigator.storage) {
      const estimate = await navigator.storage.estimate();
      return {
        used: estimate.usage || 0,
        quota: estimate.quota || 0,
      };
    }
    return { used: 0, quota: 0 };
  }
}

export const patternOptimizationStorage = new PatternOptimizationStorage();
