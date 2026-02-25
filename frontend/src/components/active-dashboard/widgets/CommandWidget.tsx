"use client";

import { useState, useMemo } from "react";
import type { CurrentExecutionStep } from "@/lib/runner";
import { useSharedStepsData } from "@/contexts/SharedRunnerDataContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  Terminal,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

type CommandMode = "shell" | "check" | "check_group" | "test" | "unknown";

const MODE_LABELS: Record<CommandMode, string> = {
  shell: "Shell",
  check: "Check",
  check_group: "Check Group",
  test: "Test",
  unknown: "Command",
};

const MODE_COLORS: Record<CommandMode, string> = {
  shell: "text-slate-400 border-slate-500/30",
  check: "text-blue-400 border-blue-500/30",
  check_group: "text-blue-400 border-blue-500/30",
  test: "text-indigo-400 border-indigo-500/30",
  unknown: "text-slate-400 border-slate-500/30",
};

const COMMAND_STEP_TYPES = new Set([
  "command",
  "shell_command",
  "shell",
  "check",
  "check_group",
  "test",
  "api_request",
  "api_call",
  "http_request",
  "http",
  "mcp_call",
  "mcp",
  "tool_call",
  "script",
  "python",
  "node",
  "script_execution",
  "bash",
  "cmd",
  "powershell",
]);

function inferCommandMode(step: CurrentExecutionStep): CommandMode {
  if (step.command_mode) {
    const mode = step.command_mode.toLowerCase();
    if (
      mode === "shell" ||
      mode === "check" ||
      mode === "check_group" ||
      mode === "test"
    ) {
      return mode;
    }
  }
  // Infer from step_type for legacy events
  const t = step.step_type.toLowerCase();
  if (t === "check" || t === "check_group") return t as CommandMode;
  if (t === "test" || t === "playwright") return "test";
  if (
    t === "shell_command" ||
    t === "shell" ||
    t === "bash" ||
    t === "cmd" ||
    t === "powershell"
  )
    return "shell";
  return "unknown";
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "success":
      return <CheckCircle2 className="size-3.5 text-green-500 shrink-0" />;
    case "failed":
      return <XCircle className="size-3.5 text-red-500 shrink-0" />;
    case "running":
      return (
        <Loader2 className="size-3.5 text-blue-400 animate-spin shrink-0" />
      );
    default:
      return <div className="size-3.5 rounded-full bg-white/10 shrink-0" />;
  }
}

const FILTER_OPTIONS: { label: string; value: CommandMode | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Shell", value: "shell" },
  { label: "Check", value: "check" },
  { label: "Test", value: "test" },
];

export function CommandWidget({ runId: _runId }: { runId: string }) {
  const { data: stepsData, isLoading } = useSharedStepsData();
  const [filter, setFilter] = useState<CommandMode | "all">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const commandSteps = useMemo(() => {
    const executions = stepsData?.executions || [];
    return executions
      .filter((e) => COMMAND_STEP_TYPES.has(e.step_type.toLowerCase()))
      .map((step) => ({ ...step, mode: inferCommandMode(step) }));
  }, [stepsData]);

  const filtered = useMemo(() => {
    if (filter === "all") return commandSteps;
    return commandSteps.filter((s) => s.mode === filter);
  }, [commandSteps, filter]);

  if (isLoading) {
    return (
      <Card className="bg-surface-raised/30 border-border-subtle/50 h-full">
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Terminal className="size-4 text-slate-400" />
            Commands
          </CardTitle>
        </CardHeader>
        <CardContent className="py-4 text-center text-text-muted">
          <RefreshCw className="size-4 animate-spin mx-auto" />
        </CardContent>
      </Card>
    );
  }

  const stats = {
    total: commandSteps.length,
    passed: commandSteps.filter((s) => s.status === "success").length,
    failed: commandSteps.filter((s) => s.status === "failed").length,
    running: commandSteps.filter((s) => s.status === "running").length,
  };

  return (
    <Card className="bg-surface-raised/30 border-border-subtle/50 h-full flex flex-col">
      <CardHeader className="py-3 px-4 shrink-0">
        <CardTitle className="text-sm flex items-center gap-2">
          <Terminal className="size-4 text-slate-400" />
          Commands
          <Badge variant="secondary" className="text-xs">
            {stats.total}
          </Badge>
          {stats.failed > 0 && (
            <Badge variant="destructive" className="text-[10px]">
              {stats.failed} failed
            </Badge>
          )}
        </CardTitle>
        {/* Mode filter tabs */}
        <div className="flex gap-1 mt-2">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFilter(opt.value)}
              className={cn(
                "px-2 py-0.5 text-[10px] rounded-md transition-colors",
                filter === opt.value
                  ? "bg-white/10 text-text-primary"
                  : "text-text-muted hover:text-text-secondary hover:bg-white/[0.03]"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 px-4 pb-4">
        <ScrollArea className="h-full">
          <div className="space-y-1">
            {filtered.map((step) => {
              const isExpanded = expandedId === step.id;
              return (
                <div key={step.id}>
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : step.id)}
                    className="w-full flex items-center gap-2 text-xs py-1.5 px-2 rounded-md hover:bg-white/[0.03] transition-colors text-left"
                  >
                    <StatusIcon status={step.status} />
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[9px] shrink-0",
                        MODE_COLORS[step.mode]
                      )}
                    >
                      {MODE_LABELS[step.mode]}
                    </Badge>
                    <span className="font-mono text-text-primary truncate flex-1">
                      {step.step_name}
                    </span>
                    {step.duration_ms != null && (
                      <span className="text-text-muted shrink-0">
                        {step.duration_ms}ms
                      </span>
                    )}
                    {isExpanded ? (
                      <ChevronDown className="size-3 text-text-muted shrink-0" />
                    ) : (
                      <ChevronRight className="size-3 text-text-muted shrink-0" />
                    )}
                  </button>
                  {isExpanded && (step.output || step.stdout || step.error) && (
                    <div className="ml-6 mb-2 p-2 rounded bg-surface-canvas/50 border border-border-subtle/30">
                      {step.error && (
                        <pre className="text-[10px] text-red-400 whitespace-pre-wrap break-all mb-1">
                          {step.error}
                        </pre>
                      )}
                      {(step.stdout || step.output) && (
                        <pre className="text-[10px] text-text-muted whitespace-pre-wrap break-all max-h-40 overflow-auto">
                          {step.stdout || step.output}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {filtered.length === 0 && (
              <p className="text-xs text-text-muted py-4 text-center">
                No commands yet...
              </p>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
