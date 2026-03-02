import type { PlaywrightExtractionResults } from "@/hooks/use-playwright-extraction";

interface MetricsSummaryBarProps {
  metrics: NonNullable<PlaywrightExtractionResults["metrics"]>;
}

export function MetricsSummaryBar({ metrics }: MetricsSummaryBarProps) {
  return (
    <div className="shrink-0 flex items-center gap-6 px-4 py-3 bg-surface-raised/40 border border-brand-success/20 rounded-lg backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-text-muted font-mono uppercase">
          Elements:
        </span>
        <span className="text-sm font-bold text-white">
          {metrics.total_found}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-text-muted font-mono uppercase">
          Verified:
        </span>
        <span className="text-sm font-bold text-brand-success">
          {metrics.verified || 0}
        </span>
      </div>
      {metrics.verified !== undefined && metrics.total_found > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-text-muted font-mono uppercase">
            Verification:
          </span>
          <span className="text-sm font-bold text-brand-primary">
            {((metrics.verified / metrics.total_found) * 100).toFixed(0)}%
          </span>
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-text-muted font-mono uppercase">
          Pages:
        </span>
        <span className="text-sm font-bold text-brand-secondary">
          {metrics.pages_visited}
        </span>
      </div>
      {metrics.skipped_dangerous > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-text-muted font-mono uppercase">
            Skipped:
          </span>
          <span className="text-sm font-bold text-warning">
            {metrics.skipped_dangerous}
          </span>
        </div>
      )}
      {metrics.errors > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-text-muted font-mono uppercase">
            Errors:
          </span>
          <span className="text-sm font-bold text-error">{metrics.errors}</span>
        </div>
      )}
    </div>
  );
}
