/**
 * Shared types for the Dependency Graph component tree.
 */

import { Node, Edge } from "@xyflow/react";
import { Workflow } from "../../../lib/action-schema/action-types";

// ============================================================================
// Graph Node & Edge Types
// ============================================================================

export interface WorkflowNodeData extends Record<string, unknown> {
  workflowId: string;
  workflowName: string;
  dependencyCount: number;
  dependentCount: number;
  isCircular: boolean;
  isUnused: boolean;
  isLeaf: boolean;
  tags?: string[];
  folder?: string;
}

export type WorkflowNode = Node<WorkflowNodeData>;

export interface DependencyEdge extends Edge {
  data: {
    actionName?: string;
    sourceWorkflowId: string;
    targetWorkflowId: string;
  };
}

// ============================================================================
// Layout & Filter Types
// ============================================================================

export type LayoutType = "hierarchical" | "force" | "circular" | "tree";

export type FilterType =
  | "all"
  | "dependencies"
  | "dependents"
  | "unused"
  | "critical";

// ============================================================================
// Dependency Analysis Types
// ============================================================================

export interface DependencyInfo {
  workflowId: string;
  dependencies: string[]; // Workflows this depends on
  dependents: string[]; // Workflows that depend on this
}

export interface CircularDependency {
  chain: string[];
  workflows: Set<string>;
}

export interface GraphAnalysis {
  circularDependencies: CircularDependency[];
  unusedWorkflows: string[];
  mostDependedOn: Array<{ workflowId: string; count: number }>;
  longestChains: Array<{ chain: string[]; length: number }>;
  totalDependencies: number;
  avgDependencies: number;
}

// ============================================================================
// Component Props
// ============================================================================

export interface DependencyGraphProps {
  workflows: Workflow[];
  selectedWorkflowId?: string;
  onSelectWorkflow: (workflowId: string) => void;
  onOpenWorkflow: (workflowId: string) => void;
  className?: string;
}

export interface GraphCanvasProps {
  nodes: WorkflowNode[];
  edges: DependencyEdge[];
  onNodesChange: (changes: unknown[]) => void;
  onEdgesChange: (changes: unknown[]) => void;
  onNodeClick: (event: React.MouseEvent, node: Node) => void;
  onNodeDoubleClick: (event: React.MouseEvent, node: Node) => void;
  onNodeContextMenu: (event: React.MouseEvent, node: Node) => void;
  contextMenu: { x: number; y: number; workflowId: string } | null;
  onCloseContextMenu: () => void;
  onOpenWorkflow: (workflowId: string) => void;
  onShowDependencies: (workflowId: string) => void;
  onShowDependents: (workflowId: string) => void;
  onCenterOnNode: () => void;
  /** Children rendered inside ReactFlow (e.g. Panel-based controls) */
  children?: React.ReactNode;
}

export interface GraphControlsProps {
  searchQuery: string;
  onSearch: (query: string) => void;
  layout: LayoutType;
  onLayoutChange: (layout: LayoutType) => void;
  selectedFilter: FilterType;
  onFilterChange: (filter: FilterType) => void;
  onExport: (format: string) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
  onCenterOnSelected: () => void;
  selectedWorkflowId?: string;
  showAnalysis: boolean;
  onToggleAnalysis: () => void;
  workflowCount: number;
  totalDependencies: number;
  circularCount: number;
  unusedCount: number;
}

export interface NodeRendererProps {
  data: WorkflowNodeData;
}

export interface AnalysisPanelProps {
  analysis: GraphAnalysis;
  workflows: Workflow[];
  onSelectWorkflow: (workflowId: string) => void;
  onHighlightCircular: (index: number) => void;
  onClose: () => void;
}
