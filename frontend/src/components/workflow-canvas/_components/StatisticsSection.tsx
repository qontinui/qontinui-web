import React from "react";
import type { LayoutPreviewResult } from "@/services/layout-service";
import {
  formatStatistics,
  LayoutStatistics,
} from "@/services/layout-statistics";

interface StatisticsSectionProps {
  previewResult: LayoutPreviewResult;
  showStatistics: boolean;
  onToggle: () => void;
}

export function StatisticsSection({
  previewResult,
  showStatistics,
  onToggle,
}: StatisticsSectionProps) {
  return (
    <section className="statistics-section">
      <div className="section-header">
        <h3>Statistics</h3>
        <button className="toggle-button" onClick={onToggle}>
          {showStatistics ? "Hide" : "Show"}
        </button>
      </div>

      <div className="statistics-comparison">
        <div className="stat-column">
          <h4>Before</h4>
          {Object.entries(
            formatStatistics(
              previewResult.comparison.metrics.overlaps
                .before as unknown as LayoutStatistics
            )
          )
            .slice(0, 5)
            .map(([key, value]) => (
              <div key={key} className="stat-item">
                <span className="stat-label">{key}:</span>
                <span className="stat-value">{value}</span>
              </div>
            ))}
        </div>

        <div className="stat-column">
          <h4>After</h4>
          {Object.entries(formatStatistics(previewResult.statistics))
            .slice(0, 5)
            .map(([key, value]) => (
              <div key={key} className="stat-item">
                <span className="stat-label">{key}:</span>
                <span className="stat-value">{value}</span>
              </div>
            ))}
        </div>
      </div>

      <div className="improvement-summary">
        <div
          className={`improvement-badge ${previewResult.comparison.isImprovement ? "positive" : "negative"}`}
        >
          {previewResult.comparison.improvementScore > 0 ? "+" : ""}
          {Math.round(previewResult.comparison.improvementScore)}
        </div>
        <p>{previewResult.comparison.summary}</p>
      </div>
    </section>
  );
}
