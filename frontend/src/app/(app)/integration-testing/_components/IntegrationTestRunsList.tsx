import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Loader2, Clock } from "lucide-react";
import { formatTimestampLocal } from "@/lib/time-utils";
import type { IntegrationTestRunSummary } from "@/types/integration-testing";

interface IntegrationTestRunsListProps {
  runs: IntegrationTestRunSummary[];
  onSelectRun: (runId: string) => void;
}

export function IntegrationTestRunsList({
  runs,
  onSelectRun,
}: IntegrationTestRunsListProps) {
  return (
    <div className="space-y-3">
      {runs.map((run) => (
        <Card
          key={run.id}
          className="bg-muted border-border hover:border-primary/50 transition-colors cursor-pointer"
          onClick={() => onSelectRun(run.id)}
        >
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-foreground">
                      {run.workflow_name}
                    </span>
                    <StatusBadge status={run.status} />
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {formatTimestampLocal(run.started_at)}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-6 text-sm">
                <div className="text-center">
                  <div className="text-muted-foreground">Coverage</div>
                  <div
                    className={`font-bold ${
                      run.coverage_percentage >= 80
                        ? "text-green-400"
                        : run.coverage_percentage >= 50
                          ? "text-yellow-400"
                          : "text-red-400"
                    }`}
                  >
                    {run.coverage_percentage.toFixed(0)}%
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-muted-foreground">Success</div>
                  <div
                    className={`font-bold ${
                      run.success_rate >= 90
                        ? "text-green-400"
                        : run.success_rate >= 70
                          ? "text-yellow-400"
                          : "text-red-400"
                    }`}
                  >
                    {run.success_rate}%
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-muted-foreground">Actions</div>
                  <div className="font-bold text-foreground">
                    {run.total_actions}
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-muted-foreground">Duration</div>
                  <div className="font-bold text-foreground">
                    {formatDuration(run.duration_ms)}
                  </div>
                </div>
                {run.issues_count > 0 && (
                  <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                    {run.issues_count} issue{run.issues_count > 1 ? "s" : ""}
                  </Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function StatusBadge({
  status,
}: {
  status: IntegrationTestRunSummary["status"];
}) {
  switch (status) {
    case "completed":
      return (
        <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          Completed
        </Badge>
      );
    case "failed":
      return (
        <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
          <XCircle className="w-3 h-3 mr-1" />
          Failed
        </Badge>
      );
    case "running":
      return (
        <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">
          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
          Running
        </Badge>
      );
    case "timeout":
      return (
        <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
          <Clock className="w-3 h-3 mr-1" />
          Timeout
        </Badge>
      );
    default:
      return (
        <Badge className="bg-muted text-muted-foreground border-border">
          {status}
        </Badge>
      );
  }
}

function formatDuration(ms: number) {
  if (ms === 0) return "0ms (virtual)";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}
