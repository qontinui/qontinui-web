/**
 * Base Repository
 *
 * Provides generic IndexedDB operations that can be extended by entity-specific repositories.
 * Follows the Repository pattern to abstract data access logic.
 *
 * Uses the centralized connection pool for database connections.
 */

import { getProjectDBConnection, withRetry } from "@/lib/db";

/**
 * Interface that all entities stored in repositories must implement
 */
export interface Entity {
  id: string;
  projectName?: string;
}

/**
 * Repository interface defining the contract for all repositories
 */
export interface Repository<T extends Entity> {
  getAll(): Promise<T[]>;
  getByProject(projectName: string): Promise<T[]>;
  getById(id: string): Promise<T | null>;
  save(item: T): Promise<void>;
  add(item: T): Promise<void>;
  update(item: T): Promise<void>;
  delete(id: string): Promise<void>;
  deleteByProject(projectName: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Base repository providing generic CRUD operations
 */
export abstract class BaseRepository<
  T extends Entity,
> implements Repository<T> {
  protected abstract readonly storeName: string;

  protected async getDB(): Promise<IDBDatabase> {
    return getProjectDBConnection();
  }

  async getAll(): Promise<T[]> {
    try {
      return await withRetry<T[]>(
        async () => {
          const db = await this.getDB();
          return new Promise((resolve, reject) => {
            const transaction = db.transaction(this.storeName, "readonly");
            const store = transaction.objectStore(this.storeName);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result as T[]);
            request.onerror = () => reject(request.error);
          });
        },
        { operationName: "getAll", storeName: this.storeName }
      );
    } catch (error) {
      console.error(`Error getting all from ${this.storeName}:`, error);
      return [];
    }
  }

  async getByProject(projectName: string): Promise<T[]> {
    try {
      return await withRetry<T[]>(
        async () => {
          const db = await this.getDB();
          return new Promise((resolve, reject) => {
            const transaction = db.transaction(this.storeName, "readonly");
            const store = transaction.objectStore(this.storeName);
            const index = store.index("projectName");
            const request = index.getAll(projectName);

            request.onsuccess = () => resolve(request.result as T[]);
            request.onerror = () => reject(request.error);
          });
        },
        { operationName: "getByProject", storeName: this.storeName }
      );
    } catch (error) {
      console.error(
        `Error getting ${this.storeName} for project ${projectName}:`,
        error
      );
      return [];
    }
  }

  async getById(id: string): Promise<T | null> {
    try {
      return await withRetry<T | null>(
        async () => {
          const db = await this.getDB();
          return new Promise((resolve, reject) => {
            const transaction = db.transaction(this.storeName, "readonly");
            const store = transaction.objectStore(this.storeName);
            const request = store.get(id);

            request.onsuccess = () => resolve((request.result as T) ?? null);
            request.onerror = () => reject(request.error);
          });
        },
        { operationName: "getById", storeName: this.storeName }
      );
    } catch (error) {
      console.error(`Error getting ${id} from ${this.storeName}:`, error);
      return null;
    }
  }

  async save(item: T): Promise<void> {
    // Save uses put (upsert) - creates or updates
    return this.update(item);
  }

  async add(item: T): Promise<void> {
    return withRetry(
      async () => {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(this.storeName, "readwrite");
          const store = transaction.objectStore(this.storeName);
          const request = store.add(item);

          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
      },
      { operationName: "add", storeName: this.storeName }
    );
  }

  async update(item: T): Promise<void> {
    return withRetry(
      async () => {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(this.storeName, "readwrite");
          const store = transaction.objectStore(this.storeName);
          const request = store.put(item);

          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
      },
      { operationName: "update", storeName: this.storeName }
    );
  }

  async delete(id: string): Promise<void> {
    return withRetry(
      async () => {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(this.storeName, "readwrite");
          const store = transaction.objectStore(this.storeName);
          const request = store.delete(id);

          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
      },
      { operationName: "delete", storeName: this.storeName }
    );
  }

  async deleteByProject(projectName: string): Promise<void> {
    const items = await this.getByProject(projectName);
    await Promise.all(items.map((item) => this.delete(item.id)));
  }

  async clear(): Promise<void> {
    return withRetry(
      async () => {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction(this.storeName, "readwrite");
          const store = transaction.objectStore(this.storeName);
          const request = store.clear();

          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
      },
      { operationName: "clear", storeName: this.storeName }
    );
  }
}
