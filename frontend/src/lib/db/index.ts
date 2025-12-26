/**
 * Database Module
 *
 * Unified database infrastructure for IndexedDB operations.
 *
 * USAGE:
 * ```typescript
 * import {
 *   connectionPool,
 *   getProjectDBConnection,
 *   withRetry,
 *   DBError,
 *   DATABASE_CONFIGS
 * } from "@/lib/db";
 *
 * // Get a connection
 * const db = await getProjectDBConnection();
 *
 * // Execute with retry
 * const result = await withRetry(
 *   () => myOperation(),
 *   { operationName: "myOperation", storeName: "myStore" }
 * );
 *
 * // Check connection status
 * const status = connectionPool.getStatus();
 * ```
 */

// Connection pool
export {
  connectionPool,
  getProjectDBConnection,
  getScreenshotsDBConnection,
  getPageStateDBConnection,
  DATABASE_CONFIGS,
} from "./connection-pool";
export type {
  DatabaseConfig,
  StoreConfig,
  IndexConfig,
} from "./connection-pool";

// Migration runner
export {
  createMigrationRegistry,
  registerMigration,
  runMigrations,
  getMigrationsForDatabase,
  createUpgradeHandler,
  projectDBMigrations,
  screenshotsDBMigrations,
  pageStateDBMigrations,
} from "./migration-runner";
export type {
  Migration,
  MigrationFn,
  MigrationRegistry,
} from "./migration-runner";

// Error handling
export {
  DBError,
  DBErrorType,
  classifyError,
  wrapError,
  withRetry,
  handleQuotaExceeded,
  recoverConnection,
} from "./error-handler";
export type { RetryConfig } from "./error-handler";
