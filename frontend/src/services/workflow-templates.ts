/**
 * Workflow Templates System
 *
 * Provides built-in workflow templates and template management:
 * - 8+ built-in templates
 * - Template creation from existing workflows
 * - Template categories
 * - Template search and filtering
 * - Custom user templates
 */

import { Workflow, createAction } from "../lib/action-schema/action-types";

// ============================================================================
// Types
// ============================================================================

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  thumbnail?: string;
  tags: string[];
  workflow: Workflow;
  builtin: boolean;
}

export type TemplateCategory =
  | "basic"
  | "control-flow"
  | "data-processing"
  | "automation"
  | "advanced"
  | "custom";

export interface TemplateFilter {
  category?: TemplateCategory;
  search?: string;
  tags?: string[];
  builtinOnly?: boolean;
}

// ============================================================================
// Built-in Templates
// ============================================================================

/**
 * 1. Empty Workflow - Just entry point
 */
function createEmptyWorkflow(): Workflow {
  return {
    id: `workflow-${Date.now()}`,
    name: "New Workflow",
    version: "1.0.0",
    format: "graph",
    actions: [],
    connections: {},
    metadata: {
      created: new Date().toISOString(),
      description: "A new empty workflow",
    },
  };
}

/**
 * 2. Linear Workflow - Sequential actions template
 */
function createLinearWorkflow(): Workflow {
  const click1 = createAction(
    "CLICK",
    { target: "button.png" },
    [100, 100],
    {
      id: "action-1",
      name: "Click Button",
    }
  );

  const wait = createAction("WAIT", { waitFor: "time", duration: 1000 }, [100, 250], {
    id: "action-2",
    name: "Wait 1 Second",
  });

  const click2 = createAction(
    "CLICK",
    { target: "submit.png" },
    [100, 400],
    {
      id: "action-3",
      name: "Click Submit",
    }
  );

  return {
    id: `workflow-${Date.now()}`,
    name: "Linear Workflow",
    version: "1.0.0",
    format: "graph",
    actions: [click1, wait, click2],
    connections: {
      "action-1": {
        main: [[{ action: "action-2", type: "main", index: 0 }]],
      },
      "action-2": {
        main: [[{ action: "action-3", type: "main", index: 0 }]],
      },
    },
    metadata: {
      created: new Date().toISOString(),
      description: "A simple linear workflow with three sequential actions",
    },
  };
}

/**
 * 3. Conditional Workflow - IF statement template
 */
function createConditionalWorkflow(): Workflow {
  const find = createAction(
    "EXISTS",
    { target: { type: "image", imageId: "element.png" } },
    [100, 100],
    { id: "check", name: "Check if Element Exists" }
  );

  const ifAction = createAction(
    "IF",
    {
      condition: { type: "variable", variableName: "check" },
      thenActions: [],
      elseActions: [],
    },
    [100, 250],
    { id: "if-1", name: "If Found" }
  );

  const thenAction = createAction(
    "CLICK",
    { target: "element.png" },
    [300, 400],
    {
      id: "then-1",
      name: "Click Element",
    }
  );

  const elseAction = createAction(
    "TYPE",
    { text: "Element not found" },
    [500, 400],
    { id: "else-1", name: "Log Error" }
  );

  return {
    id: `workflow-${Date.now()}`,
    name: "Conditional Workflow",
    version: "1.0.0",
    format: "graph",
    actions: [find, ifAction, thenAction, elseAction],
    connections: {
      check: {
        main: [[{ action: "if-1", type: "main", index: 0 }]],
      },
      "if-1": {
        main: [
          [{ action: "then-1", type: "main", index: 0 }], // True branch
          [{ action: "else-1", type: "main", index: 0 }], // False branch
        ],
      },
    },
    metadata: {
      created: new Date().toISOString(),
      description: "Conditional workflow with IF/ELSE branching",
    },
  };
}

/**
 * 4. Loop Workflow - FOR loop template
 */
function createLoopWorkflow(): Workflow {
  const loop = createAction(
    "LOOP",
    { loopType: "FOR", iterations: 5, actions: [], iteratorVariable: "i" },
    [100, 100],
    { id: "loop-1", name: "Repeat 5 Times" }
  );

  const click = createAction(
    "CLICK",
    { target: "button.png" },
    [300, 100],
    {
      id: "loop-action",
      name: "Click Button",
    }
  );

  const wait = createAction("WAIT", { waitFor: "time", duration: 500 }, [300, 250], {
    id: "loop-wait",
    name: "Wait 500ms",
  });

  const done = createAction(
    "TYPE",
    { text: "Done" },
    [100, 400],
    {
      id: "done",
      name: "Type Done",
    }
  );

  return {
    id: `workflow-${Date.now()}`,
    name: "Loop Workflow",
    version: "1.0.0",
    format: "graph",
    actions: [loop, click, wait, done],
    connections: {
      "loop-1": {
        main: [[{ action: "loop-action", type: "main", index: 0 }]],
      },
      "loop-action": {
        main: [[{ action: "loop-wait", type: "main", index: 0 }]],
      },
      "loop-wait": {
        main: [[{ action: "loop-1", type: "main", index: 0 }]], // Loop back
      },
      // When loop completes, go to done
    },
    metadata: {
      created: new Date().toISOString(),
      description: "Workflow with a loop that repeats 5 times",
    },
  };
}

/**
 * 5. Error Handling - TRY_CATCH template
 */
function createErrorHandlingWorkflow(): Workflow {
  const tryCatch = createAction(
    "TRY_CATCH",
    { tryActions: [], catchActions: [] },
    [100, 100],
    { id: "try-1", name: "Try-Catch Block" }
  );

  const riskyAction = createAction(
    "CLICK",
    { target: "button.png" },
    [300, 100],
    { id: "risky", name: "Click (May Fail)" }
  );

  const success = createAction(
    "TYPE",
    { text: "Success" },
    [500, 100],
    {
      id: "success",
      name: "Success Handler",
    }
  );

  const error = createAction(
    "SCREENSHOT",
    { saveToFile: { enabled: true, filename: "error.png" } },
    [500, 250],
    {
      id: "error",
      name: "Take Error Screenshot",
    }
  );

  return {
    id: `workflow-${Date.now()}`,
    name: "Error Handling Workflow",
    version: "1.0.0",
    format: "graph",
    actions: [tryCatch, riskyAction, success, error],
    connections: {
      "try-1": {
        main: [[{ action: "risky", type: "main", index: 0 }]],
      },
      risky: {
        success: [[{ action: "success", type: "main", index: 0 }]],
        error: [[{ action: "error", type: "main", index: 0 }]],
      },
    },
    metadata: {
      created: new Date().toISOString(),
      description: "Workflow with error handling using TRY_CATCH",
    },
  };
}

/**
 * 6. Data Processing - Filter/Map/Reduce pipeline
 */
function createDataProcessingWorkflow(): Workflow {
  const getData = createAction(
    "GET_VARIABLE",
    { variableName: "items" },
    [100, 100],
    { id: "get-data", name: "Get Items" }
  );

  const filter = createAction(
    "FILTER",
    { variableName: "items", condition: { type: "property", property: "active", operator: "==", value: true } },
    [100, 250],
    { id: "filter", name: "Filter Active Items" }
  );

  const map = createAction(
    "MAP",
    { variableName: "filteredItems", transform: { type: "property", property: "name" } },
    [100, 400],
    { id: "map", name: "Map to Uppercase" }
  );

  const reduce = createAction("REDUCE", { variableName: "mappedItems", operation: "count" }, [100, 550], {
    id: "reduce",
    name: "Count Items",
  });

  const save = createAction(
    "SET_VARIABLE",
    { variableName: "result", value: "${reduce.output}", scope: "local" },
    [100, 700],
    { id: "save", name: "Save Result" }
  );

  return {
    id: `workflow-${Date.now()}`,
    name: "Data Processing Workflow",
    version: "1.0.0",
    format: "graph",
    actions: [getData, filter, map, reduce, save],
    connections: {
      "get-data": {
        main: [[{ action: "filter", type: "main", index: 0 }]],
      },
      filter: {
        main: [[{ action: "map", type: "main", index: 0 }]],
      },
      map: {
        main: [[{ action: "reduce", type: "main", index: 0 }]],
      },
      reduce: {
        main: [[{ action: "save", type: "main", index: 0 }]],
      },
    },
    metadata: {
      created: new Date().toISOString(),
      description:
        "Data processing pipeline with filter, map, and reduce operations",
    },
  };
}

/**
 * 7. Form Automation - Form filling template
 */
function createFormAutomationWorkflow(): Workflow {
  const clickName = createAction(
    "CLICK",
    { target: "#name" },
    [100, 100],
    {
      id: "click-name",
      name: "Click Name Field",
    }
  );

  const typeName = createAction(
    "TYPE",
    { text: "John Doe" },
    [100, 250],
    {
      id: "type-name",
      name: "Type Name",
    }
  );

  const clickEmail = createAction(
    "CLICK",
    { target: "#email" },
    [100, 400],
    {
      id: "click-email",
      name: "Click Email Field",
    }
  );

  const typeEmail = createAction(
    "TYPE",
    { text: "john@example.com" },
    [100, 550],
    { id: "type-email", name: "Type Email" }
  );

  const submit = createAction(
    "CLICK",
    { target: 'button[type="submit"]' },
    [100, 700],
    {
      id: "submit",
      name: "Click Submit",
    }
  );

  return {
    id: `workflow-${Date.now()}`,
    name: "Form Automation",
    version: "1.0.0",
    format: "graph",
    actions: [clickName, typeName, clickEmail, typeEmail, submit],
    connections: {
      "click-name": {
        main: [[{ action: "type-name", type: "main", index: 0 }]],
      },
      "type-name": {
        main: [[{ action: "click-email", type: "main", index: 0 }]],
      },
      "click-email": {
        main: [[{ action: "type-email", type: "main", index: 0 }]],
      },
      "type-email": {
        main: [[{ action: "submit", type: "main", index: 0 }]],
      },
    },
    metadata: {
      created: new Date().toISOString(),
      description: "Automated form filling workflow",
    },
  };
}

/**
 * 8. Scraping - Data extraction template
 */
function createScrapingWorkflow(): Workflow {
  const find = createAction(
    "FIND",
    { target: { type: "text", text: ".product-card" } },
    [100, 100],
    {
      id: "find-products",
      name: "Find Product Cards",
    }
  );

  const extract = createAction(
    "GET_VARIABLE",
    { variableName: "found.text" },
    [100, 250],
    { id: "extract-text", name: "Extract Text" }
  );

  const filter = createAction(
    "FILTER",
    { variableName: "extractedText", condition: { type: "property", property: "price", operator: "<", value: 100 } },
    [100, 400],
    { id: "filter-price", name: "Filter by Price" }
  );

  const save = createAction(
    "SET_VARIABLE",
    { variableName: "products", value: "${filter.output}", scope: "process" },
    [100, 550],
    { id: "save-results", name: "Save Results" }
  );

  const screenshot = createAction(
    "SCREENSHOT",
    { saveToFile: { enabled: true, filename: "products.png" } },
    [100, 700],
    {
      id: "screenshot",
      name: "Take Screenshot",
    }
  );

  return {
    id: `workflow-${Date.now()}`,
    name: "Web Scraping Workflow",
    version: "1.0.0",
    format: "graph",
    actions: [find, extract, filter, save, screenshot],
    connections: {
      "find-products": {
        main: [[{ action: "extract-text", type: "main", index: 0 }]],
      },
      "extract-text": {
        main: [[{ action: "filter-price", type: "main", index: 0 }]],
      },
      "filter-price": {
        main: [[{ action: "save-results", type: "main", index: 0 }]],
      },
      "save-results": {
        main: [[{ action: "screenshot", type: "main", index: 0 }]],
      },
    },
    metadata: {
      created: new Date().toISOString(),
      description: "Web scraping workflow for extracting product data",
    },
  };
}

// ============================================================================
// Template Registry
// ============================================================================

const BUILTIN_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "empty",
    name: "Empty Workflow",
    description: "Start with a blank canvas",
    category: "basic",
    tags: ["blank", "new", "empty"],
    workflow: createEmptyWorkflow(),
    builtin: true,
  },
  {
    id: "linear",
    name: "Linear Workflow",
    description: "Simple sequential actions",
    category: "basic",
    tags: ["sequential", "simple", "basic"],
    workflow: createLinearWorkflow(),
    builtin: true,
  },
  {
    id: "conditional",
    name: "Conditional Logic",
    description: "IF/ELSE branching workflow",
    category: "control-flow",
    tags: ["if", "else", "branch", "conditional"],
    workflow: createConditionalWorkflow(),
    builtin: true,
  },
  {
    id: "loop",
    name: "Loop Workflow",
    description: "Repeat actions multiple times",
    category: "control-flow",
    tags: ["loop", "repeat", "iteration"],
    workflow: createLoopWorkflow(),
    builtin: true,
  },
  {
    id: "error-handling",
    name: "Error Handling",
    description: "TRY/CATCH error handling",
    category: "control-flow",
    tags: ["error", "try", "catch", "exception"],
    workflow: createErrorHandlingWorkflow(),
    builtin: true,
  },
  {
    id: "data-processing",
    name: "Data Processing",
    description: "Filter, map, and reduce operations",
    category: "data-processing",
    tags: ["filter", "map", "reduce", "data", "transform"],
    workflow: createDataProcessingWorkflow(),
    builtin: true,
  },
  {
    id: "form-automation",
    name: "Form Automation",
    description: "Automated form filling",
    category: "automation",
    tags: ["form", "input", "submit", "fill"],
    workflow: createFormAutomationWorkflow(),
    builtin: true,
  },
  {
    id: "scraping",
    name: "Web Scraping",
    description: "Extract data from web pages",
    category: "automation",
    tags: ["scrape", "extract", "data", "web"],
    workflow: createScrapingWorkflow(),
    builtin: true,
  },
];

// ============================================================================
// WorkflowTemplates Service
// ============================================================================

export class WorkflowTemplatesService {
  private static instance: WorkflowTemplatesService;
  private customTemplates: WorkflowTemplate[] = [];

  private constructor() {
    this.loadCustomTemplates();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): WorkflowTemplatesService {
    if (!WorkflowTemplatesService.instance) {
      WorkflowTemplatesService.instance = new WorkflowTemplatesService();
    }
    return WorkflowTemplatesService.instance;
  }

  // ==========================================================================
  // Get Templates
  // ==========================================================================

  /**
   * Get all templates
   */
  getTemplates(filter?: TemplateFilter): WorkflowTemplate[] {
    let templates = [...BUILTIN_TEMPLATES, ...this.customTemplates];

    // Apply filters
    if (filter) {
      if (filter.builtinOnly) {
        templates = templates.filter((t) => t.builtin);
      }

      if (filter.category) {
        templates = templates.filter((t) => t.category === filter.category);
      }

      if (filter.tags && filter.tags.length > 0) {
        templates = templates.filter((t) =>
          filter.tags!.some((tag) => t.tags.includes(tag))
        );
      }

      if (filter.search) {
        const search = filter.search.toLowerCase();
        templates = templates.filter(
          (t) =>
            t.name.toLowerCase().includes(search) ||
            t.description.toLowerCase().includes(search) ||
            t.tags.some((tag) => tag.toLowerCase().includes(search))
        );
      }
    }

    return templates;
  }

  /**
   * Get template by ID
   */
  getTemplate(id: string): WorkflowTemplate | undefined {
    return [...BUILTIN_TEMPLATES, ...this.customTemplates].find(
      (t) => t.id === id
    );
  }

  /**
   * Get builtin templates only
   */
  getBuiltinTemplates(): WorkflowTemplate[] {
    return BUILTIN_TEMPLATES;
  }

  /**
   * Get custom templates only
   */
  getCustomTemplates(): WorkflowTemplate[] {
    return this.customTemplates;
  }

  /**
   * Get template categories
   */
  getCategories(): TemplateCategory[] {
    return [
      "basic",
      "control-flow",
      "data-processing",
      "automation",
      "advanced",
      "custom",
    ];
  }

  // ==========================================================================
  // Create from Template
  // ==========================================================================

  /**
   * Create workflow from template
   */
  createFromTemplate(templateId: string): Workflow | null {
    const template = this.getTemplate(templateId);
    if (!template) {
      return null;
    }

    // Clone the workflow with new ID
    const workflow: Workflow = {
      ...template.workflow,
      id: `workflow-${Date.now()}`,
      metadata: {
        ...template.workflow.metadata,
        created: new Date().toISOString(),
        templateId: template.id,
        templateName: template.name,
      },
    };

    return workflow;
  }

  // ==========================================================================
  // Custom Templates
  // ==========================================================================

  /**
   * Save workflow as custom template
   */
  saveAsTemplate(
    workflow: Workflow,
    name: string,
    description: string,
    category: TemplateCategory = "custom",
    tags: string[] = []
  ): WorkflowTemplate {
    const template: WorkflowTemplate = {
      id: `custom-${Date.now()}`,
      name,
      description,
      category,
      tags,
      workflow: { ...workflow },
      builtin: false,
    };

    this.customTemplates.push(template);
    this.saveCustomTemplates();

    return template;
  }

  /**
   * Delete custom template
   */
  deleteTemplate(id: string): boolean {
    const index = this.customTemplates.findIndex((t) => t.id === id);
    if (index === -1) {
      return false;
    }

    this.customTemplates.splice(index, 1);
    this.saveCustomTemplates();
    return true;
  }

  /**
   * Update custom template
   */
  updateTemplate(id: string, updates: Partial<WorkflowTemplate>): boolean {
    const index = this.customTemplates.findIndex((t) => t.id === id);
    if (index === -1) {
      return false;
    }

    this.customTemplates[index] = {
      ...this.customTemplates[index],
      ...updates,
      builtin: false, // Ensure it remains custom
    } as WorkflowTemplate;

    this.saveCustomTemplates();
    return true;
  }

  // ==========================================================================
  // Persistence
  // ==========================================================================

  /**
   * Load custom templates from localStorage
   */
  private loadCustomTemplates(): void {
    try {
      const json = localStorage.getItem("workflow-custom-templates");
      if (json) {
        this.customTemplates = JSON.parse(json);
      }
    } catch (error) {
      console.error("Failed to load custom templates:", error);
      this.customTemplates = [];
    }
  }

  /**
   * Save custom templates to localStorage
   */
  private saveCustomTemplates(): void {
    try {
      localStorage.setItem(
        "workflow-custom-templates",
        JSON.stringify(this.customTemplates)
      );
    } catch (error) {
      console.error("Failed to save custom templates:", error);
    }
  }

  /**
   * Clear all custom templates
   */
  clearCustomTemplates(): void {
    this.customTemplates = [];
    localStorage.removeItem("workflow-custom-templates");
  }
}

// ============================================================================
// Exports
// ============================================================================

export const workflowTemplates = WorkflowTemplatesService.getInstance();
