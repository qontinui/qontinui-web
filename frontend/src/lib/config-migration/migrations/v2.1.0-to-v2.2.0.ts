/**
 * Migration: v2.1.0 → v2.2.0
 *
 * Normalizes state position coordinates to integers
 *
 * Key changes:
 * - Rounds state position.x and position.y to integers
 * - Rounds transition position.x and position.y to integers (if present)
 */

import type { Migration, MigrationContext } from "../migration-types";

export const migrationV21ToV22: Migration = {
  fromVersion: "2.1.0",
  toVersion: "2.2.0",
  description: "Normalize state and transition positions to integers",

  migrate(config: unknown, context: MigrationContext): unknown {
    const migrated = structuredClone(config) as Record<string, unknown>;

    let statesNormalized = 0;
    let transitionsNormalized = 0;

    // Normalize state positions
    if (migrated.states && Array.isArray(migrated.states)) {
      for (const state of migrated.states as Array<Record<string, unknown>>) {
        if (state.position) {
          const position = state.position as Record<string, unknown>;
          const oldX = position.x;
          const oldY = position.y;

          if (typeof oldX === "number" && !Number.isInteger(oldX)) {
            position.x = Math.round(oldX);
            statesNormalized++;
          }
          if (typeof oldY === "number" && !Number.isInteger(oldY)) {
            position.y = Math.round(oldY);
            if (statesNormalized === 0) statesNormalized++;
          }
        }
      }
    }

    // Normalize transition positions (if they have position data)
    if (migrated.transitions && Array.isArray(migrated.transitions)) {
      for (const transition of migrated.transitions as Array<Record<string, unknown>>) {
        if (transition.position) {
          const position = transition.position as Record<string, unknown>;
          const oldX = position.x;
          const oldY = position.y;

          if (typeof oldX === "number" && !Number.isInteger(oldX)) {
            position.x = Math.round(oldX);
            transitionsNormalized++;
          }
          if (typeof oldY === "number" && !Number.isInteger(oldY)) {
            position.y = Math.round(oldY);
            if (transitionsNormalized === 0) transitionsNormalized++;
          }
        }
      }
    }

    // Add context warnings if normalizations occurred
    if (statesNormalized > 0) {
      context.warnings.push(
        `Normalized ${statesNormalized} state position(s) from float to integer coordinates`
      );
    }
    if (transitionsNormalized > 0) {
      context.warnings.push(
        `Normalized ${transitionsNormalized} transition position(s) from float to integer coordinates`
      );
    }

    // Update config version
    migrated.version = "2.2.0";

    return migrated;
  },

  /**
   * This migration is always applicable - it normalizes positions even if they're already integers
   * (in which case it's a no-op for those values)
   */
  isApplicable(_config: unknown): boolean {
    return true;
  },

  /**
   * Validate the migrated config - ensure all positions are integers
   */
  validate(migratedConfig: unknown): boolean {
    const configObj = migratedConfig as Record<string, unknown>;
    // Check state positions
    if (configObj.states && Array.isArray(configObj.states)) {
      for (const state of configObj.states as Array<Record<string, unknown>>) {
        if (state.position) {
          const position = state.position as Record<string, unknown>;
          if (
            typeof position.x === "number" &&
            !Number.isInteger(position.x)
          ) {
            console.error(
              `Validation failed: State "${state.name || state.id}" has non-integer x position`
            );
            return false;
          }
          if (
            typeof position.y === "number" &&
            !Number.isInteger(position.y)
          ) {
            console.error(
              `Validation failed: State "${state.name || state.id}" has non-integer y position`
            );
            return false;
          }
        }
      }
    }

    // Check transition positions
    if (
      configObj.transitions &&
      Array.isArray(configObj.transitions)
    ) {
      for (const transition of configObj.transitions as Array<Record<string, unknown>>) {
        if (transition.position) {
          const position = transition.position as Record<string, unknown>;
          if (
            typeof position.x === "number" &&
            !Number.isInteger(position.x)
          ) {
            console.error(
              `Validation failed: Transition "${transition.id}" has non-integer x position`
            );
            return false;
          }
          if (
            typeof position.y === "number" &&
            !Number.isInteger(position.y)
          ) {
            console.error(
              `Validation failed: Transition "${transition.id}" has non-integer y position`
            );
            return false;
          }
        }
      }
    }

    return true;
  },
};
