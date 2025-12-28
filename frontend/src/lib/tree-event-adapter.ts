/**
 * Tree Event Adapter
 *
 * Converts between different execution event formats:
 * - TreeEvent (real execution from runner)
 * - Mock ExecutionStep (historical/simulated testing)
 * - UnifiedExecutionStep (common display format)
 *
 * This enables components to display both real and mock execution
 * data using the same UI components.
 *
 * @module tree-event-adapter
 */

import type { TreeEvent, DisplayNode } from "@/types/tree-events";
import type { UnifiedExecutionStep } from "@/types/tree-events";
import type {
  ExecutionStep,
  StateDiscoveryStep,
  PathCalculationStep,
  ActionStep,
  StateUpdateStep,
} from "@/types/integration-testing";

/**
 * Convert a TreeEvent to UnifiedExecutionStep for display
 */
export function treeEventToUnifiedStep(
  event: TreeEvent,
  stepNumber: number
): UnifiedExecutionStep {
  const node = event.node;
  const metadata = node.metadata ?? {};
  const runtime = metadata.runtime;
  const stateContext = metadata.state_context;

  // Calculate duration in ms
  const durationMs = node.duration ? node.duration * 1000 : 0;

  // Convert timestamp to ISO string
  const timestamp = new Date(event.timestamp * 1000).toISOString();

  // Build match location if available
  let matchLocation: UnifiedExecutionStep["matchLocation"] | undefined;
  if (runtime?.location) {
    matchLocation = {
      x: runtime.location.x,
      y: runtime.location.y,
      width: runtime.location.w ?? undefined,
      height: runtime.location.h ?? undefined,
      confidence: runtime.confidence ?? undefined,
    };
  } else if (runtime?.clicked_at) {
    matchLocation = {
      x: runtime.clicked_at.x,
      y: runtime.clicked_at.y,
    };
  }

  // Build input data if available
  let inputData: UnifiedExecutionStep["inputData"] | undefined;
  if (runtime?.typed_text) {
    inputData = { text: runtime.typed_text };
  }

  // Build state context
  let unifiedStateContext: UnifiedExecutionStep["stateContext"] | undefined;
  if (stateContext) {
    unifiedStateContext = {
      activeBefore: stateContext.active_before,
      activeAfter: stateContext.active_after,
      changed: stateContext.changed,
      activated: stateContext.activated,
      deactivated: stateContext.deactivated,
    };
  }

  // Extract action type from metadata config or runtime
  const actionType = (metadata.config as Record<string, unknown>)
    ?.action_type as string | undefined;

  return {
    stepNumber,
    timestamp,
    durationMs,
    stepType: event.event_type as UnifiedExecutionStep["stepType"],
    name: node.name,
    nodeType: node.node_type as "workflow" | "action" | "transition",
    status: node.status as "pending" | "running" | "success" | "failed",
    error: node.error,
    nodeId: node.id,
    actionType,
    stateContext: unifiedStateContext,
    matchLocation,
    inputData,
    screenshotUrl: metadata.screenshot_reference ?? undefined,
    metadata: metadata as Record<string, unknown>,
    originalTreeEvent: event,
    isRealExecution: true,
  };
}

/**
 * Convert a DisplayNode to UnifiedExecutionStep for display
 */
export function displayNodeToUnifiedStep(
  node: DisplayNode,
  stepNumber: number
): UnifiedExecutionStep {
  const metadata = node.metadata ?? {};
  const runtime = metadata.runtime;
  const stateContext = metadata.state_context;

  // Calculate duration in ms
  const durationMs = node.duration ? node.duration * 1000 : 0;

  // Convert timestamp to ISO string
  const timestamp = new Date(node.timestamp * 1000).toISOString();

  // Determine event type based on node status
  let stepType: UnifiedExecutionStep["stepType"];
  if (node.node_type === "workflow") {
    stepType =
      node.status === "success"
        ? "workflow_completed"
        : node.status === "failed"
          ? "workflow_failed"
          : "workflow_started";
  } else if (node.node_type === "transition") {
    stepType =
      node.status === "success"
        ? "transition_completed"
        : node.status === "failed"
          ? "transition_failed"
          : "transition_started";
  } else {
    stepType =
      node.status === "success"
        ? "action_completed"
        : node.status === "failed"
          ? "action_failed"
          : "action_started";
  }

  // Build match location if available
  let matchLocation: UnifiedExecutionStep["matchLocation"] | undefined;
  if (runtime?.location) {
    matchLocation = {
      x: runtime.location.x,
      y: runtime.location.y,
      width: runtime.location.w ?? undefined,
      height: runtime.location.h ?? undefined,
      confidence: runtime.confidence ?? undefined,
    };
  }

  // Build input data if available
  let inputData: UnifiedExecutionStep["inputData"] | undefined;
  if (runtime?.typed_text) {
    inputData = { text: runtime.typed_text };
  }

  // Build state context
  let unifiedStateContext: UnifiedExecutionStep["stateContext"] | undefined;
  if (stateContext) {
    unifiedStateContext = {
      activeBefore: stateContext.active_before,
      activeAfter: stateContext.active_after,
      changed: stateContext.changed,
      activated: stateContext.activated,
      deactivated: stateContext.deactivated,
    };
  }

  // Extract action type from metadata config
  const actionType = (metadata.config as Record<string, unknown>)
    ?.action_type as string | undefined;

  return {
    stepNumber,
    timestamp,
    durationMs,
    stepType,
    name: node.name,
    nodeType: node.node_type as "workflow" | "action" | "transition",
    status: node.status as "pending" | "running" | "success" | "failed",
    error: node.error,
    nodeId: node.id,
    actionType,
    stateContext: unifiedStateContext,
    matchLocation,
    inputData,
    screenshotUrl: metadata.screenshot_reference ?? undefined,
    metadata: metadata as Record<string, unknown>,
    isRealExecution: true,
  };
}

/**
 * Convert a mock ExecutionStep to UnifiedExecutionStep for display
 */
export function mockStepToUnifiedStep(
  step: ExecutionStep
): UnifiedExecutionStep {
  const baseStep = {
    stepNumber: step.step_number,
    timestamp: step.timestamp,
    durationMs: step.duration_ms,
    isRealExecution: false,
  };

  switch (step.type) {
    case "state_discovery": {
      const discoveryStep = step as StateDiscoveryStep;
      return {
        ...baseStep,
        stepType: "state_discovery",
        name: "State Discovery",
        status: discoveryStep.initial_states_match ? "success" : "failed",
        stateContext: {
          activeAfter: discoveryStep.active_states,
        },
        metadata: {
          expected_initial_states: discoveryStep.expected_initial_states,
          detection_method: discoveryStep.detection_method,
          initial_states_match: discoveryStep.initial_states_match,
        },
      };
    }

    case "path_calculation": {
      const pathStep = step as PathCalculationStep;
      return {
        ...baseStep,
        stepType: "path_calculation",
        name: `Path to ${pathStep.target_state}`,
        status: pathStep.no_path_found ? "failed" : "success",
        stateContext: {
          activeBefore: pathStep.current_states,
        },
        metadata: {
          target_state: pathStep.target_state,
          available_paths: pathStep.available_paths,
          selected_path: pathStep.selected_path,
          selection_reason: pathStep.selection_reason,
          no_path_found: pathStep.no_path_found,
        },
      };
    }

    case "action": {
      const actionStep = step as ActionStep;
      return {
        ...baseStep,
        stepType: actionStep.result.success
          ? "action_completed"
          : "action_failed",
        name: actionStep.action_name,
        nodeId: actionStep.action_id,
        actionType: actionStep.action_type,
        status: actionStep.result.success ? "success" : "failed",
        error: actionStep.result.error_message,
        stateContext: {
          activeBefore: actionStep.from_states,
          activeAfter: actionStep.to_states,
        },
        matchLocation: actionStep.match_location
          ? {
              x: actionStep.match_location.x,
              y: actionStep.match_location.y,
              width: actionStep.match_location.width,
              height: actionStep.match_location.height,
              confidence: actionStep.match_location.score,
            }
          : undefined,
        inputData: actionStep.input_data
          ? {
              text: actionStep.input_data.text,
              from: actionStep.input_data.from,
              to: actionStep.input_data.to,
            }
          : undefined,
        screenshotUrl: actionStep.screenshot_url,
        metadata: {
          pattern_id: actionStep.pattern_id,
          pattern_name: actionStep.pattern_name,
          target_state: actionStep.target_state,
          result: actionStep.result,
          historical_stats: actionStep.historical_stats,
          stochastic_notes: actionStep.stochastic_notes,
        },
      };
    }

    case "state_update": {
      const updateStep = step as StateUpdateStep;
      return {
        ...baseStep,
        stepType: "state_update",
        name: "State Update",
        status: "success",
        stateContext: {
          activeAfter: updateStep.new_active_states,
          activated: updateStep.activated_states,
          deactivated: updateStep.deactivated_states,
        },
        metadata: {
          trigger_action_id: updateStep.trigger_action_id,
        },
      };
    }

    default:
      return {
        ...baseStep,
        stepType: "action_completed",
        name: "Unknown Step",
        status: "success",
      };
  }
}

/**
 * Convert an array of TreeEvents to UnifiedExecutionSteps
 */
export function treeEventsToUnifiedSteps(
  events: TreeEvent[]
): UnifiedExecutionStep[] {
  return events.map((event, index) => treeEventToUnifiedStep(event, index + 1));
}

/**
 * Convert an array of DisplayNodes to UnifiedExecutionSteps
 * Flattens the tree structure into a chronological list
 */
export function displayNodesToUnifiedSteps(
  nodes: DisplayNode[]
): UnifiedExecutionStep[] {
  const steps: UnifiedExecutionStep[] = [];
  let stepNumber = 1;

  function traverse(node: DisplayNode) {
    // Only include action nodes in the flat list
    if (node.node_type === "action") {
      steps.push(displayNodeToUnifiedStep(node, stepNumber++));
    }
    // Traverse children
    if (node.children) {
      for (const child of node.children) {
        traverse(child);
      }
    }
  }

  for (const node of nodes) {
    traverse(node);
  }

  // Sort by timestamp
  steps.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Re-number after sorting
  steps.forEach((step, index) => {
    step.stepNumber = index + 1;
  });

  return steps;
}

/**
 * Convert an array of mock ExecutionSteps to UnifiedExecutionSteps
 */
export function mockStepsToUnifiedSteps(
  steps: ExecutionStep[]
): UnifiedExecutionStep[] {
  return steps.map(mockStepToUnifiedStep);
}

/**
 * Check if a step type is a tree event type (real execution)
 */
export function isTreeEventStepType(stepType: string): boolean {
  const treeEventTypes = [
    "workflow_started",
    "workflow_completed",
    "workflow_failed",
    "action_started",
    "action_completed",
    "action_failed",
    "transition_started",
    "transition_completed",
    "transition_failed",
  ];
  return treeEventTypes.includes(stepType);
}

/**
 * Check if a step type is a mock step type (simulation)
 */
export function isMockStepType(stepType: string): boolean {
  const mockTypes = ["state_discovery", "path_calculation", "state_update"];
  return mockTypes.includes(stepType);
}

/**
 * Get icon name for a step type
 */
export function getStepTypeIcon(step: UnifiedExecutionStep): string {
  if (step.stepType === "state_discovery") return "compass";
  if (step.stepType === "path_calculation") return "route";
  if (step.stepType === "state_update") return "refresh-cw";

  // For tree event types, use action type if available
  if (step.actionType) {
    const type = step.actionType.toLowerCase();
    if (type.includes("click")) return "mouse-pointer-2";
    if (type.includes("type")) return "keyboard";
    if (type.includes("find")) return "eye";
    if (type.includes("drag")) return "move";
    if (type.includes("scroll")) return "mouse";
    if (type.includes("screenshot")) return "camera";
    if (type.includes("wait")) return "clock";
  }

  // Default by node type
  if (step.nodeType === "workflow") return "layers";
  if (step.nodeType === "transition") return "arrow-right";
  return "play";
}

/**
 * Get human-readable label for a step type
 */
export function getStepTypeLabel(step: UnifiedExecutionStep): string {
  switch (step.stepType) {
    case "state_discovery":
      return "State Discovery";
    case "path_calculation":
      return "Path Calculation";
    case "state_update":
      return "State Update";
    case "workflow_started":
      return "Workflow Started";
    case "workflow_completed":
      return "Workflow Completed";
    case "workflow_failed":
      return "Workflow Failed";
    case "action_started":
      return step.actionType ? step.actionType.toUpperCase() : "Action Started";
    case "action_completed":
      return step.actionType
        ? step.actionType.toUpperCase()
        : "Action Completed";
    case "action_failed":
      return step.actionType
        ? `${step.actionType.toUpperCase()} (Failed)`
        : "Action Failed";
    case "transition_started":
      return "Transition";
    case "transition_completed":
      return "Transition Complete";
    case "transition_failed":
      return "Transition Failed";
    default:
      return step.name || "Unknown";
  }
}
