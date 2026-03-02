export interface StateCoverageHeatMapProps {
  projectId: string;
  workflowId: string;
}

export interface StateNodeData {
  label: string;
  visit_count: number;
  success_rate: number;
  covered: boolean;
  status: "passing" | "partial" | "failing" | "uncovered";
}

export interface NodeExecutionDetails {
  stateName: string;
  visitCount: number;
  successRate: number;
  status: string;
  totalAttempts: number;
  successfulAttempts: number;
  failedAttempts: number;
}

export interface CoverageStats {
  passing: number;
  partial: number;
  failing: number;
  uncovered: number;
  total: number;
}
