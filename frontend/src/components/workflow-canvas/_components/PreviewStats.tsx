import React from "react";
import type { LayoutComparison } from "@/services/layout-statistics";

interface PreviewStatsProps {
  changedNodeCount: number;
  comparison: LayoutComparison;
}

export function PreviewStats({
  changedNodeCount,
  comparison,
}: PreviewStatsProps) {
  return (
    <div className="preview-stats">
      <div className="stat-item">
        <span className="stat-label">Nodes Moved:</span>
        <span className="stat-value">{changedNodeCount}</span>
      </div>
      <div className="stat-item">
        <span className="stat-label">Improvement:</span>
        <span
          className={`stat-value ${comparison.isImprovement ? "positive" : "negative"}`}
        >
          {comparison.improvementScore > 0 ? "+" : ""}
          {Math.round(comparison.improvementScore)}
        </span>
      </div>
    </div>
  );
}
