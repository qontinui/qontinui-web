/**
 * Types for the LayoutSuggestions component and its sub-components.
 */

import type { Workflow } from "@/lib/action-schema/action-types";
import type { LayoutPreviewResult } from "@/services/layout-service";

export interface LayoutSuggestionsProps {
  workflow: Workflow;
  layoutResult: LayoutPreviewResult;
  onApplySuggestion: (fixedWorkflow: Workflow) => void;
}

export interface LayoutIssue {
  id: string;
  severity: "error" | "warning" | "info";
  title: string;
  description: string;
  affectedNodes: string[];
  fix?: () => Workflow;
  autoFixable: boolean;
}

export interface IssueCounts {
  errorCount: number;
  warningCount: number;
  infoCount: number;
  autoFixableCount: number;
}
