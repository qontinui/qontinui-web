// types/snapshot-recommendations.ts

import type { SnapshotRun } from "./snapshots";

/**
 * Coverage metrics for state and action analysis
 */
export interface CoverageMetrics {
  state_coverage: {
    total_states: number;
    covered_states: number;
    states: string[];
  };
  action_coverage: {
    total_action_types: number;
    covered_action_types: number;
    action_types: string[];
  };
  screenshot_count: number;
  duplicate_coverage_ratio: number; // 0-1, higher means more overlap
}

/**
 * Detailed analysis of a single snapshot
 */
export interface SnapshotAnalysis {
  snapshot_id: number;
  run_id: string;
  states: string[];
  action_types: string[];
  screenshot_count: number;
  recency_score: number; // 0-1, based on timestamp
  priority_score: number; // 0-1, based on success rate and coverage
  created_at: string;
  duration_seconds: number | null;
  success_rate: number; // 0-1
}

/**
 * Recommendation for a combination of snapshots
 */
export interface SnapshotRecommendation {
  snapshot_ids: number[];
  snapshots: SnapshotRun[];
  score: number; // 0-100
  reason: string;
  coverage: CoverageMetrics;
  estimated_execution_time_seconds: number;
  rank: number; // 1 = best, 2 = second best, etc.
}

/**
 * Request parameters for getting snapshot recommendations
 */
export interface RecommendationRequest {
  process_id?: string;
  max_snapshots?: number; // Max snapshots per combination (default: 3)
  num_recommendations?: number; // Number of recommendations to return (default: 3)
}

/**
 * Response containing multiple recommendations
 */
export interface RecommendationResponse {
  recommendations: SnapshotRecommendation[];
  total_snapshots_available: number;
  analysis_timestamp: string;
}

/**
 * Detailed snapshot data for dialog/preview
 */
export interface SnapshotDetail extends SnapshotRun {
  states: string[];
  action_types: string[];
  screenshots: {
    path: string;
    timestamp: string;
    states: string[];
  }[];
  metadata: {
    recency: "new" | "recent" | "old";
    priority: "high" | "medium" | "low";
    has_duplicates: boolean;
  };
}

/**
 * Coverage indicator data for UI display
 */
export interface CoverageIndicator {
  type:
    | "state"
    | "action"
    | "screenshot"
    | "recency"
    | "priority"
    | "duplicate";
  label: string;
  value: number | string;
  max?: number;
  variant?: "success" | "warning" | "error" | "info";
  tooltip?: string;
}
