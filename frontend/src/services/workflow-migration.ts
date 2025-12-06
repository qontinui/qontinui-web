/**
 * Workflow Migration System
 *
 * Handles version migration for workflows:
 * - Detect workflow version
 * - Migrate from old formats to current format
 * - Handle breaking changes gracefully
 * - Preserve data where possible
 * - Log migration warnings
 * - Support dry-run mode
 */

import type {
  Workflow,
} from "../lib/action-schema/action-types";

// ============================================================================
// Types
// ============================================================================

export interface MigrationResult {
  success: boolean;
  workflow?: Workflow;
  warnings: string[];
  errors: string[];
  migratedFrom?: string;
  migratedTo?: string;
}

export interface MigrationOptions {
  dryRun?: boolean;
  preserveUnknown?: boolean;
  strict?: boolean;
}

// ============================================================================
// Version Detection
// ============================================================================

/**
 * Detect workflow version from data
 */
export function detectWorkflowVersion(data: any): string {
  // Check explicit version field
  if (data.version) {
    return data.version;
  }

  // Detect by structure
  if (data.format === "graph" && data.connections) {
    return "1.0.0"; // Current format
  }

  if (data.format === "sequential" || (!data.format && data.actions)) {
    return "0.9.0"; // Legacy sequential format
  }

  if (data.nodes && data.edges) {
    return "0.5.0"; // Very old node/edge format
  }

  // Default to current version if unknown
  return "1.0.0";
}

/**
 * Compare versions
 * Returns: -1 if v1 < v2, 0 if equal, 1 if v1 > v2
 */
export function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split(".").map(Number);
  const parts2 = v2.split(".").map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;

    if (p1 < p2) return -1;
    if (p1 > p2) return 1;
  }

  return 0;
}

/**
 * Check if migration is needed
 */
export function needsMigration(
  currentVersion: string,
  targetVersion: string
): boolean {
  return compareVersions(currentVersion, targetVersion) < 0;
}

// ============================================================================
// Main Migration Function
// ============================================================================

const CURRENT_VERSION = "1.0.0";

/**
 * Migrate workflow from one version to another
 */
export function migrateWorkflow(
  data: any,
  fromVersion: string,
  toVersion: string = CURRENT_VERSION,
  options: MigrationOptions = {}
): Workflow {
  const { preserveUnknown = true, strict = false } = options;

  const warnings: string[] = [];
  const errors: string[] = [];

  // No migration needed
  if (compareVersions(fromVersion, toVersion) === 0) {
    return data as Workflow;
  }

  // Chain migrations
  let current = data;
  const migrations = getMigrationPath(fromVersion, toVersion);

  for (const migration of migrations) {
    try {
      current = migration(current, {
        warnings,
        errors,
        preserveUnknown,
        strict,
      });
    } catch (error) {
      errors.push(
        `Migration failed at ${migration.name}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      throw new Error(`Migration failed: ${errors.join(", ")}`);
    }
  }

  // Add migration metadata
  const result = {
    ...current,
    version: toVersion,
    metadata: {
      ...current.metadata,
      migratedFrom: fromVersion,
      migratedTo: toVersion,
      migrationDate: new Date().toISOString(),
      migrationWarnings: warnings,
    },
  } as Workflow;

  return result;
}

// ============================================================================
// Migration Path
// ============================================================================

type MigrationFunction = (
  data: any,
  context: {
    warnings: string[];
    errors: string[];
    preserveUnknown: boolean;
    strict: boolean;
  }
) => any;

/**
 * Get the migration path from one version to another
 */
function getMigrationPath(from: string, to: string): MigrationFunction[] {
  const migrations: MigrationFunction[] = [];

  // v0.5.0 -> v0.9.0: node/edge format to sequential format
  if (
    compareVersions(from, "0.5.0") <= 0 &&
    compareVersions(to, "0.9.0") >= 0
  ) {
    migrations.push(migrateV05ToV09);
  }

  // v0.9.0 -> v1.0.0: sequential format to graph format
  if (
    compareVersions(from, "0.9.0") <= 0 &&
    compareVersions(to, "1.0.0") >= 0
  ) {
    migrations.push(migrateV09ToV10);
  }

  return migrations;
}

// ============================================================================
// Migration Functions
// ============================================================================

/**
 * Migrate from v0.5.0 (node/edge format) to v0.9.0 (sequential format)
 */
function migrateV05ToV09(
  data: any,
  context: {
    warnings: string[];
    errors: string[];
    preserveUnknown: boolean;
    strict: boolean;
  }
): any {
  const { warnings } = context;

  warnings.push("Migrating from node/edge format to sequential format");

  const workflow: any = {
    id: data.id || `workflow-${Date.now()}`,
    name: data.name || "Untitled Workflow",
    version: "0.9.0",
    format: "sequential",
    actions: [],
    metadata: data.metadata || {},
  };

  // Convert nodes to actions
  if (data.nodes && Array.isArray(data.nodes)) {
    workflow.actions = data.nodes.map((node: any, index: number) => ({
      id: node.id || `action-${index}`,
      type: node.type,
      name: node.name,
      config: node.config || node.data || {},
      base: node.base,
      execution: node.execution,
    }));
  }

  warnings.push(`Converted ${workflow.actions.length} nodes to actions`);
  warnings.push(
    "Note: Edge information was discarded (not supported in sequential format)"
  );

  return workflow;
}

/**
 * Migrate from v0.9.0 (sequential format) to v1.0.0 (graph format)
 */
function migrateV09ToV10(
  data: any,
  context: {
    warnings: string[];
    errors: string[];
    preserveUnknown: boolean;
    strict: boolean;
  }
): any {
  const { warnings } = context;

  warnings.push("Migrating from sequential format to graph format");

  const workflow: Workflow = {
    id: data.id || `workflow-${Date.now()}`,
    name: data.name || "Untitled Workflow",
    version: "1.0.0",
    format: "graph",
    actions: [],
    connections: {},
    variables: data.variables,
    settings: data.settings,
    metadata: data.metadata || {},
    tags: data.tags,
  };

  // Convert actions and add positions
  if (data.actions && Array.isArray(data.actions)) {
    workflow.actions = data.actions.map((action: any, index: number) => {
      const x = 100 + (index % 4) * 300;
      const y = 100 + Math.floor(index / 4) * 200;

      return {
        ...action,
        position: [x, y] as [number, number],
      };
    });

    // Create sequential connections
    for (let i = 0; i < workflow.actions.length - 1; i++) {
      const currentAction = workflow.actions[i];
      const nextAction = workflow.actions[i + 1];

      if (currentAction?.id && nextAction?.id) {
        workflow.connections[currentAction.id] = {
          main: [[{ action: nextAction.id, type: "main", index: 0 }]],
        };
      }
    }

    warnings.push(
      `Converted ${workflow.actions.length} sequential actions to graph format`
    );
    warnings.push("Created linear connections between actions");
  }

  return workflow;
}

// ============================================================================
// Migration Utilities
// ============================================================================

/**
 * Dry-run migration to check for issues
 */
export function dryRunMigration(
  data: any,
  fromVersion: string,
  toVersion: string = CURRENT_VERSION
): MigrationResult {
  try {
    const warnings: string[] = [];
    const errors: string[] = [];

    const workflow = migrateWorkflow(data, fromVersion, toVersion, {
      dryRun: true,
      preserveUnknown: true,
      strict: false,
    });

    return {
      success: errors.length === 0,
      workflow,
      warnings,
      errors,
      migratedFrom: fromVersion,
      migratedTo: toVersion,
    };
  } catch (error) {
    return {
      success: false,
      warnings: [],
      errors: [error instanceof Error ? error.message : "Unknown error"],
    };
  }
}

/**
 * Get migration summary
 */
export function getMigrationSummary(from: string, to: string): string[] {
  const summary: string[] = [];

  if (compareVersions(from, to) === 0) {
    summary.push("No migration needed - versions are the same");
    return summary;
  }

  // v0.5.0 -> v0.9.0
  if (
    compareVersions(from, "0.5.0") <= 0 &&
    compareVersions(to, "0.9.0") >= 0
  ) {
    summary.push("v0.5.0 -> v0.9.0:");
    summary.push("  - Convert node/edge format to sequential format");
    summary.push("  - Edge information will be discarded");
    summary.push("  - Actions will be executed in array order");
  }

  // v0.9.0 -> v1.0.0
  if (
    compareVersions(from, "0.9.0") <= 0 &&
    compareVersions(to, "1.0.0") >= 0
  ) {
    summary.push("v0.9.0 -> v1.0.0:");
    summary.push("  - Convert sequential format to graph format");
    summary.push("  - Add positions to all actions");
    summary.push("  - Create linear connections between sequential actions");
    summary.push("  - Enable non-linear workflow capabilities");
  }

  return summary;
}

/**
 * Check if version is supported
 */
export function isSupportedVersion(version: string): boolean {
  const supportedVersions = ["0.5.0", "0.9.0", "1.0.0"];
  return supportedVersions.includes(version);
}

/**
 * Get latest supported version
 */
export function getLatestVersion(): string {
  return CURRENT_VERSION;
}

/**
 * Validate migration path exists
 */
export function canMigrate(from: string, to: string): boolean {
  if (compareVersions(from, to) === 0) {
    return true; // No migration needed
  }

  if (compareVersions(from, to) > 0) {
    return false; // Cannot downgrade
  }

  const path = getMigrationPath(from, to);
  return path.length > 0;
}

// ============================================================================
// Backup & Restore
// ============================================================================

/**
 * Create backup of workflow before migration
 */
export function backupWorkflow(workflow: any): string {
  const backup = {
    workflow,
    timestamp: new Date().toISOString(),
    version: detectWorkflowVersion(workflow),
  };

  const key = `workflow-backup:${workflow.id || Date.now()}:${Date.now()}`;
  localStorage.setItem(key, JSON.stringify(backup));

  return key;
}

/**
 * Restore workflow from backup
 */
export function restoreWorkflow(backupKey: string): any {
  const backup = localStorage.getItem(backupKey);
  if (!backup) {
    throw new Error("Backup not found");
  }

  const data = JSON.parse(backup);
  return data.workflow;
}

/**
 * List all workflow backups
 */
export function listBackups(): Array<{
  key: string;
  timestamp: string;
  version: string;
}> {
  const backups: Array<{ key: string; timestamp: string; version: string }> =
    [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith("workflow-backup:")) {
      try {
        const backup = JSON.parse(localStorage.getItem(key)!);
        backups.push({
          key,
          timestamp: backup.timestamp,
          version: backup.version,
        });
      } catch (e) {
        // Skip invalid backups
      }
    }
  }

  return backups.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/**
 * Clear old backups (keep last N)
 */
export function clearOldBackups(keepCount = 5): number {
  const backups = listBackups();
  const toDelete = backups.slice(keepCount);

  toDelete.forEach((backup) => {
    localStorage.removeItem(backup.key);
  });

  return toDelete.length;
}
