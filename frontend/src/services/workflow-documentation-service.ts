/**
 * Enhanced Workflow Documentation System
 *
 * Provides comprehensive documentation management for workflows:
 * - Documentation CRUD operations
 * - Action-level commenting
 * - Auto-generated documentation with multiple sections
 * - Documentation templates
 * - Version history tracking
 * - Full-text search
 * - Export to multiple formats
 * - Rich markdown support with Mermaid diagrams
 */

import { Workflow, ActionType } from "../lib/action-schema/action-types";

// ============================================================================
// Types
// ============================================================================

export interface WorkflowDocumentation {
  workflowId: string;
  content: string;
  format: "markdown" | "html" | "plain";
  created: string;
  updated: string;
  version: number;
  author?: string;
  tags?: string[];
}

export interface ActionComment {
  id: string;
  workflowId: string;
  actionId: string;
  comment: string;
  created: string;
  updated: string;
  author?: string;
}

export interface DocumentationVersion {
  version: number;
  content: string;
  timestamp: string;
  author?: string;
  changeDescription?: string;
}

export interface DocumentationTemplate {
  name: string;
  description: string;
  category:
    | "standard"
    | "api"
    | "ui-test"
    | "data-processing"
    | "error-handling"
    | "custom";
  content: string;
}

export interface VariableInfo {
  name: string;
  scope: "local" | "process" | "global";
  type: string;
  usage: string;
  actions: string[];
}

export interface DependencyInfo {
  type: "workflow" | "external" | "resource";
  name: string;
  description: string;
  required: boolean;
}

export interface ComplexityMetrics {
  totalActions: number;
  branchingPoints: number;
  loopCount: number;
  maxDepth: number;
  cyclomaticComplexity: number;
  cognitiveComplexity: number;
}

export interface DocumentationSection {
  title: string;
  content: string;
  level: number;
}

export interface ExportOptions {
  format: "markdown" | "html" | "pdf";
  includeTOC?: boolean;
  includeMetadata?: boolean;
  includeDiagrams?: boolean;
  includeComments?: boolean;
}

// ============================================================================
// Workflow Documentation Service
// ============================================================================

export class WorkflowDocumentationService {
  private static instance: WorkflowDocumentationService;
  private documentations: Map<string, WorkflowDocumentation> = new Map();
  private comments: Map<string, ActionComment> = new Map();
  private versions: Map<string, DocumentationVersion[]> = new Map();
  private readonly DOCS_STORAGE_KEY = "workflow-documentation";
  private readonly COMMENTS_STORAGE_KEY = "workflow-action-comments";
  private readonly VERSIONS_STORAGE_KEY = "workflow-documentation-versions";

  private constructor() {
    this.loadFromStorage();
  }

  static getInstance(): WorkflowDocumentationService {
    if (!WorkflowDocumentationService.instance) {
      WorkflowDocumentationService.instance =
        new WorkflowDocumentationService();
    }
    return WorkflowDocumentationService.instance;
  }

  // ==========================================================================
  // 1. Documentation Management
  // ==========================================================================

  /**
   * Create documentation for a workflow
   */
  createDocumentation(
    workflowId: string,
    content: string,
    options?: {
      format?: "markdown" | "html" | "plain";
      author?: string;
      tags?: string[];
    }
  ): WorkflowDocumentation {
    const doc: WorkflowDocumentation = {
      workflowId,
      content,
      format: options?.format || "markdown",
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      version: 1,
      author: options?.author,
      tags: options?.tags || [],
    };

    this.documentations.set(workflowId, doc);
    this.saveDocumentationVersion(workflowId, content, "Initial documentation");
    this.saveToStorage();

    return doc;
  }

  /**
   * Update documentation for a workflow
   */
  updateDocumentation(
    workflowId: string,
    content: string,
    changeDescription?: string
  ): WorkflowDocumentation | null {
    const doc = this.documentations.get(workflowId);
    if (!doc) {
      return null;
    }

    doc.content = content;
    doc.updated = new Date().toISOString();
    doc.version++;

    this.saveDocumentationVersion(workflowId, content, changeDescription);
    this.saveToStorage();

    return doc;
  }

  /**
   * Get documentation for a workflow
   */
  getDocumentation(workflowId: string): WorkflowDocumentation | null {
    return this.documentations.get(workflowId) || null;
  }

  /**
   * Delete documentation for a workflow
   */
  deleteDocumentation(workflowId: string): boolean {
    const deleted = this.documentations.delete(workflowId);
    if (deleted) {
      this.versions.delete(workflowId);
      // Delete associated comments
      const commentIds = Array.from(this.comments.values())
        .filter((c) => c.workflowId === workflowId)
        .map((c) => c.id);
      commentIds.forEach((id) => this.comments.delete(id));
      this.saveToStorage();
    }
    return deleted;
  }

  /**
   * Check if workflow has documentation
   */
  hasDocumentation(workflowId: string): boolean {
    return this.documentations.has(workflowId);
  }

  // ==========================================================================
  // 2. Action Comments
  // ==========================================================================

  /**
   * Add comment to an action
   */
  addActionComment(
    workflowId: string,
    actionId: string,
    comment: string,
    author?: string
  ): ActionComment {
    const commentObj: ActionComment = {
      id: `comment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      workflowId,
      actionId,
      comment,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      author,
    };

    this.comments.set(commentObj.id, commentObj);
    this.saveToStorage();

    return commentObj;
  }

  /**
   * Update an action comment
   */
  updateActionComment(
    commentId: string,
    comment: string
  ): ActionComment | null {
    const commentObj = this.comments.get(commentId);
    if (!commentObj) {
      return null;
    }

    commentObj.comment = comment;
    commentObj.updated = new Date().toISOString();
    this.saveToStorage();

    return commentObj;
  }

  /**
   * Delete an action comment
   */
  deleteActionComment(commentId: string): boolean {
    const deleted = this.comments.delete(commentId);
    if (deleted) {
      this.saveToStorage();
    }
    return deleted;
  }

  /**
   * Get comment for a specific action
   */
  getActionComment(actionId: string): ActionComment | null {
    return (
      Array.from(this.comments.values()).find((c) => c.actionId === actionId) ||
      null
    );
  }

  /**
   * Get all comments for a workflow
   */
  getAllActionComments(workflowId: string): ActionComment[] {
    return Array.from(this.comments.values()).filter(
      (c) => c.workflowId === workflowId
    );
  }

  // ==========================================================================
  // 3. Auto-Generated Documentation
  // ==========================================================================

  /**
   * Generate comprehensive documentation for a workflow
   */
  generateDocumentation(workflow: Workflow): string {
    const sections: string[] = [];

    // Title and metadata
    sections.push(`# ${workflow.name}\n`);

    // Overview
    sections.push(this.generateOverview(workflow));

    // Purpose and Use Cases
    sections.push(this.generatePurposeSection(workflow));

    // Input Requirements
    sections.push(this.generateInputRequirements(workflow));

    // Output/Side Effects
    sections.push(this.generateOutputSection(workflow));

    // Action Flow
    sections.push(this.generateActionFlow(workflow));

    // Variables Used
    sections.push(this.generateVariablesTable(workflow));

    // Dependencies
    sections.push(this.generateDependenciesList(workflow));

    // Complexity Metrics
    sections.push(this.generateComplexityMetrics(workflow));

    // Visual Flowchart
    sections.push(this.generateFlowchart(workflow));

    // Error Handling
    sections.push(this.generateErrorHandlingSection(workflow));

    // Recent Changes
    sections.push(this.generateRecentChanges(workflow));

    return sections.join("\n\n");
  }

  /**
   * Generate overview section
   */
  private generateOverview(workflow: Workflow): string {
    const parts: string[] = ["## Overview\n"];

    parts.push(`**Name:** ${workflow.name}`);
    parts.push(`**Version:** ${workflow.version}`);
    parts.push(`**Category:** ${workflow.category || "Uncategorized"}`);
    parts.push(`**Format:** Graph-based workflow`);

    if (workflow.description) {
      parts.push(`\n**Description:** ${workflow.description}`);
    }

    if (workflow.metadata?.created) {
      parts.push(
        `**Created:** ${new Date(workflow.metadata.created).toLocaleString()}`
      );
    }

    if (workflow.metadata?.updated) {
      parts.push(
        `**Last Updated:** ${new Date(workflow.metadata.updated).toLocaleString()}`
      );
    }

    if (workflow.metadata?.author) {
      parts.push(`**Author:** ${workflow.metadata.author}`);
    }

    if (workflow.tags && workflow.tags.length > 0) {
      parts.push(`**Tags:** ${workflow.tags.join(", ")}`);
    }

    return parts.join("\n");
  }

  /**
   * Generate purpose and use cases section
   */
  private generatePurposeSection(workflow: Workflow): string {
    const parts: string[] = ["## Purpose and Use Cases\n"];

    // Try to infer purpose from workflow structure
    const actionTypes = new Set(workflow.actions.map((a) => a.type));
    const hasControlFlow = Array.from(actionTypes).some((t) =>
      ["IF", "LOOP", "SWITCH", "TRY_CATCH"].includes(t)
    );
    const hasUI = Array.from(actionTypes).some((t) =>
      ["CLICK", "TYPE", "FIND", "EXISTS"].includes(t)
    );
    const hasData = Array.from(actionTypes).some((t) =>
      ["FILTER", "MAP", "REDUCE", "SORT"].includes(t)
    );

    if (workflow.description) {
      parts.push(workflow.description);
      parts.push("");
    }

    parts.push("**Characteristics:**");
    if (hasControlFlow) {
      parts.push("- Contains conditional logic and control flow");
    }
    if (hasUI) {
      parts.push("- Includes UI automation actions");
    }
    if (hasData) {
      parts.push("- Performs data processing operations");
    }
    parts.push(`- Total of ${workflow.actions.length} action(s)`);

    return parts.join("\n");
  }

  /**
   * Generate input requirements section
   */
  private generateInputRequirements(workflow: Workflow): string {
    const parts: string[] = ["## Input Requirements\n"];

    // Variables
    if (workflow.variables) {
      parts.push("### Required Variables:\n");

      if (
        workflow.variables.local &&
        Object.keys(workflow.variables.local).length > 0
      ) {
        parts.push("**Local Variables:**");
        Object.entries(workflow.variables.local).forEach(([key, value]) => {
          parts.push(
            `- \`${key}\`: ${typeof value} = ${JSON.stringify(value)}`
          );
        });
      }

      if (
        workflow.variables.process &&
        Object.keys(workflow.variables.process).length > 0
      ) {
        parts.push("\n**Process Variables:**");
        Object.entries(workflow.variables.process).forEach(([key, value]) => {
          parts.push(
            `- \`${key}\`: ${typeof value} = ${JSON.stringify(value)}`
          );
        });
      }

      if (
        workflow.variables.global &&
        Object.keys(workflow.variables.global).length > 0
      ) {
        parts.push("\n**Global Variables:**");
        Object.entries(workflow.variables.global).forEach(([key, value]) => {
          parts.push(
            `- \`${key}\`: ${typeof value} = ${JSON.stringify(value)}`
          );
        });
      }
    } else {
      parts.push("*No predefined variables required.*");
    }

    // Initial states
    if (workflow.initialStateIds && workflow.initialStateIds.length > 0) {
      parts.push("\n### Required Initial States:\n");
      workflow.initialStateIds.forEach((stateId) => {
        parts.push(`- ${stateId}`);
      });
    }

    // Initial screenshot
    if (workflow.initialScreenshotId) {
      parts.push(
        `\n### Initial Screenshot: \`${workflow.initialScreenshotId}\``
      );
    }

    return parts.join("\n");
  }

  /**
   * Generate output/side effects section
   */
  private generateOutputSection(workflow: Workflow): string {
    const parts: string[] = ["## Output & Side Effects\n"];

    // Look for actions that produce output
    const outputActions = workflow.actions.filter((a) =>
      ["SCREENSHOT", "SET_VARIABLE", "RUN_WORKFLOW"].includes(a.type)
    );

    if (outputActions.length > 0) {
      parts.push("### Actions with Output:\n");
      outputActions.forEach((action) => {
        const name = action.name || action.id;
        parts.push(`- **${name}** (${action.type})`);

        if (action.type === "SCREENSHOT") {
          const config = action.config as { filename?: string };
          parts.push(
            `  - Saves screenshot: \`${config.filename || "screenshot.png"}\``
          );
        } else if (action.type === "SET_VARIABLE") {
          const config = action.config as { variable?: string; scope?: string };
          parts.push(`  - Sets variable: \`${config.variable}\``);
          parts.push(`  - Scope: ${config.scope || "local"}`);
        } else if (action.type === "RUN_WORKFLOW") {
          const config = action.config as { workflowId?: string };
          parts.push(`  - Executes workflow: \`${config.workflowId}\``);
        }
      });
    } else {
      parts.push(
        "*No explicit outputs defined. Side effects may include UI interactions.*"
      );
    }

    return parts.join("\n");
  }

  /**
   * Generate action flow section
   */
  private generateActionFlow(workflow: Workflow): string {
    const parts: string[] = ["## Action Flow\n"];

    parts.push("Step-by-step execution flow:\n");

    // Find entry point (action with no incoming connections)
    const entryPoints = this.findEntryPoints(workflow);

    if (entryPoints.length === 0 && workflow.actions.length > 0) {
      // Fallback to first action
      entryPoints.push(workflow.actions[0]!.id);
    }

    let stepNumber = 1;
    const visited = new Set<string>();

    const processAction = (actionId: string, indent: string = "") => {
      if (visited.has(actionId)) {
        return;
      }
      visited.add(actionId);

      const action = workflow.actions.find((a) => a.id === actionId);
      if (!action) return;

      const actionName = action.name || action.id;
      const comment = this.getActionComment(actionId);

      parts.push(
        `${indent}${stepNumber}. **${actionName}** (\`${action.type}\`)`
      );
      if (comment) {
        parts.push(`${indent}   *${comment.comment}*`);
      }

      stepNumber++;

      // Get connections from this action
      const connections = workflow.connections[actionId];
      if (connections?.main) {
        connections.main.forEach((outputs) => {
          outputs.forEach((conn) => {
            processAction(conn.action, indent + "   ");
          });
        });
      }
    };

    entryPoints.forEach((entryId) => {
      processAction(entryId);
    });

    return parts.join("\n");
  }

  /**
   * Generate variables table
   */
  generateVariablesTable(workflow: Workflow): string {
    const parts: string[] = ["## Variables Used\n"];

    const variableUsage = this.analyzeVariableUsage(workflow);

    if (variableUsage.length === 0) {
      parts.push("*No variables detected in this workflow.*");
      return parts.join("\n");
    }

    parts.push("| Variable | Scope | Type | Usage | Actions |");
    parts.push("|----------|-------|------|-------|---------|");

    variableUsage.forEach((v) => {
      parts.push(
        `| \`${v.name}\` | ${v.scope} | ${v.type} | ${v.usage} | ${v.actions.join(", ")} |`
      );
    });

    return parts.join("\n");
  }

  /**
   * Generate dependencies list
   */
  generateDependenciesList(workflow: Workflow): string {
    const parts: string[] = ["## Dependencies\n"];

    const dependencies = this.analyzeDependencies(workflow);

    if (dependencies.length === 0) {
      parts.push("*No external dependencies detected.*");
      return parts.join("\n");
    }

    dependencies.forEach((dep) => {
      const required = dep.required ? "**[Required]**" : "[Optional]";
      parts.push(`- ${required} **${dep.name}** (${dep.type})`);
      if (dep.description) {
        parts.push(`  ${dep.description}`);
      }
    });

    return parts.join("\n");
  }

  /**
   * Generate complexity metrics
   */
  private generateComplexityMetrics(workflow: Workflow): string {
    const parts: string[] = ["## Complexity Metrics\n"];

    const metrics = this.calculateComplexity(workflow);

    parts.push(`- **Total Actions:** ${metrics.totalActions}`);
    parts.push(`- **Branching Points:** ${metrics.branchingPoints}`);
    parts.push(`- **Loops:** ${metrics.loopCount}`);
    parts.push(`- **Max Depth:** ${metrics.maxDepth}`);
    parts.push(`- **Cyclomatic Complexity:** ${metrics.cyclomaticComplexity}`);
    parts.push(`- **Cognitive Complexity:** ${metrics.cognitiveComplexity}`);

    // Complexity assessment
    const complexity =
      metrics.cyclomaticComplexity <= 5
        ? "Low"
        : metrics.cyclomaticComplexity <= 10
          ? "Medium"
          : "High";
    parts.push(`\n**Overall Complexity:** ${complexity}`);

    return parts.join("\n");
  }

  /**
   * Generate Mermaid flowchart
   */
  generateFlowchart(workflow: Workflow): string {
    const parts: string[] = ["## Visual Flowchart\n"];

    parts.push("```mermaid");
    parts.push("graph TD");

    // Add nodes
    workflow.actions.forEach((action) => {
      const name = (action.name || action.id).replace(/"/g, '\\"');
      const shape = this.getMermaidNodeShape(action.type);

      if (shape === "diamond") {
        parts.push(`    ${action.id}{"${name}<br/>(${action.type})"}`);
      } else if (shape === "round") {
        parts.push(`    ${action.id}(["${name}<br/>(${action.type})"])`);
      } else if (shape === "stadium") {
        parts.push(`    ${action.id}(["${name}<br/>(${action.type})"])`);
      } else {
        parts.push(`    ${action.id}["${name}<br/>(${action.type})"]`);
      }
    });

    // Add connections
    Object.entries(workflow.connections).forEach(([sourceId, outputs]) => {
      if (outputs.main) {
        outputs.main.forEach((connections, outputIndex) => {
          connections.forEach((conn) => {
            const label =
              outputIndex === 0
                ? ""
                : outputIndex === 1
                  ? "|false|"
                  : `|${outputIndex}|`;
            parts.push(`    ${sourceId} -->${label} ${conn.action}`);
          });
        });
      }

      if (outputs.error) {
        outputs.error.forEach((connections) => {
          connections.forEach((conn) => {
            parts.push(`    ${sourceId} -.->|error| ${conn.action}`);
          });
        });
      }

      if (outputs.success) {
        outputs.success.forEach((connections) => {
          connections.forEach((conn) => {
            parts.push(`    ${sourceId} ==>|success| ${conn.action}`);
          });
        });
      }
    });

    parts.push("```");

    return parts.join("\n");
  }

  /**
   * Generate error handling section
   */
  private generateErrorHandlingSection(workflow: Workflow): string {
    const parts: string[] = ["## Error Handling\n"];

    const errorHandlers = workflow.actions.filter(
      (a) => a.type === "TRY_CATCH"
    );

    if (errorHandlers.length > 0) {
      parts.push(
        `This workflow includes ${errorHandlers.length} error handling block(s):\n`
      );
      errorHandlers.forEach((handler) => {
        const name = handler.name || handler.id;
        parts.push(
          `- **${name}**: Catches and handles errors from its try block`
        );
      });
    } else {
      parts.push("*No explicit error handling defined.*");
      parts.push(
        "\nNote: Model-based automation is resilient by design and continues execution even if individual actions fail."
      );
    }

    return parts.join("\n");
  }

  /**
   * Generate recent changes section
   */
  private generateRecentChanges(workflow: Workflow): string {
    const parts: string[] = ["## Recent Changes\n"];

    if (workflow.metadata?.updated) {
      parts.push(
        `Last updated: ${new Date(workflow.metadata.updated).toLocaleString()}`
      );
    }

    const versions = this.getDocumentationHistory(workflow.id);
    if (versions.length > 1) {
      parts.push("\n### Version History:\n");
      versions.slice(0, 5).forEach((v) => {
        const desc = v.changeDescription ? `: ${v.changeDescription}` : "";
        parts.push(
          `- Version ${v.version} (${new Date(v.timestamp).toLocaleString()})${desc}`
        );
      });
    }

    return parts.join("\n");
  }

  // ==========================================================================
  // 4. Documentation Templates
  // ==========================================================================

  /**
   * Get all available templates
   */
  getTemplates(): DocumentationTemplate[] {
    return [
      {
        name: "Standard Workflow",
        description: "Basic workflow documentation template",
        category: "standard",
        content: `# {workflow.name}

## Overview
{workflow.description}

## Purpose
Describe the purpose of this workflow.

## Prerequisites
- List any required setup
- Required variables
- Required states

## Steps
1. First step
2. Second step
3. Third step

## Expected Results
Describe what should happen when this workflow completes.

## Notes
Any additional notes or considerations.
`,
      },
      {
        name: "API Integration",
        description: "Template for API integration workflows",
        category: "api",
        content: `# {workflow.name} - API Integration

## API Endpoint
- **URL:**
- **Method:**
- **Authentication:**

## Request Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
|           |      |          |             |

## Response Format
\`\`\`json
{
  "example": "response"
}
\`\`\`

## Error Codes
- **200:** Success
- **400:** Bad Request
- **401:** Unauthorized
- **500:** Server Error

## Example Usage
Describe how to use this integration.
`,
      },
      {
        name: "UI Test",
        description: "Template for UI testing workflows",
        category: "ui-test",
        content: `# {workflow.name} - UI Test

## Test Objective
Describe what this test validates.

## Test Preconditions
- Browser state
- Required test data
- Initial screen/state

## Test Steps
1. [ ] Navigate to page
2. [ ] Verify element exists
3. [ ] Perform action
4. [ ] Verify result

## Expected Results
- What should be visible
- What state changes should occur
- What data should be present

## Pass/Fail Criteria
- **Pass:**
- **Fail:**

## Known Issues
List any known issues or limitations.
`,
      },
      {
        name: "Data Processing",
        description: "Template for data processing workflows",
        category: "data-processing",
        content: `# {workflow.name} - Data Processing

## Input Data
- **Format:**
- **Source:**
- **Example:**
\`\`\`json
{
  "sample": "data"
}
\`\`\`

## Processing Steps
1. **Filter:**
2. **Transform:**
3. **Aggregate:**

## Output Data
- **Format:**
- **Destination:**
- **Example:**
\`\`\`json
{
  "result": "data"
}
\`\`\`

## Data Validation
- Input validation rules
- Output validation rules

## Performance
- Expected processing time
- Data volume limits
`,
      },
      {
        name: "Error Handling",
        description: "Template for error handling workflows",
        category: "error-handling",
        content: `# {workflow.name} - Error Handling

## Error Types Handled
- **Type 1:** Description
- **Type 2:** Description
- **Type 3:** Description

## Error Detection
How errors are detected in this workflow.

## Recovery Actions
1. **For Error Type 1:**
   - Action to take
   - Fallback behavior

2. **For Error Type 2:**
   - Action to take
   - Fallback behavior

## Logging
- What is logged
- Where logs are stored
- Log format

## Notifications
- Who is notified
- When notifications are sent
- Notification format

## Retry Strategy
- Number of retries
- Retry delay
- Backoff strategy
`,
      },
    ];
  }

  /**
   * Apply template to workflow
   */
  applyTemplate(
    workflowId: string,
    templateName: string,
    workflow: Workflow
  ): boolean {
    const template = this.getTemplates().find((t) => t.name === templateName);
    if (!template) {
      return false;
    }

    // Replace placeholders
    let content = template.content;
    content = content.replace(/{workflow\.name}/g, workflow.name);
    content = content.replace(
      /{workflow\.description}/g,
      workflow.description || ""
    );
    content = content.replace(/{workflow\.version}/g, workflow.version);

    this.createDocumentation(workflowId, content, {
      tags: [template.category],
    });

    return true;
  }

  // ==========================================================================
  // 5. Table of Contents
  // ==========================================================================

  /**
   * Generate table of contents from markdown content
   */
  generateTOC(content: string): string {
    const lines = content.split("\n");
    const headers: Array<{ level: number; text: string; anchor: string }> = [];

    lines.forEach((line) => {
      const match = line.match(/^(#{1,6})\s+(.+)$/);
      if (match) {
        const level = match[1]!.length;
        const text = match[2]!.trim();
        const anchor = text
          .toLowerCase()
          .replace(/[^\w\s-]/g, "")
          .replace(/\s+/g, "-");

        headers.push({ level, text, anchor });
      }
    });

    if (headers.length === 0) {
      return "";
    }

    const toc: string[] = ["## Table of Contents\n"];

    headers.forEach((header) => {
      const indent = "  ".repeat(header.level - 1);
      toc.push(`${indent}- [${header.text}](#${header.anchor})`);
    });

    return toc.join("\n");
  }

  /**
   * Update TOC in workflow documentation
   */
  updateTOC(workflowId: string): boolean {
    const doc = this.getDocumentation(workflowId);
    if (!doc) {
      return false;
    }

    const toc = this.generateTOC(doc.content);

    // Remove existing TOC if present
    let content = doc.content.replace(
      /## Table of Contents\n\n([\s\S]*?)\n\n##/m,
      "##"
    );

    // Add new TOC after title
    const lines = content.split("\n");
    const titleIndex = lines.findIndex((l) => l.startsWith("#"));

    if (titleIndex !== -1) {
      lines.splice(titleIndex + 1, 0, "", toc);
      content = lines.join("\n");
    }

    this.updateDocumentation(workflowId, content, "Updated table of contents");

    return true;
  }

  // ==========================================================================
  // 6. Search
  // ==========================================================================

  /**
   * Search across all documentation
   */
  searchDocumentation(query: string): Array<{
    workflowId: string;
    doc: WorkflowDocumentation;
    matches: number;
    excerpt: string;
  }> {
    const results: Array<{
      workflowId: string;
      doc: WorkflowDocumentation;
      matches: number;
      excerpt: string;
    }> = [];

    const lowerQuery = query.toLowerCase();

    this.documentations.forEach((doc, workflowId) => {
      const content = doc.content.toLowerCase();
      const matches = (content.match(new RegExp(lowerQuery, "g")) || []).length;

      if (matches > 0) {
        // Find first occurrence for excerpt
        const index = content.indexOf(lowerQuery);
        const start = Math.max(0, index - 50);
        const end = Math.min(content.length, index + query.length + 50);
        const excerpt = "..." + doc.content.substring(start, end) + "...";

        results.push({
          workflowId,
          doc,
          matches,
          excerpt,
        });
      }
    });

    // Sort by number of matches
    return results.sort((a, b) => b.matches - a.matches);
  }

  /**
   * Find workflows by documentation content
   */
  findWorkflowsByDocContent(query: string): string[] {
    return this.searchDocumentation(query).map((r) => r.workflowId);
  }

  // ==========================================================================
  // 7. Version History
  // ==========================================================================

  /**
   * Save documentation version
   */
  saveDocumentationVersion(
    workflowId: string,
    content: string,
    changeDescription?: string
  ): void {
    const versions = this.versions.get(workflowId) || [];

    const version: DocumentationVersion = {
      version: versions.length + 1,
      content,
      timestamp: new Date().toISOString(),
      changeDescription,
    };

    versions.push(version);
    this.versions.set(workflowId, versions);

    // Keep only last 20 versions to save space
    if (versions.length > 20) {
      versions.shift();
    }

    this.saveToStorage();
  }

  /**
   * Get documentation history
   */
  getDocumentationHistory(workflowId: string): DocumentationVersion[] {
    return this.versions.get(workflowId) || [];
  }

  /**
   * Compare two documentation versions
   */
  compareDocVersions(
    version1: DocumentationVersion,
    version2: DocumentationVersion
  ): {
    added: string[];
    removed: string[];
    modified: string[];
  } {
    const lines1 = version1.content.split("\n");
    const lines2 = version2.content.split("\n");

    const added: string[] = [];
    const removed: string[] = [];
    const modified: string[] = [];

    const set1 = new Set(lines1);
    const set2 = new Set(lines2);

    lines2.forEach((line) => {
      if (!set1.has(line)) {
        added.push(line);
      }
    });

    lines1.forEach((line) => {
      if (!set2.has(line)) {
        removed.push(line);
      }
    });

    return { added, removed, modified };
  }

  // ==========================================================================
  // 8. Export
  // ==========================================================================

  /**
   * Export documentation in various formats
   */
  exportDocumentation(
    workflowId: string,
    options: ExportOptions = { format: "markdown" }
  ): string | null {
    const doc = this.getDocumentation(workflowId);
    if (!doc) {
      return null;
    }

    let content = doc.content;

    // Add TOC if requested
    if (options.includeTOC) {
      const toc = this.generateTOC(content);
      content = toc + "\n\n" + content;
    }

    // Add metadata if requested
    if (options.includeMetadata) {
      const metadata = `---
Workflow ID: ${workflowId}
Version: ${doc.version}
Created: ${doc.created}
Updated: ${doc.updated}
${doc.author ? `Author: ${doc.author}` : ""}
${doc.tags && doc.tags.length > 0 ? `Tags: ${doc.tags.join(", ")}` : ""}
---

`;
      content = metadata + content;
    }

    // Add comments if requested
    if (options.includeComments) {
      const comments = this.getAllActionComments(workflowId);
      if (comments.length > 0) {
        content += "\n\n## Action Comments\n\n";
        comments.forEach((comment) => {
          content += `- **${comment.actionId}**: ${comment.comment}\n`;
        });
      }
    }

    // Convert format if needed
    if (options.format === "html") {
      return this.markdownToHTML(content);
    } else if (options.format === "pdf") {
      // PDF would require a library like jsPDF
      return `[PDF Export] ${content}`;
    }

    return content;
  }

  /**
   * Export all documentation
   */
  exportAllDocumentation(
    options: ExportOptions = { format: "markdown" }
  ): string {
    const parts: string[] = [];

    parts.push("# Workflow Documentation\n");
    parts.push(`Generated: ${new Date().toISOString()}\n`);
    parts.push(`Total Workflows: ${this.documentations.size}\n`);

    this.documentations.forEach((_doc, workflowId) => {
      parts.push("\n---\n");
      const exported = this.exportDocumentation(workflowId, {
        ...options,
        includeMetadata: true,
      });
      if (exported) {
        parts.push(exported);
      }
    });

    return parts.join("\n");
  }

  /**
   * Generate project README with all workflows
   */
  exportProjectReadme(workflows: Workflow[]): string {
    const parts: string[] = [];

    parts.push("# Workflow Project Documentation\n");
    parts.push(`Generated: ${new Date().toISOString()}\n`);

    // Group by category
    const byCategory = new Map<string, Workflow[]>();
    workflows.forEach((wf) => {
      const category = wf.category || "Uncategorized";
      const list = byCategory.get(category) || [];
      list.push(wf);
      byCategory.set(category, list);
    });

    // Table of contents
    parts.push("## Table of Contents\n");
    byCategory.forEach((_wfs, category) => {
      parts.push(
        `- [${category}](#${category.toLowerCase().replace(/\s+/g, "-")})`
      );
    });

    // Workflows by category
    byCategory.forEach((wfs, category) => {
      parts.push(`\n## ${category}\n`);

      wfs.forEach((wf) => {
        parts.push(`### ${wf.name}`);
        if (wf.description) {
          parts.push(wf.description);
        }
        parts.push(`- **Version:** ${wf.version}`);
        parts.push(`- **Actions:** ${wf.actions.length}`);
        if (wf.tags && wf.tags.length > 0) {
          parts.push(`- **Tags:** ${wf.tags.join(", ")}`);
        }

        const doc = this.getDocumentation(wf.id);
        if (doc) {
          parts.push("\n[View Full Documentation →]");
        }

        parts.push("");
      });
    });

    return parts.join("\n");
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Find entry points (actions with no incoming connections)
   */
  private findEntryPoints(workflow: Workflow): string[] {
    const hasIncoming = new Set<string>();

    Object.values(workflow.connections).forEach((outputs) => {
      ["main", "error", "success", "parallel"].forEach((type) => {
        const connections = (outputs as Record<string, Array<Array<{ action: string }>>>)[type];
        if (connections) {
          connections.forEach((conns) => {
            conns.forEach((conn) => hasIncoming.add(conn.action));
          });
        }
      });
    });

    return workflow.actions
      .filter((a) => !hasIncoming.has(a.id))
      .map((a) => a.id);
  }

  /**
   * Analyze variable usage
   */
  private analyzeVariableUsage(workflow: Workflow): VariableInfo[] {
    const variables: VariableInfo[] = [];

    // Check workflow variables
    if (workflow.variables) {
      ["local", "process", "global"].forEach((scopeKey) => {
        const vars = (workflow.variables as Record<string, Record<string, unknown>>)[scopeKey];
        if (vars) {
          Object.entries(vars).forEach(([name, value]) => {
            variables.push({
              name,
              scope: scopeKey as "local" | "process" | "global",
              type: typeof value,
              usage: "Predefined",
              actions: [],
            });
          });
        }
      });
    }

    // Check action configs for variable usage
    workflow.actions.forEach((action) => {
      if (action.type === "SET_VARIABLE" || action.type === "GET_VARIABLE") {
        const config = action.config as { variable?: string; scope?: string };
        const varName = config.variable || "";
        const scope = config.scope || "local";

        let varInfo = variables.find((v) => v.name === varName);
        if (!varInfo) {
          varInfo = {
            name: varName,
            scope: scope as "local" | "process" | "global",
            type: "unknown",
            usage: action.type === "SET_VARIABLE" ? "Set" : "Get",
            actions: [],
          };
          variables.push(varInfo);
        }

        varInfo.actions.push(action.name || action.id);
      }
    });

    return variables;
  }

  /**
   * Analyze dependencies
   */
  private analyzeDependencies(workflow: Workflow): DependencyInfo[] {
    const dependencies: DependencyInfo[] = [];

    workflow.actions.forEach((action) => {
      if (action.type === "RUN_WORKFLOW") {
        const config = action.config as { workflowId?: string };
        dependencies.push({
          type: "workflow",
          name: config.workflowId || "Unknown workflow",
          description: `Called from action: ${action.name || action.id}`,
          required: true,
        });
      }

      // Check for image dependencies
      if ("target" in action.config) {
        const target = (action.config as { target?: { image?: string } }).target;
        if (target?.image) {
          dependencies.push({
            type: "resource",
            name: target.image,
            description: `Image used in action: ${action.name || action.id}`,
            required: true,
          });
        }
      }
    });

    return dependencies;
  }

  /**
   * Calculate workflow complexity
   */
  private calculateComplexity(workflow: Workflow): ComplexityMetrics {
    const totalActions = workflow.actions.length;

    // Count branching points
    const branchingPoints = workflow.actions.filter((a) =>
      ["IF", "SWITCH", "TRY_CATCH"].includes(a.type)
    ).length;

    // Count loops
    const loopCount = workflow.actions.filter((a) => a.type === "LOOP").length;

    // Calculate max depth (simplified)
    let maxDepth = 0;
    const visited = new Set<string>();

    const calculateDepth = (actionId: string, depth: number) => {
      if (visited.has(actionId)) return;
      visited.add(actionId);

      maxDepth = Math.max(maxDepth, depth);

      const connections = workflow.connections[actionId];
      if (connections?.main) {
        connections.main.forEach((conns) => {
          conns.forEach((conn) => {
            calculateDepth(conn.action, depth + 1);
          });
        });
      }
    };

    const entryPoints = this.findEntryPoints(workflow);
    entryPoints.forEach((id) => calculateDepth(id, 1));

    // Cyclomatic complexity: edges - nodes + 2
    const edges = Object.values(workflow.connections).reduce((sum, outputs) => {
      return (
        sum +
        (outputs.main?.flat().length || 0) +
        (outputs.error?.flat().length || 0) +
        (outputs.success?.flat().length || 0)
      );
    }, 0);

    const cyclomaticComplexity = edges - totalActions + 2;

    // Cognitive complexity (simplified: branching + loops * 2)
    const cognitiveComplexity = branchingPoints + loopCount * 2;

    return {
      totalActions,
      branchingPoints,
      loopCount,
      maxDepth,
      cyclomaticComplexity: Math.max(1, cyclomaticComplexity),
      cognitiveComplexity,
    };
  }

  /**
   * Get Mermaid node shape for action type
   */
  private getMermaidNodeShape(
    actionType: ActionType
  ): "rectangle" | "diamond" | "round" | "stadium" {
    if (["IF", "SWITCH"].includes(actionType)) {
      return "diamond";
    }
    if (actionType === "LOOP") {
      return "stadium";
    }
    if (["TRY_CATCH", "BREAK", "CONTINUE"].includes(actionType)) {
      return "round";
    }
    return "rectangle";
  }

  /**
   * Convert markdown to HTML (basic)
   */
  private markdownToHTML(markdown: string): string {
    let html = markdown;

    // Headers
    html = html.replace(/^### (.*$)/gim, "<h3>$1</h3>");
    html = html.replace(/^## (.*$)/gim, "<h2>$1</h2>");
    html = html.replace(/^# (.*$)/gim, "<h1>$1</h1>");

    // Bold
    html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");

    // Italic
    html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");

    // Code
    html = html.replace(/`(.*?)`/g, "<code>$1</code>");

    // Lists
    html = html.replace(/^\- (.*$)/gim, "<li>$1</li>");

    // Paragraphs
    html = html.replace(/\n\n/g, "</p><p>");
    html = "<p>" + html + "</p>";

    return html;
  }

  // ==========================================================================
  // Persistence
  // ==========================================================================

  /**
   * Save to localStorage
   */
  private saveToStorage(): void {
    try {
      // Save documentations
      const docsArray = Array.from(this.documentations.entries());
      localStorage.setItem(this.DOCS_STORAGE_KEY, JSON.stringify(docsArray));

      // Save comments
      const commentsArray = Array.from(this.comments.entries());
      localStorage.setItem(
        this.COMMENTS_STORAGE_KEY,
        JSON.stringify(commentsArray)
      );

      // Save versions
      const versionsArray = Array.from(this.versions.entries());
      localStorage.setItem(
        this.VERSIONS_STORAGE_KEY,
        JSON.stringify(versionsArray)
      );
    } catch (error) {
      console.error("Failed to save documentation to storage:", error);
    }
  }

  /**
   * Load from localStorage
   */
  private loadFromStorage(): void {
    try {
      // Load documentations
      const docsJson = localStorage.getItem(this.DOCS_STORAGE_KEY);
      if (docsJson) {
        const docsArray = JSON.parse(docsJson);
        this.documentations = new Map(docsArray);
      }

      // Load comments
      const commentsJson = localStorage.getItem(this.COMMENTS_STORAGE_KEY);
      if (commentsJson) {
        const commentsArray = JSON.parse(commentsJson);
        this.comments = new Map(commentsArray);
      }

      // Load versions
      const versionsJson = localStorage.getItem(this.VERSIONS_STORAGE_KEY);
      if (versionsJson) {
        const versionsArray = JSON.parse(versionsJson);
        this.versions = new Map(versionsArray);
      }
    } catch (error) {
      console.error("Failed to load documentation from storage:", error);
    }
  }

  /**
   * Clear all documentation data
   */
  clearAll(): void {
    this.documentations.clear();
    this.comments.clear();
    this.versions.clear();
    localStorage.removeItem(this.DOCS_STORAGE_KEY);
    localStorage.removeItem(this.COMMENTS_STORAGE_KEY);
    localStorage.removeItem(this.VERSIONS_STORAGE_KEY);
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const workflowDocumentation = WorkflowDocumentationService.getInstance();
