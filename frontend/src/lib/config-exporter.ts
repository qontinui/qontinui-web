import {
  QontinuiConfig,
  ConfigMetadata,
  ImageAsset as ExportImageAsset,
  Workflow as ExportWorkflow,
  State as ExportState,
  Transition as ExportTransition,
  FromTransition as ExportFromTransition,
  ToTransition as ExportToTransition,
  ConfigSettings,
  ActionConfig
} from './export-schema';

import { validateWorkflowConnections } from './workflow-validator';

// Import types from new action schema
import { Action, ActionType, BaseActionSettings, ExecutionSettings, Workflow } from './action-schema';

// Import types from automation context
interface ImageAsset {
  id: string;
  name: string;
  url: string;
  size: number;
  uploadedAt: Date;
  usageCount: number;
  usedIn: Array<{ type: "workflow" | "state"; id: string; name: string }>;
}

interface SearchRegion {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  referenceImageId?: string;
}

interface Pattern {
  id: string;
  name?: string;
  image: string;
  mask?: string;
  searchRegions?: SearchRegion[];
  fixed: boolean;
  similarity?: number;
  targetPosition?: any;
  offsetX?: number;
  offsetY?: number;
}

interface StateImage {
  id: string;
  name: string;
  patterns: Pattern[];
  shared: boolean;
  source?: string;
  probability?: number;
  searchRegions?: SearchRegion[];
}

interface State {
  id: string;
  name: string;
  description: string;
  initial?: boolean;
  stateImages: StateImage[];
  regions?: any[];
  locations?: any[];
  strings?: any[];
  position: { x: number; y: number };
}

interface Transition {
  id: string;
  type: "FromTransition" | "ToTransition";
  workflows: string[];
  timeout: number;
  retryCount: number;
  fromState?: string;
  toState?: string;
  staysVisible?: boolean;
  activateStates?: string[];
  deactivateStates?: string[];
}

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
      workflows: this.exportWorkflows(workflows || []),
      states: this.exportStates(states || [], screenshots),
      transitions: this.exportTransitions(transitions || []),
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
  private exportWorkflows(workflows: Workflow[]): ExportWorkflow[] {
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
      actions: this.exportActions(workflow.actions),
      connections: workflow.connections || {},
      metadata: workflow.metadata || {}
    }));
  }

  /**
   * Export actions to the correct format
   * Actions already have the correct structure from the new schema
   */
  private exportActions(actions: Action[]): any[] {
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

        // Export config directly - it's already type-safe
        exported.config = action.config;

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
   * Convert states to export format
   */
  private exportStates(states: State[], screenshots?: Screenshot[]): ExportState[] {
    if (!states || !Array.isArray(states)) {
      return [];
    }

    return states.map(state => {
      // Collect state objects from screenshots
      const stateRegions: any[] = [];
      const stateLocations: any[] = [];

      if (screenshots) {
        screenshots.forEach(screenshot => {
          if (screenshot.associatedStates.includes(state.id)) {
            // Add regions associated with this state
            screenshot.regions.forEach(region => {
              if (region.stateId === state.id) {
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
              if (location.stateId === state.id) {
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

      return {
        id: state.id,
        name: state.name,
        description: state.description,
        stateImages: (state.stateImages || []).map(img => ({
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
        })),
        regions: state.regions || [],
        locations: state.locations || [],
        strings: state.strings || [],
        position: state.position,
        isInitial: state.initial || false,
        isFinal: false
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

    return transitions.map(transition => {
      const baseTransition: any = {
        id: transition.id,
        type: transition.type,
        workflows: transition.workflows || [],
        timeout: transition.timeout,
        retryCount: transition.retryCount
      };

      if (transition.type === 'FromTransition') {
        return {
          ...baseTransition,
          fromState: transition.fromState || '',
          toState: transition.toState || '',
          staysVisible: transition.staysVisible || false,
          activateStates: transition.activateStates || [],
          deactivateStates: transition.deactivateStates || []
        } as ExportFromTransition;
      } else {
        return {
          ...baseTransition,
          toState: transition.toState || ''
        } as ExportToTransition;
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
      if (transition.type === 'FromTransition') {
        const ft = transition as ExportFromTransition;
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

    return {
      valid: errors.length === 0,
      errors
    };
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
