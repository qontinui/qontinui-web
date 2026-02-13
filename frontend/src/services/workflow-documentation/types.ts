/**
 * Types for the Workflow Documentation System
 */

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
