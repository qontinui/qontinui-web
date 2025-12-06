/**
 * Workflow Components/Subflows System
 *
 * Provides reusable components and subflows for workflows:
 * - Create components from action selections
 * - Define parameters for flexible reuse
 * - Component library with categories
 * - Import/export components
 * - Built-in common patterns
 * - Nested component support
 */

import {
  Workflow,
  Action,
  Connections,
  createAction,
} from "../lib/action-schema/action-types";

// ============================================================================
// Types
// ============================================================================

/**
 * Parameter definition for a component
 */
export interface ComponentParameter {
  /** Parameter name (used in placeholders like ${paramName}) */
  name: string;

  /** Parameter type */
  type: "string" | "number" | "boolean" | "image" | "selector" | "any";

  /** Whether parameter is required */
  required: boolean;

  /** Default value if not provided */
  defaultValue?: any;

  /** Description of parameter purpose */
  description?: string;

  /** Validation regex for string types */
  validation?: string;

  /** Min/max for number types */
  min?: number;
  max?: number;
}

/**
 * Component category for organization
 */
export type ComponentCategory =
  | "basic"
  | "control-flow"
  | "interaction"
  | "verification"
  | "error-handling"
  | "data"
  | "custom";

/**
 * A reusable workflow component/subflow
 */
export interface WorkflowComponent {
  /** Unique component identifier */
  id: string;

  /** Component name */
  name: string;

  /** Description of what the component does */
  description: string;

  /** Category for organization */
  category: ComponentCategory;

  /** Component version */
  version: string;

  /** Tags for search and filtering */
  tags: string[];

  /** Actions that make up this component */
  actions: Action[];

  /** Connections between actions in the component */
  connections: Connections;

  /** Parameters that can be customized when using the component */
  parameters: ComponentParameter[];

  /** Whether this is a built-in component */
  builtin: boolean;

  /** Component icon (emoji or image URL) */
  icon?: string;

  /** Thumbnail preview */
  thumbnail?: string;

  /** Whether this component is marked as favorite */
  favorite?: boolean;

  /** Number of times this component has been used */
  usageCount?: number;

  /** Last used timestamp */
  lastUsed?: string;

  /** Metadata */
  metadata?: {
    created?: string;
    updated?: string;
    author?: string;
    [key: string]: any;
  };
}

/**
 * Instance of a component with specific parameter values
 */
export interface ComponentInstance {
  /** Unique instance identifier */
  id: string;

  /** Reference to the component definition */
  componentId: string;

  /** Parameter values for this instance */
  parameterValues: Record<string, any>;

  /** Actions generated from the component with applied parameters */
  actions: Action[];

  /** Connections for the generated actions */
  connections: Connections;

  /** Position offset for the instance */
  position?: [number, number];
}

/**
 * Component usage tracking - where a component is used
 */
export interface ComponentUsage {
  /** Workflow ID where component is used */
  workflowId: string;

  /** Workflow name */
  workflowName: string;

  /** Instance IDs in this workflow */
  instanceIds: string[];

  /** Last updated timestamp */
  updated: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ============================================================================
// Workflow Components Service
// ============================================================================

export class WorkflowComponentsService {
  private static instance: WorkflowComponentsService;
  private components: Map<string, WorkflowComponent> = new Map();
  private usageData: Map<string, ComponentUsage[]> = new Map();

  private constructor() {
    this.loadComponents();
    this.loadUsageData();
    this.initializeBuiltinComponents();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): WorkflowComponentsService {
    if (!WorkflowComponentsService.instance) {
      WorkflowComponentsService.instance = new WorkflowComponentsService();
    }
    return WorkflowComponentsService.instance;
  }

  // ==========================================================================
  // Component Management
  // ==========================================================================

  /**
   * Create a new component
   */
  createComponent(
    name: string,
    actions: Action[],
    parameters: ComponentParameter[],
    config: {
      description?: string;
      category?: ComponentCategory;
      tags?: string[];
      icon?: string;
      connections?: Connections;
    } = {}
  ): WorkflowComponent {
    const component: WorkflowComponent = {
      id: `component-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name,
      description: config.description || "",
      category: config.category || "custom",
      version: "1.0.0",
      tags: config.tags || [],
      actions: this.cloneActions(actions),
      connections: config.connections || {},
      parameters,
      builtin: false,
      icon: config.icon,
      usageCount: 0,
      metadata: {
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      },
    };

    this.components.set(component.id, component);
    this.saveComponents();

    return component;
  }

  /**
   * Update an existing component
   */
  updateComponent(id: string, updates: Partial<WorkflowComponent>): boolean {
    const component = this.components.get(id);
    if (!component || component.builtin) {
      return false;
    }

    const updated = {
      ...component,
      ...updates,
      id: component.id, // Preserve ID
      builtin: false, // Preserve builtin status
      metadata: {
        ...component.metadata,
        ...updates.metadata,
        updated: new Date().toISOString(),
      },
    };

    this.components.set(id, updated);
    this.saveComponents();

    return true;
  }

  /**
   * Delete a component
   */
  deleteComponent(id: string): boolean {
    const component = this.components.get(id);
    if (!component || component.builtin) {
      return false;
    }

    this.components.delete(id);
    this.usageData.delete(id);
    this.saveComponents();
    this.saveUsageData();

    return true;
  }

  /**
   * Get a component by ID
   */
  getComponent(id: string): WorkflowComponent | undefined {
    return this.components.get(id);
  }

  /**
   * Get all components
   */
  getAllComponents(): WorkflowComponent[] {
    return Array.from(this.components.values());
  }

  /**
   * Duplicate a component
   */
  duplicateComponent(id: string, newName?: string): WorkflowComponent | null {
    const original = this.components.get(id);
    if (!original) {
      return null;
    }

    const duplicate: WorkflowComponent = {
      ...original,
      id: `component-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: newName || `${original.name} (Copy)`,
      builtin: false,
      usageCount: 0,
      lastUsed: undefined,
      metadata: {
        ...original.metadata,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        duplicatedFrom: original.id,
      },
    };

    this.components.set(duplicate.id, duplicate);
    this.saveComponents();

    return duplicate;
  }

  // ==========================================================================
  // Component Creation from Selection
  // ==========================================================================

  /**
   * Create a component from selected actions in a workflow
   */
  createComponentFromActions(
    _workflowId: string,
    _actionIds: string[],
    _name: string,
    _parameters?: ComponentParameter[]
  ): WorkflowComponent | null {
    // Extract actions would need to get the workflow from somewhere
    // For now, accepting actions and connections directly
    return null;
  }

  /**
   * Extract actions and their connections from a workflow
   */
  extractActions(
    workflow: Workflow,
    actionIds: string[]
  ): { actions: Action[]; connections: Connections } {
    const actions = workflow.actions.filter((a) => actionIds.includes(a.id));
    const connections: Connections = {};

    // Extract connections between selected actions
    actionIds.forEach((sourceId) => {
      const sourceConnections = workflow.connections[sourceId];
      if (!sourceConnections) return;

      const filteredConnections: any = {};

      Object.entries(sourceConnections).forEach(([type, outputs]) => {
        const filteredOutputs = outputs
          ?.map((output) =>
            output.filter((conn) => actionIds.includes(conn.action))
          )
          .filter((output) => output.length > 0);

        if (filteredOutputs && filteredOutputs.length > 0) {
          filteredConnections[type] = filteredOutputs;
        }
      });

      if (Object.keys(filteredConnections).length > 0) {
        connections[sourceId] = filteredConnections;
      }
    });

    return { actions, connections };
  }

  /**
   * Automatically infer parameters from actions
   * Detects common patterns that should be parameterized
   */
  inferParameters(actions: Action[]): ComponentParameter[] {
    const parameters: ComponentParameter[] = [];
    const seen = new Set<string>();

    actions.forEach((action) => {
      // Infer from TYPE actions
      if (action.type === "TYPE" && "text" in action.config) {
        const text = (action.config as any).text;
        if (text && typeof text === "string" && !seen.has("inputText")) {
          parameters.push({
            name: "inputText",
            type: "string",
            required: true,
            description: "Text to type",
          });
          seen.add("inputText");
        }
      }

      // Infer from FIND/CLICK actions with images
      if (
        (action.type === "FIND" ||
          action.type === "CLICK" ||
          action.type === "EXISTS") &&
        "target" in action.config
      ) {
        const target = (action.config as any).target;
        if (target?.image && !seen.has("targetImage")) {
          parameters.push({
            name: "targetImage",
            type: "image",
            required: true,
            description: "Target image to find",
          });
          seen.add("targetImage");
        }
        if (target?.selector && !seen.has("targetSelector")) {
          parameters.push({
            name: "targetSelector",
            type: "selector",
            required: true,
            description: "CSS selector for target element",
          });
          seen.add("targetSelector");
        }
      }

      // Infer from WAIT actions
      if (action.type === "WAIT" && "duration" in action.config) {
        const duration = (action.config as any).duration;
        if (duration && !seen.has("waitDuration")) {
          parameters.push({
            name: "waitDuration",
            type: "number",
            required: false,
            defaultValue: duration,
            description: "Wait duration in milliseconds",
            min: 0,
          });
          seen.add("waitDuration");
        }
      }

      // Infer from LOOP actions
      if (action.type === "LOOP" && "iterations" in action.config) {
        const iterations = (action.config as any).iterations;
        if (iterations && !seen.has("iterations")) {
          parameters.push({
            name: "iterations",
            type: "number",
            required: false,
            defaultValue: iterations,
            description: "Number of loop iterations",
            min: 1,
          });
          seen.add("iterations");
        }
      }
    });

    return parameters;
  }

  // ==========================================================================
  // Component Usage
  // ==========================================================================

  /**
   * Insert a component into a workflow at a specific position
   */
  insertComponent(
    workflowId: string,
    componentId: string,
    position: [number, number],
    parameterValues: Record<string, any>
  ): ComponentInstance | null {
    const component = this.components.get(componentId);
    if (!component) {
      return null;
    }

    const instance = this.instantiateComponent(
      component,
      parameterValues,
      position
    );

    // Track usage
    this.trackUsage(workflowId, componentId, instance.id);
    this.incrementUsageCount(componentId);

    return instance;
  }

  /**
   * Replace selected actions with a component
   */
  replaceActionsWithComponent(
    workflowId: string,
    _actionIds: string[],
    componentId: string
  ): ComponentInstance | null {
    const component = this.components.get(componentId);
    if (!component) {
      return null;
    }

    // Calculate average position of replaced actions
    // This would need access to the workflow
    const position: [number, number] = [0, 0];

    const instance = this.instantiateComponent(component, {}, position);

    this.trackUsage(workflowId, componentId, instance.id);
    this.incrementUsageCount(componentId);

    return instance;
  }

  /**
   * Get all workflows where a component is used
   */
  getComponentUsages(componentId: string): ComponentUsage[] {
    return this.usageData.get(componentId) || [];
  }

  /**
   * Update all instances of a component when the component changes
   */
  updateAllUsages(componentId: string): boolean {
    const component = this.components.get(componentId);
    if (!component) {
      return false;
    }

    // In a real implementation, this would update all workflow instances
    // For now, just update the metadata
    component.metadata = {
      ...component.metadata,
      updated: new Date().toISOString(),
    };

    this.saveComponents();
    return true;
  }

  /**
   * Track usage of a component in a workflow
   */
  private trackUsage(
    workflowId: string,
    componentId: string,
    instanceId: string
  ): void {
    const usages = this.usageData.get(componentId) || [];
    const existing = usages.find((u) => u.workflowId === workflowId);

    if (existing) {
      existing.instanceIds.push(instanceId);
      existing.updated = new Date().toISOString();
    } else {
      usages.push({
        workflowId,
        workflowName: `Workflow ${workflowId}`, // Would be fetched in real implementation
        instanceIds: [instanceId],
        updated: new Date().toISOString(),
      });
    }

    this.usageData.set(componentId, usages);
    this.saveUsageData();
  }

  // ==========================================================================
  // Component Library
  // ==========================================================================

  /**
   * Get components by category
   */
  getComponentsByCategory(category: ComponentCategory): WorkflowComponent[] {
    return Array.from(this.components.values()).filter(
      (c) => c.category === category
    );
  }

  /**
   * Search components
   */
  searchComponents(query: string): WorkflowComponent[] {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.components.values()).filter(
      (c) =>
        c.name.toLowerCase().includes(lowerQuery) ||
        c.description.toLowerCase().includes(lowerQuery) ||
        c.tags.some((tag) => tag.toLowerCase().includes(lowerQuery))
    );
  }

  /**
   * Get recently used components
   */
  getRecentComponents(limit: number = 10): WorkflowComponent[] {
    return Array.from(this.components.values())
      .filter((c) => c.lastUsed)
      .sort((a, b) => {
        const aTime = new Date(a.lastUsed!).getTime();
        const bTime = new Date(b.lastUsed!).getTime();
        return bTime - aTime;
      })
      .slice(0, limit);
  }

  /**
   * Get favorite components
   */
  getFavoriteComponents(): WorkflowComponent[] {
    return Array.from(this.components.values()).filter((c) => c.favorite);
  }

  /**
   * Toggle favorite status of a component
   */
  toggleFavorite(componentId: string): boolean {
    const component = this.components.get(componentId);
    if (!component) {
      return false;
    }

    component.favorite = !component.favorite;
    this.saveComponents();

    return true;
  }

  /**
   * Increment usage count for a component
   */
  incrementUsageCount(componentId: string): void {
    const component = this.components.get(componentId);
    if (!component) {
      return;
    }

    component.usageCount = (component.usageCount || 0) + 1;
    component.lastUsed = new Date().toISOString();
    this.saveComponents();
  }

  /**
   * Get component categories
   */
  getCategories(): ComponentCategory[] {
    return [
      "basic",
      "control-flow",
      "interaction",
      "verification",
      "error-handling",
      "data",
      "custom",
    ];
  }

  // ==========================================================================
  // Parameters
  // ==========================================================================

  /**
   * Define a parameter
   */
  defineParameter(
    name: string,
    type: ComponentParameter["type"],
    required: boolean,
    defaultValue?: any,
    description?: string
  ): ComponentParameter {
    return {
      name,
      type,
      required,
      defaultValue,
      description,
    };
  }

  /**
   * Validate parameter values against component definition
   */
  validateParameters(
    component: WorkflowComponent,
    values: Record<string, any>
  ): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    component.parameters.forEach((param) => {
      const value = values[param.name];

      // Check required parameters
      if (param.required && (value === undefined || value === null)) {
        errors.push(`Required parameter '${param.name}' is missing`);
        return;
      }

      // Skip validation if value is not provided and not required
      if (value === undefined || value === null) {
        return;
      }

      // Type validation
      switch (param.type) {
        case "string":
          if (typeof value !== "string") {
            errors.push(`Parameter '${param.name}' must be a string`);
          } else if (param.validation) {
            const regex = new RegExp(param.validation);
            if (!regex.test(value)) {
              errors.push(
                `Parameter '${param.name}' does not match validation pattern`
              );
            }
          }
          break;

        case "number":
          if (typeof value !== "number") {
            errors.push(`Parameter '${param.name}' must be a number`);
          } else {
            if (param.min !== undefined && value < param.min) {
              errors.push(
                `Parameter '${param.name}' must be at least ${param.min}`
              );
            }
            if (param.max !== undefined && value > param.max) {
              errors.push(
                `Parameter '${param.name}' must be at most ${param.max}`
              );
            }
          }
          break;

        case "boolean":
          if (typeof value !== "boolean") {
            errors.push(`Parameter '${param.name}' must be a boolean`);
          }
          break;
      }
    });

    // Check for extra parameters
    Object.keys(values).forEach((key) => {
      if (!component.parameters.find((p) => p.name === key)) {
        warnings.push(`Unknown parameter '${key}' will be ignored`);
      }
    });

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Apply parameters to a component, replacing placeholders
   */
  applyParameters(
    component: WorkflowComponent,
    values: Record<string, any>
  ): { actions: Action[]; connections: Connections } {
    // Merge with default values
    const allValues: Record<string, any> = {};
    component.parameters.forEach((param) => {
      allValues[param.name] = values[param.name] ?? param.defaultValue;
    });

    // Clone actions and apply parameters
    const actions = this.cloneActions(component.actions);

    actions.forEach((action) => {
      this.replaceParametersInConfig(action.config, allValues);
    });

    return {
      actions,
      connections: this.cloneConnections(component.connections),
    };
  }

  /**
   * Replace parameter placeholders in action config
   */
  private replaceParametersInConfig(
    config: any,
    values: Record<string, any>
  ): void {
    Object.keys(config).forEach((key) => {
      const value = config[key];

      if (typeof value === "string") {
        // Replace ${paramName} placeholders
        config[key] = value.replace(/\$\{(\w+)\}/g, (match, paramName) => {
          return values[paramName] !== undefined ? values[paramName] : match;
        });
      } else if (typeof value === "object" && value !== null) {
        this.replaceParametersInConfig(value, values);
      }
    });
  }

  // ==========================================================================
  // Validation
  // ==========================================================================

  /**
   * Validate component structure
   */
  validateComponent(component: WorkflowComponent): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Basic validation
    if (!component.name || component.name.trim() === "") {
      errors.push("Component must have a name");
    }

    if (!component.actions || component.actions.length === 0) {
      errors.push("Component must have at least one action");
    }

    // Validate action IDs are unique
    const actionIds = new Set<string>();
    component.actions.forEach((action) => {
      if (actionIds.has(action.id)) {
        errors.push(`Duplicate action ID: ${action.id}`);
      }
      actionIds.add(action.id);
    });

    // Validate connections reference existing actions
    Object.entries(component.connections).forEach(([sourceId, outputs]) => {
      if (!actionIds.has(sourceId)) {
        errors.push(
          `Connection references non-existent source action: ${sourceId}`
        );
      }

      Object.values(outputs).forEach((outputList) => {
        outputList?.forEach((output) => {
          output.forEach((conn) => {
            if (!actionIds.has(conn.action)) {
              errors.push(
                `Connection references non-existent target action: ${conn.action}`
              );
            }
          });
        });
      });
    });

    // Validate parameters
    const paramNames = new Set<string>();
    component.parameters.forEach((param) => {
      if (paramNames.has(param.name)) {
        errors.push(`Duplicate parameter name: ${param.name}`);
      }
      paramNames.add(param.name);

      if (!param.name || param.name.trim() === "") {
        errors.push("Parameter must have a name");
      }

      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(param.name)) {
        errors.push(
          `Parameter name '${param.name}' must be a valid identifier`
        );
      }
    });

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Check for circular references in nested components
   */
  checkCircularReferences(
    component: WorkflowComponent,
    visited: Set<string> = new Set()
  ): ValidationResult {
    const errors: string[] = [];

    if (visited.has(component.id)) {
      errors.push(
        `Circular reference detected for component: ${component.name}`
      );
      return { valid: false, errors, warnings: [] };
    }

    visited.add(component.id);

    // Check for RUN_WORKFLOW actions that reference other components
    component.actions.forEach((action) => {
      if (action.type === "RUN_WORKFLOW" && "workflowId" in action.config) {
        const workflowId = (action.config as any).workflowId;
        const referencedComponent = this.components.get(workflowId);

        if (referencedComponent) {
          const result = this.checkCircularReferences(
            referencedComponent,
            new Set(visited)
          );
          errors.push(...result.errors);
        }
      }
    });

    return {
      valid: errors.length === 0,
      errors,
      warnings: [],
    };
  }

  /**
   * Validate parameter types
   */
  validateParameterTypes(
    component: WorkflowComponent,
    values: Record<string, any>
  ): ValidationResult {
    return this.validateParameters(component, values);
  }

  // ==========================================================================
  // Import/Export
  // ==========================================================================

  /**
   * Export a component as JSON
   */
  exportComponent(id: string): string | null {
    const component = this.components.get(id);
    if (!component) {
      return null;
    }

    return JSON.stringify(component, null, 2);
  }

  /**
   * Import a component from JSON
   */
  importComponent(data: string): WorkflowComponent | null {
    try {
      const component = JSON.parse(data) as WorkflowComponent;

      // Validate structure
      const validation = this.validateComponent(component);
      if (!validation.valid) {
        console.error("Invalid component:", validation.errors);
        return null;
      }

      // Generate new ID to avoid conflicts
      component.id = `component-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      component.builtin = false;
      component.metadata = {
        ...component.metadata,
        imported: new Date().toISOString(),
      };

      this.components.set(component.id, component);
      this.saveComponents();

      return component;
    } catch (error) {
      console.error("Failed to import component:", error);
      return null;
    }
  }

  /**
   * Export all components as JSON
   */
  exportLibrary(): string {
    const library = Array.from(this.components.values());
    return JSON.stringify(library, null, 2);
  }

  /**
   * Import multiple components from JSON
   */
  importLibrary(data: string): number {
    try {
      const library = JSON.parse(data) as WorkflowComponent[];
      let imported = 0;

      library.forEach((component) => {
        const validation = this.validateComponent(component);
        if (validation.valid) {
          component.id = `component-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          component.builtin = false;
          this.components.set(component.id, component);
          imported++;
        }
      });

      if (imported > 0) {
        this.saveComponents();
      }

      return imported;
    } catch (error) {
      console.error("Failed to import library:", error);
      return 0;
    }
  }

  // ==========================================================================
  // Component Instantiation
  // ==========================================================================

  /**
   * Create an instance of a component with specific parameter values
   */
  instantiateComponent(
    component: WorkflowComponent,
    parameterValues: Record<string, any>,
    positionOffset?: [number, number]
  ): ComponentInstance {
    // Validate parameters
    const validation = this.validateParameters(component, parameterValues);
    if (!validation.valid) {
      throw new Error(`Invalid parameters: ${validation.errors.join(", ")}`);
    }

    // Apply parameters to get actions with substituted values
    const { actions, connections } = this.applyParameters(
      component,
      parameterValues
    );

    // Generate unique IDs for all actions
    const idMap = this.generateUniqueIds(actions);

    // Update connections with new IDs
    const updatedConnections = this.updateConnections(connections, idMap);

    // Apply position offset if provided
    if (positionOffset) {
      actions.forEach((action) => {
        action.position = [
          action.position[0] + positionOffset[0],
          action.position[1] + positionOffset[1],
        ];
      });
    }

    return {
      id: `instance-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      componentId: component.id,
      parameterValues,
      actions,
      connections: updatedConnections,
      position: positionOffset,
    };
  }

  /**
   * Generate unique IDs for actions, returning a mapping of old ID to new ID
   */
  private generateUniqueIds(actions: Action[]): Map<string, string> {
    const idMap = new Map<string, string>();

    actions.forEach((action) => {
      const oldId = action.id;
      const newId = `action-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      idMap.set(oldId, newId);
      action.id = newId;
    });

    return idMap;
  }

  /**
   * Update connections to use new action IDs
   */
  private updateConnections(
    connections: Connections,
    idMap: Map<string, string>
  ): Connections {
    const updated: Connections = {};

    Object.entries(connections).forEach(([sourceId, outputs]) => {
      const newSourceId = idMap.get(sourceId) || sourceId;
      updated[newSourceId] = {};

      Object.entries(outputs).forEach(([type, outputList]) => {
        updated[newSourceId]![type]! = outputList?.map((output) =>
          output.map((conn) => ({
            ...conn,
            action: idMap.get(conn.action) || conn.action,
          }))
        );
      });
    });

    return updated;
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Clone actions array
   */
  private cloneActions(actions: Action[]): Action[] {
    return JSON.parse(JSON.stringify(actions));
  }

  /**
   * Clone connections object
   */
  private cloneConnections(connections: Connections): Connections {
    return JSON.parse(JSON.stringify(connections));
  }

  // ==========================================================================
  // Persistence
  // ==========================================================================

  /**
   * Load components from localStorage
   */
  private loadComponents(): void {
    try {
      const json = localStorage.getItem("workflow-components");
      if (json) {
        const components = JSON.parse(json) as WorkflowComponent[];
        components.forEach((c) => this.components.set(c.id, c));
      }
    } catch (error) {
      console.error("Failed to load components:", error);
    }
  }

  /**
   * Save components to localStorage
   */
  private saveComponents(): void {
    try {
      const components = Array.from(this.components.values());
      localStorage.setItem("workflow-components", JSON.stringify(components));
    } catch (error) {
      console.error("Failed to save components:", error);
    }
  }

  /**
   * Load usage data from localStorage
   */
  private loadUsageData(): void {
    try {
      const json = localStorage.getItem("workflow-component-usage");
      if (json) {
        const data = JSON.parse(json);
        Object.entries(data).forEach(([componentId, usages]) => {
          this.usageData.set(componentId, usages as ComponentUsage[]);
        });
      }
    } catch (error) {
      console.error("Failed to load usage data:", error);
    }
  }

  /**
   * Save usage data to localStorage
   */
  private saveUsageData(): void {
    try {
      const data: any = {};
      this.usageData.forEach((usages, componentId) => {
        data[componentId] = usages;
      });
      localStorage.setItem("workflow-component-usage", JSON.stringify(data));
    } catch (error) {
      console.error("Failed to save usage data:", error);
    }
  }

  /**
   * Clear all components (except built-ins)
   */
  clearComponents(): void {
    const builtins = Array.from(this.components.values()).filter(
      (c) => c.builtin
    );
    this.components.clear();
    builtins.forEach((c) => this.components.set(c.id, c));
    this.saveComponents();
  }

  /**
   * Clear all usage data
   */
  clearUsageData(): void {
    this.usageData.clear();
    localStorage.removeItem("workflow-component-usage");
  }

  // ==========================================================================
  // Built-in Components
  // ==========================================================================

  /**
   * Initialize built-in component library
   */
  private initializeBuiltinComponents(): void {
    // Only initialize if not already loaded
    const hasBuiltins = Array.from(this.components.values()).some(
      (c) => c.builtin
    );
    if (hasBuiltins) {
      return;
    }

    this.createBuiltinErrorHandler();
    this.createBuiltinRetryLogic();
    this.createBuiltinWaitForElement();
    this.createBuiltinClickAndWait();
    this.createBuiltinFormFill();
    this.createBuiltinScreenshotAndVerify();
    this.createBuiltinSafeClick();

    this.saveComponents();
  }

  /**
   * Built-in: Error Handler (TRY/CATCH wrapper)
   */
  private createBuiltinErrorHandler(): void {
    const tryCatch = createAction(
      "TRY_CATCH",
      { tryActions: [], catchActions: [] },
      [100, 100],
      { id: "try-catch", name: "Try-Catch Block" }
    );

    const errorAction = createAction(
      "SCREENSHOT",
      { filename: "error-${timestamp}.png" },
      [300, 200],
      { id: "error-screenshot", name: "Capture Error" }
    );

    const component: WorkflowComponent = {
      id: "builtin-error-handler",
      name: "Error Handler",
      description:
        "Wrap actions with try-catch error handling and automatic error screenshots",
      category: "error-handling",
      version: "1.0.0",
      tags: ["error", "try-catch", "exception", "screenshot"],
      actions: [tryCatch, errorAction],
      connections: {
        "try-catch": {
          error: [[{ action: "error-screenshot", type: "error", index: 0 }]],
        },
      },
      parameters: [
        {
          name: "errorMessage",
          type: "string",
          required: false,
          defaultValue: "An error occurred",
          description: "Error message to log",
        },
      ],
      builtin: true,
      icon: "⚠️",
      usageCount: 0,
      metadata: {
        created: new Date().toISOString(),
      },
    };

    this.components.set(component.id, component);
  }

  /**
   * Built-in: Retry Logic (LOOP with attempts)
   */
  private createBuiltinRetryLogic(): void {
    const loop = createAction(
      "LOOP",
      { iterations: 3, loopActions: [], variable: "attempt" },
      [100, 100],
      { id: "retry-loop", name: "Retry Loop" }
    );

    const wait = createAction("WAIT", { duration: 1000 }, [300, 100], {
      id: "retry-wait",
      name: "Wait Between Retries",
    });

    const component: WorkflowComponent = {
      id: "builtin-retry-logic",
      name: "Retry Logic",
      description: "Retry an action multiple times with delay between attempts",
      category: "control-flow",
      version: "1.0.0",
      tags: ["retry", "loop", "resilience"],
      actions: [loop, wait],
      connections: {
        "retry-loop": {
          main: [[{ action: "retry-wait", type: "main", index: 0 }]],
        },
      },
      parameters: [
        {
          name: "maxAttempts",
          type: "number",
          required: false,
          defaultValue: 3,
          description: "Maximum number of retry attempts",
          min: 1,
          max: 10,
        },
        {
          name: "retryDelay",
          type: "number",
          required: false,
          defaultValue: 1000,
          description: "Delay between retries in milliseconds",
          min: 0,
        },
      ],
      builtin: true,
      icon: "🔄",
      usageCount: 0,
      metadata: {
        created: new Date().toISOString(),
      },
    };

    this.components.set(component.id, component);
  }

  /**
   * Built-in: Wait for Element (FIND with retry)
   */
  private createBuiltinWaitForElement(): void {
    const exists = createAction(
      "EXISTS",
      { target: { image: "${targetImage}" }, timeout: 10000 },
      [100, 100],
      { id: "wait-exists", name: "Wait for Element" }
    );

    const component: WorkflowComponent = {
      id: "builtin-wait-for-element",
      name: "Wait for Element",
      description: "Wait for an element to appear on screen with timeout",
      category: "verification",
      version: "1.0.0",
      tags: ["wait", "find", "exists", "timeout"],
      actions: [exists],
      connections: {},
      parameters: [
        {
          name: "targetImage",
          type: "image",
          required: true,
          description: "Image to wait for",
        },
        {
          name: "timeout",
          type: "number",
          required: false,
          defaultValue: 10000,
          description: "Maximum wait time in milliseconds",
          min: 0,
        },
      ],
      builtin: true,
      icon: "⏱️",
      usageCount: 0,
      metadata: {
        created: new Date().toISOString(),
      },
    };

    this.components.set(component.id, component);
  }

  /**
   * Built-in: Click and Wait (CLICK + WAIT sequence)
   */
  private createBuiltinClickAndWait(): void {
    const click = createAction(
      "CLICK",
      { target: { image: "${targetImage}" } },
      [100, 100],
      { id: "click", name: "Click Element" }
    );

    const wait = createAction("WAIT", { duration: 500 }, [100, 250], {
      id: "wait",
      name: "Wait After Click",
    });

    const component: WorkflowComponent = {
      id: "builtin-click-and-wait",
      name: "Click and Wait",
      description: "Click an element and wait for the action to complete",
      category: "interaction",
      version: "1.0.0",
      tags: ["click", "wait", "interaction"],
      actions: [click, wait],
      connections: {
        click: {
          main: [[{ action: "wait", type: "main", index: 0 }]],
        },
      },
      parameters: [
        {
          name: "targetImage",
          type: "image",
          required: true,
          description: "Element to click",
        },
        {
          name: "waitDuration",
          type: "number",
          required: false,
          defaultValue: 500,
          description: "Wait duration after click in milliseconds",
          min: 0,
        },
      ],
      builtin: true,
      icon: "👆",
      usageCount: 0,
      metadata: {
        created: new Date().toISOString(),
      },
    };

    this.components.set(component.id, component);
  }

  /**
   * Built-in: Form Fill (Multiple TYPE actions)
   */
  private createBuiltinFormFill(): void {
    const clickField1 = createAction(
      "CLICK",
      { target: { selector: "${field1Selector}" } },
      [100, 100],
      { id: "click-field1", name: "Click Field 1" }
    );

    const typeField1 = createAction(
      "TYPE",
      { text: "${field1Value}", target: { selector: "${field1Selector}" } },
      [100, 250],
      { id: "type-field1", name: "Type Field 1" }
    );

    const clickField2 = createAction(
      "CLICK",
      { target: { selector: "${field2Selector}" } },
      [100, 400],
      { id: "click-field2", name: "Click Field 2" }
    );

    const typeField2 = createAction(
      "TYPE",
      { text: "${field2Value}", target: { selector: "${field2Selector}" } },
      [100, 550],
      { id: "type-field2", name: "Type Field 2" }
    );

    const component: WorkflowComponent = {
      id: "builtin-form-fill",
      name: "Form Fill",
      description: "Fill multiple form fields with values",
      category: "interaction",
      version: "1.0.0",
      tags: ["form", "type", "input", "fill"],
      actions: [clickField1, typeField1, clickField2, typeField2],
      connections: {
        "click-field1": {
          main: [[{ action: "type-field1", type: "main", index: 0 }]],
        },
        "type-field1": {
          main: [[{ action: "click-field2", type: "main", index: 0 }]],
        },
        "click-field2": {
          main: [[{ action: "type-field2", type: "main", index: 0 }]],
        },
      },
      parameters: [
        {
          name: "field1Selector",
          type: "selector",
          required: true,
          description: "CSS selector for first field",
        },
        {
          name: "field1Value",
          type: "string",
          required: true,
          description: "Value for first field",
        },
        {
          name: "field2Selector",
          type: "selector",
          required: true,
          description: "CSS selector for second field",
        },
        {
          name: "field2Value",
          type: "string",
          required: true,
          description: "Value for second field",
        },
      ],
      builtin: true,
      icon: "📝",
      usageCount: 0,
      metadata: {
        created: new Date().toISOString(),
      },
    };

    this.components.set(component.id, component);
  }

  /**
   * Built-in: Screenshot and Verify (SCREENSHOT + FIND_STATE_IMAGE)
   */
  private createBuiltinScreenshotAndVerify(): void {
    const screenshot = createAction(
      "SCREENSHOT",
      { filename: "verify-${timestamp}.png" },
      [100, 100],
      { id: "screenshot", name: "Take Screenshot" }
    );

    const verify = createAction(
      "FIND_STATE_IMAGE",
      { target: { image: "${expectedImage}" }, timeout: 5000 },
      [100, 250],
      { id: "verify", name: "Verify Expected State" }
    );

    const component: WorkflowComponent = {
      id: "builtin-screenshot-verify",
      name: "Screenshot and Verify",
      description: "Take a screenshot and verify expected state is present",
      category: "verification",
      version: "1.0.0",
      tags: ["screenshot", "verify", "validation", "state"],
      actions: [screenshot, verify],
      connections: {
        screenshot: {
          main: [[{ action: "verify", type: "main", index: 0 }]],
        },
      },
      parameters: [
        {
          name: "expectedImage",
          type: "image",
          required: true,
          description: "Expected state image to verify",
        },
        {
          name: "filename",
          type: "string",
          required: false,
          defaultValue: "verify.png",
          description: "Screenshot filename",
        },
      ],
      builtin: true,
      icon: "📸",
      usageCount: 0,
      metadata: {
        created: new Date().toISOString(),
      },
    };

    this.components.set(component.id, component);
  }

  /**
   * Built-in: Safe Click (EXISTS check + CLICK + verification)
   */
  private createBuiltinSafeClick(): void {
    const exists = createAction(
      "EXISTS",
      { target: { image: "${targetImage}" }, timeout: 5000 },
      [100, 100],
      { id: "check-exists", name: "Check Element Exists" }
    );

    const ifAction = createAction(
      "IF",
      {
        condition: { type: "found", variable: "check-exists" },
        thenActions: [],
        elseActions: [],
      },
      [100, 250],
      { id: "if-exists", name: "If Element Exists" }
    );

    const click = createAction(
      "CLICK",
      { target: { image: "${targetImage}" } },
      [300, 400],
      { id: "click-element", name: "Click Element" }
    );

    const component: WorkflowComponent = {
      id: "builtin-safe-click",
      name: "Safe Click",
      description:
        "Safely click an element with existence check and verification",
      category: "interaction",
      version: "1.0.0",
      tags: ["click", "safe", "exists", "verification"],
      actions: [exists, ifAction, click],
      connections: {
        "check-exists": {
          main: [[{ action: "if-exists", type: "main", index: 0 }]],
        },
        "if-exists": {
          main: [[{ action: "click-element", type: "main", index: 0 }]],
        },
      },
      parameters: [
        {
          name: "targetImage",
          type: "image",
          required: true,
          description: "Element to click",
        },
        {
          name: "timeout",
          type: "number",
          required: false,
          defaultValue: 5000,
          description: "Timeout for existence check in milliseconds",
          min: 0,
        },
      ],
      builtin: true,
      icon: "🛡️",
      usageCount: 0,
      metadata: {
        created: new Date().toISOString(),
      },
    };

    this.components.set(component.id, component);
  }
}

// ============================================================================
// Exports
// ============================================================================

export const workflowComponents = WorkflowComponentsService.getInstance();
