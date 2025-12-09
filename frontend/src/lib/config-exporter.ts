import {
  QontinuiConfig,
  ConfigMetadata,
  ImageAsset as ExportImageAsset,
  Workflow as ExportWorkflow,
  State as ExportState,
  Transition as ExportTransition,
  OutgoingTransition as ExportOutgoingTransition,
  IncomingTransition as ExportIncomingTransition,
  ConfigSettings,
} from "./export-schema";

import { validateWorkflowConnections } from "./workflow-validator";
import { CURRENT_VERSION } from "./config-migration/migrations";

// Import types from new action schema
import { Action, Workflow } from "./action-schema";

// Import types from automation context
import type {
  ImageAsset,
  State,
  Transition,
} from "../contexts/automation-context/types";
import { Screenshot } from "../types/Screenshot";

export class ConfigExporter {
  private version = CURRENT_VERSION;

  /**
   * Export the current configuration to Qontinui format
   */
  async exportConfiguration(
    images: ImageAsset[],
    workflows: Workflow[],
    states: State[],
    transitions: Transition[],
    categories: string[],
    metadata?: Partial<ConfigMetadata>,
    _settings?: any,
    screenshots?: Screenshot[]
  ): Promise<QontinuiConfig> {
    const now = new Date().toISOString();

    // Get settings
    const settings = _settings || this.getDefaultSettings();

    // Export images first and build a lookup map from base64 data to image IDs
    const exportedImages = await this.exportImages(images || [], screenshots);
    const base64ToImageId = this.buildBase64ToImageIdMap(exportedImages);

    // Collect helper workflows from transitions and add to main workflows array
    const allWorkflows = [...(workflows || [])];
    (transitions || []).forEach((transition) => {
      if ((transition as any).inlineWorkflows) {
        allWorkflows.push(...(transition as any).inlineWorkflows);
      }
    });

    const config: QontinuiConfig = {
      version: this.version,
      metadata: {
        name: metadata?.name || "Untitled Automation",
        description: metadata?.description,
        author: metadata?.author,
        created: metadata?.created || now,
        modified: now,
        tags: metadata?.tags || [],
        targetApplication: metadata?.targetApplication,
        compatibleVersions: {
          runner: "2.0.0",
          website: "2.0.0",
        },
      },
      images: exportedImages,
      workflows: this.exportWorkflows(allWorkflows, states || []),
      states: this.exportStates(states || [], screenshots, base64ToImageId),
      transitions: this.exportTransitions(transitions || []),
      categories: categories || ["Main"],
      settings: this.convertSettings(settings) || this.getDefaultSettings(),
    };

    return config;
  }

  /**
   * Convert ProjectSettings to ConfigSettings format
   */
  private convertSettings(projectSettings: any): ConfigSettings {
    if (!projectSettings) {
      return this.getDefaultSettings();
    }

    return {
      execution: {
        defaultTimeout: projectSettings.execution?.default_timeout || 10000,
        defaultRetryCount: projectSettings.execution?.default_retry_count || 0,
        actionDelay: projectSettings.execution?.action_delay || 100,
        failureStrategy:
          projectSettings.execution?.failure_strategy || "continue",
        headless: false,
      },
      recognition: {
        defaultThreshold: projectSettings.recognition?.default_threshold || 0.7,
        searchAlgorithm: "template_matching",
        multiScaleSearch:
          projectSettings.recognition?.multi_scale_search ?? false,
        colorSpace: projectSettings.recognition?.color_space || "rgb",
        edgeDetection: projectSettings.recognition?.edge_detection || false,
        ocrEnabled: projectSettings.recognition?.ocr_enabled || false,
      },
      logging: {
        level: "info",
        screenshotOnError: true,
        consoleOutput: true,
        detailedMatching: false,
      },
      performance: {
        maxParallelActions: 1,
        cacheImages: true,
        optimizeSearch: true,
      },
      mouse: {
        click_hold_duration: projectSettings.mouse?.click_hold_duration || 100,
        click_release_delay: projectSettings.mouse?.click_release_delay || 50,
        click_safety_release:
          projectSettings.mouse?.click_safety_release ?? true,
        double_click_interval:
          projectSettings.mouse?.double_click_interval || 300,
        drag_start_delay: projectSettings.mouse?.drag_start_delay || 100,
        drag_end_delay: projectSettings.mouse?.drag_end_delay || 100,
        drag_default_duration:
          projectSettings.mouse?.drag_default_duration || 500,
        move_default_duration:
          projectSettings.mouse?.move_default_duration || 500,
        safety_release_delay: projectSettings.mouse?.safety_release_delay || 50,
      },
      keyboard: {
        key_hold_duration: projectSettings.keyboard?.key_hold_duration || 50,
        key_release_delay: projectSettings.keyboard?.key_release_delay || 50,
        typing_interval: projectSettings.keyboard?.typing_interval || 50,
        hotkey_hold_duration:
          projectSettings.keyboard?.hotkey_hold_duration || 100,
        hotkey_press_interval:
          projectSettings.keyboard?.hotkey_press_interval || 50,
      },
      find: {
        default_timeout: projectSettings.find?.default_timeout || 30000,
        default_retry_count: projectSettings.find?.default_retry_count || 0,
        search_interval: projectSettings.find?.search_interval || 500,
      },
      wait: {
        pause_before_action: projectSettings.wait?.pause_before_action || 0,
        pause_after_action: projectSettings.wait?.pause_after_action || 0,
      },
    };
  }

  /**
   * Build a lookup map from base64 data to image IDs
   * This is used to convert embedded base64 data in patterns to imageId references
   */
  private buildBase64ToImageIdMap(
    exportedImages: ExportImageAsset[]
  ): Map<string, string> {
    const map = new Map<string, string>();

    for (const img of exportedImages) {
      if (img.data) {
        // Store mapping for bare base64 string
        map.set(img.data, img.id);

        // Also store mappings with common data URL prefixes
        map.set(`data:image/png;base64,${img.data}`, img.id);
        map.set(`data:image/jpeg;base64,${img.data}`, img.id);
        map.set(`data:image/jpg;base64,${img.data}`, img.id);
      }
    }

    return map;
  }

  /**
   * Convert images to export format with base64 encoding
   */
  private async exportImages(
    images: ImageAsset[],
    screenshots?: Screenshot[]
  ): Promise<ExportImageAsset[]> {
    const exportedImages: ExportImageAsset[] = [];

    if (!images || !Array.isArray(images)) {
      return exportedImages;
    }

    for (const image of images) {
      try {
        const base64Data = await this.imageUrlToBase64(image.url);
        const dimensions = await this.getImageDimensions(image.url);

        exportedImages.push({
          id: image.id,
          name: image.name,
          data: base64Data,
          format: this.getImageFormat(image.name),
          width: dimensions.width,
          height: dimensions.height,
          hash: await this.calculateHash(base64Data),
        });
      } catch (error) {
        console.error(`Failed to export image ${image.name}:`, error);
      }
    }

    // Also export screenshot images
    if (screenshots && Array.isArray(screenshots)) {
      for (const screenshot of screenshots) {
        try {
          // Screenshots already have base64 data in imageData field
          const base64Data =
            screenshot.imageData.split(",")[1] || screenshot.imageData;

          exportedImages.push({
            id: `screenshot_${screenshot.id}`,
            name: screenshot.name,
            data: base64Data,
            format: "png",
            width: screenshot.width,
            height: screenshot.height,
            hash: await this.calculateHash(base64Data),
          });
        } catch (error) {
          console.error(
            `Failed to export screenshot ${screenshot.name}:`,
            error
          );
        }
      }
    }

    return exportedImages;
  }

  /**
   * Convert workflows to export format
   */
  private exportWorkflows(
    workflows: Workflow[],
    states?: State[]
  ): ExportWorkflow[] {
    if (!workflows || !Array.isArray(workflows)) {
      return [];
    }

    return workflows.map((workflow) => {
      // Start with the workflow's existing connections or empty object
      let connections = workflow.connections || {};

      // Ensure all actions have connection entries
      workflow.actions.forEach((action) => {
        if (!connections[action.id]) {
          connections[action.id] = { main: [] };
        }
      });

      // Auto-generate sequential connections for workflows in sequential view mode
      if (
        workflow.metadata?.viewMode === "sequential" &&
        workflow.actions.length > 1
      ) {
        console.log(
          `🔍 [Export] Workflow "${workflow.name}" - viewMode: ${workflow.metadata?.viewMode}, ${workflow.actions.length} actions`
        );
        console.log(`🔍 [Export] Connections before check:`, connections);

        // Check if connections have actual chains (not just empty arrays)
        const hasActualConnections = Object.values(connections).some(
          (outputs) => {
            if (!outputs || typeof outputs !== "object") return false;
            // Check if any output has non-empty connection arrays
            return Object.values(outputs).some((conns) => {
              if (!Array.isArray(conns) || conns.length === 0) return false;
              const firstConn = conns[0];
              return firstConn && firstConn.length > 0;
            });
          }
        );

        console.log(`🔍 [Export] hasActualConnections:`, hasActualConnections);

        if (!hasActualConnections) {
          console.log(
            `✅ [Export] Generating sequential connections for "${workflow.name}"`
          );

          // Generate sequential chain: action1 -> action2 -> action3 -> ...
          const generatedConnections: any = {};
          for (let i = 0; i < workflow.actions.length - 1; i++) {
            const currentAction = workflow.actions[i];
            const nextAction = workflow.actions[i + 1];
            if (currentAction && nextAction) {
              generatedConnections[currentAction.id] = {
                main: [
                  [
                    {
                      action: nextAction.id,
                      type: "main",
                      index: 0,
                    },
                  ],
                ],
              };
            }
          }
          // Last action has empty connections
          if (workflow.actions.length > 0) {
            const lastAction = workflow.actions[workflow.actions.length - 1];
            if (lastAction) {
              generatedConnections[lastAction.id] = {
                main: [],
              };
            }
          }

          console.log(
            `✅ [Export] Generated connections:`,
            generatedConnections
          );
          connections = generatedConnections;
        } else {
          console.log(
            `⏭️ [Export] Skipping generation - connections already exist`
          );
        }
      }

      const exported: any = {
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        category: workflow.category,
        format: "graph" as const,
        version: workflow.version || "1.0.0",
        actions: this.exportActions(workflow.actions, states),
        connections: connections,
        metadata: workflow.metadata || {},
      };

      // Include initialStateIds if present (required for Main category workflows)
      if (workflow.initialStateIds && workflow.initialStateIds.length > 0) {
        exported.initialStateIds = workflow.initialStateIds;
      }

      return exported;
    });
  }

  /**
   * Export actions to the correct format
   * Actions already have the correct structure from the new schema
   */
  private exportActions(actions: Action[], states?: State[]): any[] {
    if (!actions || !Array.isArray(actions)) {
      return [];
    }

    // Filter out any null/undefined actions
    return actions
      .filter((action) => action != null)
      .map((action) => {
        const exported: any = {
          id: action.id,
          type: action.type,
        };

        // Add optional name if present
        if (action.name) {
          exported.name = action.name;
        }

        // Transform config for specific action types
        exported.config = this.transformActionConfig(action, states);

        // Export position for graph visualization
        if (action.position) {
          exported.position = action.position;
        }

        // Export base settings if present
        if ((action as any).base) {
          exported.base = (action as any).base;
        }

        // Export execution settings if present
        if ((action as any).execution) {
          exported.execution = (action as any).execution;
        }

        // Export timeout and retry settings
        if ((action as any).timeout !== undefined) {
          exported.timeout = (action as any).timeout;
        }
        if ((action as any).retryCount !== undefined) {
          exported.retryCount = (action as any).retryCount;
        }
        if ((action as any).continueOnError !== undefined) {
          exported.continueOnError = (action as any).continueOnError;
        }

        return exported;
      });
  }

  /**
   * Transform action config for export
   * Converts internal field names to export schema format
   */
  private transformActionConfig(action: Action, states?: State[]): any {
    const config = { ...action.config };

    // Handle GO_TO_STATE action: convert 'states' array to 'stateIds' array and add stateNames
    if (action.type === "GO_TO_STATE") {
      let targetStateIds: string[] = [];

      // Get state IDs from either 'states' or 'stateIds' field
      if ((config as any).states) {
        targetStateIds = (config as any).states as string[];
        (config as any).stateIds = targetStateIds;
        delete (config as any).states;
      } else if ((config as any).stateIds) {
        targetStateIds = (config as any).stateIds as string[];
      }

      // Always add stateNames array for the runner
      if (targetStateIds.length > 0) {
        const stateNames = targetStateIds.map((stateId: string) => {
          const state = states?.find((s) => s.id === stateId);
          return state ? state.name : stateId;
        });
        (config as any).stateNames = stateNames;
      } else {
        // Ensure stateNames exists even if empty
        (config as any).stateNames = [];
      }
    }

    // Handle TYPE action: convert UI textSource format to schema format
    if (action.type === "TYPE") {
      // If textSource is the string "stateString", convert to TextSource object
      if ((config as any).textSource === "stateString") {
        // Create TextSource object from UI fields
        if ((config as any).selectedState) {
          (config as any).textSource = {
            stateId: (config as any).selectedState,
            stringIds: (config as any).selectedStateStrings || [],
            useAll: (config as any).useAllStateStrings || false,
          };
        } else {
          // No state selected, remove textSource
          delete (config as any).textSource;
        }

        // Clean up UI-specific fields
        delete (config as any).selectedState;
        delete (config as any).selectedStateStrings;
        delete (config as any).useAllStateStrings;
      } else if ((config as any).textSource === "manual") {
        // Manual text mode - remove textSource field, keep text field only if non-empty
        delete (config as any).textSource;

        // Remove empty text field
        if ((config as any).text !== undefined) {
          const textValue = (config as any).text;
          if (
            !textValue ||
            (typeof textValue === "string" && !textValue.trim())
          ) {
            delete (config as any).text;
          }
        }
      }

      // If textSource is an object (already converted), remove empty text field
      if (
        typeof (config as any).textSource === "object" &&
        (config as any).textSource !== null
      ) {
        if ((config as any).text !== undefined) {
          const textValue = (config as any).text;
          if (
            !textValue ||
            (typeof textValue === "string" && !textValue.trim())
          ) {
            delete (config as any).text;
          }
        }
      }
    }

    // Handle RUN_WORKFLOW action: convert UI field names to schema format
    if (action.type === "RUN_WORKFLOW") {
      // Transform enableRepeat/maxRepeats/repeatDelay/repeatUntilSuccess -> repetition object
      if (
        (config as any).enableRepeat !== undefined ||
        (config as any).maxRepeats !== undefined ||
        (config as any).repeatDelay !== undefined ||
        (config as any).repeatUntilSuccess !== undefined
      ) {
        const enabled = (config as any).enableRepeat ?? false;

        // Only include repetition object if enabled or if any repeat fields are set
        if (
          enabled ||
          (config as any).maxRepeats ||
          (config as any).repeatDelay ||
          (config as any).repeatUntilSuccess
        ) {
          (config as any).repetition = {
            enabled: enabled,
            maxRepeats: (config as any).maxRepeats ?? 10,
            ...((config as any).repeatDelay !== undefined && {
              delay: (config as any).repeatDelay,
            }),
            ...((config as any).repeatUntilSuccess !== undefined && {
              untilSuccess: (config as any).repeatUntilSuccess,
            }),
          };
        }

        // Remove old UI field names
        delete (config as any).enableRepeat;
        delete (config as any).maxRepeats;
        delete (config as any).repeatDelay;
        delete (config as any).repeatUntilSuccess;
      }
    }

    // Handle stateImage target: add stateName for readability in exported JSON
    if (
      action.type === "FIND" &&
      (config as any).target?.type === "stateImage" &&
      (config as any).target?.stateId
    ) {
      const stateId = (config as any).target.stateId;
      const state = states?.find((s) => s.id === stateId);
      if (state) {
        (config as any).target.stateName = state.name;
      }
    }

    // Handle target transformation for MOUSE_MOVE, CLICK, and other actions
    // Convert UI string values like "Last Find Result" to proper target objects
    if ((config as any).target && typeof (config as any).target === "string") {
      const targetString = (config as any).target;

      if (targetString === "Last Find Result") {
        (config as any).target = { type: "lastFindResult" };
      } else if (targetString === "Current Position") {
        (config as any).target = { type: "currentPosition" };
      } else if (targetString === "Coordinates") {
        // Convert to coordinates target with x, y values
        (config as any).target = {
          type: "coordinates",
          coordinates: {
            x: (config as any).x || 0,
            y: (config as any).y || 0,
          },
        };
        // Remove flat x, y fields
        delete (config as any).x;
        delete (config as any).y;
      }
      // Note: StateImage, StateRegion, StateLocation would need more complex handling
      // with additional data from the UI, not implemented here yet
    }

    // Handle target transformation for the 3 new target types
    // These are likely already objects from the UI, but we ensure proper field mapping
    if ((config as any).target && typeof (config as any).target === "object") {
      const target = (config as any).target;

      // ResultIndexTarget: Target specific match by index
      if (target.type === "resultIndex") {
        // Ensure index field exists (default to 0 if not specified)
        if (target.index === undefined) {
          target.index = 0;
        }
        // No field name conversion needed - already matches JSON format
      }

      // AllResultsTarget: Target all matches
      // No additional processing needed - just ensure type field is correct
      if (target.type === "allResults") {
        // Type is already correct, no additional fields needed
      }

      // ResultByImageTarget: Target match from specific image
      if (target.type === "resultByImage") {
        // Ensure imageId field exists and convert from snake_case if needed
        if (target.image_id && !target.imageId) {
          target.imageId = target.image_id;
          delete target.image_id;
        }
        // Validate that imageId is present
        if (!target.imageId) {
          console.warn("ResultByImageTarget requires imageId field");
        }
      }
    }

    return config;
  }

  /**
   * Convert states to export format
   */
  private exportStates(
    states: State[],
    screenshots?: Screenshot[],
    base64ToImageId?: Map<string, string>
  ): ExportState[] {
    if (!states || !Array.isArray(states)) {
      return [];
    }

    return states.map((state) => {
      // Collect state objects from state definition and screenshots with deduplication
      const stateRegions: any[] = [];
      const stateLocations: any[] = [];
      const regionIds = new Set<string>();
      const locationIds = new Set<string>();

      // Add regions from state definition first
      (state.regions || []).forEach((region) => {
        if (!regionIds.has(region.id)) {
          regionIds.add(region.id);
          stateRegions.push(region);
        }
      });

      // Add locations from state definition first
      (state.locations || []).forEach((location) => {
        if (!locationIds.has(location.id)) {
          locationIds.add(location.id);
          stateLocations.push(location);
        }
      });

      // Add regions and locations from screenshots if not already present
      if (screenshots) {
        screenshots.forEach((screenshot) => {
          if (screenshot.associatedStates.includes(state.id)) {
            // Add regions associated with this state
            screenshot.regions.forEach((region) => {
              if (region.stateId === state.id && !regionIds.has(region.id)) {
                regionIds.add(region.id);
                stateRegions.push({
                  id: region.id,
                  name: region.name,
                  bounds: region.bounds,
                  fixed: true,
                  isSearchRegion: region.type === "SearchRegion",
                  isInteractionRegion: region.type === "StateRegion",
                });
              }
            });

            // Add locations associated with this state
            screenshot.locations.forEach((location) => {
              if (
                location.stateId === state.id &&
                !locationIds.has(location.id)
              ) {
                locationIds.add(location.id);
                stateLocations.push({
                  id: location.id,
                  name: location.name,
                  x: location.x,
                  y: location.y,
                  fixed: true,
                });
              }
            });
          }
        });
      }

      // Deduplicate stateImages
      const stateImages: any[] = [];
      const imageIds = new Set<string>();
      (state.stateImages || []).forEach((img) => {
        if (!imageIds.has(img.id)) {
          imageIds.add(img.id);
          stateImages.push({
            id: img.id,
            name: img.name,
            patterns: img.patterns.map((pattern) => {
              // Convert embedded base64 data to imageId reference
              let imageIdRef = pattern.imageId;

              // If pattern.imageId is a base64 data URL, look it up in the image map
              if (base64ToImageId && pattern.imageId) {
                const matchedImageId = base64ToImageId.get(pattern.imageId);
                if (matchedImageId) {
                  imageIdRef = matchedImageId;
                } else {
                  // Log a warning if we can't find a matching image
                  console.warn(
                    `State "${state.name}": Pattern "${pattern.name || img.name}" has embedded base64 data that doesn't match any exported image`
                  );
                }
              }

              return {
                id: pattern.id,
                name: pattern.name,
                imageId: imageIdRef, // Use imageId instead of image
                mask: (pattern as any).mask,
                searchRegions: pattern.searchRegions || [],
                fixed: pattern.fixed,
                similarity: pattern.similarity,
                targetPosition: pattern.targetPosition,
                offsetX: pattern.offsetX,
                offsetY: pattern.offsetY,
              };
            }),
            shared: img.shared,
            source: img.source,
            probability: img.probability,
            searchRegions: img.searchRegions || [],
          });
        }
      });

      // Deduplicate strings
      const stateStrings: any[] = [];
      const stringIds = new Set<string>();
      (state.strings || []).forEach((str) => {
        if (!stringIds.has(str.id)) {
          stringIds.add(str.id);
          stateStrings.push(str);
        }
      });

      return {
        id: state.id,
        name: state.name,
        description: state.description,
        stateImages,
        regions: stateRegions,
        locations: stateLocations,
        strings: stateStrings,
        position: {
          x: Math.round(state.position.x),
          y: Math.round(state.position.y),
        },
        isInitial: state.initial || false,
        isFinal: false,
      };
    });
  }

  /**
   * Convert transitions to export format
   */
  private exportTransitions(transitions: Transition[]): ExportTransition[] {
    if (!transitions || !Array.isArray(transitions)) {
      return [];
    }

    return transitions.map((transition) => {
      // In v2.0.0, transition.workflows is a simple string array containing all workflow IDs
      // (both regular workflows and helper workflows)
      const workflows = transition.workflows || [];

      const baseTransition: any = {
        id: transition.id,
        workflows,
        timeout: transition.timeout,
        retryCount: transition.retryCount,
      };

      // Export OutgoingTransition
      if (transition.type === "OutgoingTransition") {
        const fromState = transition.fromState || "";
        const activateStates = transition.activateStates || [];
        const toState =
          transition.toState ||
          (activateStates.length > 0 ? activateStates[0] : "");

        return {
          ...baseTransition,
          type: "OutgoingTransition",
          fromState,
          toState,
          staysVisible: transition.staysVisible || false,
          activateStates: activateStates,
          deactivateStates: transition.deactivateStates || [],
        } as ExportOutgoingTransition;
      }
      // Export IncomingTransition
      else {
        return {
          ...baseTransition,
          type: "IncomingTransition",
          toState: transition.toState || "",
        } as ExportIncomingTransition;
      }
    });
  }

  /**
   * Get default settings for the configuration
   */
  private getDefaultSettings(): ConfigSettings {
    return {
      execution: {
        defaultTimeout: 10000,
        defaultRetryCount: 0,
        actionDelay: 100,
        failureStrategy: "continue",
        headless: false,
      },
      recognition: {
        defaultThreshold: 0.7,
        searchAlgorithm: "template_matching",
        multiScaleSearch: false,
        colorSpace: "rgb",
        edgeDetection: false,
        ocrEnabled: false,
      },
      logging: {
        level: "info",
        screenshotOnError: true,
        consoleOutput: true,
        detailedMatching: false,
      },
      performance: {
        maxParallelActions: 1,
        cacheImages: true,
        optimizeSearch: true,
      },
      mouse: {
        click_hold_duration: 100,
        click_release_delay: 50,
        click_safety_release: true,
        double_click_interval: 300,
        drag_start_delay: 100,
        drag_end_delay: 100,
        drag_default_duration: 500,
        move_default_duration: 500,
        safety_release_delay: 50,
      },
      keyboard: {
        key_hold_duration: 50,
        key_release_delay: 50,
        typing_interval: 50,
        hotkey_hold_duration: 100,
        hotkey_press_interval: 50,
      },
      find: {
        default_timeout: 30000,
        default_retry_count: 0,
        search_interval: 500,
      },
      wait: {
        pause_before_action: 0,
        pause_after_action: 0,
      },
    };
  }

  /**
   * Convert image URL to base64
   */
  private async imageUrlToBase64(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";

      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Failed to get canvas context"));
          return;
        }

        ctx.drawImage(img, 0, 0);
        const base64 = canvas.toDataURL("image/png").split(",")[1] || "";
        resolve(base64);
      };

      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = url;
    });
  }

  /**
   * Get image dimensions
   */
  private async getImageDimensions(
    url: string
  ): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.width, height: img.height });
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = url;
    });
  }

  /**
   * Get image format from filename
   */
  private getImageFormat(filename: string): "png" | "jpg" | "jpeg" {
    const ext = filename.split(".").pop()?.toLowerCase();
    if (ext === "jpg" || ext === "jpeg") return "jpeg";
    return "png";
  }

  /**
   * Calculate SHA256 hash of data
   */
  private async calculateHash(data: string): Promise<string> {
    const msgBuffer = new TextEncoder().encode(data);
    const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  /**
   * Validate configuration against schema
   */
  validateConfiguration(config: QontinuiConfig): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    // Check version
    if (!config.version || !config.version.match(/^\d+\.\d+\.\d+$/)) {
      errors.push("Invalid version format");
    }

    // Check metadata
    if (!config.metadata?.name) {
      errors.push("Configuration name is required");
    }

    // Check images
    if (!Array.isArray(config.images)) {
      errors.push("Images must be an array");
    }

    // Check workflows
    if (!Array.isArray(config.workflows)) {
      errors.push("Workflows must be an array");
    }

    // Validate workflow structure
    (config.workflows || []).forEach((workflow) => {
      if (!workflow.id || !workflow.name) {
        errors.push(
          `Workflow missing required fields: ${workflow.id || "unknown"}`
        );
      }
      if (workflow.format !== "graph") {
        errors.push(
          `Workflow ${workflow.id} has invalid format: ${workflow.format}`
        );
      }
      if (!workflow.connections || typeof workflow.connections !== "object") {
        errors.push(`Workflow ${workflow.id} missing connections object`);
      }
    });

    // Validate workflow connections
    (config.workflows || []).forEach((workflow) => {
      // Skip validation if workflow is invalid
      if (!workflow || !workflow.id) {
        errors.push("Workflow missing required ID");
        return;
      }

      try {
        const validationResult = validateWorkflowConnections(workflow);

        // Add errors to the main errors array
        errors.push(
          ...validationResult.errors.map(
            (e) => `Workflow ${workflow.id}: ${e.message}`
          )
        );

        // Log warnings (don't fail export)
        validationResult.warnings.forEach((w) => {
          console.warn(`Workflow ${workflow.id}: ${w.message}`);
        });
      } catch (error) {
        console.error(`Error validating workflow ${workflow.id}:`, error);
        errors.push(
          `Workflow ${workflow.id}: Validation failed - ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    });

    // Check states
    if (!Array.isArray(config.states) || config.states.length === 0) {
      errors.push("At least one state is required");
    }

    // Check transitions
    if (!Array.isArray(config.transitions)) {
      errors.push("Transitions must be an array");
    }

    // Validate state references in transitions
    const stateIds = new Set((config.states || []).map((s) => s.id));
    (config.transitions || []).forEach((transition) => {
      if (transition.type === "OutgoingTransition") {
        const ft = transition as ExportOutgoingTransition;
        if (!stateIds.has(ft.fromState)) {
          errors.push(
            `Transition ${ft.id} references unknown fromState: ${ft.fromState}`
          );
        }
        if (!stateIds.has(ft.toState)) {
          errors.push(
            `Transition ${ft.id} references unknown toState: ${ft.toState}`
          );
        }
      }
    });

    // Validate workflow references
    const workflowIds = new Set((config.workflows || []).map((w) => w.id));
    (config.transitions || []).forEach((transition) => {
      (transition.workflows || []).forEach((workflowId) => {
        if (!workflowIds.has(workflowId)) {
          errors.push(
            `Transition ${transition.id} references unknown workflow: ${workflowId}`
          );
        }
      });
    });

    // Validate image references
    const imageValidation = this.validateImageReferences(config);
    errors.push(...imageValidation.errors);

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate that all image references in workflows and states exist
   */
  private validateImageReferences(config: QontinuiConfig): {
    errors: string[];
    warnings: string[];
    missingRefs: Array<{
      location: string;
      imageId: string;
      imageName?: string;
    }>;
  } {
    const errors: string[] = [];
    const warnings: string[] = [];
    const missingRefs: Array<{
      location: string;
      imageId: string;
      imageName?: string;
    }> = [];

    // Build a set of all valid image IDs from the images array
    const validImageIds = new Set<string>();
    const imageIdToName = new Map<string, string>();

    (config.images || []).forEach((img) => {
      validImageIds.add(img.id);
      imageIdToName.set(img.id, img.name);
    });

    // Check workflow actions for image references
    (config.workflows || []).forEach((workflow) => {
      (workflow.actions || []).forEach((action) => {
        const imageId = this.extractImageIdFromAction(action);
        if (imageId && !validImageIds.has(imageId)) {
          const location = `Workflow ${workflow.name || workflow.id}: Action ${action.type}`;
          errors.push(
            `${location} references non-existent image ID: ${imageId}`
          );
          missingRefs.push({ location, imageId });
        }
      });
    });

    // Check state images for pattern image references
    (config.states || []).forEach((state) => {
      (state.stateImages || []).forEach((stateImage) => {
        (stateImage.patterns || []).forEach((pattern) => {
          // Pattern.imageId contains the image ID reference (updated from pattern.image)
          const imageRef = (pattern as any).imageId || (pattern as any).image; // Support both for compatibility
          if (imageRef && !validImageIds.has(imageRef)) {
            const location = `State ${state.name || state.id}: StateImage ${stateImage.name}`;
            errors.push(
              `${location} references non-existent image ID: ${imageRef}`
            );
            missingRefs.push({
              location,
              imageId: imageRef,
              imageName: pattern.name || stateImage.name,
            });
          }
        });
      });
    });

    return { errors, warnings, missingRefs };
  }

  /**
   * Extract image ID from action config (if any)
   */
  private extractImageIdFromAction(action: any): string | null {
    if (!action || !action.config) return null;

    // FIND, CLICK, EXISTS, VANISH actions may have imageId
    if (action.config.imageId) {
      return action.config.imageId;
    }

    // Some actions may have target.imageId
    if (action.config.target && action.config.target.imageId) {
      return action.config.target.imageId;
    }

    return null;
  }

  /**
   * Download configuration as JSON file
   */
  downloadConfiguration(config: QontinuiConfig, filename?: string) {
    const json = JSON.stringify(config, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = filename || `qontinui_config_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
