"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Server,
  Play,
  History,
  Activity,
  Workflow,
  AlertCircle,
  CheckCircle2,
  Clock,
  Layers,
  XCircle,
  Loader2,
  ArrowRight,
} from "lucide-react";
import { useRunnerHealth, useRunningTaskRuns } from "@/lib/runner-api";
import { useTaskRunList, useFindingsSummary } from "@/hooks/useTaskRunData";
import { RunnerPartialState } from "@/components/runner/RunnerPartialState";

function StatusDot({
  status,
}: {
  status: "connected" | "disconnected" | "loading";
}) {
  if (status === "loading") {
    return <Loader2 className="size-4 animate-spin text-text-muted" />;
  }
  return (
    <div
      className={`size-3 rounded-full ${
        status === "connected"
          ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]"
          : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]"
      }`}
    />
  );
}

function RunnerConnectionCard() {
  const { data: health, isLoading, isOffline } = useRunnerHealth();
  const status = isLoading
    ? "loading"
    : isOffline
      ? "disconnected"
      : "connected";

  return (
    <Card className="bg-surface-raised/50 border-border-subtle/50 backdrop-blur-sm">
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-surface-hover rounded-lg flex items-center justify-center">
              <Server className="size-5 text-brand-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-text-primary">
                Desktop Runner
              </h3>
              <p className="text-xs text-text-muted">localhost:9876</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusDot status={status} />
            <Badge
              variant="outline"
              className={
                status === "connected"
                  ? "border-green-500/30 bg-green-500/10 text-green-400"
                  : status === "loading"
                    ? "border-border-subtle bg-surface-hover text-text-muted"
                    : "border-red-500/30 bg-red-500/10 text-red-400"
              }
            >
              {status === "connected"
                ? "Connected"
                : status === "loading"
                  ? "Checking..."
                  : "Offline"}
            </Badge>
          </div>
        </div>
        {status === "connected" && health && (
          <div className="flex gap-4 text-sm text-text-muted">
            {health.version && <span>v{health.version}</span>}
            {health.uptime_seconds != null && (
              <span>
                Uptime: {Math.floor(health.uptime_seconds / 3600)}h{" "}
                {Math.floor((health.uptime_seconds % 3600) / 60)}m
              </span>
            )}
          </div>
        )}
        {status === "disconnected" && (
          <p className="text-sm text-text-muted">
            Start the Qontinui Runner desktop app to connect.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ActiveRunsCard() {
  const router = useRouter();
  const { data: activeRuns, isOffline } = useRunningTaskRuns();
  const runs = activeRuns ?? [];

  if (isOffline) {
    return (
      <Card className="bg-surface-raised/50 border-border-subtle/50 backdrop-blur-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="size-5 text-text-muted" />
            Active Runs
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm text-text-muted py-4 text-center">
            Runner not connected
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-surface-raised/50 border-border-subtle/50 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="size-5 text-green-400" />
            Active Runs
            {runs.length > 0 && (
              <Badge
                variant="outline"
                className="border-green-500/30 bg-green-500/10 text-green-400"
              >
                {runs.length}
              </Badge>
            )}
          </CardTitle>
          {runs.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("/runs/active")}
            >
              View Dashboard <ArrowRight className="size-4 ml-1" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {runs.length === 0 ? (
          <p className="text-sm text-text-muted py-4 text-center">
            No active runs
          </p>
        ) : (
          <div className="space-y-2">
            {runs.slice(0, 3).map((run) => (
              <div
                key={run.id}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-surface-hover/30 transition-colors cursor-pointer"
                onClick={() => router.push(`/runs/${run.id}`)}
              >
                <Loader2 className="size-4 animate-spin text-blue-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">
                    {run.task_name || run.workflow_name || `Run #${run.id}`}
                  </p>
                  <p className="text-xs text-text-muted">
                    {run.phase || "Running"}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className="border-blue-500/30 bg-blue-500/10 text-blue-400 shrink-0"
                >
                  {run.status}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RecentRunsCard() {
  const router = useRouter();
  const { data: runs, isRunnerOffline } = useTaskRunList({ limit: 5 });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="size-4 text-green-400" />;
      case "failed":
        return <XCircle className="size-4 text-red-400" />;
      case "running":
        return <Loader2 className="size-4 animate-spin text-blue-400" />;
      default:
        return <Clock className="size-4 text-text-muted" />;
    }
  };

  const getRelativeTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  return (
    <Card className="bg-surface-raised/50 border-border-subtle/50 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <History className="size-5 text-brand-primary" />
            Recent Runs
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/runs")}
          >
            View All <ArrowRight className="size-4 ml-1" />
          </Button>
        </div>
      </CardHeader>
      {isRunnerOffline && (
        <div className="px-2 mb-2">
          <RunnerPartialState message="Runner offline — showing recent historical runs" />
        </div>
      )}
      <CardContent className="pt-0">
        {runs.length === 0 ? (
          <p className="text-sm text-text-muted py-4 text-center">
            No runs yet
          </p>
        ) : (
          <div className="space-y-1">
            {runs.map((run) => (
              <div
                key={run.id}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-surface-hover/30 transition-colors cursor-pointer"
                onClick={() => router.push(`/runs/${run.id}`)}
              >
                {getStatusIcon(run.status)}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">
                    {run.task_name || run.workflow_name || `Run #${run.id}`}
                  </p>
                </div>
                <span className="text-xs text-text-muted shrink-0">
                  {getRelativeTime(run.created_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FindingsSummaryCard() {
  const router = useRouter();
  const { data: summary, isRunnerOffline } = useFindingsSummary();

  const total = summary?.total ?? 0;
  const bySeverity = summary?.by_severity ?? {};

  return (
    <Card className="bg-surface-raised/50 border-border-subtle/50 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertCircle className="size-5 text-amber-400" />
            Findings
            {total > 0 && (
              <Badge
                variant="outline"
                className="border-amber-500/30 bg-amber-500/10 text-amber-400"
              >
                {total}
              </Badge>
            )}
          </CardTitle>
          {total > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("/runs/findings")}
            >
              View All <ArrowRight className="size-4 ml-1" />
            </Button>
          )}
        </div>
      </CardHeader>
      {isRunnerOffline && (
        <div className="px-2 mb-2">
          <RunnerPartialState message="Runner offline — showing historical findings" />
        </div>
      )}
      <CardContent className="pt-0">
        {total === 0 ? (
          <p className="text-sm text-text-muted py-4 text-center">
            No findings detected
          </p>
        ) : (
          <div className="flex gap-3">
            {bySeverity["critical"] && (
              <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
                <span className="text-lg font-bold text-red-400">
                  {bySeverity["critical"]}
                </span>
                <span className="text-xs text-red-400">Critical</span>
              </div>
            )}
            {bySeverity["high"] && (
              <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-orange-500/10 border border-orange-500/20">
                <span className="text-lg font-bold text-orange-400">
                  {bySeverity["high"]}
                </span>
                <span className="text-xs text-orange-400">High</span>
              </div>
            )}
            {bySeverity["medium"] && (
              <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                <span className="text-lg font-bold text-yellow-400">
                  {bySeverity["medium"]}
                </span>
                <span className="text-xs text-yellow-400">Medium</span>
              </div>
            )}
            {bySeverity["low"] && (
              <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <span className="text-lg font-bold text-blue-400">
                  {bySeverity["low"]}
                </span>
                <span className="text-xs text-blue-400">Low</span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function QuickActionsCard() {
  const router = useRouter();

  const actions = [
    {
      label: "Execute Workflow",
      description: "Run a workflow on the runner",
      icon: <Play className="size-5" />,
      route: "/execute",
      color: "text-green-400",
      bgColor: "bg-green-500/10 hover:bg-green-500/20 border-green-500/20",
    },
    {
      label: "Build Workflow",
      description: "Create or edit workflows",
      icon: <Workflow className="size-5" />,
      route: "/build/workflows",
      color: "text-brand-secondary",
      bgColor:
        "bg-brand-secondary/10 hover:bg-brand-secondary/20 border-brand-secondary/20",
    },
    {
      label: "View Runs",
      description: "Browse run history",
      icon: <History className="size-5" />,
      route: "/runs",
      color: "text-brand-primary",
      bgColor:
        "bg-brand-primary/10 hover:bg-brand-primary/20 border-brand-primary/20",
    },
    {
      label: "Asset Library",
      description: "Browse all assets",
      icon: <Layers className="size-5" />,
      route: "/build/library",
      color: "text-purple-400",
      bgColor: "bg-purple-500/10 hover:bg-purple-500/20 border-purple-500/20",
    },
  ];

  return (
    <Card className="bg-surface-raised/50 border-border-subtle/50 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Quick Actions</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-2 gap-3">
          {actions.map((action) => (
            <button
              key={action.route}
              onClick={() => router.push(action.route)}
              className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${action.bgColor}`}
            >
              <span className={action.color}>{action.icon}</span>
              <div className="text-left">
                <p className="text-sm font-medium text-text-primary">
                  {action.label}
                </p>
                <p className="text-xs text-text-muted">{action.description}</p>
              </div>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
    }
  }, [user, authLoading, router]);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  }, []);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="size-8 animate-spin text-brand-primary mx-auto mb-4" />
          <div className="text-lg text-muted-foreground">Loading...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white">
      <main className="p-6 max-w-7xl mx-auto">
        {/* Welcome Section */}
        <div className="mb-8">
          <h2 className="text-3xl font-bold mb-2">
            {greeting}, {user.full_name || user.username}
          </h2>
          <p className="text-text-muted">
            Qontinui Runner Companion — manage workflows, monitor runs, and
            analyze results
          </p>
        </div>

        {/* Runner Connection */}
        <div className="mb-6">
          <RunnerConnectionCard />
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <ActiveRunsCard />
          <RecentRunsCard />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <FindingsSummaryCard />
          <QuickActionsCard />
        </div>
      </main>
    </div>
  );
}
