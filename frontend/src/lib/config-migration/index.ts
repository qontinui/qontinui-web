/**
 * Configuration Migration System - Public API
 *
 * Provides backward compatibility for historical JSON config formats.
 * Automatically migrates configs from older versions to the current version.
 *
 * Usage:
 *   import { migrateConfigToLatest, needsMigration } from './config-migration';
 *
 *   if (needsMigration(config.version)) {
 *     const result = await migrateConfigToLatest(config);
 *     if (result.success) {
 *       config = result.config;
 *     }
 *   }
 */

import { MigrationEngine } from './migration-engine';
import { ALL_MIGRATIONS, CURRENT_VERSION } from './migrations';

// Initialize global migration engine
const migrationEngine = new MigrationEngine(CURRENT_VERSION);

// Register all migrations
for (const migration of ALL_MIGRATIONS) {
  migrationEngine.registerMigration(migration);
}

/**
 * Migrate a config to the latest version
 *
 * Automatically finds the migration path and applies all necessary migrations sequentially.
 *
 * @param config - Configuration object with a version field
 * @returns Migration result with transformed config, warnings, and errors
 */
export async function migrateConfigToLatest(config: any) {
  return migrationEngine.migrateToLatest(config);
}

/**
 * Check if a config needs migration
 *
 * @param configVersion - Version string from config (e.g., "1.0.0")
 * @returns true if config version is older than current version
 */
export function needsMigration(configVersion: string): boolean {
  return migrationEngine.needsMigration(configVersion);
}

/**
 * Get the current version of the application
 *
 * @returns Current version string (e.g., "2.0.0")
 */
export function getCurrentVersion(): string {
  return CURRENT_VERSION;
}

/**
 * Get all registered migrations
 *
 * Useful for debugging and documentation
 */
export function getAllMigrations() {
  return migrationEngine.getMigrations();
}

// Re-export types for convenience
export type { Migration, MigrationResult, MigrationContext, MigrationHistoryEntry } from './migration-types';
export { MigrationEngine } from './migration-engine';
export * from './version-utils';
