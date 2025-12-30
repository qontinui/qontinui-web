/**
 * Migration: v2.10.0 → v2.11.0
 *
 * Converts categories from string[] to Category[] with automationEnabled flag
 *
 * Key changes:
 * - Categories are now objects with { name: string, automationEnabled: boolean }
 * - Only "Main" category has automationEnabled: true by default
 * - Other categories default to automationEnabled: false
 * - This allows any category to be made available for runner automation
 *
 * Data transformation:
 * - Converts ["Main", "Testing"] to [{ name: "Main", automationEnabled: true }, { name: "Testing", automationEnabled: false }]
 */

import type { Migration, MigrationContext } from "../migration-types";

interface Category {
  name: string;
  automationEnabled: boolean;
}

export const migrationV210ToV211: Migration = {
  fromVersion: "2.10.0",
  toVersion: "2.11.0",
  description:
    "Convert categories from string[] to Category[] with automationEnabled flag",

  migrate(
    config: Record<string, unknown>,
    context: MigrationContext
  ): Record<string, unknown> {
    const migrated = structuredClone(config);

    // Convert categories from string[] to Category[]
    if (migrated.categories && Array.isArray(migrated.categories)) {
      const oldCategories = migrated.categories as unknown[];

      // Check if already in new format (objects with name field)
      if (oldCategories.length > 0 && typeof oldCategories[0] === "string") {
        // Convert from string[] to Category[]
        const newCategories: Category[] = (oldCategories as string[]).map(
          (name) => ({
            name,
            // Only "Main" category has automation enabled by default
            automationEnabled: name.toLowerCase() === "main",
          })
        );

        migrated.categories = newCategories;

        context.warnings.push(
          `Converted ${oldCategories.length} category(ies) to new format with automationEnabled flag. ` +
            'Only "Main" category is enabled for runner automation by default. ' +
            "You can enable other categories for automation in the Workflows panel."
        );
      }
    }

    // Update config version
    migrated.version = "2.11.0";

    return migrated;
  },

  /**
   * This migration is applicable if categories exist and are in old format
   */
  isApplicable(config: Record<string, unknown>): boolean {
    if (config.categories && Array.isArray(config.categories)) {
      const categories = config.categories as unknown[];
      if (categories.length > 0) {
        // Old format is string[], new format is object[]
        return typeof categories[0] === "string";
      }
    }
    return true; // Apply anyway to update version
  },

  /**
   * Validate the migrated config
   * - Ensure categories are in the new format (array of objects with name and automationEnabled)
   */
  validate(migratedConfig: Record<string, unknown>): boolean {
    if (migratedConfig.categories && Array.isArray(migratedConfig.categories)) {
      for (const category of migratedConfig.categories) {
        // Validate category is an object with required fields
        if (typeof category !== "object" || category === null) {
          console.error(
            `Validation failed: Category is not an object: ${JSON.stringify(category)}`
          );
          return false;
        }

        const cat = category as Record<string, unknown>;
        if (typeof cat.name !== "string") {
          console.error(
            `Validation failed: Category missing name field: ${JSON.stringify(category)}`
          );
          return false;
        }

        if (typeof cat.automationEnabled !== "boolean") {
          console.error(
            `Validation failed: Category "${cat.name}" missing automationEnabled field: ${JSON.stringify(category)}`
          );
          return false;
        }
      }
    }

    return true;
  },
};
