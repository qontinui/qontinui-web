"use client";

import { Card, CardContent } from "@/components/ui/card";
import type { VerificationResultsListResponse } from "@/types/task-runs";

export function SummaryBanner({
  data,
}: {
  data: VerificationResultsListResponse;
}) {
  const passRate =
    data.count > 0 ? Math.round((data.passedIterations / data.count) * 100) : 0;

  return (
    <Card className="bg-surface-raised/50 border-border-subtle/50">
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-brand-secondary">
                {data.count}
              </div>
              <div className="text-xs text-text-muted">Iterations</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-500">
                {data.passedIterations}
              </div>
              <div className="text-xs text-text-muted">Passed</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-500">
                {data.failedIterations}
              </div>
              <div className="text-xs text-text-muted">Failed</div>
            </div>
          </div>
          <div className="text-right">
            <div
              className={`text-3xl font-bold ${
                passRate === 100
                  ? "text-green-500"
                  : passRate >= 50
                    ? "text-yellow-500"
                    : "text-red-500"
              }`}
            >
              {passRate}%
            </div>
            <div className="text-xs text-text-muted">Pass Rate</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
