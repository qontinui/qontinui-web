/**
 * Heatmap Generator
 *
 * Generates performance heatmap data for workflow visualization,
 * using either actual execution data or estimated timings.
 */

import type { Workflow } from "@/lib/action-schema/action-types";
import type { ExecutionData, PerformanceHeatmap } from "./types";
import { estimateActionTime } from "./helpers";

export class HeatmapGenerator {
  /**
   * Generate performance heatmap data
   */
  generatePerformanceHeatmap(
    workflow: Workflow,
    executionData?: ExecutionData
  ): PerformanceHeatmap {
    const actionMetrics: PerformanceHeatmap["actionMetrics"] = {};
    let totalDuration = 0;
    let maxDuration = 0;
    let minDuration = Infinity;
    let count = 0;

    if (executionData) {
      // Use actual execution data
      for (const [_actionId, state] of Object.entries(
        executionData.actionStates
      )) {
        if (state.duration !== undefined) {
          totalDuration += state.duration;
          maxDuration = Math.max(maxDuration, state.duration);
          minDuration = Math.min(minDuration, state.duration);
          count++;
        }
      }

      const avgDuration = count > 0 ? totalDuration / count : 0;

      for (const [actionId, state] of Object.entries(
        executionData.actionStates
      )) {
        const duration = state.duration || 0;
        const ratio = avgDuration > 0 ? duration / avgDuration : 1;

        let status: "fast" | "normal" | "slow" | "critical";
        let color: string;

        if (ratio < 0.5) {
          status = "fast";
          color = "#10b981"; // green
        } else if (ratio < 1.5) {
          status = "normal";
          color = "#6b7280"; // gray
        } else if (ratio < 3) {
          status = "slow";
          color = "#f59e0b"; // orange
        } else {
          status = "critical";
          color = "#ef4444"; // red
        }

        const score = Math.max(0, Math.min(100, 100 - (ratio - 1) * 50));

        actionMetrics[actionId] = {
          score,
          duration,
          executionCount: state.executionCount || 1,
          status,
          color,
        };
      }
    } else {
      // Use estimated data
      for (const action of workflow.actions) {
        const estimatedDuration = estimateActionTime(action);
        totalDuration += estimatedDuration;
        maxDuration = Math.max(maxDuration, estimatedDuration);
        minDuration = Math.min(minDuration, estimatedDuration);
        count++;

        actionMetrics[action.id] = {
          score: 70, // Neutral score for estimates
          duration: estimatedDuration,
          status: "normal",
          color: "#6b7280",
        };
      }
    }

    return {
      actionMetrics,
      overall: {
        averageDuration: count > 0 ? totalDuration / count : 0,
        maxDuration: maxDuration === -Infinity ? 0 : maxDuration,
        minDuration: minDuration === Infinity ? 0 : minDuration,
      },
    };
  }
}
