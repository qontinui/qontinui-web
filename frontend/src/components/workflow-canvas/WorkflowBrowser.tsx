/**
 * Workflow Browser - Re-export shim
 *
 * The implementation has been split into focused sub-modules under ./workflow-browser/.
 * This file re-exports the component for backward compatibility with existing imports.
 *
 * Canonical location: ./workflow-browser/
 */

export { WorkflowBrowser } from "./workflow-browser";
export type {
  WorkflowBrowserProps,
  EnhancedWorkflowItem,
} from "./workflow-browser";
