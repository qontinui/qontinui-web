/**
 * RAG Migration Registry
 *
 * Central registry of all available RAG config migrations.
 * Add new migrations here as they are created.
 */

import type { RAGMigration } from "../types";

/**
 * Current version of RAG configurations
 *
 * Update this when creating new migrations.
 */
export const CURRENT_RAG_VERSION = "1.0.0";

/**
 * All registered RAG migrations
 *
 * Migrations are applied sequentially to upgrade configs from old versions.
 * Each migration should be a pure function that transforms config from one version to the next.
 *
 * Example: To add a new migration from 1.0.0 to 1.1.0:
 * 1. Create migrations/v1.0.0-to-v1.1.0.ts
 * 2. Import it here: import { migrationV10ToV11 } from './v1.0.0-to-v1.1.0';
 * 3. Add it to RAG_MIGRATIONS array below
 * 4. Update CURRENT_RAG_VERSION to '1.1.0'
 */
export const RAG_MIGRATIONS: RAGMigration[] = [
  // No migrations yet for v1.0.0 (initial version)
];

/**
 * Get a specific migration by version range
 *
 * @param fromVersion - Source version (e.g., "1.0.0")
 * @param toVersion - Target version (e.g., "1.1.0")
 * @returns Migration if found, undefined otherwise
 */
export function getRagMigration(
  fromVersion: string,
  toVersion: string
): RAGMigration | undefined {
  return RAG_MIGRATIONS.find(
    (m) => m.fromVersion === fromVersion && m.toVersion === toVersion
  );
}
