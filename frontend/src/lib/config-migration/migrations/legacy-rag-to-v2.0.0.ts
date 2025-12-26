/**
 * Migration: Legacy RAGConfig → v2.0.0
 *
 * Converts the legacy RAG export format to the modern QontinuiConfig format.
 * This is a breaking change migration - the RAGConfig format is being removed.
 *
 * Key differences:
 * - RAGConfig: project_id, project_name, screenshots[], elements{}, states[]
 * - QontinuiConfig: version, metadata, images[], workflows[], states[], transitions[], categories[]
 *
 * Conversion strategy:
 * - screenshots metadata → converted to placeholder images (no base64 data in RAGConfig)
 * - elements{} → converted to states with stateImages (limited conversion)
 * - project_name → metadata.name
 * - exported_at → metadata.created, metadata.modified
 *
 * IMPORTANT: This is a lossy migration because RAGConfig doesn't contain:
 * - Actual image data (base64) - only metadata
 * - Workflow definitions
 * - Transitions between states
 *
 * After migration, users need to:
 * 1. Re-import screenshots with actual image data
 * 2. Define workflows and transitions
 */

import type { Migration, MigrationContext } from "../migration-types";

/**
 * Legacy RAGConfig types (for reference during migration)
 */
interface LegacyRAGConfig {
  project_id: string;
  project_name: string;
  version: string;
  exported_at: string;
  screenshots: LegacyScreenshotMetadata[];
  elements: Record<string, LegacyElementAnnotation[]>;
  states?: LegacyStateInfo[];
}

interface LegacyScreenshotMetadata {
  id: string;
  filename: string;
  captured_at: string;
  width: number;
  height: number;
  state_id?: string;
}

interface LegacyElementAnnotation {
  id: string;
  label: string;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  element_type?: string;
  metadata?: Record<string, unknown>;
}

interface LegacyStateInfo {
  id: string;
  name: string;
  description?: string;
}

/**
 * Check if a config is a legacy RAGConfig format
 */
export function isLegacyRAGConfig(config: unknown): config is LegacyRAGConfig {
  const cfg = config as Record<string, unknown>;
  return (
    typeof cfg.project_id === "string" &&
    typeof cfg.project_name === "string" &&
    Array.isArray(cfg.screenshots) &&
    typeof cfg.elements === "object" &&
    cfg.elements !== null &&
    // Ensure it's NOT a QontinuiConfig (which has metadata object)
    typeof cfg.metadata !== "object"
  );
}

/**
 * Normalize the legacy RAGConfig to assign a detectable version
 * This is called before migration to ensure the config has a proper version
 */
export function normalizeLegacyRAGConfig(config: unknown): unknown {
  if (!isLegacyRAGConfig(config)) {
    return config;
  }

  // Assign a special version that triggers the legacy migration
  return {
    ...config,
    version: "0.0.0-legacy-rag",
    _originalVersion: (config as LegacyRAGConfig).version,
  };
}

export const migrationLegacyRagToV2: Migration = {
  fromVersion: "0.0.0-legacy-rag",
  toVersion: "2.0.0",
  description:
    "Convert legacy RAGConfig format to QontinuiConfig (breaking change)",

  migrate(config: unknown, context: MigrationContext): unknown {
    const legacyConfig = config as LegacyRAGConfig & {
      _originalVersion?: string;
    };

    context.warnings.push(
      "Converting legacy RAGConfig format to QontinuiConfig"
    );
    context.warnings.push(
      "This is a lossy migration - original image data was not stored in RAGConfig"
    );
    context.warnings.push(
      "You will need to re-import screenshots with actual image data"
    );

    const now = new Date().toISOString();

    // Create the new QontinuiConfig structure
    const migratedConfig: Record<string, unknown> = {
      version: "2.0.0",
      metadata: {
        name: legacyConfig.project_name || "Imported RAG Project",
        description: `Migrated from legacy RAGConfig (original version: ${legacyConfig._originalVersion || legacyConfig.version || "unknown"})`,
        created: legacyConfig.exported_at || now,
        modified: now,
        tags: ["migrated-from-rag"],
        migrationHistory: [
          {
            fromVersion: "0.0.0-legacy-rag",
            toVersion: "2.0.0",
            date: now,
            path: ["0.0.0-legacy-rag→2.0.0"],
          },
        ],
      },
      // Images array - create placeholders for screenshots (no actual data)
      images: createPlaceholderImages(legacyConfig.screenshots, context),
      // Empty workflows - RAGConfig didn't have workflow definitions
      workflows: [],
      // Convert legacy states and elements to new state format
      states: convertToStates(legacyConfig, context),
      // Empty transitions - RAGConfig didn't have transitions
      transitions: [],
      // Empty categories
      categories: [],
    };

    return migratedConfig;
  },

  isApplicable(config: unknown): boolean {
    // Check if this is a legacy RAGConfig that needs migration
    const cfg = config as Record<string, unknown>;
    return cfg.version === "0.0.0-legacy-rag" || isLegacyRAGConfig(config);
  },

  validate(config: unknown): boolean {
    const cfg = config as Record<string, unknown>;
    // Basic validation that the migrated config has required fields
    return (
      cfg.version === "2.0.0" &&
      typeof cfg.metadata === "object" &&
      cfg.metadata !== null &&
      Array.isArray(cfg.images) &&
      Array.isArray(cfg.workflows) &&
      Array.isArray(cfg.states) &&
      Array.isArray(cfg.transitions) &&
      Array.isArray(cfg.categories)
    );
  },
};

/**
 * Create placeholder image entries from screenshot metadata
 * These have width/height but no actual image data
 */
function createPlaceholderImages(
  screenshots: LegacyScreenshotMetadata[] | undefined,
  context: MigrationContext
): Array<{
  id: string;
  name: string;
  data: string;
  format: string;
  width: number;
  height: number;
  _placeholder: boolean;
}> {
  if (!screenshots || screenshots.length === 0) {
    return [];
  }

  context.warnings.push(
    `Creating ${screenshots.length} placeholder images from screenshot metadata`
  );
  context.warnings.push(
    "Placeholder images have no actual data - re-import required"
  );

  return screenshots.map((screenshot) => ({
    id: screenshot.id,
    name: screenshot.filename || `screenshot-${screenshot.id}`,
    data: "", // Empty - no actual data in RAGConfig
    format: "png",
    width: screenshot.width || 0,
    height: screenshot.height || 0,
    _placeholder: true, // Mark as placeholder for UI to show warning
  }));
}

/**
 * Convert legacy states and elements to new State format
 */
function convertToStates(
  legacyConfig: LegacyRAGConfig,
  context: MigrationContext
): Array<{
  id: string;
  name: string;
  description?: string;
  stateImages: Array<{
    id: string;
    name: string;
    patterns: Array<{
      id: string;
      name: string;
      imageId: string;
      fixed: boolean;
    }>;
    shared: boolean;
  }>;
  position: { x: number; y: number };
}> {
  const states: Array<{
    id: string;
    name: string;
    description?: string;
    stateImages: Array<{
      id: string;
      name: string;
      patterns: Array<{
        id: string;
        name: string;
        imageId: string;
        fixed: boolean;
      }>;
      shared: boolean;
    }>;
    position: { x: number; y: number };
  }> = [];

  // If legacy states exist, use them as base
  if (legacyConfig.states && legacyConfig.states.length > 0) {
    let positionIndex = 0;
    for (const legacyState of legacyConfig.states) {
      const stateImages: Array<{
        id: string;
        name: string;
        patterns: Array<{
          id: string;
          name: string;
          imageId: string;
          fixed: boolean;
        }>;
        shared: boolean;
      }> = [];

      // Find screenshots associated with this state
      const associatedScreenshots =
        legacyConfig.screenshots?.filter(
          (s) => s.state_id === legacyState.id
        ) || [];

      for (const screenshot of associatedScreenshots) {
        // Get elements for this screenshot
        const elements = legacyConfig.elements[screenshot.id] || [];

        // Create a stateImage for each element
        for (const element of elements) {
          stateImages.push({
            id: `si-${element.id}`,
            name: element.label,
            patterns: [
              {
                id: `pattern-${element.id}`,
                name: element.label,
                imageId: screenshot.id, // Reference the placeholder image
                fixed: false,
              },
            ],
            shared: false,
          });
        }
      }

      states.push({
        id: legacyState.id,
        name: legacyState.name,
        description: legacyState.description,
        stateImages,
        position: {
          x: 100 + (positionIndex % 4) * 300,
          y: 100 + Math.floor(positionIndex / 4) * 200,
        },
      });
      positionIndex++;
    }
  } else if (legacyConfig.screenshots && legacyConfig.screenshots.length > 0) {
    // No legacy states - create states from screenshots
    context.warnings.push(
      "No states found in legacy config - creating states from screenshots"
    );

    let positionIndex = 0;
    for (const screenshot of legacyConfig.screenshots) {
      const elements = legacyConfig.elements[screenshot.id] || [];

      const stateImages: Array<{
        id: string;
        name: string;
        patterns: Array<{
          id: string;
          name: string;
          imageId: string;
          fixed: boolean;
        }>;
        shared: boolean;
      }> = [];

      // Create stateImages from elements
      for (const element of elements) {
        stateImages.push({
          id: `si-${element.id}`,
          name: element.label,
          patterns: [
            {
              id: `pattern-${element.id}`,
              name: element.label,
              imageId: screenshot.id,
              fixed: false,
            },
          ],
          shared: false,
        });
      }

      // Create a state for each screenshot
      states.push({
        id: `state-${screenshot.id}`,
        name: screenshot.filename || `State ${positionIndex + 1}`,
        description: `Imported from screenshot: ${screenshot.filename}`,
        stateImages,
        position: {
          x: 100 + (positionIndex % 4) * 300,
          y: 100 + Math.floor(positionIndex / 4) * 200,
        },
      });
      positionIndex++;
    }
  }

  if (states.length > 0) {
    context.warnings.push(`Created ${states.length} states from legacy data`);
  }

  return states;
}
