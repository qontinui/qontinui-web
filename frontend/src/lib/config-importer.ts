import {
  QontinuiConfig,
  ImageAsset as ExportImageAsset,
  Workflow as ExportWorkflow,
} from "./export-schema";
import { Workflow } from "./action-schema";
import { migrateConfigToLatest, needsMigration } from "./config-migration";

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
  [key: string]: any;
}

export interface ImportResult {
  success: boolean;
  images: ImageAsset[];
  workflows: Workflow[];
  states: State[];
  transitions: Transition[];
  settings?: any; // QontinuiConfig.settings
  errors: string[];
  warnings: string[];
}

export class ConfigImporter {
  private readonly SUPPORTED_VERSION = "2.1.0";

  /**
   * Import a Qontinui configuration from JSON
   */
  async importConfiguration(
    configJson: string | QontinuiConfig | any
  ): Promise<ImportResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Parse JSON if string
      let config: any =
        typeof configJson === "string" ? JSON.parse(configJson) : configJson;

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
        config = migrationResult.config;
        warnings.push(...migrationResult.context.warnings);

        // Add migration summary
        warnings.push(
          `Configuration migrated from v${migrationResult.context.fromVersion} to v${migrationResult.context.toVersion}`
        );
      }

      // Validate version
      if (config.version !== this.SUPPORTED_VERSION) {
        throw new Error(
          `Unsupported configuration version: ${config.version}. Only version ${this.SUPPORTED_VERSION} is supported.`
        );
      }

      // Import components
      const images = await this.importImages(config.images);
      const workflows = this.importWorkflows(config.workflows || []);
      const states = this.importStates(config.states || [], images);
      const transitions = this.importTransitions(config.transitions || []);

      // Validate references
      this.validateReferences(states, workflows, transitions, errors);

      return {
        success: errors.length === 0,
        images,
        workflows,
        states,
        transitions,
        settings: config.settings, // Pass through settings for backend to apply
        errors,
        warnings,
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
      const workflow: any = {
        id: exportWorkflow.id,
        name: exportWorkflow.name,
        description: exportWorkflow.description || "",
        category: exportWorkflow.category,
        format: "graph" as const,
        version: this.SUPPORTED_VERSION,
        actions:
          exportWorkflow.actions?.map((action) => this.importAction(action)) ||
          [],
        connections: (exportWorkflow.connections as any) || {},
        metadata: exportWorkflow.metadata || {},
      };

      // Import initialStateIds if present (for Main category workflows)
      if (
        (exportWorkflow as any).initialStateIds &&
        Array.isArray((exportWorkflow as any).initialStateIds)
      ) {
        workflow.initialStateIds = (exportWorkflow as any).initialStateIds;
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
  private importAction(action: any): any {
    const imported: any = {
      id: action.id,
      type: action.type,
      config: this.importActionConfig(action),
    };

    if (action.position) imported.position = action.position;
    if (action.timeout !== undefined) imported.timeout = action.timeout;
    if (action.retryCount !== undefined)
      imported.retryCount = action.retryCount;
    if (action.continueOnError !== undefined)
      imported.continueOnError = action.continueOnError;

    return imported;
  }

  /**
   * Import action configuration
   */
  private importActionConfig(action: any): Record<string, any> {
    const config: Record<string, any> = { ...action.config };

    // Handle target conversions - only FIND supports multiple images (imageIds)
    if (config.target?.type === "image" && action.type === "FIND") {
      if (config.target.imageId && !config.target.imageIds) {
        config.target.imageIds = [config.target.imageId];
        delete config.target.imageId;
      }
      if (config.target.imageIds && !Array.isArray(config.target.imageIds)) {
        config.target.imageIds = [config.target.imageIds];
      }
    }

    // Handle target object to string conversion for UI
    // Convert proper target objects back to UI string format
    if (
      config.target &&
      typeof config.target === "object" &&
      config.target.type
    ) {
      const targetType = config.target.type;

      if (targetType === "lastFindResult") {
        config.target = "Last Find Result";
      } else if (targetType === "currentPosition") {
        config.target = "Current Position";
      } else if (targetType === "coordinates" && config.target.coordinates) {
        config.target = "Coordinates";
        config.x = config.target.coordinates.x;
        config.y = config.target.coordinates.y;
      }
      // Handle the 3 new multi-result target types
      // These are imported as objects and stay as objects in the UI
      else if (targetType === "resultIndex") {
        // ResultIndexTarget: Ensure index field exists (default to 0)
        if (config.target.index === undefined) {
          config.target.index = 0;
        }
      } else if (targetType === "allResults") {
        // AllResultsTarget: No additional processing needed
        // Already has correct type field
      } else if (targetType === "resultByImage") {
        // ResultByImageTarget: Ensure imageId field exists
        // The JSON format uses imageId (camelCase), which matches UI expectation
        if (!config.target.imageId) {
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
  private importStates(exportStates: any[], images: ImageAsset[]): State[] {
    return exportStates.map((exportState) => {
      this.updateImageUsage(exportState, images);

      return {
        id: exportState.id,
        name: exportState.name,
        description: exportState.description || "",
        initial: exportState.isInitial || false,
        stateImages:
          exportState.stateImages?.map((img: any) => ({
            id: img.id,
            name: img.name,
            patterns:
              img.patterns?.map((pattern: any) => ({
                id: pattern.id,
                name: pattern.name,
                image: this.resolveImageId(pattern.imageId, images),
                mask: pattern.mask,
                searchRegions: pattern.searchRegions || [],
                fixed: pattern.fixed || false,
                similarity: pattern.similarity,
                targetPosition: pattern.targetPosition,
                offsetX: pattern.offsetX,
                offsetY: pattern.offsetY,
              })) || [],
            shared: img.shared || false,
            source: img.source,
            probability: img.probability,
            searchRegions: img.searchRegions || [],
          })) || [],
        regions: exportState.regions || [],
        locations: exportState.locations || [],
        strings: exportState.strings || [],
        position: exportState.position,
      };
    });
  }

  /**
   * Import transitions from configuration
   */
  private importTransitions(exportTransitions: any[]): Transition[] {
    return exportTransitions.map((exportTransition) => {
      const type: "OutgoingTransition" | "IncomingTransition" =
        exportTransition.type;

      // Keep workflows as string[] array to match export format
      const workflows: string[] = Array.isArray(exportTransition.workflows)
        ? exportTransition.workflows
        : [];

      const transition: Transition = {
        id: exportTransition.id,
        type: type,
        workflows: workflows,
        timeout: exportTransition.timeout || 10000,
        retryCount: exportTransition.retryCount || 0,
      };

      if (type === "OutgoingTransition") {
        transition.fromState = exportTransition.fromState;
        transition.toState = exportTransition.toState;
        transition.staysVisible = exportTransition.staysVisible;
        transition.activateStates = Array.isArray(
          exportTransition.activateStates
        )
          ? exportTransition.activateStates
          : [];
        transition.deactivateStates = Array.isArray(
          exportTransition.deactivateStates
        )
          ? exportTransition.deactivateStates
          : [];
      } else if (type === "IncomingTransition") {
        transition.toState = exportTransition.toState;
      }

      return transition;
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

      // Check state references
      if (transition.type === "OutgoingTransition") {
        if (transition.fromState && !stateIds.has(transition.fromState)) {
          errors.push(
            `Transition ${transition.id} references unknown fromState: ${transition.fromState}`
          );
        }
        if (transition.toState && !stateIds.has(transition.toState)) {
          errors.push(
            `Transition ${transition.id} references unknown toState: ${transition.toState}`
          );
        }
      } else if (transition.type === "IncomingTransition") {
        if (transition.toState && !stateIds.has(transition.toState)) {
          errors.push(
            `Transition ${transition.id} references unknown toState: ${transition.toState}`
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
   * Resolve image ID to base64 data URL
   */
  private resolveImageId(imageId: string, images: ImageAsset[]): string {
    const imageAsset = images.find((img) => img.id === imageId);

    if (!imageAsset) {
      throw new Error(`Pattern references unknown image ID: ${imageId}`);
    }

    return imageAsset.url;
  }

  /**
   * Update image usage tracking for patterns in a state
   */
  private updateImageUsage(exportState: any, images: ImageAsset[]): void {
    exportState.stateImages?.forEach((stateImage: any) => {
      stateImage.patterns?.forEach((pattern: any) => {
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
  validateBeforeImport(config: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check required fields
    if (!config.version) errors.push("Version is required");
    if (!config.metadata?.name) errors.push("Configuration name is required");
    if (!Array.isArray(config.images)) errors.push("Images must be an array");
    if (!Array.isArray(config.workflows))
      errors.push("Workflows must be an array");
    if (!Array.isArray(config.states)) errors.push("States must be an array");
    if (!Array.isArray(config.transitions))
      errors.push("Transitions must be an array");

    // Check for at least one state
    if (config.states?.length === 0) {
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
      const updatedActions = workflow.actions.map((action) => ({
        ...action,
        config: {
          ...action.config,
          imageId: (action.config as any).imageId
            ? idMap.get((action.config as any).imageId) ||
              (action.config as any).imageId
            : undefined,
        },
      }));

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

      // Update image references
      const updatedImages = state.stateImages.map((img) => ({
        ...img,
        image: idMap.get(img.image) || img.image,
      }));

      mergedStates.push({
        ...state,
        id: newId,
        stateImages: updatedImages,
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

      const updatedTransition: Transition = {
        ...transition,
        id: newId,
        workflows: updatedWorkflows,
      };

      // Update state references
      if (transition.type === "OutgoingTransition") {
        if (transition.fromState) {
          updatedTransition.fromState =
            idMap.get(transition.fromState) || transition.fromState;
        }
        if (transition.toState) {
          updatedTransition.toState =
            idMap.get(transition.toState) || transition.toState;
        }
        if (transition.activateStates) {
          updatedTransition.activateStates = transition.activateStates.map(
            (sid: any) => idMap.get(sid) || sid
          );
        }
        if (transition.deactivateStates) {
          updatedTransition.deactivateStates = transition.deactivateStates.map(
            (sid: any) => idMap.get(sid) || sid
          );
        }
      } else if (
        transition.type === "IncomingTransition" &&
        transition.toState
      ) {
        updatedTransition.toState =
          idMap.get(transition.toState) || transition.toState;
      }

      mergedTransitions.push(updatedTransition);
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
