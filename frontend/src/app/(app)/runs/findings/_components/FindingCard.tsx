import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronRight,
  Code,
  FileCode,
  CheckCircle2,
} from "lucide-react";
import type { FindingView } from "@/lib/task-run-mappers";
import { getSeverityIcon, getSeverityBadge } from "./severity-utils";

interface FindingCardProps {
  finding: FindingView;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onResolve: (findingId: string, e: React.MouseEvent) => void;
}

export function FindingCard({
  finding,
  isExpanded,
  onToggleExpand,
  onResolve,
}: FindingCardProps) {
  return (
    <Card
      className="bg-muted/50 border-border cursor-pointer transition-all hover:bg-muted"
      onClick={onToggleExpand}
    >
      <CardContent className="py-4 px-5">
        <div className="flex items-start gap-3">
          <div className="pt-0.5">{getSeverityIcon(finding.severity)}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {isExpanded ? (
                <ChevronDown className="size-3.5 text-muted-foreground" />
              ) : (
                <ChevronRight className="size-3.5 text-muted-foreground" />
              )}
              <span
                className="font-medium text-foreground text-sm"
                data-content-role="label"
                data-content-label="finding-title"
              >
                {finding.title}
              </span>
              {getSeverityBadge(finding.severity)}
              <Badge variant="outline" className="text-xs">
                {finding.category}
              </Badge>
              <Badge variant="secondary" className="text-xs">
                {finding.status}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1.5">
              {finding.description}
            </p>

            {isExpanded && (
              <div className="mt-3 space-y-3 border-t border-border pt-3">
                {finding.file_path && (
                  <div className="bg-background rounded-lg p-3">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono mb-1">
                      <Code className="size-3" />
                      {finding.file_path}
                      {finding.line_number ? `:${finding.line_number}` : ""}
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <div className="text-xs text-muted-foreground">
                    Run #{finding.task_run_id} &middot;{" "}
                    {new Date(finding.created_at).toLocaleString()}
                  </div>
                  {finding.status !== "resolved" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => onResolve(finding.id, e)}
                      className="text-xs text-green-400 border-green-500/30 hover:bg-green-950/50"
                    >
                      <CheckCircle2 className="size-3 mr-1" />
                      Resolve
                    </Button>
                  )}
                </div>
              </div>
            )}

            {!isExpanded && finding.file_path && (
              <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground font-mono">
                <FileCode className="size-3" />
                {finding.file_path}
                {finding.line_number ? `:${finding.line_number}` : ""}
              </div>
            )}
            {!isExpanded && (
              <div className="text-xs text-muted-foreground mt-1.5">
                Run #{finding.task_run_id} &middot;{" "}
                {new Date(finding.created_at).toLocaleString()}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
