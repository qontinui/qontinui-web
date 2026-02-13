"use client";

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
  };
}

// ---------------------------------------------------------------------------
// Circular Progress SVG
// ---------------------------------------------------------------------------

function CircularProgress({
  current,
  max,
  size = 28,
  strokeWidth = 3,
}: {
  current: number;
  max: number;
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = max > 0 ? Math.min(current / max, 1) : 0;
  const dashOffset = circumference * (1 - progress);
  const center = size / 2;

  return (
    <div className="flex items-center gap-1.5">
      <svg width={size} height={size} className="-rotate-90">
        {/* Background circle */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-white/5"
        />
        {/* Progress circle */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          className={cn(
            "transition-all duration-500",
            progress >= 1 ? "text-green-500" : "text-brand-primary"
          )}
        />
      </svg>
      <span className="text-[10px] text-text-muted font-mono tabular-nums">
        {current}/{max || "∞"}
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
  const iterCurrent = run.iteration_count ?? run.sessions_count ?? 0;
  const iterMax = run.max_sessions ?? 0;

  return (
    <div className="flex items-center justify-between px-4 py-1.5 bg-surface-canvas/80 border-t border-border-subtle/30 gap-4">
      {/* Left: iteration progress */}
      <div className="flex items-center gap-3">
        <CircularProgress current={iterCurrent} max={iterMax} />
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
          <span className="text-[10px] text-text-muted capitalize">{run.status}</span>
        )}
      </div>

      {/* Right: connection status */}
      <ConnectionStatus />
    </div>
  );
}
