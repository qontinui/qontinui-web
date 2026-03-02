/**
 * Element Counts Summary
 *
 * Displays total and ground truth element counts,
 * plus a warning when no ground truth elements are available.
 */

import { Alert, AlertDescription } from "@/components/ui/alert";

interface ElementCountsSummaryProps {
  totalCount: number;
  groundTruthCount: number;
  includeAllElements: boolean;
}

export function ElementCountsSummary({
  totalCount,
  groundTruthCount,
  includeAllElements,
}: ElementCountsSummaryProps) {
  return (
    <>
      <div className="flex gap-4 justify-center">
        <div className="text-center">
          <div className="text-2xl font-bold text-[#9B59B6]">{totalCount}</div>
          <div className="text-xs text-text-muted">Total Elements</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-green-500">
            {groundTruthCount}
          </div>
          <div className="text-xs text-text-muted">Ground Truth</div>
        </div>
      </div>

      {groundTruthCount === 0 && !includeAllElements && (
        <Alert className="bg-yellow-500/10 border-yellow-500/30">
          <AlertDescription className="text-yellow-600 dark:text-yellow-400 text-sm">
            No ground truth elements marked. Enable &quot;Include all
            elements&quot; or mark elements as ground truth.
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}
