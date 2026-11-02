"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, Play, Server } from "lucide-react";
import {
  MachineName,
  RedactedText,
  usePresentationMode,
} from "@/components/presentation";
import { OutputViewer } from "./OutputViewer";
import { relativeTime, truncate } from "./utils";
import type { RunnerTaskRun } from "./types";

interface TaskRunCardProps {
  task: RunnerTaskRun;
}

/**
 * A task run as an outsider sees it (plan
 * `2026-10-23-console-presentation-spaces` Phase 7): one read-only line — its
 * status, its workflow's name only when provably the tenant's own (a task run
 * names no repository, so in practice a descriptor), the machine's alias and
 * the start time. No prompt and no output: both are free text the run was
 * given or produced, and expanding the card would fetch and show it (D3.3).
 */
function PresentedTaskRun({ task }: TaskRunCardProps) {
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card/30 px-3 py-2 text-sm"
      data-testid="task-run-presented"
    >
      <Play className="h-4 w-4 text-success shrink-0" />
      <RedactedText
        className="min-w-0 truncate font-medium"
        text={task.workflow_name ?? "Workflow run"}
        repo={null}
        descriptor={{
          kind: "Workflow run",
          status: task.status,
          at: task.started_at,
        }}
      />
      <Badge variant={statusVariant(task.status)} className="shrink-0">
        {task.status}
      </Badge>
      <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
        <Server className="h-3 w-3" />
        <MachineName identity={{ hostname: task.runner_hostname }} />
      </span>
    </div>
  );
}

function statusVariant(
  status: string
): "default" | "success" | "warning" | "destructive" | "secondary" {
  const lower = status.toLowerCase();
  if (lower === "running" || lower === "in_progress") return "success";
  if (lower === "completed" || lower === "done") return "default";
  if (lower === "failed" || lower === "error") return "destructive";
  if (lower === "pending" || lower === "queued") return "warning";
  return "secondary";
}

export function TaskRunCard({ task }: TaskRunCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { presenting } = usePresentationMode();
  if (presenting) return <PresentedTaskRun task={task} />;

  const hostLabel =
    task.runner_hostname && task.runner_port
      ? `${task.runner_hostname}:${task.runner_port}`
      : (task.runner_hostname ?? `runner ${task.runner_id.slice(0, 8)}`);

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <Card className="py-0 gap-0">
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer select-none hover:bg-muted/50 transition-colors rounded-t-xl py-3">
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-3 min-w-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  tabIndex={-1}
                >
                  {expanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </Button>

                <Play className="h-4 w-4 text-success shrink-0" />

                <CardTitle className="text-sm truncate">
                  {task.workflow_name ?? `Task ${task.id.slice(0, 8)}`}
                </CardTitle>

                <Badge
                  variant={statusVariant(task.status)}
                  className="shrink-0"
                >
                  {task.status}
                </Badge>
              </div>

              <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0 ml-4">
                <span className="flex items-center gap-1">
                  <Server className="h-3 w-3" />
                  {hostLabel}
                </span>
                {task.started_at && (
                  <span title={task.started_at}>
                    {relativeTime(task.started_at)}
                  </span>
                )}
              </div>
            </div>

            {task.prompt && (
              <p className="text-xs text-muted-foreground mt-1 pl-9 truncate">
                {truncate(task.prompt, 120)}
              </p>
            )}
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="pt-0 pb-4">
            <OutputViewer runnerId={task.runner_id} taskRunId={task.id} />
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
