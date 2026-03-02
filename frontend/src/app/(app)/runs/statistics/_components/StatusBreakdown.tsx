import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Activity,
  CheckCircle2,
  XCircle,
  PlayCircle,
  Clock,
} from "lucide-react";
import type { Stats } from "../types";

interface StatusBreakdownProps {
  stats: Stats;
}

export function StatusBreakdown({ stats }: StatusBreakdownProps) {
  return (
    <Card className="bg-muted border-border">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="size-4" />
          Status Breakdown
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-background">
            <CheckCircle2 className="size-5 text-green-500" />
            <div>
              <div
                className="text-xl font-bold text-green-500"
                data-content-role="metric"
                data-content-label="completed-runs"
              >
                {stats.completedRuns}
              </div>
              <div
                className="text-xs text-muted-foreground"
                data-content-role="label"
              >
                Completed
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg bg-background">
            <XCircle className="size-5 text-red-500" />
            <div>
              <div
                className="text-xl font-bold text-red-500"
                data-content-role="metric"
                data-content-label="failed-runs"
              >
                {stats.failedRuns}
              </div>
              <div
                className="text-xs text-muted-foreground"
                data-content-role="label"
              >
                Failed
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg bg-background">
            <PlayCircle className="size-5 text-blue-500" />
            <div>
              <div
                className="text-xl font-bold text-blue-500"
                data-content-role="metric"
                data-content-label="running-runs"
              >
                {stats.runningRuns}
              </div>
              <div
                className="text-xs text-muted-foreground"
                data-content-role="label"
              >
                Running
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg bg-background">
            <Clock className="size-5 text-muted-foreground" />
            <div>
              <div
                className="text-xl font-bold text-muted-foreground"
                data-content-role="metric"
                data-content-label="stopped-runs"
              >
                {stats.stoppedRuns}
              </div>
              <div
                className="text-xs text-muted-foreground"
                data-content-role="label"
              >
                Stopped
              </div>
            </div>
          </div>
        </div>

        {stats.totalRuns > 0 && (
          <div className="mt-4">
            <div className="flex h-3 rounded-full overflow-hidden bg-background">
              {stats.completedRuns > 0 && (
                <div
                  className="bg-green-500 transition-all"
                  style={{
                    width: `${(stats.completedRuns / stats.totalRuns) * 100}%`,
                  }}
                />
              )}
              {stats.failedRuns > 0 && (
                <div
                  className="bg-red-500 transition-all"
                  style={{
                    width: `${(stats.failedRuns / stats.totalRuns) * 100}%`,
                  }}
                />
              )}
              {stats.runningRuns > 0 && (
                <div
                  className="bg-blue-500 transition-all"
                  style={{
                    width: `${(stats.runningRuns / stats.totalRuns) * 100}%`,
                  }}
                />
              )}
              {stats.stoppedRuns > 0 && (
                <div
                  className="bg-gray-500 transition-all"
                  style={{
                    width: `${(stats.stoppedRuns / stats.totalRuns) * 100}%`,
                  }}
                />
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
