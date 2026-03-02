import { AlertTriangle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

import type { ExtractionMetrics } from "../playwright-results-types";

export function PlaywrightMetricsCard({
  metrics,
}: {
  metrics: ExtractionMetrics | undefined;
}) {
  if (!metrics) {
    return null;
  }
  return (
    <Card className="border-cyan-500/30 bg-cyan-500/5">
      <CardHeader className="py-3">
        <CardTitle className="text-sm font-medium text-cyan-400">
          Extraction Metrics
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="space-y-1">
            <p className="text-2xl font-bold">{metrics.total_found}</p>
            <p className="text-xs text-muted-foreground">Total Elements</p>
          </div>
          <div className="space-y-1">
            <p className="text-2xl font-bold text-green-500">
              {metrics.clicked}
            </p>
            <p className="text-xs text-muted-foreground">Clicked</p>
          </div>
          <div className="space-y-1">
            <p className="text-2xl font-bold text-yellow-500">
              {metrics.skipped_dangerous}
            </p>
            <p className="text-xs text-muted-foreground">Skipped (Safety)</p>
          </div>
          <div className="space-y-1">
            <p className="text-2xl font-bold text-blue-500">
              {metrics.pages_visited}
            </p>
            <p className="text-xs text-muted-foreground">Pages Visited</p>
          </div>
        </div>

        {metrics.verified !== undefined && (
          <>
            <div className="my-4 border-t border-border" />
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Verification Rate</span>
                <span className="font-medium">
                  {metrics.total_found > 0
                    ? ((metrics.verified / metrics.total_found) * 100).toFixed(
                        1
                      )
                    : 0}
                  %
                </span>
              </div>
              <Progress
                value={
                  metrics.total_found > 0
                    ? (metrics.verified / metrics.total_found) * 100
                    : 0
                }
                className="h-2"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span className="text-green-500">
                  {metrics.verified} verified
                </span>
                <span className="text-red-500">
                  {metrics.unverified || 0} unverified
                </span>
              </div>
            </div>
          </>
        )}

        {metrics.errors > 0 && (
          <div className="mt-4 flex items-center gap-2 text-red-500">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm">{metrics.errors} errors encountered</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
