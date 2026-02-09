/**
 * Connection Pool
 *
 * Unified connection management for all IndexedDB databases.
 * Provides shared connection pooling, automatic reconnection, and health checks.
 *
 * DATABASES:
 * - qontinui-project-db: Workflows, states, transitions, images
 * - qontinui-screenshots-db: Screenshot cache
 * - qontinui-page-state-db: Page UI state
 */

import { projectLogger } from "@/lib/project-logger";
import {
  classifyError,
  DBErrorType,
  handleStorageCorruption,
} from "./error-handler";

/**
 * Database configuration
 */
export interface DatabaseConfig {
  /** Database name */
  name: string;
  /** Current version */
  version: number;
  /** Store configurations */
  stores: readonly StoreConfig[];
  /** Upgrade handler for migrations */
  onUpgrade?: (db: IDBDatabase, oldVersion: number, newVersion: number) => void;
}

/**
 * Object store configuration
 */
export interface StoreConfig {
  /** Store name */
  readonly name: string;
  /** Key path (e.g., "id") */
  readonly keyPath: string;
  /** Index configurations */
  readonly indexes?: readonly IndexConfig[];
}

/**
 * Index configuration
 */
export interface IndexConfig {
  /** Index name */
  readonly name: string;
  /** Key path for the index */
  readonly keyPath: string;
  /** Whether values must be unique */
  readonly unique?: boolean;
}

/**
 * Connection state for a database
 */
interface ConnectionState {
  /** Active database connection */
  db: IDBDatabase | null;
  /** Promise for pending connection */
  promise: Promise<IDBDatabase> | null;
  /** Configuration used to open this connection */
  config: DatabaseConfig;
  /** Whether connection is currently being established */
  connecting: boolean;
  /** Last error encountered */
  lastError: Error | null;
  /** Connection opened timestamp */
  connectedAt: number | null;
  /** Whether recovery has been attempted for this database */
  recoveryAttempted: boolean;
}

/**
 * Known database configurations
 */
export const DATABASE_CONFIGS = {
  PROJECT: {
    name: "qontinui-project-db",
    version: 3,
    stores: [
      {
        name: "workflows",
        keyPath: "id",
        indexes: [
          { name: "projectName", keyPath: "projectName", unique: false },
        ],
      },
      {
        name: "states",
        keyPath: "id",
        indexes: [
          { name: "projectName", keyPath: "projectName", unique: false },
        ],
      },
      {
        name: "transitions",
        keyPath: "id",
        indexes: [
          { name: "projectName", keyPath: "projectName", unique: false },
        ],
      },
      {
        name: "images",
        keyPath: "id",
        indexes: [
          { name: "projectName", keyPath: "projectName", unique: false },
        ],
      },
    ],
  },
  SCREENSHOTS: {
    name: "qontinui-screenshots-db",
    version: 3,
    stores: [
      {
        name: "screenshots",
        keyPath: "id",
        indexes: [
          { name: "name", keyPath: "name", unique: false },
          { name: "uploadedAt", keyPath: "uploadedAt", unique: false },
          { name: "projectName", keyPath: "projectName", unique: false },
        ],
      },
    ],
  },
  PAGE_STATE: {
    name: "qontinui-page-state-db",
    version: 1,
    stores: [
      {
        name: "page-metadata",
        keyPath: "key",
        indexes: [
          { name: "projectName", keyPath: "projectName", unique: false },
          { name: "userId", keyPath: "userId", unique: false },
          { name: "pageId", keyPath: "pageId", unique: false },
        ],
      },
      {
        name: "page-blobs",
        keyPath: "id",
        indexes: [{ name: "pageKey", keyPath: "pageKey", unique: false }],
      },
    ],
  },
} as const;

/**
 * Connection Pool implementation
 */
class ConnectionPoolImpl {
  private connections: Map<string, ConnectionState> = new Map();
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Start periodic health checks in browser environment
    if (typeof window !== "undefined") {
      this.startHealthChecks();
    }
  }

  /**
   * Get or create a database connection
   */
  async getConnection(config: DatabaseConfig): Promise<IDBDatabase> {
    if (typeof window === "undefined") {
      throw new Error("IndexedDB not available on server");
    }

    let state = this.connections.get(config.name);

    // Initialize connection state if not exists
    if (!state) {
      state = {
        db: null,
        promise: null,
        config,
        connecting: false,
        lastError: null,
        connectedAt: null,
        recoveryAttempted: false,
      };
      this.connections.set(config.name, state);
    }

    // Return existing valid connection
    if (state.db && !this.isConnectionClosed(state.db)) {
      return state.db;
    }

    // Reset if connection is closed
    if (state.db && this.isConnectionClosed(state.db)) {
      projectLogger.debug("ConnectionPool", "Connection closed, reconnecting", {
        database: config.name,
      });
      state.db = null;
      state.promise = null;
    }

    // Wait for pending connection
    if (state.promise) {
      return state.promise;
    }

    // Open new connection
    state.connecting = true;
    state.promise = this.openConnection(config, state);

    try {
      const db = await state.promise;
      state.db = db;
      state.connectedAt = Date.now();
      state.lastError = null;
      state.recoveryAttempted = false; // Reset on successful connection
      return db;
    } catch (error) {
      state.lastError =
        error instanceof Error ? error : new Error(String(error));
      state.promise = null;

      // Check if this is a storage corruption error
      const errorType = classifyError(error);
      if (
        errorType === DBErrorType.STORAGE_CORRUPTED &&
        !state.recoveryAttempted
      ) {
        state.recoveryAttempted = true;
        projectLogger.warn("ConnectionPool", "Attempting storage recovery", {
          database: config.name,
        });

        // Attempt recovery by deleting the corrupted database
        const recovered = await handleStorageCorruption(
          config.name,
          "getConnection"
        );

        if (recovered) {
          // Retry the connection after recovery
          state.promise = this.openConnection(config, state);
          try {
            const db = await state.promise;
            state.db = db;
            state.connectedAt = Date.now();
            state.lastError = null;
            projectLogger.info(
              "ConnectionPool",
              "Connection established after recovery",
              {
                database: config.name,
              }
            );
            return db;
          } catch (retryError) {
            state.lastError =
              retryError instanceof Error
                ? retryError
                : new Error(String(retryError));
            throw retryError;
          }
        }
      }

      throw error;
    } finally {
      state.connecting = false;
    }
  }

  /**
   * Open a new database connection
   */
  private openConnection(
    config: DatabaseConfig,
    state: ConnectionState
  ): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      projectLogger.debug("ConnectionPool", "Opening database", {
        name: config.name,
        version: config.version,
      });

      const request = indexedDB.open(config.name, config.version);

      request.onerror = () => {
        projectLogger.error("ConnectionPool", "Failed to open database", {
          name: config.name,
          error: request.error?.message,
        });
        reject(request.error);
      };

      request.onsuccess = () => {
        const db = request.result;

        // Handle connection close events
        db.onclose = () => {
          projectLogger.debug("ConnectionPool", "Database connection closed", {
            name: config.name,
          });
          state.db = null;
          state.promise = null;
        };

        db.onerror = (event) => {
          projectLogger.error("ConnectionPool", "Database error", {
            name: config.name,
            error: (event.target as IDBRequest).error?.message,
          });
        };

        projectLogger.debug("ConnectionPool", "Database opened successfully", {
          name: config.name,
          version: db.version,
        });

        resolve(db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const oldVersion = event.oldVersion;
        const newVersion = event.newVersion ?? config.version;

        projectLogger.info("ConnectionPool", "Database upgrade needed", {
          name: config.name,
          oldVersion,
          newVersion,
        });

        // Apply standard store creation/updates
        this.applyStoreConfigs(db, config.stores, event);

        // Call custom upgrade handler if provided
        if (config.onUpgrade) {
          config.onUpgrade(db, oldVersion, newVersion);
        }
      };
    });
  }

  /**
   * Apply store configurations during upgrade
   */
  private applyStoreConfigs(
    db: IDBDatabase,
    stores: readonly StoreConfig[],
    event: IDBVersionChangeEvent
  ): void {
    const transaction = (event.target as IDBOpenDBRequest).transaction;

    for (const storeConfig of stores) {
      let store: IDBObjectStore;

      if (!db.objectStoreNames.contains(storeConfig.name)) {
        // Create new store
        store = db.createObjectStore(storeConfig.name, {
          keyPath: storeConfig.keyPath,
        });
        projectLogger.debug("ConnectionPool", "Created object store", {
          store: storeConfig.name,
        });
      } else if (transaction) {
        // Get existing store for index updates
        store = transaction.objectStore(storeConfig.name);
      } else {
        continue;
      }

      // Create indexes if they don't exist
      if (storeConfig.indexes) {
        for (const indexConfig of storeConfig.indexes) {
          if (!store.indexNames.contains(indexConfig.name)) {
            store.createIndex(indexConfig.name, indexConfig.keyPath, {
              unique: indexConfig.unique ?? false,
            });
            projectLogger.debug("ConnectionPool", "Created index", {
              store: storeConfig.name,
              index: indexConfig.name,
            });
          }
        }
      }
    }
  }

  /**
   * Check if a connection is closed
   */
  private isConnectionClosed(db: IDBDatabase): boolean {
    try {
      // Try to get object store names - will throw if closed
      const storeNames = db.objectStoreNames;
      if (storeNames.length === 0) return false;
      // Try to start a transaction - will throw if closed
      const firstStore = storeNames.item(0);
      if (firstStore) {
        db.transaction(firstStore, "readonly");
      }
      return false;
    } catch {
      return true;
    }
  }

  /**
   * Close a specific database connection
   */
  closeConnection(dbName: string): void {
    const state = this.connections.get(dbName);
    if (state?.db) {
      state.db.close();
      state.db = null;
      state.promise = null;
      projectLogger.debug("ConnectionPool", "Connection closed", {
        database: dbName,
      });
    }
  }

  /**
   * Close all connections
   */
  closeAll(): void {
    this.stopHealthChecks();
    for (const [name, state] of this.connections) {
      if (state.db) {
        state.db.close();
        projectLogger.debug("ConnectionPool", "Connection closed", {
          database: name,
        });
      }
    }
    this.connections.clear();
  }

  /**
   * Get connection status for all databases
   */
  getStatus(): Record<
    string,
    { connected: boolean; connectedAt: number | null; lastError: string | null }
  > {
    const status: Record<
      string,
      {
        connected: boolean;
        connectedAt: number | null;
        lastError: string | null;
      }
    > = {};

    for (const [name, state] of this.connections) {
      status[name] = {
        connected: state.db !== null && !this.isConnectionClosed(state.db),
        connectedAt: state.connectedAt,
        lastError: state.lastError?.message ?? null,
      };
    }

    return status;
  }

  /**
   * Start periodic health checks
   */
  private startHealthChecks(): void {
    // Check every 30 seconds
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, 30000);
  }

  /**
   * Perform health check on all connections
   */
  private performHealthCheck(): void {
    for (const [name, state] of this.connections) {
      if (state.db && this.isConnectionClosed(state.db)) {
        projectLogger.warn(
          "ConnectionPool",
          "Health check: connection closed",
          {
            database: name,
          }
        );
        state.db = null;
        state.promise = null;
      }
    }
  }

  /**
   * Stop health checks (for cleanup)
   */
  stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Delete a database entirely
   */
  async deleteDatabase(dbName: string): Promise<void> {
    // Close connection first
    this.closeConnection(dbName);

    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(dbName);
      request.onsuccess = () => {
        projectLogger.info("ConnectionPool", "Database deleted", {
          database: dbName,
        });
        resolve();
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => {
        projectLogger.warn("ConnectionPool", "Database deletion blocked", {
          database: dbName,
        });
      };
    });
  }
}

// Export singleton instance
export const connectionPool = new ConnectionPoolImpl();

/**
 * Helper to get a connection for a known database
 */
export async function getProjectDBConnection(): Promise<IDBDatabase> {
  return connectionPool.getConnection(DATABASE_CONFIGS.PROJECT);
}

export async function getScreenshotsDBConnection(): Promise<IDBDatabase> {
  return connectionPool.getConnection(DATABASE_CONFIGS.SCREENSHOTS);
}

export async function getPageStateDBConnection(): Promise<IDBDatabase> {
  return connectionPool.getConnection(DATABASE_CONFIGS.PAGE_STATE);
}
