import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Stats } from "../types";
import { formatDuration } from "../types";

interface DurationExtremesProps {
  stats: Stats;
}

export function DurationExtremes({ stats }: DurationExtremesProps) {
  if (!stats.longestRun && !stats.shortestRun) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {stats.longestRun && (
        <Card className="bg-muted border-border">
          <CardHeader>
            <CardTitle className="text-base text-muted-foreground">
              Longest Run
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-medium text-foreground">
              {stats.longestRun.task_name}
            </div>
            <div className="text-2xl font-bold text-foreground mt-1">
              {formatDuration(stats.longestRun.duration_seconds)}
            </div>
          </CardContent>
        </Card>
      )}
      {stats.shortestRun && (
        <Card className="bg-muted border-border">
          <CardHeader>
            <CardTitle className="text-base text-muted-foreground">
              Shortest Run
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-medium text-foreground">
              {stats.shortestRun.task_name}
            </div>
            <div className="text-2xl font-bold text-foreground mt-1">
              {formatDuration(stats.shortestRun.duration_seconds)}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
