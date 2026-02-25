/**
 * Documentation Generator
 *
 * Generates comprehensive documentation content from workflow structures.
 * Includes overview, purpose, input/output, action flow, variables,
 * dependencies, complexity metrics, flowcharts, and error handling sections.
 */

import type { Workflow, ActionType } from "@/lib/action-schema/action-types";
import type {
  VariableInfo,
  DependencyInfo,
  ComplexityMetrics,
  DocumentationVersion,
} from "./types";

/**
 * Generate comprehensive documentation for a workflow
 */
export function generateDocumentation(
  workflow: Workflow,
  getActionComment: (actionId: string) => { comment: string } | null,
  getDocumentationHistory: (workflowId: string) => DocumentationVersion[]
): string {
  const sections: string[] = [];

  // Title and metadata
  sections.push(`# ${workflow.name}\n`);

  // Overview
  sections.push(generateOverview(workflow));

  // Purpose and Use Cases
  sections.push(generatePurposeSection(workflow));

  // Input Requirements
  sections.push(generateInputRequirements(workflow));

  // Output/Side Effects
  sections.push(generateOutputSection(workflow));

  // Action Flow
  sections.push(generateActionFlow(workflow, getActionComment));

  // Variables Used
  sections.push(generateVariablesTable(workflow));

  // Dependencies
  sections.push(generateDependenciesList(workflow));

  // Complexity Metrics
  sections.push(generateComplexityMetricsSection(workflow));

  // Visual Flowchart
  sections.push(generateFlowchart(workflow));

  // Error Handling
  sections.push(generateErrorHandlingSection(workflow));

  // Recent Changes
  sections.push(generateRecentChanges(workflow, getDocumentationHistory));

  return sections.join("\n\n");
}

/**
 * Generate overview section
 */
function generateOverview(workflow: Workflow): string {
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
function generatePurposeSection(workflow: Workflow): string {
  const parts: string[] = ["## Purpose and Use Cases\n"];

  // Try to infer purpose from workflow structure
  const actionTypes = new Set(workflow.actions.map((a) => a.type));
  const hasControlFlow = Array.from(actionTypes).some((t) =>
    ["IF", "LOOP", "SWITCH", "TRY_CATCH"].includes(t)
  );
  const hasUI = Array.from(actionTypes).some((t) =>
    ["CLICK", "TYPE", "FIND"].includes(t)
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
function generateInputRequirements(workflow: Workflow): string {
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
        parts.push(`- \`${key}\`: ${typeof value} = ${JSON.stringify(value)}`);
      });
    }

    if (
      workflow.variables.process &&
      Object.keys(workflow.variables.process).length > 0
    ) {
      parts.push("\n**Process Variables:**");
      Object.entries(workflow.variables.process).forEach(([key, value]) => {
        parts.push(`- \`${key}\`: ${typeof value} = ${JSON.stringify(value)}`);
      });
    }

    if (
      workflow.variables.global &&
      Object.keys(workflow.variables.global).length > 0
    ) {
      parts.push("\n**Global Variables:**");
      Object.entries(workflow.variables.global).forEach(([key, value]) => {
        parts.push(`- \`${key}\`: ${typeof value} = ${JSON.stringify(value)}`);
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
    parts.push(`\n### Initial Screenshot: \`${workflow.initialScreenshotId}\``);
  }

  return parts.join("\n");
}

/**
 * Generate output/side effects section
 */
function generateOutputSection(workflow: Workflow): string {
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
function generateActionFlow(
  workflow: Workflow,
  getActionComment: (actionId: string) => { comment: string } | null
): string {
  const parts: string[] = ["## Action Flow\n"];

  parts.push("Step-by-step execution flow:\n");

  // Find entry point (action with no incoming connections)
  const entryPoints = findEntryPoints(workflow);

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
    const comment = getActionComment(actionId);

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
export function generateVariablesTable(workflow: Workflow): string {
  const parts: string[] = ["## Variables Used\n"];

  const variableUsage = analyzeVariableUsage(workflow);

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
export function generateDependenciesList(workflow: Workflow): string {
  const parts: string[] = ["## Dependencies\n"];

  const dependencies = analyzeDependencies(workflow);

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
 * Generate complexity metrics section
 */
function generateComplexityMetricsSection(workflow: Workflow): string {
  const parts: string[] = ["## Complexity Metrics\n"];

  const metrics = calculateComplexity(workflow);

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
export function generateFlowchart(workflow: Workflow): string {
  const parts: string[] = ["## Visual Flowchart\n"];

  parts.push("```mermaid");
  parts.push("graph TD");

  // Add nodes
  workflow.actions.forEach((action) => {
    const name = (action.name || action.id).replace(/"/g, '\\"');
    const shape = getMermaidNodeShape(action.type);

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
function generateErrorHandlingSection(workflow: Workflow): string {
  const parts: string[] = ["## Error Handling\n"];

  const errorHandlers = workflow.actions.filter((a) => a.type === "TRY_CATCH");

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
function generateRecentChanges(
  workflow: Workflow,
  getDocumentationHistory: (workflowId: string) => DocumentationVersion[]
): string {
  const parts: string[] = ["## Recent Changes\n"];

  if (workflow.metadata?.updated) {
    parts.push(
      `Last updated: ${new Date(workflow.metadata.updated).toLocaleString()}`
    );
  }

  const versions = getDocumentationHistory(workflow.id);
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

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Find entry points (actions with no incoming connections)
 */
export function findEntryPoints(workflow: Workflow): string[] {
  const hasIncoming = new Set<string>();

  Object.values(workflow.connections).forEach((outputs) => {
    ["main", "error", "success", "parallel"].forEach((type) => {
      const connections = (
        outputs as Record<string, Array<Array<{ action: string }>>>
      )[type];
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
export function analyzeVariableUsage(workflow: Workflow): VariableInfo[] {
  const variables: VariableInfo[] = [];

  // Check workflow variables
  if (workflow.variables) {
    ["local", "process", "global"].forEach((scopeKey) => {
      const vars = (
        workflow.variables as Record<string, Record<string, unknown>>
      )[scopeKey];
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
export function analyzeDependencies(workflow: Workflow): DependencyInfo[] {
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
export function calculateComplexity(workflow: Workflow): ComplexityMetrics {
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

  const entryPoints = findEntryPoints(workflow);
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
function getMermaidNodeShape(
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
