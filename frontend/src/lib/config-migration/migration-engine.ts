/**
 * Migration Engine - Core orchestration for config migrations
 *
 * Handles version detection, migration path finding, and sequential migration execution
 */

import type {
  Migration,
  MigrationContext,
  MigrationResult,
  MigrationHistoryEntry,
} from "./migration-types";
import { compareVersions, isValidVersion } from "./version-utils";

export class MigrationEngine {
  private migrations: Map<string, Migration> = new Map();
  private currentVersion: string;
  private cache: Map<string, MigrationResult> = new Map();
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
  registerMigration(migration: Migration): void {
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
  async migrateToLatest(config: unknown): Promise<MigrationResult> {
    const configObj = config as Record<string, unknown>;
    const configVersion = configObj.version as string;

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
    let currentConfig = structuredClone(config) as Record<string, unknown>; // Deep clone to avoid mutations
    const context: MigrationContext = {
      fromVersion: configVersion,
      toVersion: this.currentVersion,
      timestamp: new Date(),
      warnings: [],
      errors: [],
    };

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
        currentConfig = migration.migrate(currentConfig, context) as Record<string, unknown>;

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
    this.addMigrationHistory(currentConfig, configVersion, path);

    const result: MigrationResult = {
      success: true,
      config: currentConfig,
      context,
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
  private findMigrationPath(from: string, to: string): Migration[] | null {
    // Build adjacency list (graph of version transitions)
    const graph = new Map<string, Migration[]>();

    for (const migration of Array.from(this.migrations.values())) {
      if (!graph.has(migration.fromVersion)) {
        graph.set(migration.fromVersion, []);
      }
      graph.get(migration.fromVersion)!.push(migration);
    }

    // BFS to find shortest path
    const queue: { version: string; path: Migration[] }[] = [
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
    config: unknown,
    originalVersion: string,
    path: Migration[]
  ): void {
    const configObj = config as Record<string, unknown>;
    // Ensure metadata exists
    if (!configObj.metadata) {
      configObj.metadata = {};
    }

    const metadata = configObj.metadata as Record<string, unknown>;
    // Initialize migration history array
    if (!metadata.migrationHistory) {
      metadata.migrationHistory = [];
    }

    // Create history entry
    const historyEntry: MigrationHistoryEntry = {
      fromVersion: originalVersion,
      toVersion: this.currentVersion,
      date: new Date().toISOString(),
      path: path.map((m) => `${m.fromVersion}→${m.toVersion}`),
    };

    (metadata.migrationHistory as MigrationHistoryEntry[]).push(historyEntry);
  }

  /**
   * Get all registered migrations
   */
  getMigrations(): Migration[] {
    return Array.from(this.migrations.values());
  }

  /**
   * Get current version
   */
  getCurrentVersion(): string {
    return this.currentVersion;
  }

  /**
   * Generate cache key for a config
   * Uses version + content hash for uniqueness
   */
  private getCacheKey(config: unknown): string {
    const configObj = config as Record<string, unknown>;
    const version = configObj.version || "unknown";
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
  async previewMigration(config: unknown): Promise<{
    needsMigration: boolean;
    currentVersion: string;
    targetVersion: string;
    migrationSteps: Array<{
      from: string;
      to: string;
      description: string;
    }>;
    estimatedChanges: string[];
  }> {
    const configObj = config as Record<string, unknown>;
    const configVersion = configObj.version as string;

    // Check if migration is needed
    if (!this.needsMigration(configVersion)) {
      return {
        needsMigration: false,
        currentVersion: configVersion,
        targetVersion: this.currentVersion,
        migrationSteps: [],
        estimatedChanges: [],
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
      };
    }

    // Build preview information
    const migrationSteps = path.map((migration) => ({
      from: migration.fromVersion,
      to: migration.toVersion,
      description: migration.description,
    }));

    // Estimate changes by checking isApplicable for each migration
    const estimatedChanges: string[] = [];
    const previewConfig = structuredClone(config) as Record<string, unknown>;

    for (const migration of path) {
      if (migration.isApplicable && !migration.isApplicable(previewConfig)) {
        estimatedChanges.push(
          `${migration.fromVersion}→${migration.toVersion}: No changes (not applicable)`
        );
      } else {
        estimatedChanges.push(
          `${migration.fromVersion}→${migration.toVersion}: ${migration.description}`
        );
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
    };
  }
}
