/**
 * IndexedDB storage service for Pattern Optimization images
 * Stores large image data separately from session metadata
 */

const DB_NAME = "PatternOptimizationDB";
const DB_VERSION = 1;
const IMAGES_STORE = "images";
const SESSIONS_STORE = "sessions";

class PatternOptimizationStorage {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    if (this.db) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
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
