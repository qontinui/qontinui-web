"use client";

import React from "react";
import { useRunnerHealth } from "@/lib/runner-api";
import { useSharedOrchestratorState } from "@/contexts/SharedRunnerDataContext";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Brain,
  ShieldCheck,
  BookOpen,
  Workflow,
  Wrench,
  Wifi,
  WifiOff,
  Activity,
  Zap,
  Clock,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BottomBarProps {
  run: {
    id: string;
    status: string;
    iteration_count?: number;
    max_sessions?: number;
    sessions_count?: number;
    started_at?: string;
  };
}

// ---------------------------------------------------------------------------
// Elapsed Time Display
// ---------------------------------------------------------------------------

function ElapsedTime({ startedAt }: { startedAt?: string }) {
  const [elapsed, setElapsed] = React.useState(0);

  React.useEffect(() => {
    if (!startedAt) return;
    const startMs = new Date(startedAt).getTime();
    const update = () => setElapsed(Math.floor((Date.now() - startMs) / 1000));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  if (!startedAt) return null;

  const formatTime = (totalSec: number): string => {
    if (totalSec < 60) return `${totalSec}s`;
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    if (mins < 60) return `${mins}m ${secs}s`;
    const hours = Math.floor(mins / 60);
    const remainMins = mins % 60;
    return `${hours}h ${remainMins}m`;
  };

  return (
    <div className="flex items-center gap-1.5">
      <Clock className="size-3 text-text-muted" />
      <span className="text-[10px] text-text-muted font-mono tabular-nums">
        {formatTime(elapsed)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Orchestrator Agent Badge
// ---------------------------------------------------------------------------

const AGENT_CONFIG: Record<
  string,
  { icon: typeof Brain; color: string; label: string }
> = {
  planning: { icon: Brain, color: "text-blue-400", label: "Planning" },
  verification: {
    icon: ShieldCheck,
    color: "text-teal-400",
    label: "Verifying",
  },
  knowledge: { icon: BookOpen, color: "text-amber-400", label: "Knowledge" },
  orchestrator: {
    icon: Workflow,
    color: "text-violet-400",
    label: "Orchestrating",
  },
  worker: { icon: Wrench, color: "text-cyan-400", label: "Working" },
};

function AgentBadge({ agent }: { agent: string | undefined }) {
  if (!agent) return null;
  const config = AGENT_CONFIG[agent.toLowerCase()] || {
    icon: Zap,
    color: "text-text-muted",
    label: agent,
  };
  const Icon = config.icon;

  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] gap-1 border-white/10 bg-white/[0.02]",
        config.color
      )}
    >
      <Icon className="size-2.5" />
      {config.label}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Activity Indicator
// ---------------------------------------------------------------------------

function ActivityIndicator({
  activityType,
  currentAction,
}: {
  activityType?: string;
  currentAction?: string;
}) {
  if (!activityType && !currentAction) return null;

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <Activity className="size-3 text-green-500 animate-pulse shrink-0" />
      {activityType && (
        <span className="text-[10px] text-text-muted capitalize shrink-0">
          {activityType}
        </span>
      )}
      {currentAction && (
        <>
          <span className="text-[10px] text-border-subtle">•</span>
          <span className="text-[10px] text-text-muted/70 truncate max-w-[200px]">
            {currentAction}
          </span>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connection Status
// ---------------------------------------------------------------------------

function ConnectionStatus() {
  const { isOffline } = useRunnerHealth();

  return (
    <div className="flex items-center gap-1">
      {isOffline ? (
        <>
          <WifiOff className="size-3 text-red-400" />
          <span className="text-[10px] text-red-400">Offline</span>
        </>
      ) : (
        <>
          <Wifi className="size-3 text-green-500" />
          <span className="text-[10px] text-green-500/70">Connected</span>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main BottomBar
// ---------------------------------------------------------------------------

export function BottomBar({ run }: BottomBarProps) {
  const { data: orchState } = useSharedOrchestratorState();

  return (
    <div className="flex items-center justify-between px-4 py-1.5 bg-surface-canvas/80 border-t border-border-subtle/30 gap-4">
      {/* Left: elapsed time + agent badge */}
      <div className="flex items-center gap-3">
        <ElapsedTime startedAt={run.started_at} />
        <AgentBadge agent={orchState?.active_agent} />
      </div>

      {/* Center: activity */}
      <div className="flex-1 flex items-center justify-center min-w-0">
        {run.status === "running" ? (
          <ActivityIndicator
            activityType={orchState?.activity_type}
            currentAction={orchState?.current_action}
          />
        ) : (
          <span className="text-[10px] text-text-muted capitalize">
            {run.status}
          </span>
        )}
      </div>

      {/* Right: connection status */}
      <ConnectionStatus />
    </div>
  );
}
