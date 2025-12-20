import {
  QontinuiConfig,
  ConfigMetadata,
  ImageAsset as ExportImageAsset,
  Workflow as ExportWorkflow,
  State as ExportState,
  Transition as ExportTransition,
  OutgoingTransition as ExportOutgoingTransition,
  ConfigSettings,
  Action as ExportAction,
  ActionConfig as ExportActionConfig,
  WorkflowConnections,
  ActionOutputs,
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
import type { ProjectSettings } from "../types/project-settings";

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
    _settings?: Partial<ProjectSettings>,
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
      const transitionWithWorkflows = transition as Transition & {
        inlineWorkflows?: Workflow[];
      };
      if (transitionWithWorkflows.inlineWorkflows) {
        allWorkflows.push(...transitionWithWorkflows.inlineWorkflows);
      }
    });

    // Ensure settings is properly converted to ConfigSettings
    // Check if settings is already ConfigSettings (has defaultTimeout instead of default_timeout)
    const configSettings =
      settings &&
      typeof settings === "object" &&
      "execution" in settings &&
      typeof settings.execution === "object" &&
      settings.execution &&
      "defaultTimeout" in settings.execution
        ? (settings as ConfigSettings)
        : this.convertSettings(
            settings as Partial<ProjectSettings> | undefined
          );

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
      settings: configSettings,
    };

    return config;
  }

  /**
   * Convert ProjectSettings to ConfigSettings format
   */
  private convertSettings(
    projectSettings: Partial<ProjectSettings> | undefined
  ): ConfigSettings {
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
      // Deep clone connections to avoid mutating frozen Immer state
      let connections: WorkflowConnections = workflow.connections
        ? structuredClone(workflow.connections)
        : {};

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
          (outputs: ActionOutputs) => {
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
          const generatedConnections: WorkflowConnections = {};
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

      const exported: ExportWorkflow = {
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
  private exportActions(actions: Action[], states?: State[]): ExportAction[] {
    if (!actions || !Array.isArray(actions)) {
      return [];
    }

    // Filter out any null/undefined actions
    return actions
      .filter((action) => action != null)
      .map((action) => {
        const actionWithExtras = action as Action & {
          base?: Record<string, unknown>;
          execution?: Record<string, unknown>;
          timeout?: number;
          retryCount?: number;
          continueOnError?: boolean;
        };

        const exported: ExportAction = {
          id: action.id,
          type: action.type as ExportAction["type"],
          config: this.transformActionConfig(action, states),
        };

        // Add optional name if present
        if (action.name) {
          exported.name = action.name;
        }

        // Export position for graph visualization
        if (action.position) {
          exported.position = action.position;
        }

        // Export timeout and retry settings
        if (actionWithExtras.timeout !== undefined) {
          exported.timeout = actionWithExtras.timeout;
        }
        if (actionWithExtras.retryCount !== undefined) {
          exported.retryCount = actionWithExtras.retryCount;
        }
        if (actionWithExtras.continueOnError !== undefined) {
          exported.continueOnError = actionWithExtras.continueOnError;
        }

        return exported;
      });
  }

  /**
   * Transform action config for export
   * Converts internal field names to export schema format
   */
  private transformActionConfig(
    action: Action,
    states?: State[]
  ): ExportActionConfig {
    // Deep clone to avoid mutating frozen Immer state
    const config = action.config
      ? (structuredClone(action.config) as Record<string, unknown>)
      : ({} as Record<string, unknown>);

    // Handle GO_TO_STATE action: convert 'states' array to 'stateIds' array and add stateNames
    if (action.type === "GO_TO_STATE") {
      let targetStateIds: string[] = [];

      // Get state IDs from either 'states' or 'stateIds' field
      if (config.states && Array.isArray(config.states)) {
        targetStateIds = config.states as string[];
        config.stateIds = targetStateIds;
        delete config.states;
      } else if (config.stateIds && Array.isArray(config.stateIds)) {
        targetStateIds = config.stateIds as string[];
      }

      // Always add stateNames array for the runner
      if (targetStateIds.length > 0) {
        const stateNames = targetStateIds.map((stateId: string) => {
          const state = states?.find((s) => s.id === stateId);
          return state ? state.name : stateId;
        });
        config.stateNames = stateNames;
      } else {
        // Ensure stateNames exists even if empty
        config.stateNames = [];
      }
    }

    // Handle TYPE action: convert UI textSource format to schema format
    if (action.type === "TYPE") {
      // If textSource is the string "stateString", convert to TextSource object
      if (config.textSource === "stateString") {
        // Create TextSource object from UI fields
        if (config.selectedState) {
          config.textSource = {
            stateId: config.selectedState as string,
            stringIds: (config.selectedStateStrings as string[]) || [],
            useAll: (config.useAllStateStrings as boolean) || false,
          };
        } else {
          // No state selected, remove textSource
          delete config.textSource;
        }

        // Clean up UI-specific fields
        delete config.selectedState;
        delete config.selectedStateStrings;
        delete config.useAllStateStrings;
      } else if (config.textSource === "manual") {
        // Manual text mode - remove textSource field, keep text field only if non-empty
        delete config.textSource;

        // Remove empty text field
        if (config.text !== undefined) {
          const textValue = config.text;
          if (
            !textValue ||
            (typeof textValue === "string" && !textValue.trim())
          ) {
            delete config.text;
          }
        }
      }

      // If textSource is an object (already converted), remove empty text field
      if (typeof config.textSource === "object" && config.textSource !== null) {
        if (config.text !== undefined) {
          const textValue = config.text;
          if (
            !textValue ||
            (typeof textValue === "string" && !textValue.trim())
          ) {
            delete config.text;
          }
        }
      }
    }

    // Handle RUN_WORKFLOW action: convert UI field names to schema format
    if (action.type === "RUN_WORKFLOW") {
      // Transform enableRepeat/maxRepeats/repeatDelay/repeatUntilSuccess -> repetition object
      if (
        config.enableRepeat !== undefined ||
        config.maxRepeats !== undefined ||
        config.repeatDelay !== undefined ||
        config.repeatUntilSuccess !== undefined
      ) {
        const enabled = (config.enableRepeat as boolean) ?? false;

        // Only include repetition object if enabled or if any repeat fields are set
        if (
          enabled ||
          config.maxRepeats ||
          config.repeatDelay ||
          config.repeatUntilSuccess
        ) {
          config.workflowRepetition = {
            enabled: enabled,
            maxRepeats: (config.maxRepeats as number) ?? 10,
            ...(config.repeatDelay !== undefined && {
              delay: config.repeatDelay as number,
            }),
            ...(config.repeatUntilSuccess !== undefined && {
              untilSuccess: config.repeatUntilSuccess as boolean,
            }),
          };
        }

        // Remove old UI field names
        delete config.enableRepeat;
        delete config.maxRepeats;
        delete config.repeatDelay;
        delete config.repeatUntilSuccess;
      }
    }

    // Handle stateImage target: add stateName for readability in exported JSON
    if (
      action.type === "FIND" &&
      config.target &&
      typeof config.target === "object"
    ) {
      const target = config.target as Record<string, unknown>;
      if (target.type === "stateImage" && target.stateId) {
        const stateId = target.stateId as string;
        const state = states?.find((s) => s.id === stateId);
        if (state) {
          target.stateName = state.name;
        }
      }
    }

    // Handle target transformation for MOUSE_MOVE, CLICK, and other actions
    // Convert UI string values like "Last Find Result" to proper target objects
    if (config.target && typeof config.target === "string") {
      const targetString = config.target;

      if (targetString === "Last Find Result") {
        config.target = { type: "lastFindResult" };
      } else if (targetString === "Current Position") {
        config.target = { type: "currentPosition" };
      } else if (targetString === "Coordinates") {
        // Convert to coordinates target with x, y values
        config.target = {
          type: "coordinates",
          coordinates: {
            x: (config.x as number) || 0,
            y: (config.y as number) || 0,
          },
        };
        // Remove flat x, y fields
        delete config.x;
        delete config.y;
      }
      // Note: StateImage, StateRegion, StateLocation would need more complex handling
      // with additional data from the UI, not implemented here yet
    }

    // Handle target transformation for the 3 new target types
    // These are likely already objects from the UI, but we ensure proper field mapping
    if (config.target && typeof config.target === "object") {
      const target = config.target as Record<string, unknown>;

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

    return config as ExportActionConfig;
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
      const stateRegions: Array<Record<string, unknown>> = [];
      const stateLocations: Array<Record<string, unknown>> = [];
      const regionIds = new Set<string>();
      const locationIds = new Set<string>();

      // Add regions from state definition first
      (state.regions || []).forEach((region) => {
        if (!regionIds.has(region.id)) {
          regionIds.add(region.id);
          // Include all region properties including monitors
          // Note: 'fixed' is not present in source type, only in export schema
          stateRegions.push({
            id: region.id,
            name: region.name,
            bounds: region.bounds,
            isSearchRegion: region.isSearchRegion,
            referenceImageId: region.referenceImageId,
            position: region.position,
            offsetX: region.offsetX,
            offsetY: region.offsetY,
            monitors: region.monitors,
          });
        }
      });

      // Add locations from state definition first
      (state.locations || []).forEach((location) => {
        if (!locationIds.has(location.id)) {
          locationIds.add(location.id);
          // Include all location properties including monitors
          stateLocations.push({
            id: location.id,
            name: location.name,
            x: location.x,
            y: location.y,
            anchor: location.anchor,
            fixed: location.fixed,
            referenceImageId: location.referenceImageId,
            position: location.position,
            monitors: location.monitors,
          });
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
                const regionWithMonitors = region as typeof region & {
                  monitors?: number[];
                };
                stateRegions.push({
                  id: region.id,
                  name: region.name,
                  bounds: region.bounds,
                  fixed: true,
                  isSearchRegion: region.type === "SearchRegion",
                  isInteractionRegion: region.type === "StateRegion",
                  monitors: regionWithMonitors.monitors,
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
                const locationWithMonitors = location as typeof location & {
                  monitors?: number[];
                };
                stateLocations.push({
                  id: location.id,
                  name: location.name,
                  x: location.x,
                  y: location.y,
                  fixed: true,
                  monitors: locationWithMonitors.monitors,
                });
              }
            });
          }
        });
      }

      // Deduplicate stateImages
      const stateImages: Array<Record<string, unknown>> = [];
      const imageIds = new Set<string>();
      (state.stateImages || []).forEach((img) => {
        if (!imageIds.has(img.id)) {
          imageIds.add(img.id);
          const patternWithExtras = img.patterns.map((pattern) => {
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

            const patternWithMask = pattern as typeof pattern & {
              mask?: string;
            };

            return {
              id: pattern.id,
              name: pattern.name,
              imageId: imageIdRef, // Use imageId instead of image
              mask: patternWithMask.mask,
              searchRegions: pattern.searchRegions || [],
              fixed: pattern.fixed,
              similarity: pattern.similarity,
              targetPosition: pattern.targetPosition,
              offsetX: pattern.offsetX,
              offsetY: pattern.offsetY,
            };
          });

          stateImages.push({
            id: img.id,
            name: img.name,
            patterns: patternWithExtras,
            shared: img.shared,
            source: img.source,
            probability: img.probability,
            searchRegions: img.searchRegions || [],
            // Include monitors for multi-monitor support
            monitors: img.monitors,
            searchMode: img.searchMode,
          });
        }
      });

      // Deduplicate strings
      const stateStrings: Array<Record<string, unknown>> = [];
      const stringIds = new Set<string>();
      (state.strings || []).forEach((str) => {
        if (!stringIds.has(str.id)) {
          stringIds.add(str.id);
          // Include all string properties including monitors
          stateStrings.push({
            id: str.id,
            name: str.name,
            value: str.value,
            identifier: str.identifier,
            inputText: str.inputText,
            expectedText: str.expectedText,
            regexPattern: str.regexPattern,
            monitors: str.monitors,
          });
        }
      });

      return {
        id: state.id,
        name: state.name,
        description: state.description,
        stateImages: stateImages as unknown as ExportState["stateImages"],
        regions: stateRegions as unknown as ExportState["regions"],
        locations: stateLocations as unknown as ExportState["locations"],
        strings: stateStrings as unknown as ExportState["strings"],
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

      const baseTransition = {
        id: transition.id,
        workflows,
        timeout: transition.timeout,
        retryCount: transition.retryCount,
      };

      // Export OutgoingTransition
      if (transition.type === "OutgoingTransition") {
        const outgoing = transition as Transition & {
          fromState?: string;
          toState?: string;
          staysVisible?: boolean;
          activateStates?: string[];
          deactivateStates?: string[];
        };

        const fromState = outgoing.fromState || "";
        const activateStates = outgoing.activateStates || [];
        const toState =
          outgoing.toState ||
          (activateStates.length > 0 ? activateStates[0] : "");

        return {
          ...baseTransition,
          type: "OutgoingTransition" as const,
          fromState,
          toState,
          staysVisible: outgoing.staysVisible || false,
          activateStates: activateStates,
          deactivateStates: outgoing.deactivateStates || [],
        };
      }
      // Export IncomingTransition
      else {
        const incoming = transition as Transition & {
          toState?: string;
        };

        return {
          ...baseTransition,
          type: "IncomingTransition" as const,
          toState: incoming.toState || "",
        };
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

    // Validate that state elements have corresponding screens (monitors)
    (config.states || []).forEach((state) => {
      if (state.stateImages && state.stateImages.length > 0) {
        state.stateImages.forEach((stateImage) => {
          if (!stateImage.monitors || stateImage.monitors.length === 0) {
            errors.push(
              `State "${state.name || state.id}": StateImage "${stateImage.name || stateImage.id}" has no monitor assignments. All state elements must have corresponding screens.`
            );
          }
        });
      }
    });

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
        const imageId = this.extractImageIdFromAction(
          action as unknown as Record<string, unknown>
        );
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
          const patternWithImageId = pattern as unknown as Record<
            string,
            unknown
          > & {
            imageId?: string;
            image?: string;
            name?: string;
          };
          const imageRef =
            patternWithImageId.imageId || patternWithImageId.image; // Support both for compatibility
          if (imageRef && !validImageIds.has(imageRef)) {
            const location = `State ${state.name || state.id}: StateImage ${stateImage.name}`;
            errors.push(
              `${location} references non-existent image ID: ${imageRef}`
            );
            missingRefs.push({
              location,
              imageId: imageRef,
              imageName: patternWithImageId.name || stateImage.name,
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
  private extractImageIdFromAction(
    action: Record<string, unknown>
  ): string | null {
    if (!action || !action.config) return null;

    const config = action.config as Record<string, unknown>;

    // FIND, CLICK, EXISTS, VANISH actions may have imageId
    if (config.imageId && typeof config.imageId === "string") {
      return config.imageId;
    }

    // Some actions may have target.imageId
    const target = config.target as Record<string, unknown> | undefined;
    if (target?.imageId && typeof target.imageId === "string") {
      return target.imageId;
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
