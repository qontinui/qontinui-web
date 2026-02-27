"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Inbox, CheckCircle2, History, Rocket, WifiOff } from "lucide-react";

export function IdleState({ isOffline = false }: { isOffline?: boolean }) {
  const router = useRouter();

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center space-y-6 max-w-md">
        <div className="relative mx-auto w-20 h-20">
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-brand-primary/20 to-violet-500/20 animate-pulse" />
          <div className="absolute inset-2 rounded-full bg-surface-raised/80 flex items-center justify-center">
            <Inbox className="size-8 text-text-muted" />
          </div>
        </div>
        <div>
          <h3 className="text-lg font-medium text-text-secondary mb-2">
            No Active Runs
          </h3>
          <p className="text-sm text-text-muted">
            {isOffline
              ? "Connect a runner and start a workflow to see the live dashboard."
              : "Start a workflow to see the live dashboard, or view your run history."}
          </p>
        </div>
        {isOffline && (
          <div className="flex items-center justify-center gap-2 text-xs text-amber-400/80">
            <WifiOff className="size-3.5" />
            <span>Runner not connected</span>
          </div>
        )}
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="outline"
            onClick={() => router.push("/runs")}
            className="gap-2"
          >
            <History className="size-4" />
            Run History
          </Button>
          <Button
            onClick={() => router.push("/build/workflows")}
            className="gap-2 bg-brand-primary hover:bg-brand-primary/90"
          >
            <Rocket className="size-4" />
            Run Workflow
          </Button>
        </div>
      </div>
    </div>
  );
}

export function CompletedState({ lastRunId }: { lastRunId: string }) {
  const router = useRouter();

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center space-y-4">
        <CheckCircle2 className="size-12 text-emerald-400 mx-auto" />
        <h3 className="text-lg font-medium text-text-secondary">
          Run Completed
        </h3>
        <p className="text-sm text-text-muted">
          The workflow has finished running.
        </p>
        <Button onClick={() => router.push(`/runs/${lastRunId}`)}>
          View Results
        </Button>
      </div>
    </div>
  );
}
