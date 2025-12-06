/**
 * Migration Registry
 *
 * Central registry of all available migrations.
 * Add new migrations here as they are created.
 */

import type { Migration } from "../migration-types";
import { migrationV1ToV2 } from "./v1.0.0-to-v2.0.0";
import { migrationV2ToV201 } from "./v2.0.0-to-v2.0.1";
import { migrationV201ToV21 } from "./v2.0.1-to-v2.1.0";

/**
 * Current version of the application
 *
 * Update this when creating new migrations.
 * This should match the version in export-schema.ts
 */
export const CURRENT_VERSION = "2.1.0";

/**
 * All registered migrations
 *
 * Migrations are applied sequentially to upgrade configs from old versions.
 * Each migration should be a pure function that transforms config from one version to the next.
 *
 * Example: To add a new migration from 2.1.0 to 2.2.0:
 * 1. Create migrations/v2.1.0-to-v2.2.0.ts
 * 2. Import it here: import { migrationV21ToV22 } from './v2.1.0-to-v2.2.0';
 * 3. Add it to ALL_MIGRATIONS array below
 * 4. Update CURRENT_VERSION to '2.2.0'
 */
export const ALL_MIGRATIONS: Migration[] = [
  migrationV1ToV2,
  migrationV2ToV201,
  migrationV201ToV21,
  // Add new migrations here:
  // migrationV21ToV22,
];
