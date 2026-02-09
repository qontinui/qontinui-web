"use client";

import { useRunnerHealth } from "@/lib/runner-api";
import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Clock,
  Calendar,
  Repeat,
  Zap,
  Play,
  Shield,
  Timer,
  AlertCircle,
  Loader2,
  Monitor,
} from "lucide-react";

export default function SchedulePage() {
  const { isOffline, isLoading: healthLoading } = useRunnerHealth();

  if (healthLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-text-muted" />
      </div>
    );
  }

  if (isOffline) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white">
        <header className="border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-50">
          <div className="flex items-center px-6 py-4">
            <Clock className="w-6 h-6 text-brand-primary mr-3" />
            <h1 className="text-2xl font-bold bg-gradient-to-r from-brand-primary to-emerald-400 bg-clip-text text-transparent">
              Scheduled Tasks
            </h1>
          </div>
        </header>
        <main className="p-6 max-w-4xl mx-auto">
          <RunnerOfflineState message="Start the Qontinui Runner desktop app to manage scheduled tasks." />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white">
      {/* Header */}
      <header className="border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <div className="flex items-center gap-3">
              <Clock className="w-6 h-6 text-brand-primary" />
              <h1 className="text-2xl font-bold bg-gradient-to-r from-brand-primary to-emerald-400 bg-clip-text text-transparent">
                Scheduled Tasks
              </h1>
              <Badge
                variant="outline"
                className="border-brand-primary/50 text-brand-primary"
              >
                Coming Soon
              </Badge>
            </div>
            <p className="text-sm text-text-muted mt-1 ml-9">
              Automate task execution on schedules, intervals, and conditions
            </p>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-6 max-w-4xl mx-auto space-y-6">
        {/* Feature Overview */}
        <Card className="bg-surface-raised/30 border-border-subtle/50">
          <CardHeader>
            <CardTitle className="text-lg text-white flex items-center gap-2">
              <Calendar className="w-5 h-5 text-brand-primary" />
              Schedule Types
            </CardTitle>
            <CardDescription className="text-text-muted">
              The runner scheduler supports multiple scheduling strategies
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-lg border border-border-subtle/30 bg-surface-canvas/20 p-4">
                <Calendar className="w-8 h-8 text-blue-400 mb-3" />
                <p className="text-sm font-medium text-text-primary">
                  Cron Schedules
                </p>
                <p className="text-xs text-text-muted mt-1">
                  Standard cron expressions for precise recurring schedules
                </p>
              </div>
              <div className="rounded-lg border border-border-subtle/30 bg-surface-canvas/20 p-4">
                <Play className="w-8 h-8 text-green-400 mb-3" />
                <p className="text-sm font-medium text-text-primary">
                  One-Time Runs
                </p>
                <p className="text-xs text-text-muted mt-1">
                  Schedule a single execution at a specific date and time
                </p>
              </div>
              <div className="rounded-lg border border-border-subtle/30 bg-surface-canvas/20 p-4">
                <Repeat className="w-8 h-8 text-purple-400 mb-3" />
                <p className="text-sm font-medium text-text-primary">
                  Interval-Based
                </p>
                <p className="text-xs text-text-muted mt-1">
                  Repeat at fixed intervals (e.g., every 30 minutes, every 2
                  hours)
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Task Types */}
        <Card className="bg-surface-raised/30 border-border-subtle/50">
          <CardHeader>
            <CardTitle className="text-lg text-white flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-400" />
              Task Types
            </CardTitle>
            <CardDescription className="text-text-muted">
              Different task types that can be scheduled for execution
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-lg border border-border-subtle/30 bg-surface-canvas/20 p-4">
                <Play className="w-6 h-6 text-brand-primary mb-2" />
                <p className="text-sm font-medium text-text-primary">
                  Workflow
                </p>
                <p className="text-xs text-text-muted mt-1">
                  Execute a saved unified workflow with all its phases
                </p>
              </div>
              <div className="rounded-lg border border-border-subtle/30 bg-surface-canvas/20 p-4">
                <Zap className="w-6 h-6 text-amber-400 mb-2" />
                <p className="text-sm font-medium text-text-primary">Prompt</p>
                <p className="text-xs text-text-muted mt-1">
                  Run an AI prompt as a scheduled task with full context
                </p>
              </div>
              <div className="rounded-lg border border-border-subtle/30 bg-surface-canvas/20 p-4">
                <Shield className="w-6 h-6 text-red-400 mb-2" />
                <p className="text-sm font-medium text-text-primary">
                  Auto-Fix
                </p>
                <p className="text-xs text-text-muted mt-1">
                  Periodically scan logs for errors and trigger automated fixes
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Conditions */}
        <Card className="bg-surface-raised/30 border-border-subtle/50">
          <CardHeader>
            <CardTitle className="text-lg text-white flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-sky-400" />
              Execution Conditions
            </CardTitle>
            <CardDescription className="text-text-muted">
              Optional conditions that must be met before a scheduled task runs
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-lg border border-border-subtle/30 bg-surface-canvas/20 p-4">
                <Timer className="w-6 h-6 text-sky-400 mb-2" />
                <p className="text-sm font-medium text-text-primary">
                  Require Idle
                </p>
                <p className="text-xs text-text-muted mt-1">
                  Only run when no other tasks are currently executing
                </p>
              </div>
              <div className="rounded-lg border border-border-subtle/30 bg-surface-canvas/20 p-4">
                <Clock className="w-6 h-6 text-orange-400 mb-2" />
                <p className="text-sm font-medium text-text-primary">
                  Repo Inactivity
                </p>
                <p className="text-xs text-text-muted mt-1">
                  Wait for a period of no repository changes before running
                </p>
              </div>
              <div className="rounded-lg border border-border-subtle/30 bg-surface-canvas/20 p-4">
                <AlertCircle className="w-6 h-6 text-red-400 mb-2" />
                <p className="text-sm font-medium text-text-primary">Timeout</p>
                <p className="text-xs text-text-muted mt-1">
                  Automatically cancel the task if it exceeds a time limit
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Desktop Runner Note */}
        <Card className="bg-surface-raised/30 border-border-subtle/50">
          <CardContent className="py-6">
            <div className="flex items-start gap-4">
              <Monitor className="w-8 h-8 text-text-muted flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-text-primary">
                  Manage Schedules in the Desktop Runner
                </p>
                <p className="text-sm text-text-muted mt-1">
                  Scheduled tasks can currently be configured and managed
                  directly in the Qontinui Runner desktop application. The web
                  management UI will support full create, edit, and delete
                  operations once the runner HTTP endpoints are available.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
