/**
 * MCP Client - AI-powered workflow generation
 *
 * Connects to the qontinui MCP server to enable:
 * - Natural language workflow generation
 * - Action search with semantic understanding
 * - Workflow validation and optimization
 * - Context-aware suggestions
 * - Iterative refinement
 */

import type {
  Workflow,
  Action,
  ActionType,
} from "../lib/action-schema/action-types";

// ============================================================================
// Types
// ============================================================================

export interface SearchFilters {
  category?: string[];
  actionType?: ActionType[];
  tags?: string[];
  limit?: number;
}

export interface ActionResult {
  id: string;
  type: ActionType;
  name: string;
  description: string;
  category: string;
  confidence?: number;
  parameters?: Record<string, any>;
  examples?: string[];
}

export interface ActionDetails {
  id: string;
  type: ActionType;
  name: string;
  description: string;
  category: string;
  parameters: Array<{
    name: string;
    type: string;
    description: string;
    required: boolean;
    default?: any;
  }>;
  examples: Array<{
    name: string;
    description: string;
    config: any;
  }>;
  relatedActions?: string[];
  documentation?: string;
}

export interface ValidationError {
  id: string;
  actionId?: string;
  type:
    | "connection"
    | "cycle"
    | "orphaned"
    | "missing_connection"
    | "invalid_config";
  severity: "error" | "warning";
  message: string;
  details?: any;
  suggestion?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  stats?: {
    actionCount: number;
    connectionCount: number;
    branchCount: number;
    maxDepth: number;
  };
}

export interface GenerationContext {
  existingWorkflow?: Workflow;
  templates?: string[];
  constraints?: string[];
  examples?: Workflow[];
  preferredActions?: ActionType[];
  avoidActions?: ActionType[];
}

export interface GeneratedWorkflow {
  workflow: Workflow;
  confidence: number;
  explanation: string;
  reasoning?: string[];
  alternatives?: Array<{
    workflow: Workflow;
    confidence: number;
    reason: string;
  }>;
  suggestions?: string[];
}

export interface WorkflowSuggestion {
  id: string;
  type:
    | "optimization"
    | "error_handling"
    | "missing_action"
    | "improvement"
    | "alternative";
  title: string;
  description: string;
  confidence: number;
  impact: "high" | "medium" | "low";
  actions?: Array<{
    type: "add" | "remove" | "modify" | "connect";
    actionId?: string;
    action?: Action;
    connection?: any;
    modification?: any;
  }>;
  preview?: Workflow;
}

export interface RefinementFeedback {
  feedback: string;
  focusAreas?: string[];
  keepActions?: string[];
  removeActions?: string[];
}

// ============================================================================
// MCP Client
// ============================================================================

export class MCPClient {
  private baseUrl: string;
  private timeout: number;
  private cache: Map<string, { data: any; timestamp: number }>;
  private cacheTimeout: number;

  constructor(
    baseUrl: string = "http://localhost:3000/mcp",
    options?: {
      timeout?: number;
      cacheTimeout?: number;
    }
  ) {
    this.baseUrl = baseUrl;
    this.timeout = options?.timeout || 30000;
    this.cacheTimeout = options?.cacheTimeout || 300000; // 5 minutes
    this.cache = new Map();
  }

  // ==========================================================================
  // Action Search
  // ==========================================================================

  /**
   * Search for actions using natural language
   *
   * @example
   * searchActions("click the submit button")
   * searchActions("find an image on screen", { category: ['vision'] })
   */
  async searchActions(
    query: string,
    filters?: SearchFilters
  ): Promise<ActionResult[]> {
    const cacheKey = `search:${query}:${JSON.stringify(filters)}`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    const response = await this.request("POST", "/search/actions", {
      query,
      filters,
      limit: filters?.limit || 10,
    });

    this.setCache(cacheKey, response.results);
    return response.results;
  }

  /**
   * Get detailed information about a specific action
   */
  async getActionDetails(actionType: ActionType): Promise<ActionDetails> {
    const cacheKey = `details:${actionType}`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    const response = await this.request("GET", `/actions/${actionType}`);

    this.setCache(cacheKey, response);
    return response;
  }

  /**
   * Search for actions by category
   */
  async searchByCategory(category: string): Promise<ActionResult[]> {
    const cacheKey = `category:${category}`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    const response = await this.request(
      "GET",
      `/categories/${category}/actions`
    );

    this.setCache(cacheKey, response.results);
    return response.results;
  }

  /**
   * Get all available categories
   */
  async getCategories(): Promise<
    Array<{ id: string; name: string; count: number }>
  > {
    const cacheKey = "categories:all";
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    const response = await this.request("GET", "/categories");

    this.setCache(cacheKey, response.categories);
    return response.categories;
  }

  // ==========================================================================
  // Workflow Validation
  // ==========================================================================

  /**
   * Validate a workflow structure
   * Checks for:
   * - Connection validity
   * - Cycle detection
   * - Orphaned actions
   * - Missing required connections
   * - Invalid configurations
   */
  async validateWorkflow(workflow: Workflow): Promise<ValidationResult> {
    const response = await this.request("POST", "/workflows/validate", {
      workflow,
    });

    return response.validation;
  }

  /**
   * Analyze workflow for optimization opportunities
   */
  async analyzeWorkflow(workflow: Workflow): Promise<{
    complexity: number;
    performance: {
      estimatedTime: number;
      bottlenecks: string[];
    };
    suggestions: WorkflowSuggestion[];
  }> {
    const response = await this.request("POST", "/workflows/analyze", {
      workflow,
    });

    return response.analysis;
  }

  // ==========================================================================
  // AI Workflow Generation
  // ==========================================================================

  /**
   * Generate a complete workflow from natural language description
   *
   * @example
   * generateWorkflow("Create a workflow that logs into Gmail by clicking login and typing credentials")
   * generateWorkflow("Build a scraper that finds product prices", { templates: ['scraping'] })
   */
  async generateWorkflow(
    description: string,
    context?: GenerationContext
  ): Promise<GeneratedWorkflow> {
    const response = await this.request(
      "POST",
      "/workflows/generate",
      {
        description,
        context: {
          existingWorkflow: context?.existingWorkflow,
          templates: context?.templates,
          constraints: context?.constraints,
          examples: context?.examples,
          preferredActions: context?.preferredActions,
          avoidActions: context?.avoidActions,
        },
      },
      {
        timeout: 60000, // Longer timeout for AI generation
      }
    );

    return {
      workflow: response.workflow,
      confidence: response.confidence,
      explanation: response.explanation,
      reasoning: response.reasoning,
      alternatives: response.alternatives,
      suggestions: response.suggestions,
    };
  }

  /**
   * Refine an existing workflow with feedback
   *
   * @example
   * refineWorkflow(workflow, "Add error handling for network failures")
   * refineWorkflow(workflow, "Make it run faster", ["optimize"])
   */
  async refineWorkflow(
    workflow: Workflow,
    feedback: string | RefinementFeedback
  ): Promise<GeneratedWorkflow> {
    const refinementData =
      typeof feedback === "string" ? { feedback } : feedback;

    const response = await this.request(
      "POST",
      "/workflows/refine",
      {
        workflow,
        ...refinementData,
      },
      {
        timeout: 60000,
      }
    );

    return {
      workflow: response.workflow,
      confidence: response.confidence,
      explanation: response.explanation,
      reasoning: response.reasoning,
      alternatives: response.alternatives,
      suggestions: response.suggestions,
    };
  }

  /**
   * Generate workflow from a template
   */
  async generateFromTemplate(
    templateId: string,
    parameters?: Record<string, any>
  ): Promise<GeneratedWorkflow> {
    const response = await this.request("POST", "/workflows/from-template", {
      templateId,
      parameters,
    });

    return {
      workflow: response.workflow,
      confidence: response.confidence,
      explanation: response.explanation,
      reasoning: response.reasoning,
    };
  }

  // ==========================================================================
  // Suggestions
  // ==========================================================================

  /**
   * Get context-aware suggestions for improving a workflow
   *
   * Analyzes the workflow and suggests:
   * - Missing error handling
   * - Performance optimizations
   * - Better action choices
   * - Missing connections
   * - Parallel execution opportunities
   */
  async getSuggestions(
    partialWorkflow: Workflow
  ): Promise<WorkflowSuggestion[]> {
    const response = await this.request("POST", "/workflows/suggestions", {
      workflow: partialWorkflow,
    });

    return response.suggestions;
  }

  /**
   * Get suggestions for what to add next
   */
  async getNextActionSuggestions(
    workflow: Workflow,
    afterActionId?: string
  ): Promise<
    Array<{
      action: ActionResult;
      reason: string;
      confidence: number;
    }>
  > {
    const response = await this.request("POST", "/workflows/suggest-next", {
      workflow,
      afterActionId,
    });

    return response.suggestions;
  }

  /**
   * Apply a suggestion to a workflow
   */
  async applySuggestion(
    workflow: Workflow,
    suggestion: WorkflowSuggestion
  ): Promise<Workflow> {
    const response = await this.request("POST", "/workflows/apply-suggestion", {
      workflow,
      suggestionId: suggestion.id,
      actions: suggestion.actions,
    });

    return response.workflow;
  }

  // ==========================================================================
  // Templates
  // ==========================================================================

  /**
   * Get available workflow templates
   */
  async getTemplates(category?: string): Promise<
    Array<{
      id: string;
      name: string;
      description: string;
      category: string;
      tags: string[];
      parameters?: Array<{
        name: string;
        type: string;
        description: string;
        required: boolean;
        default?: any;
      }>;
      preview?: Workflow;
    }>
  > {
    const cacheKey = `templates:${category || "all"}`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    const response = await this.request(
      "GET",
      `/templates${category ? `?category=${category}` : ""}`
    );

    this.setCache(cacheKey, response.templates);
    return response.templates;
  }

  // ==========================================================================
  // Explanation
  // ==========================================================================

  /**
   * Get a natural language explanation of a workflow
   */
  async explainWorkflow(workflow: Workflow): Promise<{
    summary: string;
    steps: Array<{
      actionId: string;
      explanation: string;
      purpose: string;
    }>;
    flowDescription: string;
    potentialIssues?: string[];
    recommendations?: string[];
  }> {
    const response = await this.request("POST", "/workflows/explain", {
      workflow,
    });

    return response.explanation;
  }

  /**
   * Get explanation for a specific action
   */
  async explainAction(action: Action): Promise<{
    what: string;
    why: string;
    how: string;
    alternatives?: string[];
  }> {
    const response = await this.request("POST", "/actions/explain", {
      action,
    });

    return response.explanation;
  }

  // ==========================================================================
  // Optimization
  // ==========================================================================

  /**
   * Optimize a workflow for performance
   */
  async optimizeWorkflow(
    workflow: Workflow,
    optimizationGoals?: Array<
      "speed" | "reliability" | "simplicity" | "maintainability"
    >
  ): Promise<GeneratedWorkflow> {
    const response = await this.request(
      "POST",
      "/workflows/optimize",
      {
        workflow,
        goals: optimizationGoals || ["speed", "reliability"],
      },
      {
        timeout: 60000,
      }
    );

    return {
      workflow: response.workflow,
      confidence: response.confidence,
      explanation: response.explanation,
      reasoning: response.reasoning,
      suggestions: response.suggestions,
    };
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  private async request(
    method: "GET" | "POST" | "PUT" | "DELETE",
    endpoint: string,
    data?: any,
    options?: { timeout?: number }
  ): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options?.timeout || this.timeout
    );

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: data ? JSON.stringify(data) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new MCPError(
          error.message || `Request failed: ${response.statusText}`,
          response.status,
          error
        );
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeout);

      if (error instanceof MCPError) {
        throw error;
      }

      const err = error as Error;
      if (err.name === "AbortError") {
        throw new MCPError("Request timeout", 408);
      }

      throw new MCPError(err.message || "Network error", 0, error);
    }
  }

  private getCached(key: string): any | null {
    const cached = this.cache.get(key);
    if (!cached) return null;

    const age = Date.now() - cached.timestamp;
    if (age > this.cacheTimeout) {
      this.cache.delete(key);
      return null;
    }

    return cached.data;
  }

  private setCache(key: string, data: any): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Check if MCP server is available
   */
  async healthCheck(): Promise<{
    available: boolean;
    version?: string;
    capabilities?: string[];
  }> {
    try {
      const response = await this.request("GET", "/health");
      return {
        available: true,
        version: response.version,
        capabilities: response.capabilities,
      };
    } catch (error) {
      return {
        available: false,
      };
    }
  }
}

// ============================================================================
// Error Handling
// ============================================================================

export class MCPError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: any
  ) {
    super(message);
    this.name = "MCPError";
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let mcpClient: MCPClient | null = null;

/**
 * Get the global MCP client instance
 */
export function getMCPClient(): MCPClient {
  if (!mcpClient) {
    const baseUrl =
      (import.meta as any).env?.VITE_MCP_URL || "http://localhost:3000/mcp";
    mcpClient = new MCPClient(baseUrl);
  }
  return mcpClient;
}

/**
 * Set a custom MCP client instance
 */
export function setMCPClient(client: MCPClient): void {
  mcpClient = client;
}
