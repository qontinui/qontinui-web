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
    const migrated = structuredClone(config);

    let statesNormalized = 0;
    let transitionsNormalized = 0;

    // Normalize state positions
    if (migrated.states && Array.isArray(migrated.states)) {
      for (const state of migrated.states) {
        if (state.position) {
          const oldX = state.position.x;
          const oldY = state.position.y;

          if (typeof oldX === "number" && !Number.isInteger(oldX)) {
            state.position.x = Math.round(oldX);
            statesNormalized++;
          }
          if (typeof oldY === "number" && !Number.isInteger(oldY)) {
            state.position.y = Math.round(oldY);
            if (statesNormalized === 0) statesNormalized++;
          }
        }
      }
    }

    // Normalize transition positions (if they have position data)
    if (migrated.transitions && Array.isArray(migrated.transitions)) {
      for (const transition of migrated.transitions) {
        if (transition.position) {
          const oldX = transition.position.x;
          const oldY = transition.position.y;

          if (typeof oldX === "number" && !Number.isInteger(oldX)) {
            transition.position.x = Math.round(oldX);
            transitionsNormalized++;
          }
          if (typeof oldY === "number" && !Number.isInteger(oldY)) {
            transition.position.y = Math.round(oldY);
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
    // Check state positions
    if (migratedConfig.states && Array.isArray(migratedConfig.states)) {
      for (const state of migratedConfig.states) {
        if (state.position) {
          if (
            typeof state.position.x === "number" &&
            !Number.isInteger(state.position.x)
          ) {
            console.error(
              `Validation failed: State "${state.name || state.id}" has non-integer x position`
            );
            return false;
          }
          if (
            typeof state.position.y === "number" &&
            !Number.isInteger(state.position.y)
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
      migratedConfig.transitions &&
      Array.isArray(migratedConfig.transitions)
    ) {
      for (const transition of migratedConfig.transitions) {
        if (transition.position) {
          if (
            typeof transition.position.x === "number" &&
            !Number.isInteger(transition.position.x)
          ) {
            console.error(
              `Validation failed: Transition "${transition.id}" has non-integer x position`
            );
            return false;
          }
          if (
            typeof transition.position.y === "number" &&
            !Number.isInteger(transition.position.y)
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
