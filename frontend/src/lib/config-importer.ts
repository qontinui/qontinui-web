import { QontinuiConfig, ImageAsset as ExportImageAsset, Workflow as ExportWorkflow } from './export-schema';
import { Action as NewFormatAction, Workflow } from './action-schema';

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

interface Action {
  id: string;
  type: string;
  config: Record<string, any>;
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
  processes: string[];
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
  private supportedVersions = ['1.0.0', '1.0.1', '1.1.0', '2.0.0'];

  /**
   * Import a Qontinui configuration from JSON
   */
  async importConfiguration(configJson: string | QontinuiConfig | any): Promise<ImportResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Parse JSON if string
      const config: any = typeof configJson === 'string'
        ? JSON.parse(configJson)
        : configJson;

      // Validate version compatibility
      if (!this.isVersionCompatible(config.version)) {
        warnings.push(`Configuration version ${config.version} may not be fully compatible`);
      }

      // Import each component
      const images = await this.importImages(config.images);

      // Handle both v2.0.0 (workflows) and v1.0.0 (processes) formats
      let workflows: Workflow[];
      if (config.workflows) {
        // v2.0.0 format with workflows
        workflows = this.importWorkflows(config.workflows);
      } else if (config.processes) {
        // v1.0.0 format with processes - convert to workflows
        warnings.push('Detected v1.0.0 format with "processes" array - converting to workflows');
        workflows = this.convertProcessesToWorkflows(config.processes);
      } else {
        workflows = [];
      }

      const states = this.importStates(config.states, images);
      const transitions = this.importTransitions(config.transitions);

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
        warnings
      };
    } catch (error) {
      errors.push(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return {
        success: false,
        images: [],
        workflows: [],
        states: [],
        transitions: [],
        settings: undefined,
        errors,
        warnings
      };
    }
  }

  /**
   * Check if the configuration version is compatible
   */
  private isVersionCompatible(version: string): boolean {
    const [major] = version.split('.').map(Number);

    // Support major versions 1 and 2
    return major === 1 || major === 2;
  }

  /**
   * Import images from configuration
   */
  private async importImages(exportImages: ExportImageAsset[]): Promise<ImageAsset[]> {
    const images: ImageAsset[] = [];

    for (const exportImage of exportImages) {
      try {
        // Convert base64 to blob URL
        const url = await this.base64ToUrl(exportImage.data, exportImage.format);

        images.push({
          id: exportImage.id,
          name: exportImage.name,
          url,
          size: this.calculateBase64Size(exportImage.data),
          uploadedAt: new Date(),
          usageCount: 0,
          usedIn: []
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
    return exportWorkflows.map(exportWorkflow => ({
      id: exportWorkflow.id,
      name: exportWorkflow.name,
      description: exportWorkflow.description || '',
      category: exportWorkflow.category,
      format: 'graph' as const,
      version: exportWorkflow.version || '1.0.0',
      actions: Array.isArray(exportWorkflow.actions)
        ? exportWorkflow.actions.map((action: any) => {
            const format = this.detectActionFormat(action);
            console.log(`[ConfigImporter] Detected ${format} format for action ${action.id} (type: ${action.type})`);

            const importedAction: any = {
              id: action.id,
              type: action.type,
              config: format === 'new'
                ? this.importNewFormatAction(action)
                : this.importActionConfig(action.config, action)
            };

            // Import position if present
            if (action.position) {
              importedAction.position = action.position;
            }

            // Import timeout/retryCount/continueOnError if present
            if (action.timeout !== undefined) importedAction.timeout = action.timeout;
            if (action.retryCount !== undefined) importedAction.retryCount = action.retryCount;
            if (action.continueOnError !== undefined) importedAction.continueOnError = action.continueOnError;

            return importedAction;
          })
        : [],
      connections: exportWorkflow.connections || {},
      metadata: exportWorkflow.metadata || {}
    }));
  }

  /**
   * Convert v1.0.0 processes to v2.0.0 workflows
   */
  private convertProcessesToWorkflows(exportProcesses: any[]): Workflow[] {
    return exportProcesses.map(exportProcess => {
      // Build sequential connections (linear graph)
      const connections: any = {};
      const actions = Array.isArray(exportProcess.actions) ? exportProcess.actions : [];

      actions.forEach((action: any, index: number) => {
        if (index < actions.length - 1) {
          // Connect to next action in sequence
          connections[action.id] = {
            main: [[index + 1]]
          };
        }
      });

      return {
        id: exportProcess.id,
        name: exportProcess.name,
        description: exportProcess.description || '',
        category: exportProcess.category,
        format: 'graph' as const,
        version: '1.0.0',
        actions: actions.map((action: any, index: number) => {
          const format = this.detectActionFormat(action);
          console.log(`[ConfigImporter] Converting process to workflow - detected ${format} format for action ${action.id} (type: ${action.type})`);

          const importedAction: any = {
            id: action.id,
            type: action.type,
            config: format === 'new'
              ? this.importNewFormatAction(action)
              : this.importActionConfig(action.config, action),
            // Add sequential position for converted workflows
            position: [100 + index * 200, 100] as [number, number]
          };

          if (action.timeout !== undefined) importedAction.timeout = action.timeout;
          if (action.retryCount !== undefined) importedAction.retryCount = action.retryCount;
          if (action.continueOnError !== undefined) importedAction.continueOnError = action.continueOnError;

          return importedAction;
        }),
        connections,
        metadata: {
          viewMode: 'sequential' as const,
          converted: true,
          originalFormat: 'process'
        }
      };
    });
  }

  /**
   * Detect whether an action is in old or new format
   */
  private detectActionFormat(action: any): 'old' | 'new' {
    // New format has 'base' or 'execution' properties at the top level
    if (action.base !== undefined || action.execution !== undefined) {
      return 'new';
    }

    // New format has 'config' as a structured object with specific properties
    // Old format has flat config with timeout/retryCount/continueOnError mixed in
    if (action.config) {
      // Check if execution settings are in the action root (old format)
      if (action.timeout !== undefined ||
          action.retryCount !== undefined ||
          action.continueOnError !== undefined) {
        return 'old';
      }
    }

    // Default to old format for backward compatibility
    return 'old';
  }

  /**
   * Import new format action (with base and execution properties)
   */
  private importNewFormatAction(action: any): Record<string, any> {
    const internalConfig: Record<string, any> = {};

    // Start with the config object directly
    if (action.config) {
      // Handle target if present
      if (action.config.target) {
        if (action.config.target.type === 'image') {
          internalConfig.imageId = action.config.target.imageId;
          internalConfig.threshold = action.config.target.threshold;
        } else if (action.config.target.type === 'region') {
          internalConfig.region = action.config.target.region;
        } else if (action.config.target.type === 'coordinates') {
          internalConfig.coordinates = action.config.target.coordinates;
        }
      }

      // Copy other config properties
      const configKeys = Object.keys(action.config);
      for (const key of configKeys) {
        if (key !== 'target') {
          internalConfig[key] = action.config[key];
        }
      }
    }

    // Map base settings
    if (action.base) {
      if (action.base.pauseBeforeBegin !== undefined) {
        internalConfig.pauseBeforeBegin = action.base.pauseBeforeBegin;
      }
      if (action.base.pauseAfterEnd !== undefined) {
        internalConfig.pauseAfterEnd = action.base.pauseAfterEnd;
      }
      if (action.base.illustrate !== undefined) {
        internalConfig.illustrate = action.base.illustrate;
      }
      if (action.base.loggingOptions !== undefined) {
        internalConfig.loggingOptions = action.base.loggingOptions;
      }
    }

    // Map execution settings
    if (action.execution) {
      if (action.execution.timeout !== undefined) {
        internalConfig.timeout = action.execution.timeout;
      }
      if (action.execution.retryCount !== undefined) {
        internalConfig.retryCount = action.execution.retryCount;
      }
      if (action.execution.continueOnError !== undefined) {
        internalConfig.continueOnError = action.execution.continueOnError;
      }
      if (action.execution.repetition !== undefined) {
        internalConfig.repetition = action.execution.repetition;
      }
    }

    console.log(`[ConfigImporter] Imported new format action:`, {
      id: action.id,
      type: action.type,
      hasBase: !!action.base,
      hasExecution: !!action.execution,
      configKeys: Object.keys(internalConfig)
    });

    return internalConfig;
  }

  /**
   * Transform imported action config to internal format (OLD FORMAT)
   */
  private importActionConfig(config: any, action: any): Record<string, any> {
    const internalConfig: Record<string, any> = {};

    // Handle target
    if (config.target) {
      if (config.target.type === 'image') {
        internalConfig.imageId = config.target.imageId;
        internalConfig.threshold = config.target.threshold;
      } else if (config.target.type === 'region') {
        internalConfig.region = config.target.region;
      } else if (config.target.type === 'coordinates') {
        internalConfig.coordinates = config.target.coordinates;
      }
    }

    // Copy other properties
    internalConfig.timeout = action.timeout;
    internalConfig.retryCount = action.retryCount;
    internalConfig.continueOnError = action.continueOnError;

    // Handle type-specific properties
    if (config.text) internalConfig.text = config.text;
    if (config.stateStringSource) {
      internalConfig.textSource = 'stateString';
      internalConfig.selectedState = config.stateStringSource.stateId;
      internalConfig.selectedStateStrings = config.stateStringSource.stringIds || [];
      internalConfig.useAllStateStrings = config.stateStringSource.useAll || false;
    }
    if (config.keys) internalConfig.keys = config.keys;
    if (config.direction) internalConfig.direction = config.direction;
    if (config.distance) internalConfig.distance = config.distance;
    if (config.duration) internalConfig.duration = config.duration;
    if (config.destination) internalConfig.destination = config.destination;

    return internalConfig;
  }

  /**
   * Import states from configuration
   */
  private importStates(exportStates: any[], images: ImageAsset[]): State[] {
    return exportStates.map(exportState => {
      // Update image usage for all patterns
      exportState.stateImages?.forEach((stateImage: any) => {
        // Check if patterns exists and is an array before calling forEach
        if (Array.isArray(stateImage.patterns)) {
          stateImage.patterns.forEach((pattern: any) => {
            const image = images.find(img => img.id === pattern.image);
            if (image) {
              image.usageCount++;
              image.usedIn.push({
                type: 'state',
                id: exportState.id,
                name: exportState.name
              });
            }
          });
        }
      });

      return {
        id: exportState.id,
        name: exportState.name,
        description: exportState.description || '',
        initial: exportState.isInitial || false,
        stateImages: exportState.stateImages?.map((img: any) => ({
          id: img.id,
          name: img.name,
          patterns: img.patterns?.map((pattern: any) => ({
            id: pattern.id,
            name: pattern.name,
            image: pattern.image,
            mask: pattern.mask,
            searchRegions: pattern.searchRegions || [],
            fixed: pattern.fixed || false,
            similarity: pattern.similarity,
            targetPosition: pattern.targetPosition,
            offsetX: pattern.offsetX,
            offsetY: pattern.offsetY
          })) || [],
          shared: img.shared || false,
          source: img.source,
          probability: img.probability,
          searchRegions: img.searchRegions || []
        })) || [],
        regions: exportState.regions || [],
        locations: exportState.locations || [],
        strings: exportState.strings || [],
        position: exportState.position
      };
    });
  }

  /**
   * Import transitions from configuration
   */
  private importTransitions(exportTransitions: any[]): Transition[] {
    return exportTransitions.map(exportTransition => {
      // Map export type names to internal type names
      let type: "OutgoingTransition" | "IncomingTransition";
      if (exportTransition.type === 'OutgoingTransition' || exportTransition.type === 'FromTransition') {
        type = 'OutgoingTransition';
      } else if (exportTransition.type === 'IncomingTransition' || exportTransition.type === 'ToTransition') {
        type = 'IncomingTransition';
      } else {
        // Default fallback
        type = exportTransition.type;
      }

      const transition: Transition = {
        id: exportTransition.id,
        type: type,
        processes: Array.isArray(exportTransition.processes) ? exportTransition.processes : [],
        timeout: exportTransition.timeout,
        retryCount: exportTransition.retryCount
      };

      if (type === 'OutgoingTransition') {
        transition.fromState = exportTransition.fromState;
        transition.toState = exportTransition.toState;
        transition.staysVisible = exportTransition.staysVisible;
        transition.activateStates = Array.isArray(exportTransition.activateStates) ? exportTransition.activateStates : [];
        transition.deactivateStates = Array.isArray(exportTransition.deactivateStates) ? exportTransition.deactivateStates : [];
        transition.process = exportTransition.process || '';
      } else if (type === 'IncomingTransition') {
        transition.toState = exportTransition.toState;
        transition.process = exportTransition.process || '';
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
    const stateIds = new Set(states.map(s => s.id));
    const workflowIds = new Set(workflows.map(w => w.id));

    // Check transition references
    transitions.forEach(transition => {
      // Check workflow references - only if processes array exists
      if (Array.isArray(transition.processes)) {
        transition.processes.forEach(workflowId => {
          if (!workflowIds.has(workflowId)) {
            errors.push(`Transition ${transition.id} references unknown workflow: ${workflowId}`);
          }
        });
      }

      // Check state references
      if (transition.type === 'OutgoingTransition') {
        if (transition.fromState && !stateIds.has(transition.fromState)) {
          errors.push(`Transition ${transition.id} references unknown fromState: ${transition.fromState}`);
        }
        if (transition.toState && !stateIds.has(transition.toState)) {
          errors.push(`Transition ${transition.id} references unknown toState: ${transition.toState}`);
        }
      } else if (transition.type === 'IncomingTransition') {
        if (transition.toState && !stateIds.has(transition.toState)) {
          errors.push(`Transition ${transition.id} references unknown toState: ${transition.toState}`);
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
    const data = base64.replace(/^data:.*,/, '');
    // Calculate approximate size in bytes
    return Math.round(data.length * 0.75);
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

      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }

  /**
   * Validate configuration before import
   */
  validateBeforeImport(config: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check required fields
    if (!config.version) errors.push('Version is required');
    if (!config.metadata?.name) errors.push('Configuration name is required');
    if (!Array.isArray(config.images)) errors.push('Images must be an array');

    // Check for workflows (v2.0.0) or processes (v1.0.0)
    if (!Array.isArray(config.workflows) && !Array.isArray(config.processes)) {
      errors.push('Either workflows or processes array is required');
    }

    if (!Array.isArray(config.states)) errors.push('States must be an array');
    if (!Array.isArray(config.transitions)) errors.push('Transitions must be an array');

    // Check for at least one state
    if (config.states?.length === 0) {
      errors.push('At least one state is required');
    }

    return {
      valid: errors.length === 0,
      errors
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
    imported.images.forEach(image => {
      const newId = `imported_${Date.now()}_${image.id}`;
      idMap.set(image.id, newId);
      mergedImages.push({
        ...image,
        id: newId
      });
    });

    // Update workflow references
    const mergedWorkflows = [...existing.workflows];
    imported.workflows.forEach(workflow => {
      const newId = `imported_${Date.now()}_${workflow.id}`;
      idMap.set(workflow.id, newId);

      // Update image references in actions
      const updatedActions = workflow.actions.map(action => ({
        ...action,
        config: {
          ...action.config,
          imageId: action.config.imageId ? idMap.get(action.config.imageId) || action.config.imageId : undefined
        }
      }));

      mergedWorkflows.push({
        ...workflow,
        id: newId,
        actions: updatedActions
      });
    });

    // Update state references
    const mergedStates = [...existing.states];
    imported.states.forEach(state => {
      const newId = `imported_${Date.now()}_${state.id}`;
      idMap.set(state.id, newId);

      // Update image references
      const updatedImages = state.stateImages.map(img => ({
        ...img,
        image: idMap.get(img.image) || img.image
      }));

      mergedStates.push({
        ...state,
        id: newId,
        stateImages: updatedImages
      });
    });

    // Update transition references
    const mergedTransitions = [...existing.transitions];
    imported.transitions.forEach(transition => {
      const newId = `imported_${Date.now()}_${transition.id}`;

      // Update workflow references (processes field for backward compat)
      const updatedWorkflows = transition.processes.map(wid =>
        idMap.get(wid) || wid
      );

      const updatedTransition: Transition = {
        ...transition,
        id: newId,
        processes: updatedWorkflows
      };

      // Update state references
      if (transition.type === 'OutgoingTransition') {
        if (transition.fromState) {
          updatedTransition.fromState = idMap.get(transition.fromState) || transition.fromState;
        }
        if (transition.toState) {
          updatedTransition.toState = idMap.get(transition.toState) || transition.toState;
        }
        if (transition.activateStates) {
          updatedTransition.activateStates = transition.activateStates.map(sid =>
            idMap.get(sid) || sid
          );
        }
        if (transition.deactivateStates) {
          updatedTransition.deactivateStates = transition.deactivateStates.map(sid =>
            idMap.get(sid) || sid
          );
        }
      } else if (transition.type === 'IncomingTransition' && transition.toState) {
        updatedTransition.toState = idMap.get(transition.toState) || transition.toState;
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
      warnings: ['Configuration merged with existing data']
    };
  }
}
