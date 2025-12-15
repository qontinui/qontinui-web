/**
 * Configuration Migration System - Type Definitions
 *
 * Provides type-safe migration infrastructure for evolving JSON config formats
 */

/**
 * Context passed through migration pipeline
 * Accumulates warnings and errors during migration
 */
export interface MigrationContext {
  fromVersion: string;
  toVersion: string;
  timestamp: Date;
  warnings: string[];
  errors: string[];
}

/**
 * Result returned from migration operations
 */
export interface MigrationResult {
  config: unknown; // Transformed configuration
  context: MigrationContext;
  success: boolean;
}

/**
 * History entry added to config metadata
 */
export interface MigrationHistoryEntry {
  fromVersion: string;
  toVersion: string;
  date: string; // ISO 8601 timestamp
  path: string[]; // Array of version transitions, e.g., ["1.0.0→2.0.0", "2.0.0→2.1.0"]
}

/**
 * Definition of a single version-to-version migration
 *
 * Each migration is a pure function that transforms a config
 * from one version to the next version.
 */
export interface Migration {
  /** Source version (e.g., "2.0.0") */
  fromVersion: string;

  /** Target version (e.g., "2.1.0") */
  toVersion: string;

  /** Human-readable description of changes */
  description: string;

  /**
   * Transform config from fromVersion to toVersion
   * Should not mutate input config
   */
  migrate(config: unknown, context: MigrationContext): unknown;

  /**
   * Optional: Check if this migration needs to run
   * Returns true if the config has elements that need migration
   */
  isApplicable?(config: unknown): boolean;

  /**
   * Optional: Validate that migration was successful
   * Returns true if the migrated config is valid
   */
  validate?(config: unknown): boolean;
}
