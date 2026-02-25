"use client";

import { useMemo } from "react";
import type { CurrentExecutionStep } from "@/lib/runner";
import { useSharedStepsData } from "@/contexts/SharedRunnerDataContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  Monitor,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Loader2,
  Navigation,
  Play,
  ShieldCheck,
  Camera,
} from "lucide-react";

type UiBridgeActionType =
  | "navigate"
  | "execute"
  | "assert"
  | "snapshot"
  | "other";

const ACTION_LABELS: Record<UiBridgeActionType, string> = {
  navigate: "Navigate",
  execute: "Execute",
  assert: "Assert",
  snapshot: "Snapshot",
  other: "Action",
};

const ACTION_COLORS: Record<UiBridgeActionType, string> = {
  navigate: "text-blue-400 border-blue-500/30",
  execute: "text-green-400 border-green-500/30",
  assert: "text-amber-400 border-amber-500/30",
  snapshot: "text-cyan-400 border-cyan-500/30",
  other: "text-slate-400 border-slate-500/30",
};

const ACTION_ICONS: Record<
  UiBridgeActionType,
  React.ComponentType<{ className?: string }>
> = {
  navigate: Navigation,
  execute: Play,
  assert: ShieldCheck,
  snapshot: Camera,
  other: Monitor,
};

const UI_BRIDGE_STEP_TYPES = new Set(["ui_bridge", "uibridge"]);

function inferActionType(step: CurrentExecutionStep): UiBridgeActionType {
  const name = step.step_name.toLowerCase();
  if (
    name.includes("navigate") ||
    name.includes("goto") ||
    name.includes("go_to")
  )
    return "navigate";
  if (
    name.includes("assert") ||
    name.includes("verify") ||
    name.includes("check")
  )
    return "assert";
  if (
    name.includes("snapshot") ||
    name.includes("screenshot") ||
    name.includes("capture")
  )
    return "snapshot";
  if (
    name.includes("click") ||
    name.includes("type") ||
    name.includes("fill") ||
    name.includes("execute")
  )
    return "execute";
  return "other";
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

export function UiBridgeWidget({ runId: _runId }: { runId: string }) {
  const { data: stepsData, isLoading } = useSharedStepsData();

  const uiBridgeSteps = useMemo(() => {
    const executions = stepsData?.executions || [];
    return executions
      .filter((e) => UI_BRIDGE_STEP_TYPES.has(e.step_type.toLowerCase()))
      .map((step) => ({ ...step, actionType: inferActionType(step) }));
  }, [stepsData]);

  if (isLoading) {
    return (
      <Card className="bg-surface-raised/30 border-border-subtle/50 h-full">
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Monitor className="size-4 text-emerald-400" />
            UI Bridge
          </CardTitle>
        </CardHeader>
        <CardContent className="py-4 text-center text-text-muted">
          <RefreshCw className="size-4 animate-spin mx-auto" />
        </CardContent>
      </Card>
    );
  }

  const stats = {
    total: uiBridgeSteps.length,
    passed: uiBridgeSteps.filter((s) => s.status === "success").length,
    failed: uiBridgeSteps.filter((s) => s.status === "failed").length,
    assertions: uiBridgeSteps.filter((s) => s.actionType === "assert").length,
    assertionsPassed: uiBridgeSteps.filter(
      (s) => s.actionType === "assert" && s.status === "success"
    ).length,
  };

  return (
    <Card className="bg-surface-raised/30 border-border-subtle/50 h-full flex flex-col">
      <CardHeader className="py-3 px-4 shrink-0">
        <CardTitle className="text-sm flex items-center gap-2">
          <Monitor className="size-4 text-emerald-400" />
          UI Bridge
          <Badge variant="secondary" className="text-xs">
            {stats.total}
          </Badge>
          {stats.assertions > 0 && (
            <Badge
              variant="outline"
              className={cn(
                "text-[10px]",
                stats.assertionsPassed === stats.assertions
                  ? "text-green-400 border-green-500/30"
                  : "text-amber-400 border-amber-500/30"
              )}
            >
              {stats.assertionsPassed}/{stats.assertions} assertions
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 px-4 pb-4">
        <ScrollArea className="h-full">
          <div className="space-y-1">
            {uiBridgeSteps.map((step) => {
              const ActionIcon = ACTION_ICONS[step.actionType];
              return (
                <div
                  key={step.id}
                  className="flex items-center gap-2 text-xs py-1.5 px-2 rounded-md hover:bg-white/[0.03] transition-colors"
                >
                  <StatusIcon status={step.status} />
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[9px] shrink-0 gap-0.5",
                      ACTION_COLORS[step.actionType]
                    )}
                  >
                    <ActionIcon className="size-2.5" />
                    {ACTION_LABELS[step.actionType]}
                  </Badge>
                  <span className="text-text-primary truncate flex-1">
                    {step.step_name}
                  </span>
                  {step.duration_ms != null && (
                    <span className="text-text-muted shrink-0">
                      {step.duration_ms}ms
                    </span>
                  )}
                </div>
              );
            })}
            {uiBridgeSteps.length === 0 && (
              <p className="text-xs text-text-muted py-4 text-center">
                No UI Bridge actions yet...
              </p>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
