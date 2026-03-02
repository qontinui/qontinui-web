import type { Workflow, Action } from "@/lib/action-schema/action-types";

export type TransitionType = "incoming" | "outgoing" | null;

export interface ProcessBuilderState {
  selectedItem: Workflow | null;
  selectedAction: Action | null;
  showTransitionDialog: boolean;
  transitionType: TransitionType;
  optionsExpanded: boolean;
  conversionItem: Workflow | null;
  conversionDialogOpen: boolean;
}

/**
 * Check if a workflow has non-linear connections (branching)
 */
export function hasNonLinearConnections(workflow: Workflow): boolean {
  for (const sourceId in workflow.connections) {
    const outputs = workflow.connections[sourceId];
    if (!outputs) continue;
    // Check if there's more than one output from main connections
    if (outputs.main && outputs.main.length > 1) return true;
    // Check if there are error or success connections (indicates branching)
    if (outputs.error && outputs.error.length > 0) return true;
    if (outputs.success && outputs.success.length > 0) return true;
  }
  return false;
}
