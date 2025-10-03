/**
 * IndexedDB wrapper for storing screenshots
 * Uses IndexedDB because screenshots are too large for localStorage
 */

const DB_NAME = 'qontinui-screenshots-db';
const STORE_NAME = 'screenshots';
const DB_VERSION = 2; // Incremented to add projectName index

export interface StoredScreenshot {
  id: string;
  name: string;
  url: string; // base64 data URL
  size: number;
  uploadedAt: Date;
  description?: string;
  tags?: string[];
  projectName?: string;
}

class ScreenshotDB {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private getDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof window === 'undefined') {
        reject(new Error('IndexedDB not available on server'));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const oldVersion = event.oldVersion;

        // Create object store if it doesn't exist
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('name', 'name', { unique: false });
          store.createIndex('uploadedAt', 'uploadedAt', { unique: false });
          store.createIndex('projectName', 'projectName', { unique: false });
        } else if (oldVersion < 2) {
          // Upgrade from version 1 to 2: add projectName index
          const transaction = (event.target as IDBOpenDBRequest).transaction;
          if (transaction) {
            const store = transaction.objectStore(STORE_NAME);
            if (!store.indexNames.contains('projectName')) {
              store.createIndex('projectName', 'projectName', { unique: false });
            }
          }
        }
      };
    });

    return this.dbPromise;
  }

  async getAll(): Promise<StoredScreenshot[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => {
          const screenshots = request.result.map((s: any) => ({
            ...s,
            uploadedAt: new Date(s.uploadedAt)
          }));
          resolve(screenshots);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error getting screenshots from IndexedDB:', error);
      return [];
    }
  }

  async getByProject(projectName: string): Promise<StoredScreenshot[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index('projectName');
        const request = index.getAll(projectName);

        request.onsuccess = () => {
          const screenshots = request.result.map((s: any) => ({
            ...s,
            uploadedAt: new Date(s.uploadedAt)
          }));
          resolve(screenshots);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error(`Error getting screenshots for project ${projectName} from IndexedDB:`, error);
      return [];
    }
  }

  async get(id: string): Promise<StoredScreenshot | null> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(id);

        request.onsuccess = () => {
          const screenshot = request.result;
          if (screenshot) {
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
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.add(screenshot);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error adding screenshot to IndexedDB:', error);
      throw error;
    }
  }

  async update(screenshot: StoredScreenshot): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(screenshot);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error updating screenshot in IndexedDB:', error);
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
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
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.clear();

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error clearing screenshots from IndexedDB:', error);
      throw error;
    }
  }

  async count(): Promise<number> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.count();

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error counting screenshots in IndexedDB:', error);
      return 0;
    }
  }
}

// Export singleton instance
export const screenshotDB = new ScreenshotDB();
