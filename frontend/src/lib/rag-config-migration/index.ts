/**
 * RAG Configuration Migration System - Public API
 *
 * Provides backward compatibility for historical RAG config formats.
 * Automatically migrates configs from older versions to the current version.
 *
 * Usage:
 *   import { migrateRAGConfigToLatest, needsRAGMigration } from './rag-config-migration';
 *
 *   if (needsRAGMigration(config.version)) {
 *     const result = await migrateRAGConfigToLatest(config);
 *     if (result.success) {
 *       config = result.config;
 *       if (result.requiresReembedding) {
 *         // Prompt user to re-embed all elements
 *       }
 *     }
 *   }
 */

import { RAGMigrationEngine } from "./migration-engine";
import { RAG_MIGRATIONS, CURRENT_RAG_VERSION } from "./migrations";
import type { RAGConfig } from "./types";

// Initialize global RAG migration engine
const ragMigrationEngine = new RAGMigrationEngine(CURRENT_RAG_VERSION);

// Register all migrations
for (const migration of RAG_MIGRATIONS) {
  ragMigrationEngine.registerMigration(migration);
}

/**
 * Migrate a RAG config to the latest version
 *
 * Automatically finds the migration path and applies all necessary migrations sequentially.
 *
 * @param config - RAG configuration object with a version field
 * @returns Migration result with transformed config, warnings, and errors
 */
export async function migrateRAGConfigToLatest(config: RAGConfig) {
  return ragMigrationEngine.migrateToLatest(config);
}

/**
 * Check if a RAG config needs migration
 *
 * @param configVersion - Version string from config (e.g., "1.0.0")
 * @returns true if config version is older than current version
 */
export function needsRAGMigration(configVersion: string): boolean {
  return ragMigrationEngine.needsMigration(configVersion);
}

/**
 * Check if migration from one version to another requires re-embedding
 *
 * @param fromVersion - Source version (e.g., "1.0.0")
 * @param toVersion - Target version (e.g., "2.0.0")
 * @returns true if any migration in the path requires re-embedding
 */
export function requiresReembedding(
  fromVersion: string,
  toVersion: string
): boolean {
  return ragMigrationEngine.getRequiresReembedding(fromVersion, toVersion);
}

/**
 * Get the current version of RAG configurations
 *
 * @returns Current version string (e.g., "1.0.0")
 */
export function getCurrentRAGVersion(): string {
  return CURRENT_RAG_VERSION;
}

/**
 * Get all registered RAG migrations
 *
 * Useful for debugging and documentation
 */
export function getAllRAGMigrations() {
  return ragMigrationEngine.getMigrations();
}

/**
 * Preview what migrations would be applied without actually applying them
 *
 * Shows users what will change before migration for transparency and confidence
 *
 * @param config - RAG configuration object with a version field
 * @returns Preview information including migration steps and estimated changes
 */
export async function previewRAGMigration(config: RAGConfig) {
  return ragMigrationEngine.previewMigration(config);
}

/**
 * Clear the RAG migration cache
 *
 * Useful when migrations are updated or for testing
 */
export function clearRAGMigrationCache(): void {
  ragMigrationEngine.clearCache();
}

/**
 * Enable or disable RAG migration result caching
 *
 * Caching improves performance for repeated imports of the same config
 *
 * @param enabled - true to enable caching, false to disable
 */
export function setRAGMigrationCacheEnabled(enabled: boolean): void {
  ragMigrationEngine.setCacheEnabled(enabled);
}

/**
 * Get RAG migration cache statistics
 *
 * @returns Object with cache size and enabled status
 */
export function getRAGMigrationCacheStats() {
  return ragMigrationEngine.getCacheStats();
}

// Re-export types for convenience
export type {
  RAGConfig,
  RAGMigration,
  RAGMigrationResult,
  RAGMigrationContext,
  RAGMigrationHistoryEntry,
  RAGElement,
  RAGState,
  RAGWorkflow,
  RAGTransition,
  RAGMetadata,
  EmbeddingConfig,
  BoundingBox,
  ScreenshotInfo,
  VectorDBInfo,
} from "./types";

export { RAGMigrationEngine } from "./migration-engine";
export { CURRENT_RAG_VERSION } from "./types";

// Re-export validators
export {
  validateRAGConfig,
  validateRAGElement,
  validateEmbeddingConfig,
  validateRAGConfigComprehensive,
  validateStateReferences,
  validateWorkflowReferences,
  validateElementReferences,
  isValidVersionFormat,
} from "./validators";
export type { ValidationResult } from "./validators";
