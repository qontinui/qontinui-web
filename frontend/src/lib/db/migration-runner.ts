/**
 * Migration Runner
 *
 * Handles IndexedDB schema migrations with version tracking.
 * Provides a structured way to define and execute migrations.
 */

import { projectLogger } from "@/lib/project-logger";

/**
 * Migration function signature
 */
export type MigrationFn = (
  db: IDBDatabase,
  transaction: IDBTransaction | null
) => void;

/**
 * Migration definition
 */
export interface Migration {
  /** Version this migration upgrades TO */
  version: number;
  /** Description of what this migration does */
  description: string;
  /** Migration function */
  migrate: MigrationFn;
}

/**
 * Migration registry for a database
 */
export interface MigrationRegistry {
  /** Database name */
  dbName: string;
  /** Current target version */
  currentVersion: number;
  /** Registered migrations */
  migrations: Migration[];
}

/**
 * Create a migration registry for a database
 */
export function createMigrationRegistry(
  dbName: string,
  currentVersion: number
): MigrationRegistry {
  return {
    dbName,
    currentVersion,
    migrations: [],
  };
}

/**
 * Register a migration
 */
export function registerMigration(
  registry: MigrationRegistry,
  migration: Migration
): void {
  // Validate version
  if (migration.version <= 0) {
    throw new Error(`Invalid migration version: ${migration.version}`);
  }

  // Check for duplicate versions
  const existing = registry.migrations.find(
    (m) => m.version === migration.version
  );
  if (existing) {
    throw new Error(`Duplicate migration version: ${migration.version}`);
  }

  registry.migrations.push(migration);

  // Sort by version
  registry.migrations.sort((a, b) => a.version - b.version);
}

/**
 * Run migrations for a database upgrade event
 */
export function runMigrations(
  registry: MigrationRegistry,
  db: IDBDatabase,
  oldVersion: number,
  newVersion: number,
  transaction: IDBTransaction | null
): void {
  projectLogger.info("MigrationRunner", "Starting migrations", {
    database: registry.dbName,
    fromVersion: oldVersion,
    toVersion: newVersion,
  });

  // Find and run applicable migrations
  const applicableMigrations = registry.migrations.filter(
    (m) => m.version > oldVersion && m.version <= newVersion
  );

  if (applicableMigrations.length === 0) {
    projectLogger.debug("MigrationRunner", "No migrations to run", {
      database: registry.dbName,
    });
    return;
  }

  for (const migration of applicableMigrations) {
    projectLogger.info("MigrationRunner", "Running migration", {
      database: registry.dbName,
      version: migration.version,
      description: migration.description,
    });

    try {
      migration.migrate(db, transaction);
      projectLogger.info("MigrationRunner", "Migration completed", {
        database: registry.dbName,
        version: migration.version,
      });
    } catch (error) {
      projectLogger.error("MigrationRunner", "Migration failed", {
        database: registry.dbName,
        version: migration.version,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  projectLogger.info("MigrationRunner", "All migrations completed", {
    database: registry.dbName,
    migrationsRun: applicableMigrations.length,
  });
}

// ============================================================================
// Pre-defined migrations for known databases
// ============================================================================

/**
 * Project database migrations
 */
export const projectDBMigrations = createMigrationRegistry(
  "qontinui-project-db",
  3
);

// Migration: Remove legacy "processes" store (renamed to "workflows")
registerMigration(projectDBMigrations, {
  version: 3,
  description: "Remove legacy processes store",
  migrate: (db) => {
    if (db.objectStoreNames.contains("processes")) {
      db.deleteObjectStore("processes");
      projectLogger.info("MigrationRunner", "Deleted processes store");
    }
  },
});

/**
 * Screenshots database migrations
 */
export const screenshotsDBMigrations = createMigrationRegistry(
  "qontinui-screenshots-db",
  3
);

// Migration: Add projectName index
registerMigration(screenshotsDBMigrations, {
  version: 2,
  description: "Add projectName index",
  migrate: (db, transaction) => {
    if (transaction && db.objectStoreNames.contains("screenshots")) {
      const store = transaction.objectStore("screenshots");
      if (!store.indexNames.contains("projectName")) {
        store.createIndex("projectName", "projectName", { unique: false });
      }
    }
  },
});

// Migration: Add s3Key, projectId, urlExpiresAt fields (no schema change needed)
registerMigration(screenshotsDBMigrations, {
  version: 3,
  description: "Add presigned URL refresh fields",
  migrate: () => {
    // No schema changes needed - new optional fields are automatically supported
    projectLogger.debug(
      "MigrationRunner",
      "v3 migration: Added optional fields for URL refresh"
    );
  },
});

/**
 * Page state database migrations
 */
export const pageStateDBMigrations = createMigrationRegistry(
  "qontinui-page-state-db",
  1
);

// Initial schema - no migrations needed yet

/**
 * Get migrations for a database by name
 */
export function getMigrationsForDatabase(
  dbName: string
): MigrationRegistry | null {
  switch (dbName) {
    case "qontinui-project-db":
      return projectDBMigrations;
    case "qontinui-screenshots-db":
      return screenshotsDBMigrations;
    case "qontinui-page-state-db":
      return pageStateDBMigrations;
    default:
      return null;
  }
}

/**
 * Create an upgrade handler that runs registered migrations
 */
export function createUpgradeHandler(
  registry: MigrationRegistry
): (db: IDBDatabase, oldVersion: number, newVersion: number) => void {
  return (db, oldVersion, newVersion) => {
    // Note: In the actual onupgradeneeded event, we'll have the transaction
    // This is just a factory for creating the handler
    runMigrations(registry, db, oldVersion, newVersion, null);
  };
}
