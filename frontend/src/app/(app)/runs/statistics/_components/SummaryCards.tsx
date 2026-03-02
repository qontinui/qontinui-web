import { Card, CardContent } from "@/components/ui/card";
import { Hash, Timer, TrendingUp, Clock } from "lucide-react";
import type { Stats } from "../types";
import { formatDuration } from "../types";

interface SummaryCardsProps {
  stats: Stats;
}

export function SummaryCards({ stats }: SummaryCardsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Card className="bg-muted border-border">
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 mb-2">
            <Hash className="size-4 text-muted-foreground" />
            <span
              className="text-xs text-muted-foreground"
              data-content-role="label"
            >
              Total Runs
            </span>
          </div>
          <div
            className="text-3xl font-bold text-foreground"
            data-content-role="metric"
            data-content-label="total-runs"
          >
            {stats.totalRuns}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-muted border-border">
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 mb-2">
            <Timer className="size-4 text-muted-foreground" />
            <span
              className="text-xs text-muted-foreground"
              data-content-role="label"
            >
              Avg Duration
            </span>
          </div>
          <div
            className="text-3xl font-bold text-foreground"
            data-content-role="metric"
            data-content-label="avg-duration"
          >
            {formatDuration(stats.avgDuration)}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-muted border-border">
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="size-4 text-muted-foreground" />
            <span
              className="text-xs text-muted-foreground"
              data-content-role="label"
            >
              Success Rate
            </span>
          </div>
          <div
            className={`text-3xl font-bold ${
              stats.successRate >= 80
                ? "text-green-500"
                : stats.successRate >= 50
                  ? "text-yellow-500"
                  : "text-red-500"
            }`}
            data-content-role="metric"
            data-content-label="success-rate"
          >
            {stats.successRate.toFixed(0)}%
          </div>
        </CardContent>
      </Card>

      <Card className="bg-muted border-border">
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="size-4 text-muted-foreground" />
            <span
              className="text-xs text-muted-foreground"
              data-content-role="label"
            >
              Total Time
            </span>
          </div>
          <div
            className="text-3xl font-bold text-foreground"
            data-content-role="metric"
            data-content-label="total-time"
          >
            {formatDuration(stats.totalDuration)}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
