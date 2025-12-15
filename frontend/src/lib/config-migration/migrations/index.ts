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
import { migrationV21ToV22 } from "./v2.1.0-to-v2.2.0";
import { migrationV22ToV23 } from "./v2.2.0-to-v2.3.0";
import { migrationV23ToV24 } from "./v2.3.0-to-v2.4.0";
import { migrationV24ToV25 } from "./v2.4.0-to-v2.5.0";
import { migrationV25ToV26 } from "./v2.5.0-to-v2.6.0";
import { migrationV26ToV27 } from "./v2.6.0-to-v2.7.0";
import { migrationV27ToV28 } from "./v2.7.0-to-v2.8.0";
import { migrationV28ToV29 } from "./v2.8.0-to-v2.9.0";

/**
 * Current version of the application
 *
 * Update this when creating new migrations.
 * This should match the version in export-schema.ts
 */
export const CURRENT_VERSION = "2.9.0";

/**
 * All registered migrations
 *
 * Migrations are applied sequentially to upgrade configs from old versions.
 * Each migration should be a pure function that transforms config from one version to the next.
 *
 * Example: To add a new migration from 2.3.0 to 2.4.0:
 * 1. Create migrations/v2.3.0-to-v2.4.0.ts
 * 2. Import it here: import { migrationV23ToV24 } from './v2.3.0-to-v2.4.0';
 * 3. Add it to ALL_MIGRATIONS array below
 * 4. Update CURRENT_VERSION to '2.4.0'
 */
export const ALL_MIGRATIONS: Migration[] = [
  migrationV1ToV2,
  migrationV2ToV201,
  migrationV201ToV21,
  migrationV21ToV22,
  migrationV22ToV23,
  migrationV23ToV24,
  migrationV24ToV25,
  migrationV25ToV26,
  migrationV26ToV27,
  migrationV27ToV28,
  migrationV28ToV29,
];
