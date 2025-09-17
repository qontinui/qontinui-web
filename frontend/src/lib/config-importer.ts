import { QontinuiConfig, ImageAsset as ExportImageAsset } from './export-schema';

// Types that match the automation context
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
  [key: string]: any;
}

export interface ImportResult {
  success: boolean;
  images: ImageAsset[];
  processes: Process[];
  states: State[];
  transitions: Transition[];
  errors: string[];
  warnings: string[];
}

export class ConfigImporter {
  private supportedVersions = ['1.0.0', '1.0.1', '1.1.0'];
  
  /**
   * Import a Qontinui configuration from JSON
   */
  async importConfiguration(configJson: string | QontinuiConfig): Promise<ImportResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    try {
      // Parse JSON if string
      const config: QontinuiConfig = typeof configJson === 'string' 
        ? JSON.parse(configJson) 
        : configJson;
      
      // Validate version compatibility
      if (!this.isVersionCompatible(config.version)) {
        warnings.push(`Configuration version ${config.version} may not be fully compatible`);
      }
      
      // Import each component
      const images = await this.importImages(config.images);
      const processes = this.importProcesses(config.processes);
      const states = this.importStates(config.states, images);
      const transitions = this.importTransitions(config.transitions);
      
      // Validate references
      this.validateReferences(states, processes, transitions, errors);
      
      return {
        success: errors.length === 0,
        images,
        processes,
        states,
        transitions,
        errors,
        warnings
      };
    } catch (error) {
      errors.push(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return {
        success: false,
        images: [],
        processes: [],
        states: [],
        transitions: [],
        errors,
        warnings
      };
    }
  }
  
  /**
   * Check if the configuration version is compatible
   */
  private isVersionCompatible(version: string): boolean {
    const [major, minor] = version.split('.').map(Number);
    const [currentMajor] = '1.0.0'.split('.').map(Number);
    
    // Major version must match
    if (major !== currentMajor) return false;
    
    // Minor version differences are acceptable with warnings
    return true;
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
   * Import processes from configuration
   */
  private importProcesses(exportProcesses: any[]): Process[] {
    return exportProcesses.map(exportProcess => ({
      id: exportProcess.id,
      name: exportProcess.name,
      description: exportProcess.description || '',
      actions: exportProcess.actions.map((action: any) => ({
        id: action.id,
        type: action.type,
        config: this.importActionConfig(action.config, action)
      }))
    }));
  }
  
  /**
   * Transform imported action config to internal format
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
      // Update image usage
      exportState.identifyingImages?.forEach((stateImage: any) => {
        const image = images.find(img => img.id === stateImage.imageId);
        if (image) {
          image.usageCount++;
          image.usedIn.push({
            type: 'state',
            id: exportState.id,
            name: exportState.name
          });
        }
      });
      
      return {
        id: exportState.id,
        name: exportState.name,
        description: exportState.description || '',
        initial: exportState.isInitial || false,
        identifyingImages: exportState.identifyingImages.map((img: any) => ({
          image: img.imageId,
          threshold: img.threshold
        })),
        position: exportState.position
      };
    });
  }
  
  /**
   * Import transitions from configuration
   */
  private importTransitions(exportTransitions: any[]): Transition[] {
    return exportTransitions.map(exportTransition => {
      const transition: Transition = {
        id: exportTransition.id,
        type: exportTransition.type,
        processes: exportTransition.processes,
        timeout: exportTransition.timeout,
        retryCount: exportTransition.retryCount
      };
      
      if (exportTransition.type === 'FromTransition') {
        transition.fromState = exportTransition.fromState;
        transition.toState = exportTransition.toState;
        transition.staysVisible = exportTransition.staysVisible;
        transition.activateStates = exportTransition.activateStates;
        transition.deactivateStates = exportTransition.deactivateStates;
      } else if (exportTransition.type === 'ToTransition') {
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
    processes: Process[],
    transitions: Transition[],
    errors: string[]
  ): void {
    const stateIds = new Set(states.map(s => s.id));
    const processIds = new Set(processes.map(p => p.id));
    
    // Check transition references
    transitions.forEach(transition => {
      // Check process references
      transition.processes.forEach(processId => {
        if (!processIds.has(processId)) {
          errors.push(`Transition ${transition.id} references unknown process: ${processId}`);
        }
      });
      
      // Check state references
      if (transition.type === 'FromTransition') {
        if (transition.fromState && !stateIds.has(transition.fromState)) {
          errors.push(`Transition ${transition.id} references unknown fromState: ${transition.fromState}`);
        }
        if (transition.toState && !stateIds.has(transition.toState)) {
          errors.push(`Transition ${transition.id} references unknown toState: ${transition.toState}`);
        }
      } else if (transition.type === 'ToTransition') {
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
  validateBeforeImport(config: QontinuiConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    // Check required fields
    if (!config.version) errors.push('Version is required');
    if (!config.metadata?.name) errors.push('Configuration name is required');
    if (!Array.isArray(config.images)) errors.push('Images must be an array');
    if (!Array.isArray(config.processes)) errors.push('Processes must be an array');
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
      processes: Process[];
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
    
    // Update process references
    const mergedProcesses = [...existing.processes];
    imported.processes.forEach(process => {
      const newId = `imported_${Date.now()}_${process.id}`;
      idMap.set(process.id, newId);
      
      // Update image references in actions
      const updatedActions = process.actions.map(action => ({
        ...action,
        config: {
          ...action.config,
          imageId: action.config.imageId ? idMap.get(action.config.imageId) || action.config.imageId : undefined
        }
      }));
      
      mergedProcesses.push({
        ...process,
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
      const updatedImages = state.identifyingImages.map(img => ({
        ...img,
        image: idMap.get(img.image) || img.image
      }));
      
      mergedStates.push({
        ...state,
        id: newId,
        identifyingImages: updatedImages
      });
    });
    
    // Update transition references
    const mergedTransitions = [...existing.transitions];
    imported.transitions.forEach(transition => {
      const newId = `imported_${Date.now()}_${transition.id}`;
      
      // Update process references
      const updatedProcesses = transition.processes.map(pid => 
        idMap.get(pid) || pid
      );
      
      const updatedTransition: Transition = {
        ...transition,
        id: newId,
        processes: updatedProcesses
      };
      
      // Update state references
      if (transition.type === 'FromTransition') {
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
      } else if (transition.type === 'ToTransition' && transition.toState) {
        updatedTransition.toState = idMap.get(transition.toState) || transition.toState;
      }
      
      mergedTransitions.push(updatedTransition);
    });
    
    return {
      success: true,
      images: mergedImages,
      processes: mergedProcesses,
      states: mergedStates,
      transitions: mergedTransitions,
      errors: [],
      warnings: ['Configuration merged with existing data']
    };
  }
}