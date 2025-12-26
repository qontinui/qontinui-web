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

import { MigrationEngine } from "./migration-engine";
import { ALL_MIGRATIONS, CURRENT_VERSION } from "./migrations";
import {
  isLegacyRAGConfig,
  normalizeLegacyRAGConfig,
} from "./migrations/legacy-rag-to-v2.0.0";

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
 * Also handles legacy RAGConfig format by detecting and normalizing it first.
 *
 * @param config - Configuration object with a version field
 * @returns Migration result with transformed config, warnings, and errors
 */
export async function migrateConfigToLatest(config: unknown) {
  // Check if this is a legacy RAGConfig format and normalize it
  let configToMigrate = config;
  if (isLegacyRAGConfig(config)) {
    configToMigrate = normalizeLegacyRAGConfig(config);
  }

  return migrationEngine.migrateToLatest(configToMigrate);
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
 * Check if a config is a legacy RAGConfig format that needs conversion
 *
 * Legacy RAGConfig has project_id, project_name, screenshots, elements fields
 * instead of the modern metadata, images, workflows, states structure.
 *
 * @param config - Configuration object to check
 * @returns true if config is legacy RAGConfig format
 */
export function isLegacyFormat(config: unknown): boolean {
  return isLegacyRAGConfig(config);
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

/**
 * Preview what migrations would be applied without actually applying them
 *
 * Shows users what will change before migration for transparency and confidence
 *
 * @param config - Configuration object with a version field
 * @returns Preview information including migration steps and estimated changes
 */
export async function previewMigration(config: unknown) {
  return migrationEngine.previewMigration(config);
}

/**
 * Clear the migration cache
 *
 * Useful when migrations are updated or for testing
 */
export function clearMigrationCache(): void {
  migrationEngine.clearCache();
}

/**
 * Enable or disable migration result caching
 *
 * Caching improves performance for repeated imports of the same config
 *
 * @param enabled - true to enable caching, false to disable
 */
export function setMigrationCacheEnabled(enabled: boolean): void {
  migrationEngine.setCacheEnabled(enabled);
}

/**
 * Get migration cache statistics
 *
 * @returns Object with cache size and enabled status
 */
export function getMigrationCacheStats() {
  return migrationEngine.getCacheStats();
}

// Re-export types for convenience
export type {
  Migration,
  MigrationResult,
  MigrationContext,
  MigrationHistoryEntry,
} from "./migration-types";
export { MigrationEngine } from "./migration-engine";
export * from "./version-utils";
