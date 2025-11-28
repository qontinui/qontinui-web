/**
 * Integration Tests Types
 *
 * Types for the integration tests page which uses the existing
 * workflow execution endpoints with mode: "full_mock" to enable
 * the qontinui library's MockMode.
 */

import type { Workflow } from "@/types";

/**
 * Current workflow test execution state
 */
export interface WorkflowTestExecution {
  workflowId: string;
  workflowName: string;
  status: "pending" | "running" | "passed" | "failed";
  currentAction?: number;
  totalActions?: number;
}

/**
 * Individual step result from test execution
 */
export interface StepResult {
  stepIndex: number;
  actionId: string;
  actionType: string;
  actionName: string;
  patternName?: string;
  success: boolean;
  message: string;
  duration: number;
  historicalResultId?: number;
  timestamp: string;
}

/**
 * Result of a workflow test
 */
export interface WorkflowTestResult {
  workflowId: string;
  workflowName: string;
  status: "pending" | "running" | "passed" | "failed";
  successRate?: number;
  totalActions?: number;
  executedActions?: number;
  passed?: boolean;
  totalSteps: number;
  successfulSteps: number;
  failedSteps?: number;
  duration: number;
  error?: string;
  /** Historical result IDs for visual playback */
  historicalResultIds?: number[];
  /** Random matches used during test (for display) */
  randomMatchesUsed?: string[];
  /** Detailed step-by-step results */
  stepResults?: StepResult[];
}

/**
 * Props for WorkflowSelector component
 */
export interface WorkflowSelectorProps {
  workflows: Workflow[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  disabled?: boolean;
}

/**
 * Props for TestExecutionPanel component
 */
export interface TestExecutionPanelProps {
  execution: WorkflowTestExecution | null;
  totalWorkflows: number;
  completedWorkflows: number;
}

/**
 * Props for TestResultsPanel component
 */
export interface TestResultsPanelProps {
  results: WorkflowTestResult[];
  loading?: boolean;
  onViewDetails: (workflowId: string) => void;
  /** Callback to trigger visual playback for a workflow */
  onPlayback?: (workflowId: string, historicalResultIds: number[]) => void;
}

/**
 * Visualization modes for test results
 */
export type VisualizationMode = "none" | "screenshots" | "state_viz";

/**
 * Props for VisualizationModeSelector component
 */
export interface VisualizationModeSelectorProps {
  mode: VisualizationMode;
  onModeChange: (mode: VisualizationMode) => void;
  disabled?: boolean;
}

/**
 * Historical data statistics
 */
export interface HistoricalDataStats {
  totalSnapshotRuns: number;
  totalActions: number;
  totalScreenshots: number;
  uniqueStates: number;
  stateNames: string[];
  hasHistoricalData: boolean;
  oldestRun: string | null;
  newestRun: string | null;
}

/**
 * Props for HistoricalDataStatus component
 */
export interface HistoricalDataStatusProps {
  stats: HistoricalDataStats | null;
  loading?: boolean;
  error?: string | null;
}
