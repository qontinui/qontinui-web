import {
  QontinuiConfig,
  ImageAsset as ExportImageAsset,
  Workflow as ExportWorkflow,
  State as ExportState,
  Transition as ExportTransition,
  Action as ExportAction,
} from "./export-schema";
import { Workflow, Action } from "./action-schema";
import { migrateConfigToLatest, needsMigration } from "./config-migration";
import { CURRENT_VERSION } from "./config-migration/migrations";

// Type guards for runtime validation
function isQontinuiConfig(value: unknown): value is QontinuiConfig {
  if (!value || typeof value !== "object") return false;
  const config = value as Partial<QontinuiConfig>;
  return (
    typeof config.version === "string" &&
    typeof config.metadata === "object" &&
    Array.isArray(config.images) &&
    Array.isArray(config.workflows) &&
    Array.isArray(config.states) &&
    Array.isArray(config.transitions)
  );
}

function isExportAction(value: unknown): value is ExportAction {
  if (!value || typeof value !== "object") return false;
  const action = value as Partial<ExportAction>;
  return (
    typeof action.id === "string" &&
    typeof action.type === "string" &&
    typeof action.config === "object"
  );
}

function isExportState(value: unknown): value is ExportState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<ExportState>;
  return (
    typeof state.id === "string" &&
    typeof state.name === "string" &&
    Array.isArray(state.stateImages)
  );
}

function isExportTransition(value: unknown): value is ExportTransition {
  if (!value || typeof value !== "object") return false;
  const transition = value as Partial<ExportTransition>;
  return (
    typeof transition.id === "string" &&
    (transition.type === "OutgoingTransition" ||
      transition.type === "IncomingTransition") &&
    Array.isArray(transition.workflows)
  );
}

// Types that match the automation context
interface ImageAsset {
  id: string;
  name: string;
  url: string;
  size: number;
  uploadedAt: Date;
  usageCount: number;
  usedIn: Array<{ type: "workflow" | "state"; id: string; name: string }>;
}

interface State {
  id: string;
  name: string;
  description: string;
  initial?: boolean;
  stateImages: Array<{ image: string; threshold: number }>;
  position: { x: number; y: number };
}

interface Transition {
  id: string;
  type: "OutgoingTransition" | "IncomingTransition";
  workflows: string[];
  timeout: number;
  retryCount: number;
  [key: string]: unknown;
}

export interface ImportResult {
  success: boolean;
  name?: string; // Project name from config metadata
  images: ImageAsset[];
  workflows: Workflow[];
  states: State[];
  transitions: Transition[];
  categories?: string[]; // Workflow categories
  settings?: unknown; // QontinuiConfig.settings
  errors: string[];
  warnings: string[];
  isUserImport?: boolean; // Flag to indicate this is a user-initiated import (bypass timestamp checks)
}

export class ConfigImporter {
  private readonly SUPPORTED_VERSION = CURRENT_VERSION;

  /**
   * Import a Qontinui configuration from JSON
   */
  async importConfiguration(
    configJson: string | QontinuiConfig | unknown
  ): Promise<ImportResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Parse JSON if string
      let config: unknown =
        typeof configJson === "string" ? JSON.parse(configJson) : configJson;

      // Validate basic structure before migration
      if (!isQontinuiConfig(config)) {
        throw new Error(
          "Invalid configuration format. Missing required fields (version, metadata, images, workflows, states, transitions)."
        );
      }

      // Migrate config if needed
      if (needsMigration(config.version)) {
        const migrationResult = await migrateConfigToLatest(config);

        if (!migrationResult.success) {
          // Migration failed - return errors
          errors.push(...migrationResult.context.errors);
          return {
            success: false,
            images: [],
            workflows: [],
            states: [],
            transitions: [],
            settings: undefined,
            errors,
            warnings,
          };
        }

        // Migration succeeded - use migrated config and collect warnings
        const migratedConfig = migrationResult.config;

        // Validate migrated config
        if (!isQontinuiConfig(migratedConfig)) {
          throw new Error("Migration produced invalid configuration");
        }

        config = migratedConfig;
        warnings.push(...migrationResult.context.warnings);

        // Add migration summary
        warnings.push(
          `Configuration migrated from v${migrationResult.context.fromVersion} to v${migrationResult.context.toVersion}`
        );
      }

      // After migration and validation, we can safely cast to QontinuiConfig
      const validatedConfig = config as QontinuiConfig;

      // Validate version
      if (validatedConfig.version !== this.SUPPORTED_VERSION) {
        throw new Error(
          `Unsupported configuration version: ${validatedConfig.version}. Only version ${this.SUPPORTED_VERSION} is supported.`
        );
      }

      // Import components
      const images = await this.importImages(validatedConfig.images);
      const workflows = this.importWorkflows(validatedConfig.workflows);
      const states = this.importStates(validatedConfig.states, images);
      const transitions = this.importTransitions(validatedConfig.transitions);

      // Validate references
      this.validateReferences(states, workflows, transitions, errors);

      return {
        success: errors.length === 0,
        name: validatedConfig.metadata?.name, // Pass through project name for loadConfiguration
        images,
        workflows,
        states,
        transitions,
        categories: validatedConfig.categories || [], // Pass through categories
        settings: validatedConfig.settings, // Pass through settings for backend to apply
        errors,
        warnings,
        isUserImport: true, // Mark as user-initiated import
      };
    } catch (error) {
      errors.push(
        `Import failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      return {
        success: false,
        images: [],
        workflows: [],
        states: [],
        transitions: [],
        settings: undefined,
        errors,
        warnings,
      };
    }
  }

  /**
   * Import images from configuration
   */
  private async importImages(
    exportImages: ExportImageAsset[]
  ): Promise<ImageAsset[]> {
    const images: ImageAsset[] = [];

    for (const exportImage of exportImages) {
      try {
        // Convert base64 to blob URL
        const url = await this.base64ToUrl(
          exportImage.data,
          exportImage.format
        );

        images.push({
          id: exportImage.id,
          name: exportImage.name,
          url,
          size: this.calculateBase64Size(exportImage.data),
          uploadedAt: new Date(),
          usageCount: 0,
          usedIn: [],
        });
      } catch (error) {
        console.error(`Failed to import image ${exportImage.name}:`, error);
      }
    }

    return images;
  }

  /**
   * Import workflows from v2.0.0 configuration
   */
  private importWorkflows(exportWorkflows: ExportWorkflow[]): Workflow[] {
    return exportWorkflows.map((exportWorkflow) => {
      // Convert connections from export format to action-schema format
      // The main difference is Connection.type must be narrowed from string to specific types
      const connections: Workflow["connections"] = {};

      for (const [actionId, outputs] of Object.entries(exportWorkflow.connections || {})) {
        const convertedOutputs: Workflow["connections"][string] = {};

        for (const [outputType, connectionArrays] of Object.entries(outputs)) {
          if (Array.isArray(connectionArrays)) {
            convertedOutputs[outputType as "main" | "error" | "success"] = connectionArrays.map(
              (connArray) => connArray.map((conn) => ({
                action: conn.action,
                type: conn.type as "main" | "error" | "success" | "parallel",
                index: conn.index,
              }))
            );
          }
        }

        connections[actionId] = convertedOutputs;
      }

      const workflow: Workflow = {
        id: exportWorkflow.id,
        name: exportWorkflow.name,
        description: exportWorkflow.description || "",
        category: exportWorkflow.category,
        format: "graph" as const,
        version: this.SUPPORTED_VERSION,
        actions:
          exportWorkflow.actions?.map((action) => this.importAction(action)) ||
          [],
        connections,
        metadata: exportWorkflow.metadata || {},
      };

      // Import initialStateIds if present (for Main category workflows)
      if (exportWorkflow.initialStateIds && Array.isArray(exportWorkflow.initialStateIds)) {
        workflow.initialStateIds = exportWorkflow.initialStateIds;
      }

      return workflow;
    });
  }

  /**
   * Import a single action from export format
   *
   * Note: FIND_STATE_IMAGE conversion is handled by the migration system
   * (v2.0.1-to-v2.1.0 migration). This method assumes the config has
   * already been migrated to the latest version.
   */
  private importAction(action: ExportAction): Action {
    if (!isExportAction(action)) {
      throw new Error(`Invalid action format: missing required fields`);
    }

    const imported: Action = {
      id: action.id,
      type: action.type as Action["type"],
      config: this.importActionConfig(action) as Action["config"],
      position: action.position || [0, 0],
    };

    if (action.timeout !== undefined) {
      if (!imported.execution) imported.execution = {};
      (imported.execution as Record<string, unknown>).timeout = action.timeout;
    }
    if (action.retryCount !== undefined) {
      if (!imported.execution) imported.execution = {};
      (imported.execution as Record<string, unknown>).retryCount = action.retryCount;
    }
    if (action.continueOnError !== undefined) {
      if (!imported.execution) imported.execution = {};
      (imported.execution as Record<string, unknown>).continueOnError = action.continueOnError;
    }

    return imported;
  }

  /**
   * Import action configuration
   */
  private importActionConfig(action: ExportAction): Record<string, unknown> {
    const config: Record<string, unknown> = { ...action.config };

    // Handle target conversions - only FIND supports multiple images (imageIds)
    const target = config.target as Record<string, unknown> | undefined;
    if (target && typeof target === "object" && target.type === "image" && action.type === "FIND") {
      if (target.imageId && !target.imageIds) {
        target.imageIds = [target.imageId];
        delete target.imageId;
      }
      if (target.imageIds && !Array.isArray(target.imageIds)) {
        target.imageIds = [target.imageIds];
      }
    }

    // Handle target object to string conversion for UI
    // Convert proper target objects back to UI string format
    if (target && typeof target === "object" && target.type) {
      const targetType = target.type;

      if (targetType === "lastFindResult") {
        config.target = "Last Find Result";
      } else if (targetType === "currentPosition") {
        config.target = "Current Position";
      } else if (targetType === "coordinates" && typeof target.coordinates === "object") {
        const coords = target.coordinates as Record<string, unknown>;
        config.target = "Coordinates";
        config.x = coords.x;
        config.y = coords.y;
      }
      // Handle the 3 new multi-result target types
      // These are imported as objects and stay as objects in the UI
      else if (targetType === "resultIndex") {
        // ResultIndexTarget: Ensure index field exists (default to 0)
        if (target.index === undefined) {
          target.index = 0;
        }
      } else if (targetType === "allResults") {
        // AllResultsTarget: No additional processing needed
        // Already has correct type field
      } else if (targetType === "resultByImage") {
        // ResultByImageTarget: Ensure imageId field exists
        // The JSON format uses imageId (camelCase), which matches UI expectation
        if (!target.imageId) {
          console.warn("ResultByImageTarget missing imageId field");
        }
      }
      // Keep image and other complex targets as objects
    }

    // Handle action-specific transformations
    if (action.type === "GO_TO_STATE" && config.stateIds) {
      config.states = config.stateIds;
    }

    return config;
  }

  /**
   * Import states from configuration
   */
  private importStates(exportStates: ExportState[], images: ImageAsset[]): State[] {
    // Build a name-to-id map for fallback matching when patterns don't have imageId
    const imageNameToId = new Map<string, string>();
    images.forEach((img) => {
      imageNameToId.set(img.name, img.id);
    });

    return exportStates.map((exportState) => {
      if (!isExportState(exportState)) {
        throw new Error(`Invalid state format: missing required fields`);
      }

      this.updateImageUsage(exportState, images);

      // Convert ExportState's complex StateImage[] to simple { image, threshold }[]
      const stateImages = exportState.stateImages?.map((img) => {
        // For the simplified format, we use the first pattern's imageId and similarity
        const firstPattern = img.patterns?.[0];
        let imageId = firstPattern?.imageId || "";

        // If pattern has imageId, use it; otherwise try to match by name
        if (!imageId && firstPattern?.name) {
          imageId = imageNameToId.get(firstPattern.name) || "";
        }
        if (!imageId && img.name) {
          imageId = imageNameToId.get(img.name) || "";
        }

        return {
          image: imageId,
          threshold: firstPattern?.similarity || 0.8,
        };
      }) || [];

      return {
        id: exportState.id,
        name: exportState.name,
        description: exportState.description || "",
        initial: exportState.isInitial || false,
        stateImages,
        position: exportState.position,
      };
    });
  }

  /**
   * Import transitions from configuration
   */
  private importTransitions(exportTransitions: ExportTransition[]): Transition[] {
    return exportTransitions.map((exportTransition) => {
      if (!isExportTransition(exportTransition)) {
        throw new Error(`Invalid transition format: missing required fields`);
      }

      const type = exportTransition.type;

      // Keep workflows as string[] array to match export format
      const workflows: string[] = Array.isArray(exportTransition.workflows)
        ? exportTransition.workflows
        : [];

      const baseTransition: Transition = {
        id: exportTransition.id,
        type: type,
        workflows: workflows,
        timeout: exportTransition.timeout || 10000,
        retryCount: exportTransition.retryCount || 0,
      };

      if (type === "OutgoingTransition" && "fromState" in exportTransition) {
        // Type assertion to OutgoingTransition for proper type checking
        const outgoing = exportTransition as ExportTransition & {
          fromState: string;
          toState: string;
          staysVisible: boolean;
          activateStates?: string[];
          deactivateStates?: string[];
        };

        return {
          ...baseTransition,
          fromState: outgoing.fromState,
          toState: outgoing.toState,
          staysVisible: outgoing.staysVisible,
          activateStates: Array.isArray(outgoing.activateStates)
            ? outgoing.activateStates
            : [],
          deactivateStates: Array.isArray(outgoing.deactivateStates)
            ? outgoing.deactivateStates
            : [],
        };
      } else if (type === "IncomingTransition" && "toState" in exportTransition) {
        const incoming = exportTransition as ExportTransition & {
          toState: string;
        };

        return {
          ...baseTransition,
          toState: incoming.toState,
        };
      }

      return baseTransition;
    });
  }

  /**
   * Validate references between components
   */
  private validateReferences(
    states: State[],
    workflows: Workflow[],
    transitions: Transition[],
    errors: string[]
  ): void {
    const stateIds = new Set(states.map((s) => s.id));
    const workflowIds = new Set(workflows.map((w) => w.id));

    // Check transition references
    transitions.forEach((transition) => {
      // Check workflow references
      if (Array.isArray(transition.workflows)) {
        transition.workflows.forEach((workflowId) => {
          if (!workflowIds.has(workflowId)) {
            errors.push(
              `Transition ${transition.id} references unknown workflow: ${workflowId}`
            );
          }
        });
      }

      // Check state references - use type narrowing
      if (transition.type === "OutgoingTransition") {
        const fromState = (transition as Transition & { fromState?: string }).fromState;
        const toState = (transition as Transition & { toState?: string }).toState;

        if (fromState && !stateIds.has(fromState)) {
          errors.push(
            `Transition ${transition.id} references unknown fromState: ${fromState}`
          );
        }
        if (toState && !stateIds.has(toState)) {
          errors.push(
            `Transition ${transition.id} references unknown toState: ${toState}`
          );
        }
      } else if (transition.type === "IncomingTransition") {
        const toState = (transition as Transition & { toState?: string }).toState;

        if (toState && !stateIds.has(toState)) {
          errors.push(
            `Transition ${transition.id} references unknown toState: ${toState}`
          );
        }
      }
    });
  }

  /**
   * Convert base64 string to data URL
   */
  private async base64ToUrl(base64: string, format: string): Promise<string> {
    // Return as data URL instead of blob URL to persist across sessions
    return `data:image/${format};base64,${base64}`;
  }

  /**
   * Calculate size of base64 encoded data
   */
  private calculateBase64Size(base64: string): number {
    // Remove data URI prefix if present
    const data = base64.replace(/^data:.*,/, "");
    // Calculate approximate size in bytes
    return Math.round(data.length * 0.75);
  }


  /**
   * Update image usage tracking for patterns in a state
   */
  private updateImageUsage(exportState: ExportState, images: ImageAsset[]): void {
    exportState.stateImages?.forEach((stateImage) => {
      stateImage.patterns?.forEach((pattern) => {
        const image = images.find((img) => img.id === pattern.imageId);

        if (image) {
          image.usageCount++;
          image.usedIn.push({
            type: "state",
            id: exportState.id,
            name: exportState.name,
          });
        }
      });
    });
  }

  /**
   * Load configuration from file
   */
  async loadFromFile(file: File): Promise<ImportResult> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = async (e) => {
        try {
          const content = e.target?.result as string;
          const result = await this.importConfiguration(content);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      };

      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsText(file);
    });
  }

  /**
   * Validate configuration before import
   */
  validateBeforeImport(config: unknown): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config || typeof config !== "object") {
      errors.push("Configuration must be an object");
      return { valid: false, errors };
    }

    const cfg = config as Record<string, unknown>;

    // Check required fields
    if (!cfg.version) errors.push("Version is required");
    if (!cfg.metadata || typeof cfg.metadata !== "object") {
      errors.push("Metadata is required");
    } else {
      const metadata = cfg.metadata as Record<string, unknown>;
      if (!metadata.name) errors.push("Configuration name is required");
    }
    if (!Array.isArray(cfg.images)) errors.push("Images must be an array");
    if (!Array.isArray(cfg.workflows))
      errors.push("Workflows must be an array");
    if (!Array.isArray(cfg.states)) errors.push("States must be an array");
    if (!Array.isArray(cfg.transitions))
      errors.push("Transitions must be an array");

    // Check for at least one state
    if (Array.isArray(cfg.states) && cfg.states.length === 0) {
      errors.push("At least one state is required");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Merge imported configuration with existing
   */
  mergeWithExisting(
    imported: ImportResult,
    existing: {
      images: ImageAsset[];
      workflows: Workflow[];
      states: State[];
      transitions: Transition[];
    }
  ): ImportResult {
    // Generate new IDs to avoid conflicts
    const idMap = new Map<string, string>();

    // Merge images
    const mergedImages = [...existing.images];
    imported.images.forEach((image) => {
      const newId = `imported_${Date.now()}_${image.id}`;
      idMap.set(image.id, newId);
      mergedImages.push({
        ...image,
        id: newId,
      });
    });

    // Update workflow references
    const mergedWorkflows = [...existing.workflows];
    imported.workflows.forEach((workflow) => {
      const newId = `imported_${Date.now()}_${workflow.id}`;
      idMap.set(workflow.id, newId);

      // Update image references in actions
      const updatedActions = workflow.actions.map((action) => {
        const config = action.config as Record<string, unknown>;
        const imageId = config.imageId;

        return {
          ...action,
          config: {
            ...config,
            imageId: typeof imageId === "string"
              ? idMap.get(imageId) || imageId
              : undefined,
          } as Action["config"],
        };
      });

      mergedWorkflows.push({
        ...workflow,
        id: newId,
        actions: updatedActions,
      });
    });

    // Update state references
    const mergedStates = [...existing.states];
    imported.states.forEach((state) => {
      const newId = `imported_${Date.now()}_${state.id}`;
      idMap.set(state.id, newId);

      // Update image references in stateImages
      // Note: stateImages is { image: string, threshold: number }[]
      const updatedStateImages = state.stateImages.map((stateImg) => ({
        ...stateImg,
        image: idMap.get(stateImg.image) || stateImg.image,
      }));

      mergedStates.push({
        ...state,
        id: newId,
        stateImages: updatedStateImages,
      });
    });

    // Update transition references
    const mergedTransitions = [...existing.transitions];
    imported.transitions.forEach((transition) => {
      const newId = `imported_${Date.now()}_${transition.id}`;

      // Update workflow references
      const updatedWorkflows = transition.workflows.map(
        (wid) => idMap.get(wid) || wid
      );

      // Update state references with proper type handling
      if (transition.type === "OutgoingTransition") {
        const outgoing = transition as Transition & {
          fromState?: string;
          toState?: string;
          staysVisible?: boolean;
          activateStates?: string[];
          deactivateStates?: string[];
        };

        const updatedTransition: Transition & typeof outgoing = {
          ...transition,
          id: newId,
          workflows: updatedWorkflows,
          fromState: outgoing.fromState
            ? idMap.get(outgoing.fromState) || outgoing.fromState
            : undefined,
          toState: outgoing.toState
            ? idMap.get(outgoing.toState) || outgoing.toState
            : undefined,
          activateStates: outgoing.activateStates?.map(
            (sid) => idMap.get(sid) || sid
          ),
          deactivateStates: outgoing.deactivateStates?.map(
            (sid) => idMap.get(sid) || sid
          ),
        };

        mergedTransitions.push(updatedTransition);
      } else if (transition.type === "IncomingTransition") {
        const incoming = transition as Transition & { toState?: string };

        const updatedTransition: Transition & typeof incoming = {
          ...transition,
          id: newId,
          workflows: updatedWorkflows,
          toState: incoming.toState
            ? idMap.get(incoming.toState) || incoming.toState
            : undefined,
        };

        mergedTransitions.push(updatedTransition);
      } else {
        // Base transition without state references
        mergedTransitions.push({
          ...transition,
          id: newId,
          workflows: updatedWorkflows,
        });
      }
    });

    return {
      success: true,
      images: mergedImages,
      workflows: mergedWorkflows,
      states: mergedStates,
      transitions: mergedTransitions,
      errors: [],
      warnings: ["Configuration merged with existing data"],
    };
  }
}
