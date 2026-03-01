"use client";

import { useState } from "react";
import { useTaskRun, type TaskRun } from "@/lib/runner-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  RefreshCw,
  Settings,
  ChevronRight,
  ChevronDown,
  FileJson,
  Clock,
  Hash,
  Layers,
} from "lucide-react";

interface ConfigurationTabProps {
  runId: string;
}

function formatDateTime(dateString: string): string {
  try {
    return new Date(dateString).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  } catch {
    return dateString;
  }
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "-";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function RunConfigSection({ run }: { run: TaskRun }) {
  const configData: Record<string, unknown> = {};

  if (run.task_name) configData.task_name = run.task_name;
  if (run.task_type) configData.task_type = run.task_type;
  if (run.workflow_name) configData.workflow_name = run.workflow_name;
  if (run.workflow_type) configData.workflow_type = run.workflow_type;
  if (run.max_sessions != null) configData.max_sessions = run.max_sessions;
  if (run.auto_continue != null) configData.auto_continue = run.auto_continue;
  if (run.depth != null) configData.depth = run.depth;
  if (run.prompt) configData.prompt = run.prompt;

  return (
    <Card className="bg-surface-raised/30 border-border-subtle/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileJson className="size-4 text-text-muted" />
          Run Configuration
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[300px]">
          <pre className="text-xs font-mono text-text-secondary whitespace-pre-wrap break-words leading-relaxed p-4 bg-surface-canvas/50 rounded-lg border border-border-subtle/30">
            {JSON.stringify(configData, null, 2)}
          </pre>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function RunDetailsSection({ run }: { run: TaskRun }) {
  const details = [
    { label: "Run ID", value: run.id, icon: Hash },
    { label: "Task Name", value: run.task_name },
    { label: "Status", value: run.status },
    {
      label: "Created At",
      value: formatDateTime(run.created_at),
      icon: Clock,
    },
    {
      label: "Completed At",
      value: run.completed_at ? formatDateTime(run.completed_at) : "-",
      icon: Clock,
    },
    { label: "Duration", value: formatDuration(run.duration_seconds) },
    {
      label: "Sessions",
      value:
        run.sessions_count != null
          ? `${run.sessions_count}${run.max_sessions != null ? ` / ${run.max_sessions}` : ""}`
          : "-",
      icon: Layers,
    },
    {
      label: "Iterations",
      value: run.iteration_count != null ? String(run.iteration_count) : "-",
    },
    { label: "Phase", value: run.phase || "-" },
    {
      label: "Auto-Continue",
      value: run.auto_continue != null ? String(run.auto_continue) : "-",
    },
    { label: "Workflow Name", value: run.workflow_name || "-" },
    { label: "Workflow Type", value: run.workflow_type || "-" },
    { label: "Task Type", value: run.task_type || "-" },
    { label: "Depth", value: run.depth != null ? String(run.depth) : "-" },
  ];

  return (
    <Card className="bg-surface-raised/30 border-border-subtle/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Settings className="size-4 text-text-muted" />
          Run Details
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
          {details.map((detail) => (
            <div
              key={detail.label}
              className="flex items-center justify-between py-1.5 border-b border-border-subtle/20"
            >
              <span className="text-xs text-text-muted">{detail.label}</span>
              <span className="text-sm text-text-primary font-mono">
                {detail.value}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function PromptSection({ prompt }: { prompt: string }) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <Card className="bg-surface-raised/30 border-border-subtle/50">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger className="w-full">
          <CardHeader className="pb-3 flex flex-row items-center gap-2">
            {isOpen ? (
              <ChevronDown className="size-4 text-text-muted" />
            ) : (
              <ChevronRight className="size-4 text-text-muted" />
            )}
            <CardTitle className="text-base">Prompt</CardTitle>
            <Badge variant="secondary" className="text-xs ml-auto">
              {prompt.length.toLocaleString()} chars
            </Badge>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent>
            <ScrollArea className="h-[300px]">
              <pre className="text-sm font-mono text-text-secondary whitespace-pre-wrap break-words leading-relaxed p-4 bg-surface-canvas/50 rounded-lg border border-border-subtle/30">
                {prompt}
              </pre>
            </ScrollArea>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

export function ConfigurationTab({ runId }: ConfigurationTabProps) {
  const { data: run, isLoading, error } = useTaskRun(runId);

  if (isLoading) {
    return (
      <div className="text-center py-12 text-text-muted">
        <RefreshCw className="size-5 animate-spin mx-auto mb-2" />
        Loading configuration...
      </div>
    );
  }

  if (error) {
    return <div className="text-center py-12 text-red-400">Error: {error}</div>;
  }

  if (!run) {
    return (
      <div className="text-center py-12 text-text-muted">
        <Settings className="size-12 mx-auto mb-4" />
        <p>No configuration data available.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <RunDetailsSection run={run} />
      <RunConfigSection run={run} />
      {run.prompt && <PromptSection prompt={run.prompt} />}
    </div>
  );
}
