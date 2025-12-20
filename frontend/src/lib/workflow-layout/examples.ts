/**
 * Workflow Auto-Layout Examples
 *
 * Practical examples demonstrating various layout scenarios
 */

import { autoLayoutWorkflow, AutoLayout, LayoutStyle } from "./auto-layout";
import type {
  Workflow,
  Connection,
  Connections,
} from "../action-schema/action-types";

/**
 * Example 1: Simple Linear Workflow
 *
 * A basic sequential workflow with 3 actions
 */
export function createLinearWorkflowExample(): Workflow {
  const workflow: Workflow = {
    id: "linear-example",
    name: "Linear Workflow Example",
    version: "1.0.0",
    format: "graph",
    actions: [
      {
        id: "click-login",
        type: "CLICK",
        name: "Click Login Button",
        config: { target: "login-button" },
        position: [0, 0],
      },
      {
        id: "type-username",
        type: "TYPE",
        name: "Type Username",
        config: { text: "user@example.com" },
        position: [0, 0],
      },
      {
        id: "type-password",
        type: "TYPE",
        name: "Type Password",
        config: { text: "password123" },
        position: [0, 0],
      },
      {
        id: "click-submit",
        type: "CLICK",
        name: "Click Submit",
        config: { target: "submit-button" },
        position: [0, 0],
      },
    ],
    connections: {
      "click-login": {
        main: [[{ action: "type-username", type: "main", index: 0 }]],
      },
      "type-username": {
        main: [[{ action: "type-password", type: "main", index: 0 }]],
      },
      "type-password": {
        main: [[{ action: "click-submit", type: "main", index: 0 }]],
      },
    },
  };

  // Apply auto-layout
  autoLayoutWorkflow(workflow);

  return workflow;
}

/**
 * Example 2: Conditional Workflow with IF
 *
 * Workflow that branches based on a condition
 */
export function createConditionalWorkflowExample(): Workflow {
  const workflow: Workflow = {
    id: "conditional-example",
    name: "Conditional Workflow Example",
    version: "1.0.0",
    format: "graph",
    actions: [
      {
        id: "check-element",
        type: "FIND",
        name: "Check if Element Exists",
        config: {
          target: { type: "image", imageId: "success-message" },
          searchOptions: { strategy: "FIRST" },
        },
        position: [0, 0],
      },
      {
        id: "branch-decision",
        type: "IF",
        name: "Element Exists?",
        config: {
          condition: { type: "expression", expression: "result === true" },
          thenActions: [],
          elseActions: [],
        },
        position: [0, 0],
      },
      {
        id: "success-path",
        type: "CLICK",
        name: "Click Continue",
        config: { target: "continue-button" },
        position: [0, 0],
      },
      {
        id: "failure-path",
        type: "CLICK",
        name: "Click Retry",
        config: { target: "retry-button" },
        position: [0, 0],
      },
      {
        id: "final-action",
        type: "SCREENSHOT",
        name: "Take Screenshot",
        config: { saveToFile: { enabled: true, filename: "result.png" } },
        position: [0, 0],
      },
    ],
    connections: {
      "check-element": {
        main: [[{ action: "branch-decision", type: "main", index: 0 }]],
      },
      "branch-decision": {
        main: [
          [{ action: "success-path", type: "main", index: 0 }], // True branch
          [{ action: "failure-path", type: "main", index: 0 }], // False branch
        ],
      },
      "success-path": {
        main: [[{ action: "final-action", type: "main", index: 0 }]],
      },
      "failure-path": {
        main: [[{ action: "final-action", type: "main", index: 0 }]],
      },
    },
  };

  // Apply auto-layout with hierarchical style
  autoLayoutWorkflow(workflow, {}, LayoutStyle.HIERARCHICAL);

  return workflow;
}

/**
 * Example 3: Loop Workflow
 *
 * Workflow with a loop that processes multiple items
 */
export function createLoopWorkflowExample(): Workflow {
  const workflow: Workflow = {
    id: "loop-example",
    name: "Loop Workflow Example",
    version: "1.0.0",
    format: "graph",
    actions: [
      {
        id: "get-items",
        type: "GET_VARIABLE",
        name: "Get Items List",
        config: { variableName: "items" },
        position: [0, 0],
      },
      {
        id: "loop-items",
        type: "LOOP",
        name: "For Each Item",
        config: {
          loopType: "FOREACH",
          collection: { type: "variable", variableName: "items" },
          actions: [],
        },
        position: [0, 0],
      },
      {
        id: "process-item",
        type: "CLICK",
        name: "Click Item",
        config: { target: "current-item" },
        position: [0, 0],
      },
      {
        id: "validate-item",
        type: "FIND",
        name: "Validate Item",
        config: {
          target: { type: "image", imageId: "item-validated" },
          searchOptions: { strategy: "FIRST" },
        },
        position: [0, 0],
      },
      {
        id: "complete",
        type: "SCREENSHOT",
        name: "Take Final Screenshot",
        config: { saveToFile: { enabled: true, filename: "complete.png" } },
        position: [0, 0],
      },
    ],
    connections: {
      "get-items": {
        main: [[{ action: "loop-items", type: "main", index: 0 }]],
      },
      "loop-items": {
        main: [[{ action: "process-item", type: "main", index: 0 }]],
      },
      "process-item": {
        main: [[{ action: "validate-item", type: "main", index: 0 }]],
      },
      "validate-item": {
        main: [[{ action: "complete", type: "main", index: 0 }]],
      },
    },
  };

  autoLayoutWorkflow(workflow);

  return workflow;
}

/**
 * Example 4: Multi-Branch SWITCH Workflow
 *
 * Workflow with multiple execution paths based on a value
 */
export function createSwitchWorkflowExample(): Workflow {
  const workflow: Workflow = {
    id: "switch-example",
    name: "Switch Workflow Example",
    version: "1.0.0",
    format: "graph",
    actions: [
      {
        id: "get-status",
        type: "GET_VARIABLE",
        name: "Get Status",
        config: { variableName: "status" },
        position: [0, 0],
      },
      {
        id: "switch-status",
        type: "SWITCH",
        name: "Check Status",
        config: {
          expression: "status",
          cases: [
            { value: "success", actions: [] },
            { value: "warning", actions: [] },
            { value: "error", actions: [] },
          ],
        },
        position: [0, 0],
      },
      {
        id: "handle-success",
        type: "CLICK",
        name: "Continue",
        config: { target: "continue-button" },
        position: [0, 0],
      },
      {
        id: "handle-warning",
        type: "CLICK",
        name: "Acknowledge Warning",
        config: { target: "ack-button" },
        position: [0, 0],
      },
      {
        id: "handle-error",
        type: "SCREENSHOT",
        name: "Capture Error",
        config: { saveToFile: { enabled: true, filename: "error.png" } },
        position: [0, 0],
      },
      {
        id: "handle-default",
        type: "SCREENSHOT",
        name: "Unknown Status",
        config: { saveToFile: { enabled: true, filename: "unknown.png" } },
        position: [0, 0],
      },
    ],
    connections: {
      "get-status": {
        main: [[{ action: "switch-status", type: "main", index: 0 }]],
      },
      "switch-status": {
        main: [
          [{ action: "handle-success", type: "main", index: 0 }], // Case: success
          [{ action: "handle-warning", type: "main", index: 0 }], // Case: warning
          [{ action: "handle-error", type: "main", index: 0 }], // Case: error
          [{ action: "handle-default", type: "main", index: 0 }], // Default
        ],
      },
    },
  };

  autoLayoutWorkflow(workflow);

  return workflow;
}

/**
 * Example 5: Diamond Pattern (Merge)
 *
 * Multiple paths that converge to a single action
 */
export function createDiamondPatternExample(): Workflow {
  const workflow: Workflow = {
    id: "diamond-example",
    name: "Diamond Pattern Example",
    version: "1.0.0",
    format: "graph",
    actions: [
      {
        id: "start",
        type: "CLICK",
        name: "Start Process",
        config: { target: "start-button" },
        position: [0, 0],
      },
      {
        id: "check-condition",
        type: "IF",
        name: "Check Condition",
        config: {
          condition: { type: "expression", expression: "value > 10" },
          thenActions: [],
          elseActions: [],
        },
        position: [0, 0],
      },
      {
        id: "path-a",
        type: "CLICK",
        name: "Process Path A",
        config: { target: "path-a-button" },
        position: [0, 0],
      },
      {
        id: "path-b",
        type: "TYPE",
        name: "Process Path B",
        config: { text: "Path B" },
        position: [0, 0],
      },
      {
        id: "merge",
        type: "SCREENSHOT",
        name: "Merge Point",
        config: { saveToFile: { enabled: true, filename: "merged.png" } },
        position: [0, 0],
      },
    ],
    connections: {
      start: {
        main: [[{ action: "check-condition", type: "main", index: 0 }]],
      },
      "check-condition": {
        main: [
          [{ action: "path-a", type: "main", index: 0 }],
          [{ action: "path-b", type: "main", index: 0 }],
        ],
      },
      "path-a": { main: [[{ action: "merge", type: "main", index: 0 }]] },
      "path-b": { main: [[{ action: "merge", type: "main", index: 0 }]] },
    },
  };

  autoLayoutWorkflow(workflow);

  return workflow;
}

/**
 * Example 6: Error Handling Workflow
 *
 * Workflow with TRY_CATCH for error handling
 */
export function createErrorHandlingExample(): Workflow {
  const workflow: Workflow = {
    id: "error-handling-example",
    name: "Error Handling Example",
    version: "1.0.0",
    format: "graph",
    actions: [
      {
        id: "try-action",
        type: "TRY_CATCH",
        name: "Try Operation",
        config: {},
        position: [0, 0],
      },
      {
        id: "risky-click",
        type: "CLICK",
        name: "Click Risky Element",
        config: { target: "risky-element" },
        position: [0, 0],
      },
      {
        id: "success-action",
        type: "SCREENSHOT",
        name: "Success Screenshot",
        config: { saveToFile: { enabled: true, filename: "success.png" } },
        position: [0, 0],
      },
      {
        id: "error-handler",
        type: "SCREENSHOT",
        name: "Error Screenshot",
        config: { saveToFile: { enabled: true, filename: "error.png" } },
        position: [0, 0],
      },
      {
        id: "final",
        type: "SCREENSHOT",
        name: "Final State",
        config: { saveToFile: { enabled: true, filename: "final.png" } },
        position: [0, 0],
      },
    ],
    connections: {
      "try-action": {
        main: [[{ action: "risky-click", type: "main", index: 0 }]],
      },
      "risky-click": {
        success: [[{ action: "success-action", type: "main", index: 0 }]],
        error: [[{ action: "error-handler", type: "main", index: 0 }]],
      },
      "success-action": {
        main: [[{ action: "final", type: "main", index: 0 }]],
      },
      "error-handler": {
        main: [[{ action: "final", type: "main", index: 0 }]],
      },
    },
  };

  autoLayoutWorkflow(workflow);

  return workflow;
}

/**
 * Example 7: Custom Configuration
 *
 * Using custom layout configuration for specific needs
 */
export function createCustomConfigExample(): Workflow {
  const workflow: Workflow = {
    id: "custom-config-example",
    name: "Custom Config Example",
    version: "1.0.0",
    format: "graph",
    actions: [
      {
        id: "a1",
        type: "CLICK",
        config: {},
        position: [0, 0],
      },
      {
        id: "a2",
        type: "TYPE",
        config: {},
        position: [0, 0],
      },
      {
        id: "a3",
        type: "CLICK",
        config: {},
        position: [0, 0],
      },
    ],
    connections: {
      a1: { main: [[{ action: "a2", type: "main", index: 0 }]] },
      a2: { main: [[{ action: "a3", type: "main", index: 0 }]] },
    },
  };

  // Create custom layout configuration
  const customLayout = new AutoLayout({
    nodeWidth: 250, // Wider nodes
    nodeHeight: 120, // Taller nodes
    horizontalSpacing: 300, // More horizontal space
    verticalSpacing: 150, // More vertical space
    branchOffset: 200, // Larger branch separation
    centerPoint: [500, 400], // Different center point
    maxOverlapIterations: 15, // More iterations for overlap reduction
    minNodeSpacing: 30, // Minimum 30px between nodes
  });

  customLayout.layout(workflow);

  return workflow;
}

/**
 * Example 8: Different Layout Styles Comparison
 *
 * Same workflow with different layout styles
 */
export function createLayoutStylesComparison(): Record<string, Workflow> {
  const baseWorkflow: Workflow = {
    id: "style-comparison",
    name: "Layout Styles Comparison",
    version: "1.0.0",
    format: "graph",
    actions: [
      { id: "a1", type: "CLICK", config: {}, position: [0, 0] },
      { id: "a2", type: "TYPE", config: {}, position: [0, 0] },
      {
        id: "if1",
        type: "IF",
        config: {
          condition: { type: "expression", expression: "true" },
          thenActions: [],
          elseActions: [],
        },
        position: [0, 0],
      },
      { id: "a3", type: "CLICK", config: {}, position: [0, 0] },
      { id: "a4", type: "CLICK", config: {}, position: [0, 0] },
      { id: "a5", type: "SCREENSHOT", config: {}, position: [0, 0] },
    ],
    connections: {
      a1: { main: [[{ action: "a2", type: "main", index: 0 }]] },
      a2: { main: [[{ action: "if1", type: "main", index: 0 }]] },
      if1: {
        main: [
          [{ action: "a3", type: "main", index: 0 }],
          [{ action: "a4", type: "main", index: 0 }],
        ],
      },
      a3: { main: [[{ action: "a5", type: "main", index: 0 }]] },
      a4: { main: [[{ action: "a5", type: "main", index: 0 }]] },
    },
  };

  // Create workflows with different styles
  const hierarchical = JSON.parse(JSON.stringify(baseWorkflow));
  hierarchical.id = "hierarchical";
  autoLayoutWorkflow(hierarchical, {}, LayoutStyle.HIERARCHICAL);

  const horizontal = JSON.parse(JSON.stringify(baseWorkflow));
  horizontal.id = "horizontal";
  autoLayoutWorkflow(horizontal, {}, LayoutStyle.HORIZONTAL);

  const tree = JSON.parse(JSON.stringify(baseWorkflow));
  tree.id = "tree";
  autoLayoutWorkflow(tree, {}, LayoutStyle.TREE);

  const force = JSON.parse(JSON.stringify(baseWorkflow));
  force.id = "force";
  autoLayoutWorkflow(force, {}, LayoutStyle.FORCE_DIRECTED);

  const circular = JSON.parse(JSON.stringify(baseWorkflow));
  circular.id = "circular";
  autoLayoutWorkflow(circular, {}, LayoutStyle.CIRCULAR);

  return {
    hierarchical,
    horizontal,
    tree,
    force,
    circular,
  };
}

/**
 * Example 9: Complex Nested Workflow
 *
 * Real-world scenario with nested branches and loops
 */
export function createComplexNestedExample(): Workflow {
  const workflow: Workflow = {
    id: "complex-nested",
    name: "Complex Nested Workflow",
    version: "1.0.0",
    format: "graph",
    actions: [
      {
        id: "start",
        type: "CLICK",
        name: "Start",
        config: {},
        position: [0, 0],
      },
      {
        id: "get-items",
        type: "GET_VARIABLE",
        name: "Get Items",
        config: { variableName: "items" },
        position: [0, 0],
      },
      {
        id: "loop-items",
        type: "LOOP",
        name: "For Each Item",
        config: {
          loopType: "FOREACH",
          collection: { type: "variable", variableName: "items" },
          actions: [],
        },
        position: [0, 0],
      },
      {
        id: "check-type",
        type: "IF",
        name: "Check Type",
        config: {
          condition: { type: "expression", expression: "true" },
          thenActions: [],
          elseActions: [],
        },
        position: [0, 0],
      },
      {
        id: "type-a",
        type: "CLICK",
        name: "Handle Type A",
        config: {},
        position: [0, 0],
      },
      {
        id: "type-b-check",
        type: "IF",
        name: "Type B Subcheck",
        config: {
          condition: { type: "expression", expression: "true" },
          thenActions: [],
          elseActions: [],
        },
        position: [0, 0],
      },
      {
        id: "type-b1",
        type: "CLICK",
        name: "Type B1",
        config: {},
        position: [0, 0],
      },
      {
        id: "type-b2",
        type: "TYPE",
        name: "Type B2",
        config: {},
        position: [0, 0],
      },
      {
        id: "validate",
        type: "FIND",
        name: "Validate",
        config: {
          target: { type: "image", imageId: "validate-image" },
          searchOptions: { strategy: "FIRST" },
        },
        position: [0, 0],
      },
      {
        id: "screenshot",
        type: "SCREENSHOT",
        name: "Screenshot",
        config: {},
        position: [0, 0],
      },
      {
        id: "complete",
        type: "SCREENSHOT",
        name: "Complete",
        config: {},
        position: [0, 0],
      },
    ],
    connections: {
      start: { main: [[{ action: "get-items", type: "main", index: 0 }]] },
      "get-items": {
        main: [[{ action: "loop-items", type: "main", index: 0 }]],
      },
      "loop-items": {
        main: [[{ action: "check-type", type: "main", index: 0 }]],
      },
      "check-type": {
        main: [
          [{ action: "type-a", type: "main", index: 0 }],
          [{ action: "type-b-check", type: "main", index: 0 }],
        ],
      },
      "type-a": { main: [[{ action: "validate", type: "main", index: 0 }]] },
      "type-b-check": {
        main: [
          [{ action: "type-b1", type: "main", index: 0 }],
          [{ action: "type-b2", type: "main", index: 0 }],
        ],
      },
      "type-b1": { main: [[{ action: "validate", type: "main", index: 0 }]] },
      "type-b2": { main: [[{ action: "validate", type: "main", index: 0 }]] },
      validate: { main: [[{ action: "screenshot", type: "main", index: 0 }]] },
      screenshot: { main: [[{ action: "complete", type: "main", index: 0 }]] },
    },
  };

  autoLayoutWorkflow(workflow);

  return workflow;
}

/**
 * Example 10: Large Workflow Performance Test
 *
 * Create a large workflow to test performance
 */
export function createLargeWorkflowExample(size: number = 100): Workflow {
  const actions = [];
  const connections: Record<string, { main?: Connection[][] }> = {};

  // Create linear chain of actions
  for (let i = 0; i < size; i++) {
    actions.push({
      id: `action-${i}`,
      type: (i % 2 === 0 ? "CLICK" : "TYPE") as "CLICK" | "TYPE",
      name: `Action ${i}`,
      config: {},
      position: [0, 0] as [number, number],
    });

    if (i < size - 1) {
      connections[`action-${i}`] = {
        main: [[{ action: `action-${i + 1}`, type: "main", index: 0 }]],
      };
    }
  }

  const workflow: Workflow = {
    id: "large-workflow",
    name: `Large Workflow (${size} actions)`,
    version: "1.0.0",
    format: "graph",
    actions,
    connections: connections as Connections,
  };

  const startTime = Date.now();
  autoLayoutWorkflow(workflow);
  const duration = Date.now() - startTime;

  console.log(`Layout time for ${size} actions: ${duration}ms`);

  return workflow;
}

// Export all examples as a collection
export const examples = {
  linear: createLinearWorkflowExample,
  conditional: createConditionalWorkflowExample,
  loop: createLoopWorkflowExample,
  switch: createSwitchWorkflowExample,
  diamond: createDiamondPatternExample,
  errorHandling: createErrorHandlingExample,
  customConfig: createCustomConfigExample,
  layoutStyles: createLayoutStylesComparison,
  complexNested: createComplexNestedExample,
  largeWorkflow: createLargeWorkflowExample,
};
