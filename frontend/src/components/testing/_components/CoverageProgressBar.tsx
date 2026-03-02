import type { CoverageStats } from "../StateCoverageHeatMap.types";

interface CoverageProgressBarProps {
  stats: CoverageStats;
}

export function CoverageProgressBar({ stats }: CoverageProgressBarProps) {
  const coveragePercent = ((stats.total - stats.uncovered) / stats.total) * 100;

  return (
    <div className="mt-6 p-4 bg-surface-canvas/50 rounded-lg">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-text-muted">Overall Coverage</span>
        <span className="text-2xl font-bold text-brand-primary">
          {coveragePercent.toFixed(1)}%
        </span>
      </div>
      <div className="h-3 bg-surface-raised rounded-full overflow-hidden">
        <div className="h-full flex">
          <div
            className="bg-green-500"
            style={{
              width: `${(stats.passing / stats.total) * 100}%`,
            }}
          />
          <div
            className="bg-yellow-500"
            style={{
              width: `${(stats.partial / stats.total) * 100}%`,
            }}
          />
          <div
            className="bg-red-500"
            style={{
              width: `${(stats.failing / stats.total) * 100}%`,
            }}
          />
        </div>
      </div>
    </div>
  );
}
