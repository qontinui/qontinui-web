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
  ActionConfig
} from './export-schema';

import { validateWorkflowConnections } from './workflow-validator';

// Import types from new action schema
import { Action, ActionType, BaseActionSettings, ExecutionSettings, Workflow } from './action-schema';

// Import types from automation context
import type {
  ImageAsset,
  State,
  Transition,
  WorkflowReference
} from '../contexts/automation-context/types';
import { Screenshot } from '../types/Screenshot';

export class ConfigExporter {
  private version = '2.0.0'; // Updated to 2.0.0 for workflows
  private settings: any = null;

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
    settings?: any,
    screenshots?: Screenshot[]
  ): Promise<QontinuiConfig> {
    const now = new Date().toISOString();

    // Store settings for use in other methods
    this.settings = settings || this.getDefaultSettings();

    const config: QontinuiConfig = {
      version: this.version,
      metadata: {
        name: metadata?.name || 'Untitled Automation',
        description: metadata?.description,
        author: metadata?.author,
        created: metadata?.created || now,
        modified: now,
        tags: metadata?.tags || [],
        targetApplication: metadata?.targetApplication,
        compatibleVersions: {
          runner: '2.0.0',
          website: '2.0.0'
        }
      },
      images: await this.exportImages(images || [], screenshots),
      workflows: this.exportWorkflows(workflows || [], states || []),
      states: this.exportStates(states || [], screenshots),
      transitions: this.exportTransitions(transitions || [], states || []),
      categories: categories || ['Main'],
      settings: this.convertSettings(settings) || this.getDefaultSettings()
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
        failureStrategy: projectSettings.execution?.failure_strategy || 'continue',
        headless: false,
      },
      recognition: {
        defaultThreshold: projectSettings.recognition?.default_threshold || 0.70,
        searchAlgorithm: 'template_matching',
        multiScaleSearch: projectSettings.recognition?.multi_scale_search ?? false,
        colorSpace: projectSettings.recognition?.color_space || 'rgb',
        edgeDetection: projectSettings.recognition?.edge_detection || false,
        ocrEnabled: projectSettings.recognition?.ocr_enabled || false,
      },
      logging: {
        level: 'info',
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
        click_safety_release: projectSettings.mouse?.click_safety_release ?? true,
        double_click_interval: projectSettings.mouse?.double_click_interval || 300,
        drag_start_delay: projectSettings.mouse?.drag_start_delay || 100,
        drag_end_delay: projectSettings.mouse?.drag_end_delay || 100,
        drag_default_duration: projectSettings.mouse?.drag_default_duration || 500,
        move_default_duration: projectSettings.mouse?.move_default_duration || 500,
        safety_release_delay: projectSettings.mouse?.safety_release_delay || 50,
      },
      keyboard: {
        key_hold_duration: projectSettings.keyboard?.key_hold_duration || 50,
        key_release_delay: projectSettings.keyboard?.key_release_delay || 50,
        typing_interval: projectSettings.keyboard?.typing_interval || 50,
        hotkey_hold_duration: projectSettings.keyboard?.hotkey_hold_duration || 100,
        hotkey_press_interval: projectSettings.keyboard?.hotkey_press_interval || 50,
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
   * Convert images to export format with base64 encoding
   */
  private async exportImages(images: ImageAsset[], screenshots?: Screenshot[]): Promise<ExportImageAsset[]> {
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
          hash: await this.calculateHash(base64Data)
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
          const base64Data = screenshot.imageData.split(',')[1] || screenshot.imageData;

          exportedImages.push({
            id: `screenshot_${screenshot.id}`,
            name: screenshot.name,
            data: base64Data,
            format: 'png',
            width: screenshot.width,
            height: screenshot.height,
            hash: await this.calculateHash(base64Data)
          });
        } catch (error) {
          console.error(`Failed to export screenshot ${screenshot.name}:`, error);
        }
      }
    }

    return exportedImages;
  }

  /**
   * Convert workflows to export format
   */
  private exportWorkflows(workflows: Workflow[], states?: State[]): ExportWorkflow[] {
    if (!workflows || !Array.isArray(workflows)) {
      return [];
    }

    return workflows.map(workflow => ({
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      category: workflow.category,
      format: 'graph' as const,
      version: workflow.version || '1.0.0',
      actions: this.exportActions(workflow.actions, states),
      connections: workflow.connections || {},
      metadata: workflow.metadata || {}
    }));
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
      .filter(action => action != null)
      .map(action => {
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
        if (action.timeout !== undefined) {
          exported.timeout = action.timeout;
        }
        if (action.retryCount !== undefined) {
          exported.retryCount = action.retryCount;
        }
        if (action.continueOnError !== undefined) {
          exported.continueOnError = action.continueOnError;
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
    if (action.type === 'GO_TO_STATE') {
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
          const state = states?.find(s => s.id === stateId);
          return state ? state.name : stateId;
        });
        (config as any).stateNames = stateNames;
      } else {
        // Ensure stateNames exists even if empty
        (config as any).stateNames = [];
      }
    }

    // Handle TYPE action: convert UI textSource format to schema format
    if (action.type === 'TYPE') {
      // If textSource is the string "stateString", convert to TextSource object
      if ((config as any).textSource === 'stateString') {
        // Create TextSource object from UI fields
        if ((config as any).selectedState) {
          (config as any).textSource = {
            stateId: (config as any).selectedState,
            stringIds: (config as any).selectedStateStrings || [],
            useAll: (config as any).useAllStateStrings || false
          };
        } else {
          // No state selected, remove textSource
          delete (config as any).textSource;
        }

        // Clean up UI-specific fields
        delete (config as any).selectedState;
        delete (config as any).selectedStateStrings;
        delete (config as any).useAllStateStrings;
      } else if ((config as any).textSource === 'manual') {
        // Manual text mode - remove textSource field, keep text field
        delete (config as any).textSource;
      }
    }

    // Handle RUN_WORKFLOW action: convert UI field names to schema format
    if (action.type === 'RUN_WORKFLOW') {
      // Transform enableRepeat/maxRepeats/repeatDelay/repeatUntilSuccess -> repetition object
      if ((config as any).enableRepeat !== undefined ||
          (config as any).maxRepeats !== undefined ||
          (config as any).repeatDelay !== undefined ||
          (config as any).repeatUntilSuccess !== undefined) {

        const enabled = (config as any).enableRepeat ?? false;

        // Only include repetition object if enabled or if any repeat fields are set
        if (enabled || (config as any).maxRepeats || (config as any).repeatDelay || (config as any).repeatUntilSuccess) {
          (config as any).repetition = {
            enabled: enabled,
            maxRepeats: (config as any).maxRepeats ?? 10,
            ...(((config as any).repeatDelay !== undefined) && { delay: (config as any).repeatDelay }),
            ...(((config as any).repeatUntilSuccess !== undefined) && { untilSuccess: (config as any).repeatUntilSuccess })
          };
        }

        // Remove old UI field names
        delete (config as any).enableRepeat;
        delete (config as any).maxRepeats;
        delete (config as any).repeatDelay;
        delete (config as any).repeatUntilSuccess;
      }
    }

    // Handle FIND_STATE_IMAGE action: convert 'state' to 'stateId'
    if (action.type === 'FIND_STATE_IMAGE' && (config as any).state) {
      const stateId = (config as any).state;
      const state = states?.find(s => s.id === stateId);

      // Convert UI field 'state' to schema field 'stateId'
      (config as any).stateId = stateId;
      delete (config as any).state;

      // Add stateName for readability in exported JSON
      if (state) {
        (config as any).stateName = state.name;
      }
    }

    return config;
  }


  /**
   * Convert states to export format
   */
  private exportStates(states: State[], screenshots?: Screenshot[]): ExportState[] {
    if (!states || !Array.isArray(states)) {
      return [];
    }

    return states.map(state => {
      // Collect state objects from state definition and screenshots with deduplication
      const stateRegions: any[] = [];
      const stateLocations: any[] = [];
      const regionIds = new Set<string>();
      const locationIds = new Set<string>();

      // Add regions from state definition first
      (state.regions || []).forEach(region => {
        if (!regionIds.has(region.id)) {
          regionIds.add(region.id);
          stateRegions.push(region);
        }
      });

      // Add locations from state definition first
      (state.locations || []).forEach(location => {
        if (!locationIds.has(location.id)) {
          locationIds.add(location.id);
          stateLocations.push(location);
        }
      });

      // Add regions and locations from screenshots if not already present
      if (screenshots) {
        screenshots.forEach(screenshot => {
          if (screenshot.associatedStates.includes(state.id)) {
            // Add regions associated with this state
            screenshot.regions.forEach(region => {
              if (region.stateId === state.id && !regionIds.has(region.id)) {
                regionIds.add(region.id);
                stateRegions.push({
                  id: region.id,
                  name: region.name,
                  bounds: region.bounds,
                  fixed: true,
                  isSearchRegion: region.type === 'SearchRegion',
                  isInteractionRegion: region.type === 'StateRegion'
                });
              }
            });

            // Add locations associated with this state
            screenshot.locations.forEach(location => {
              if (location.stateId === state.id && !locationIds.has(location.id)) {
                locationIds.add(location.id);
                stateLocations.push({
                  id: location.id,
                  name: location.name,
                  x: location.x,
                  y: location.y,
                  fixed: true
                });
              }
            });
          }
        });
      }

      // Deduplicate stateImages
      const stateImages: any[] = [];
      const imageIds = new Set<string>();
      (state.stateImages || []).forEach(img => {
        if (!imageIds.has(img.id)) {
          imageIds.add(img.id);
          stateImages.push({
            id: img.id,
            name: img.name,
            patterns: img.patterns.map(pattern => ({
              id: pattern.id,
              name: pattern.name,
              image: pattern.image,
              mask: pattern.mask,
              searchRegions: pattern.searchRegions || [],
              fixed: pattern.fixed,
              similarity: pattern.similarity,
              targetPosition: pattern.targetPosition,
              offsetX: pattern.offsetX,
              offsetY: pattern.offsetY
            })),
            shared: img.shared,
            source: img.source,
            probability: img.probability,
            searchRegions: img.searchRegions || []
          });
        }
      });

      // Deduplicate strings
      const stateStrings: any[] = [];
      const stringIds = new Set<string>();
      (state.strings || []).forEach(str => {
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
        position: state.position,
        isInitial: state.initial || false,
        isFinal: false
      };
    });
  }

  /**
   * Convert transitions to export format
   */
  private exportTransitions(transitions: Transition[], states?: State[]): ExportTransition[] {
    if (!transitions || !Array.isArray(transitions)) {
      return [];
    }

    return transitions.map(transition => {
      // Separate WorkflowReference[] into referenced IDs and inline workflows
      const workflowRefs = transition.workflows || [];
      const workflows: string[] = [];
      const inlineWorkflows: any[] = [];

      workflowRefs.forEach(ref => {
        if (ref.type === 'reference') {
          workflows.push(ref.workflowId);
        } else if (ref.type === 'inline') {
          inlineWorkflows.push(ref.workflow);
        }
      });

      const baseTransition: any = {
        id: transition.id,
        workflows,
        ...(inlineWorkflows.length > 0 ? { inlineWorkflows } : {}),
        timeout: transition.timeout,
        retryCount: transition.retryCount
      };

      // Export OutgoingTransition
      if (transition.type === 'OutgoingTransition') {
        const fromState = transition.fromState || '';
        const activateStates = transition.activateStates || [];
        const toState = transition.toState || (activateStates.length > 0 ? activateStates[0] : '');

        return {
          ...baseTransition,
          type: 'OutgoingTransition',
          fromState,
          toState,
          staysVisible: transition.staysVisible || false,
          activateStates: activateStates,
          deactivateStates: transition.deactivateStates || []
        } as ExportOutgoingTransition;
      }
      // Export IncomingTransition
      else {
        return {
          ...baseTransition,
          type: 'IncomingTransition',
          toState: transition.toState || ''
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
        failureStrategy: 'continue',
        headless: false
      },
      recognition: {
        defaultThreshold: 0.70,
        searchAlgorithm: 'template_matching',
        multiScaleSearch: false,
        colorSpace: 'rgb',
        edgeDetection: false,
        ocrEnabled: false
      },
      logging: {
        level: 'info',
        screenshotOnError: true,
        consoleOutput: true,
        detailedMatching: false
      },
      performance: {
        maxParallelActions: 1,
        cacheImages: true,
        optimizeSearch: true
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
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        ctx.drawImage(img, 0, 0);
        const base64 = canvas.toDataURL('image/png').split(',')[1];
        resolve(base64);
      };

      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = url;
    });
  }

  /**
   * Get image dimensions
   */
  private async getImageDimensions(url: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.width, height: img.height });
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = url;
    });
  }

  /**
   * Get image format from filename
   */
  private getImageFormat(filename: string): 'png' | 'jpg' | 'jpeg' {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (ext === 'jpg' || ext === 'jpeg') return 'jpeg';
    return 'png';
  }

  /**
   * Calculate SHA256 hash of data
   */
  private async calculateHash(data: string): Promise<string> {
    const msgBuffer = new TextEncoder().encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Validate configuration against schema
   */
  validateConfiguration(config: QontinuiConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check version
    if (!config.version || !config.version.match(/^\d+\.\d+\.\d+$/)) {
      errors.push('Invalid version format');
    }

    // Check metadata
    if (!config.metadata?.name) {
      errors.push('Configuration name is required');
    }

    // Check images
    if (!Array.isArray(config.images)) {
      errors.push('Images must be an array');
    }

    // Check workflows
    if (!Array.isArray(config.workflows)) {
      errors.push('Workflows must be an array');
    }

    // Validate workflow structure
    (config.workflows || []).forEach(workflow => {
      if (!workflow.id || !workflow.name) {
        errors.push(`Workflow missing required fields: ${workflow.id || 'unknown'}`);
      }
      if (workflow.format !== 'graph') {
        errors.push(`Workflow ${workflow.id} has invalid format: ${workflow.format}`);
      }
      if (!workflow.connections || typeof workflow.connections !== 'object') {
        errors.push(`Workflow ${workflow.id} missing connections object`);
      }
    });

    // Validate workflow connections
    (config.workflows || []).forEach(workflow => {
      // Skip validation if workflow is invalid
      if (!workflow || !workflow.id) {
        errors.push('Workflow missing required ID');
        return;
      }

      try {
        const validationResult = validateWorkflowConnections(workflow);

        // Add errors to the main errors array
        errors.push(...validationResult.errors.map(e =>
          `Workflow ${workflow.id}: ${e.message}`
        ));

        // Log warnings (don't fail export)
        validationResult.warnings.forEach(w => {
          console.warn(`Workflow ${workflow.id}: ${w.message}`);
        });
      } catch (error) {
        console.error(`Error validating workflow ${workflow.id}:`, error);
        errors.push(`Workflow ${workflow.id}: Validation failed - ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    });

    // Check states
    if (!Array.isArray(config.states) || config.states.length === 0) {
      errors.push('At least one state is required');
    }

    // Check transitions
    if (!Array.isArray(config.transitions)) {
      errors.push('Transitions must be an array');
    }

    // Validate state references in transitions
    const stateIds = new Set((config.states || []).map(s => s.id));
    (config.transitions || []).forEach(transition => {
      if (transition.type === 'OutgoingTransition') {
        const ft = transition as ExportOutgoingTransition;
        if (!stateIds.has(ft.fromState)) {
          errors.push(`Transition ${ft.id} references unknown fromState: ${ft.fromState}`);
        }
        if (!stateIds.has(ft.toState)) {
          errors.push(`Transition ${ft.id} references unknown toState: ${ft.toState}`);
        }
      }
    });

    // Validate workflow references
    const workflowIds = new Set((config.workflows || []).map(w => w.id));
    (config.transitions || []).forEach(transition => {
      (transition.workflows || []).forEach(workflowId => {
        if (!workflowIds.has(workflowId)) {
          errors.push(`Transition ${transition.id} references unknown workflow: ${workflowId}`);
        }
      });
    });

    // Validate image references
    const imageValidation = this.validateImageReferences(config);
    errors.push(...imageValidation.errors);

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate that all image references in workflows and states exist
   */
  private validateImageReferences(config: QontinuiConfig): {
    errors: string[];
    warnings: string[];
    missingRefs: Array<{ location: string; imageId: string; imageName?: string }>;
  } {
    const errors: string[] = [];
    const warnings: string[] = [];
    const missingRefs: Array<{ location: string; imageId: string; imageName?: string }> = [];

    // Build a set of all valid image IDs from the images array
    const validImageIds = new Set<string>();
    const imageIdToName = new Map<string, string>();

    (config.images || []).forEach(img => {
      validImageIds.add(img.id);
      imageIdToName.set(img.id, img.name);
    });

    // Check workflow actions for image references
    (config.workflows || []).forEach(workflow => {
      (workflow.actions || []).forEach(action => {
        const imageId = this.extractImageIdFromAction(action);
        if (imageId && !validImageIds.has(imageId)) {
          const location = `Workflow ${workflow.name || workflow.id}: Action ${action.type}`;
          errors.push(`${location} references non-existent image ID: ${imageId}`);
          missingRefs.push({ location, imageId });
        }
      });
    });

    // Check state images for pattern image references
    (config.states || []).forEach(state => {
      (state.stateImages || []).forEach(stateImage => {
        (stateImage.patterns || []).forEach(pattern => {
          // Pattern.image contains the image ID reference
          if (pattern.image && !validImageIds.has(pattern.image)) {
            const location = `State ${state.name || state.id}: StateImage ${stateImage.name}`;
            errors.push(`${location} references non-existent image ID: ${pattern.image}`);
            missingRefs.push({
              location,
              imageId: pattern.image,
              imageName: pattern.name || stateImage.name
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
   * Auto-fix broken image references by matching names
   */
  autoFixImageReferences(config: QontinuiConfig): {
    fixed: number;
    unfixed: number;
    details: string[];
  } {
    const details: string[] = [];
    let fixed = 0;
    let unfixed = 0;

    // Build name-to-ID mapping for available images
    const nameToImageId = new Map<string, string>();
    const base64ToImageId = new Map<string, string>();

    (config.images || []).forEach(img => {
      const normalizedName = img.name.toLowerCase().trim();
      nameToImageId.set(normalizedName, img.id);

      // Also map base64 data to image ID for legacy data
      // Image data is stored WITHOUT the data:image prefix, but we need to match both formats
      if (img.data) {
        // Store the bare base64 string
        base64ToImageId.set(img.data, img.id);

        // Also store with common data URL prefixes for matching
        base64ToImageId.set(`data:image/png;base64,${img.data}`, img.id);
        base64ToImageId.set(`data:image/jpeg;base64,${img.data}`, img.id);
        base64ToImageId.set(`data:image/jpg;base64,${img.data}`, img.id);
      }
    });

    // Fix workflow actions
    (config.workflows || []).forEach(workflow => {
      (workflow.actions || []).forEach(action => {
        const oldImageId = this.extractImageIdFromAction(action);
        if (oldImageId) {
          // Try to find a matching image by checking if any image ID matches
          const imageExists = (config.images || []).some(img => img.id === oldImageId);

          if (!imageExists) {
            // Try to find by name (if we have one)
            const actionImageName = this.extractImageNameFromAction(action);
            if (actionImageName) {
              const normalizedName = actionImageName.toLowerCase().trim();
              const newImageId = nameToImageId.get(normalizedName);

              if (newImageId) {
                // Fix the reference
                this.replaceImageIdInAction(action, oldImageId, newImageId);
                details.push(`Fixed ${workflow.name}: ${action.type} - matched "${actionImageName}"`);
                fixed++;
              } else {
                details.push(`Could not fix ${workflow.name}: ${action.type} - no image named "${actionImageName}"`);
                unfixed++;
              }
            } else {
              details.push(`Could not fix ${workflow.name}: ${action.type} - no name available to match`);
              unfixed++;
            }
          }
        }
      });
    });

    // Fix state image patterns
    (config.states || []).forEach(state => {
      (state.stateImages || []).forEach(stateImage => {
        (stateImage.patterns || []).forEach(pattern => {
          if (pattern.image) {
            // Check if this is base64 data instead of an ID (legacy format)
            if (pattern.image.startsWith('data:image/')) {
              // Try to find image by base64 data
              const matchedImageId = base64ToImageId.get(pattern.image);

              if (matchedImageId) {
                pattern.image = matchedImageId;
                details.push(`Fixed ${state.name}: ${stateImage.name} - converted base64 to image ID`);
                fixed++;
              } else {
                // Base64 data but no matching image asset - try by name
                const imageName = pattern.name || stateImage.name;
                const normalizedName = imageName.toLowerCase().trim();
                const newImageId = nameToImageId.get(normalizedName);

                if (newImageId) {
                  pattern.image = newImageId;
                  details.push(`Fixed ${state.name}: ${stateImage.name} - matched by name "${imageName}"`);
                  fixed++;
                } else {
                  details.push(`Could not fix ${state.name}: ${stateImage.name} - base64 data with no matching image asset`);
                  unfixed++;
                }
              }
            } else {
              // Regular image ID reference
              const imageExists = (config.images || []).some(img => img.id === pattern.image);

              if (!imageExists) {
                // Try to match by pattern name or state image name
                const imageName = pattern.name || stateImage.name;
                const normalizedName = imageName.toLowerCase().trim();
                const newImageId = nameToImageId.get(normalizedName);

                if (newImageId) {
                  pattern.image = newImageId;
                  details.push(`Fixed ${state.name}: ${stateImage.name} - matched "${imageName}"`);
                  fixed++;
                } else {
                  details.push(`Could not fix ${state.name}: ${stateImage.name} - no image named "${imageName}"`);
                  unfixed++;
                }
              }
            }
          }
        });
      });
    });

    return { fixed, unfixed, details };
  }

  /**
   * Extract image name from action for matching
   */
  private extractImageNameFromAction(action: any): string | null {
    // Some actions store the image name
    if (action.config && action.config.imageName) {
      return action.config.imageName;
    }
    return null;
  }

  /**
   * Replace image ID in action config
   */
  private replaceImageIdInAction(action: any, oldId: string, newId: string): void {
    if (!action || !action.config) return;

    if (action.config.imageId === oldId) {
      action.config.imageId = newId;
    }

    if (action.config.target && action.config.target.imageId === oldId) {
      action.config.target.imageId = newId;
    }
  }

  /**
   * Auto-fix broken workflow connections
   */
  autoFixBrokenConnections(config: QontinuiConfig): {
    fixed: number;
    details: string[];
  } {
    const details: string[] = [];
    let fixed = 0;

    (config.workflows || []).forEach(workflow => {
      if (!workflow.connections) return;

      // Build set of valid action IDs
      const validActionIds = new Set((workflow.actions || []).map(a => a.id));

      // Track which connection keys to delete
      const keysToDelete: string[] = [];

      Object.entries(workflow.connections).forEach(([actionId, outputs]) => {
        // If the source action doesn't exist, mark for deletion
        if (!validActionIds.has(actionId)) {
          keysToDelete.push(actionId);
          details.push(`Removed broken connection from non-existent action ${actionId} in workflow "${workflow.name || workflow.id}"`);
          fixed++;
          return;
        }

        // Check each output type and clean up broken target references
        ['main', 'success', 'error', 'parallel'].forEach((outputType) => {
          const connections = outputs[outputType as keyof typeof outputs];
          if (!connections || !Array.isArray(connections)) return;

          const validConnections = connections.filter((targetRef: any) => {
            // Handle non-string references
            if (typeof targetRef !== 'string') {
              details.push(`Removed invalid connection (not a string) in workflow "${workflow.name || workflow.id}"`);
              fixed++;
              return false;
            }

            // Parse target reference (format: "actionId" or "actionId:branch")
            const targetId = targetRef.split(':')[0];

            if (!validActionIds.has(targetId)) {
              details.push(`Removed broken connection to non-existent action ${targetId} in workflow "${workflow.name || workflow.id}"`);
              fixed++;
              return false;
            }
            return true;
          });

          // Update with cleaned connections
          if (validConnections.length !== connections.length) {
            (outputs as any)[outputType] = validConnections;
          }
        });
      });

      // Remove connections from non-existent actions
      keysToDelete.forEach(key => {
        delete workflow.connections[key];
      });
    });

    return { fixed, details };
  }

  /**
   * Remove actions with broken image references (aggressive cleanup)
   */
  removeActionsWithBrokenImages(config: QontinuiConfig): {
    removed: number;
    details: string[];
  } {
    const details: string[] = [];
    let removed = 0;

    // Build set of valid image IDs
    const validImageIds = new Set((config.images || []).map(img => img.id));

    (config.workflows || []).forEach(workflow => {
      const originalCount = workflow.actions?.length || 0;

      // Filter out actions with broken image references
      workflow.actions = (workflow.actions || []).filter(action => {
        const imageId = this.extractImageIdFromAction(action);

        if (imageId && !validImageIds.has(imageId)) {
          details.push(`Removed action ${action.type} with broken image reference in workflow "${workflow.name || workflow.id}"`);
          removed++;
          return false;
        }
        return true;
      });

      // If we removed actions, we need to clean up connections too
      if (workflow.actions.length !== originalCount) {
        const validActionIds = new Set(workflow.actions.map(a => a.id));

        // Clean up connections
        Object.keys(workflow.connections || {}).forEach(actionId => {
          if (!validActionIds.has(actionId)) {
            delete workflow.connections[actionId];
          } else {
            const outputs = workflow.connections[actionId];
            ['main', 'success', 'error', 'parallel'].forEach(outputType => {
              const connections = outputs[outputType as keyof typeof outputs];
              if (Array.isArray(connections)) {
                (outputs as any)[outputType] = connections.filter((ref: any) => {
                  if (typeof ref !== 'string') return false;
                  const targetId = ref.split(':')[0];
                  return validActionIds.has(targetId);
                });
              }
            });
          }
        });
      }
    });

    return { removed, details };
  }

  /**
   * Comprehensive auto-fix that runs all cleanup methods
   */
  comprehensiveAutoFix(config: QontinuiConfig): {
    totalFixed: number;
    details: string[];
  } {
    const allDetails: string[] = [];

    // Step 1: Fix image references
    const imageFixResult = this.autoFixImageReferences(config);
    allDetails.push(`Image references: ${imageFixResult.fixed} fixed, ${imageFixResult.unfixed} could not be auto-fixed`);
    allDetails.push(...imageFixResult.details);

    // Step 2: Remove actions with broken images that couldn't be fixed
    const removeResult = this.removeActionsWithBrokenImages(config);
    allDetails.push(`Removed ${removeResult.removed} actions with broken image references`);
    allDetails.push(...removeResult.details);

    // Step 3: Fix broken connections
    const connectionFixResult = this.autoFixBrokenConnections(config);
    allDetails.push(`Cleaned up ${connectionFixResult.fixed} broken connections`);
    allDetails.push(...connectionFixResult.details);

    const totalFixed = imageFixResult.fixed + removeResult.removed + connectionFixResult.fixed;

    return { totalFixed, details: allDetails };
  }

  /**
   * Download configuration as JSON file
   */
  downloadConfiguration(config: QontinuiConfig, filename?: string) {
    const json = JSON.stringify(config, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `qontinui_config_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
