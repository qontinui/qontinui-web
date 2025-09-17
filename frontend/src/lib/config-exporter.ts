import {
  QontinuiConfig,
  ConfigMetadata,
  ImageAsset as ExportImageAsset,
  Process as ExportProcess,
  State as ExportState,
  Transition as ExportTransition,
  FromTransition as ExportFromTransition,
  ToTransition as ExportToTransition,
  ConfigSettings,
  ActionConfig
} from './export-schema';

// Import types from automation context
interface ImageAsset {
  id: string;
  name: string;
  url: string;
  size: number;
  uploadedAt: Date;
  usageCount: number;
  usedIn: Array<{ type: "process" | "state"; id: string; name: string }>;
}

interface Process {
  id: string;
  name: string;
  description: string;
  actions: Action[];
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
  identifyingImages: Array<{ image: string; threshold: number }>;
  position: { x: number; y: number };
}

interface Transition {
  id: string;
  type: "FromTransition" | "ToTransition";
  processes: string[];
  timeout: number;
  retryCount: number;
  fromState?: string;
  toState?: string;
  staysVisible?: boolean;
  activateStates?: string[];
  deactivateStates?: string[];
}

export class ConfigExporter {
  private version = '1.0.0';

  /**
   * Export the current configuration to Qontinui format
   */
  async exportConfiguration(
    images: ImageAsset[],
    processes: Process[],
    states: State[],
    transitions: Transition[],
    metadata?: Partial<ConfigMetadata>,
    settings?: ConfigSettings
  ): Promise<QontinuiConfig> {
    const now = new Date().toISOString();
    
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
          runner: '1.0.0',
          website: '1.0.0'
        }
      },
      images: await this.exportImages(images),
      processes: this.exportProcesses(processes),
      states: this.exportStates(states),
      transitions: this.exportTransitions(transitions),
      settings: settings || this.getDefaultSettings()
    };

    return config;
  }

  /**
   * Convert images to export format with base64 encoding
   */
  private async exportImages(images: ImageAsset[]): Promise<ExportImageAsset[]> {
    const exportedImages: ExportImageAsset[] = [];

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

    return exportedImages;
  }

  /**
   * Convert processes to export format
   */
  private exportProcesses(processes: Process[]): ExportProcess[] {
    return processes.map(process => ({
      id: process.id,
      name: process.name,
      description: process.description,
      type: 'sequence', // Default to sequence, can be enhanced
      actions: process.actions.map(action => ({
        id: action.id,
        type: action.type as any,
        config: this.transformActionConfig(action.config, action.type),
        timeout: action.config.timeout || 5000,
        retryCount: action.config.retryCount || 3,
        continueOnError: action.config.continueOnError || false
      }))
    }));
  }

  /**
   * Transform action config to standard format
   */
  private transformActionConfig(config: Record<string, any>, type: string): ActionConfig {
    const actionConfig: ActionConfig = {};

    // Handle target configuration
    if (config.imageId || config.image) {
      actionConfig.target = {
        type: 'image',
        imageId: config.imageId || config.image,
        threshold: config.threshold || 0.9
      };
    } else if (config.region) {
      actionConfig.target = {
        type: 'region',
        region: config.region
      };
    } else if (config.coordinates) {
      actionConfig.target = {
        type: 'coordinates',
        coordinates: config.coordinates
      };
    }

    // Handle type-specific properties
    switch (type) {
      case 'TYPE':
        actionConfig.text = config.text;
        break;
      case 'KEY_PRESS':
        actionConfig.keys = config.keys || [config.key];
        break;
      case 'SCROLL':
        actionConfig.direction = config.direction;
        actionConfig.distance = config.distance;
        break;
      case 'DRAG':
        actionConfig.destination = config.destination;
        actionConfig.duration = config.duration;
        break;
      case 'WAIT':
        actionConfig.duration = config.duration || config.delay;
        break;
      case 'GO_TO_STATE':
        if (config.state) {
          actionConfig.state = config.state;
        }
        break;
      case 'RUN_PROCESS':
        if (config.process) {
          actionConfig.process = config.process;
        }
        break;
    }

    // Copy any other config properties that aren't handled above
    Object.keys(config).forEach(key => {
      if (!(key in actionConfig) && key !== 'timeout' && key !== 'retryCount' && key !== 'continueOnError') {
        actionConfig[key] = config[key];
      }
    });

    return actionConfig;
  }

  /**
   * Convert states to export format
   */
  private exportStates(states: State[]): ExportState[] {
    return states.map(state => ({
      id: state.id,
      name: state.name,
      description: state.description,
      identifyingImages: state.identifyingImages.map(img => ({
        imageId: img.image,
        threshold: img.threshold,
        required: true,
        tags: []
      })),
      position: state.position,
      isInitial: state.initial || false, // Use the initial property from state
      isFinal: false // Can be determined by transitions
    }));
  }

  /**
   * Convert transitions to export format
   */
  private exportTransitions(transitions: Transition[]): ExportTransition[] {
    return transitions.map(transition => {
      if (transition.type === 'FromTransition') {
        const fromTransition: ExportFromTransition = {
          id: transition.id,
          type: 'FromTransition',
          processes: transition.processes,
          timeout: transition.timeout,
          retryCount: transition.retryCount,
          fromState: transition.fromState!,
          toState: transition.toState!,
          staysVisible: transition.staysVisible || false,
          activateStates: transition.activateStates || [],
          deactivateStates: transition.deactivateStates || []
        };
        return fromTransition;
      } else {
        const toTransition: ExportToTransition = {
          id: transition.id,
          type: 'ToTransition',
          processes: transition.processes,
          timeout: transition.timeout,
          retryCount: transition.retryCount,
          toState: transition.toState!
        };
        return toTransition;
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
        defaultRetryCount: 3,
        actionDelay: 100,
        failureStrategy: 'stop',
        headless: false
      },
      recognition: {
        defaultThreshold: 0.9,
        searchAlgorithm: 'template_matching',
        multiScaleSearch: true,
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
      }
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

    // Check processes
    if (!Array.isArray(config.processes)) {
      errors.push('Processes must be an array');
    }

    // Check states
    if (!Array.isArray(config.states) || config.states.length === 0) {
      errors.push('At least one state is required');
    }

    // Check transitions
    if (!Array.isArray(config.transitions)) {
      errors.push('Transitions must be an array');
    }

    // Validate state references in transitions
    const stateIds = new Set(config.states.map(s => s.id));
    config.transitions.forEach(transition => {
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

    // Validate process references
    const processIds = new Set(config.processes.map(p => p.id));
    config.transitions.forEach(transition => {
      transition.processes.forEach(processId => {
        if (!processIds.has(processId)) {
          errors.push(`Transition ${transition.id} references unknown process: ${processId}`);
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