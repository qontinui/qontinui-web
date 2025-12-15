/**
 * RAG Migration Engine - Core orchestration for RAG config migrations
 *
 * Handles version detection, migration path finding, and sequential migration execution
 */

import type {
  RAGMigration,
  RAGMigrationContext,
  RAGMigrationResult,
  RAGMigrationHistoryEntry,
  RAGConfig,
} from "./types";
import {
  compareVersions,
  isValidVersion,
} from "../config-migration/version-utils";

export class RAGMigrationEngine {
  private migrations: Map<string, RAGMigration> = new Map();
  private currentVersion: string;
  private cache: Map<string, RAGMigrationResult> = new Map();
  private cacheEnabled: boolean = true;

  constructor(currentVersion: string) {
    if (!isValidVersion(currentVersion)) {
      throw new Error(`Invalid current version format: ${currentVersion}`);
    }
    this.currentVersion = currentVersion;
  }

  /**
   * Register a migration for use by the engine
   */
  registerMigration(migration: RAGMigration): void {
    // Validate migration versions
    if (!isValidVersion(migration.fromVersion)) {
      throw new Error(
        `Invalid migration fromVersion: ${migration.fromVersion}`
      );
    }
    if (!isValidVersion(migration.toVersion)) {
      throw new Error(`Invalid migration toVersion: ${migration.toVersion}`);
    }

    const key = `${migration.fromVersion}->${migration.toVersion}`;
    this.migrations.set(key, migration);
  }

  /**
   * Check if a config needs migration to current version
   */
  needsMigration(configVersion: string): boolean {
    if (!isValidVersion(configVersion)) {
      return false; // Invalid versions can't be migrated
    }
    return compareVersions(configVersion, this.currentVersion) < 0;
  }

  /**
   * Migrate a config from its version to the current version
   *
   * Automatically finds the migration path and applies all necessary migrations
   */
  async migrateToLatest(config: RAGConfig): Promise<RAGMigrationResult> {
    const configVersion = config.version;

    // Validate version format
    if (!isValidVersion(configVersion)) {
      return {
        success: false,
        config,
        context: {
          fromVersion: configVersion,
          toVersion: this.currentVersion,
          timestamp: new Date(),
          warnings: [],
          errors: [`Invalid version format: ${configVersion}`],
        },
      };
    }

    // Check if migration is needed
    if (!this.needsMigration(configVersion)) {
      return {
        success: true,
        config,
        context: {
          fromVersion: configVersion,
          toVersion: this.currentVersion,
          timestamp: new Date(),
          warnings:
            configVersion === this.currentVersion
              ? []
              : [
                  `Config version ${configVersion} is newer than current version ${this.currentVersion}`,
                ],
          errors: [],
        },
      };
    }

    // Check cache first
    if (this.cacheEnabled) {
      const cacheKey = this.getCacheKey(config);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return {
          ...cached,
          config: structuredClone(cached.config), // Return clone to prevent mutations
          context: {
            ...cached.context,
            warnings: [
              ...cached.context.warnings,
              "Loaded from migration cache",
            ],
          },
        };
      }
    }

    // Find migration path
    const path = this.findMigrationPath(configVersion, this.currentVersion);

    if (!path) {
      return {
        success: false,
        config,
        context: {
          fromVersion: configVersion,
          toVersion: this.currentVersion,
          timestamp: new Date(),
          warnings: [],
          errors: [
            `No migration path found from version ${configVersion} to ${this.currentVersion}`,
          ],
        },
      };
    }

    // Apply migrations sequentially
    let currentConfig = structuredClone(config); // Deep clone to avoid mutations
    const context: RAGMigrationContext = {
      fromVersion: configVersion,
      toVersion: this.currentVersion,
      timestamp: new Date(),
      warnings: [],
      errors: [],
    };

    // Track if any migration requires re-embedding
    let requiresReembedding = false;

    for (const migration of path) {
      try {
        // Check if migration is applicable
        if (migration.isApplicable && !migration.isApplicable(currentConfig)) {
          context.warnings.push(
            `Migration ${migration.fromVersion}→${migration.toVersion} skipped (not applicable)`
          );
          currentConfig.version = migration.toVersion; // Update version anyway
          continue;
        }

        // Apply migration
        const beforeVersion = currentConfig.version;
        currentConfig = migration.migrate(currentConfig, context);

        // Track if re-embedding is required
        if (migration.requiresReembedding) {
          requiresReembedding = true;
          context.warnings.push(
            `Migration ${migration.fromVersion}→${migration.toVersion} requires re-embedding all elements`
          );
        }

        // Ensure version was updated
        if (!currentConfig.version || currentConfig.version === beforeVersion) {
          currentConfig.version = migration.toVersion;
        }

        // Validate migration result
        if (migration.validate && !migration.validate(currentConfig)) {
          throw new Error("Migration validation failed");
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        context.errors.push(
          `Migration ${migration.fromVersion}→${migration.toVersion} failed: ${errorMessage}`
        );
        return {
          success: false,
          config, // Return original config
          context,
        };
      }
    }

    // Add migration history to metadata
    this.addMigrationHistory(
      currentConfig,
      configVersion,
      path,
      requiresReembedding
    );

    const result: RAGMigrationResult = {
      success: true,
      config: currentConfig,
      context,
      requiresReembedding,
    };

    // Cache successful result
    if (this.cacheEnabled && result.success) {
      const cacheKey = this.getCacheKey(config);
      this.cache.set(cacheKey, structuredClone(result)); // Store clone
    }

    return result;
  }

  /**
   * Find the shortest migration path between two versions using BFS
   */
  private findMigrationPath(from: string, to: string): RAGMigration[] | null {
    // Build adjacency list (graph of version transitions)
    const graph = new Map<string, RAGMigration[]>();

    for (const migration of this.migrations.values()) {
      if (!graph.has(migration.fromVersion)) {
        graph.set(migration.fromVersion, []);
      }
      graph.get(migration.fromVersion)!.push(migration);
    }

    // BFS to find shortest path
    const queue: { version: string; path: RAGMigration[] }[] = [
      { version: from, path: [] },
    ];
    const visited = new Set<string>([from]);

    while (queue.length > 0) {
      const { version, path } = queue.shift()!;

      // Found the target version
      if (version === to) {
        return path;
      }

      // Explore neighbors
      const neighbors = graph.get(version) || [];
      for (const migration of neighbors) {
        if (!visited.has(migration.toVersion)) {
          visited.add(migration.toVersion);
          queue.push({
            version: migration.toVersion,
            path: [...path, migration],
          });
        }
      }
    }

    return null; // No path found
  }

  /**
   * Add migration history entry to config metadata
   */
  private addMigrationHistory(
    config: RAGConfig,
    originalVersion: string,
    path: RAGMigration[],
    requiresReembedding: boolean
  ): void {
    // Ensure metadata exists
    if (!config.metadata) {
      config.metadata = {
        name: "",
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
      };
    }

    // Initialize migration history array
    const metadata = config.metadata as RAGMetadata & {
      migrationHistory?: RAGMigrationHistoryEntry[];
    };
    if (!metadata.migrationHistory) {
      metadata.migrationHistory = [];
    }

    // Create history entry
    const historyEntry: RAGMigrationHistoryEntry = {
      fromVersion: originalVersion,
      toVersion: this.currentVersion,
      date: new Date().toISOString(),
      path: path.map((m) => `${m.fromVersion}→${m.toVersion}`),
      requiresReembedding,
    };

    metadata.migrationHistory.push(historyEntry);
  }

  /**
   * Get all registered migrations
   */
  getMigrations(): RAGMigration[] {
    return Array.from(this.migrations.values());
  }

  /**
   * Get current version
   */
  getCurrentVersion(): string {
    return this.currentVersion;
  }

  /**
   * Check if a migration path requires re-embedding
   */
  getRequiresReembedding(fromVersion: string, toVersion: string): boolean {
    const path = this.findMigrationPath(fromVersion, toVersion);
    if (!path) {
      return false;
    }

    return path.some((migration) => migration.requiresReembedding);
  }

  /**
   * Generate cache key for a config
   * Uses version + content hash for uniqueness
   */
  private getCacheKey(config: RAGConfig): string {
    const version = config.version || "unknown";
    // Simple hash using JSON stringify (fast for small configs)
    // For large configs, could use a proper hash function
    const configStr = JSON.stringify(config);
    const hash = this.simpleHash(configStr);
    return `${version}-${hash}`;
  }

  /**
   * Simple hash function for cache keys
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Clear the migration cache
   * Useful when migrations are updated or for testing
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Enable or disable caching
   */
  setCacheEnabled(enabled: boolean): void {
    this.cacheEnabled = enabled;
    if (!enabled) {
      this.clearCache();
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; enabled: boolean } {
    return {
      size: this.cache.size,
      enabled: this.cacheEnabled,
    };
  }

  /**
   * Preview what migrations would be applied without actually applying them
   * Useful for showing users what will change before migration
   */
  async previewMigration(config: RAGConfig): Promise<{
    needsMigration: boolean;
    currentVersion: string;
    targetVersion: string;
    migrationSteps: Array<{
      from: string;
      to: string;
      description: string;
      requiresReembedding: boolean;
    }>;
    estimatedChanges: string[];
    requiresReembedding: boolean;
  }> {
    const configVersion = config.version;

    // Check if migration is needed
    if (!this.needsMigration(configVersion)) {
      return {
        needsMigration: false,
        currentVersion: configVersion,
        targetVersion: this.currentVersion,
        migrationSteps: [],
        estimatedChanges: [],
        requiresReembedding: false,
      };
    }

    // Find migration path
    const path = this.findMigrationPath(configVersion, this.currentVersion);

    if (!path) {
      return {
        needsMigration: true,
        currentVersion: configVersion,
        targetVersion: this.currentVersion,
        migrationSteps: [],
        estimatedChanges: ["Error: No migration path found"],
        requiresReembedding: false,
      };
    }

    // Build preview information
    const migrationSteps = path.map((migration) => ({
      from: migration.fromVersion,
      to: migration.toVersion,
      description: migration.description,
      requiresReembedding: migration.requiresReembedding || false,
    }));

    // Check if any migration requires re-embedding
    const requiresReembedding = path.some((m) => m.requiresReembedding);

    // Estimate changes by checking isApplicable for each migration
    const estimatedChanges: string[] = [];
    const previewConfig = structuredClone(config);

    for (const migration of path) {
      if (migration.isApplicable && !migration.isApplicable(previewConfig)) {
        estimatedChanges.push(
          `${migration.fromVersion}→${migration.toVersion}: No changes (not applicable)`
        );
      } else {
        let changeDesc = `${migration.fromVersion}→${migration.toVersion}: ${migration.description}`;
        if (migration.requiresReembedding) {
          changeDesc += " [REQUIRES RE-EMBEDDING]";
        }
        estimatedChanges.push(changeDesc);
      }
      // Update version for next check
      previewConfig.version = migration.toVersion;
    }

    return {
      needsMigration: true,
      currentVersion: configVersion,
      targetVersion: this.currentVersion,
      migrationSteps,
      estimatedChanges,
      requiresReembedding,
    };
  }
}

// Type augmentation for RAGMetadata with migrationHistory
interface RAGMetadata {
  name: string;
  description?: string;
  author?: string;
  createdAt: string;
  modifiedAt: string;
  tags?: string[];
  targetApplication?: string;
  migrationHistory?: RAGMigrationHistoryEntry[];
}
