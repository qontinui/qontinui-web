export function CoverageLegend() {
  return (
    <div className="flex items-center gap-4 text-sm">
      <div className="flex items-center gap-2">
        <div className="w-3 h-3 rounded-full bg-green-500" />
        <span className="text-text-muted">Passing (90%+)</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-3 h-3 rounded-full bg-yellow-500" />
        <span className="text-text-muted">Partial (70-90%)</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-3 h-3 rounded-full bg-red-500" />
        <span className="text-text-muted">Failing (&lt;70%)</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-3 h-3 rounded-full bg-border-default" />
        <span className="text-text-muted">Not Tested</span>
      </div>
    </div>
  );
}
