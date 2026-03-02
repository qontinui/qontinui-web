import { Panel } from "@xyflow/react";
import type { CoverageStats } from "../StateCoverageHeatMap.types";

interface CoverageStatsPanelProps {
  stats: CoverageStats;
}

export function CoverageStatsPanel({ stats }: CoverageStatsPanelProps) {
  return (
    <Panel
      position="top-right"
      className="bg-surface-raised/90 p-4 rounded-lg border border-border-default"
    >
      <div className="text-xs text-text-muted mb-2">Coverage Breakdown</div>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-4">
          <span className="text-green-500 text-xs">Passing:</span>
          <span className="text-white font-medium text-xs">
            {stats.passing}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-yellow-500 text-xs">Partial:</span>
          <span className="text-white font-medium text-xs">
            {stats.partial}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-red-500 text-xs">Failing:</span>
          <span className="text-white font-medium text-xs">
            {stats.failing}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-text-muted text-xs">Untested:</span>
          <span className="text-white font-medium text-xs">
            {stats.uncovered}
          </span>
        </div>
        <div className="border-t border-border-default my-2" />
        <div className="flex items-center justify-between gap-4">
          <span className="text-text-muted text-xs">Total:</span>
          <span className="text-white font-bold text-xs">{stats.total}</span>
        </div>
      </div>
    </Panel>
  );
}
