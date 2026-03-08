"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  useRunnerHealth,
  runnerApi,
  type TaskRun,
  type PlanPhaseInput,
  type ExecutePlanRequest,
} from "@/lib/runner-api";
import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Loader2,
  ListOrdered,
  Plus,
  Trash2,
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  CalendarClock,
  FileJson,
  FileText,
  ChevronDown,
  ChevronRight,
  StopCircle,
  Zap,
  Timer,
} from "lucide-react";

// --- Helpers ----------------------------------------------------------------

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function formatDuration(startStr: string, endStr?: string | null): string {
  if (!endStr) return "in progress";
  const start = new Date(startStr).getTime();
  const end = new Date(endStr).getTime();
  const secs = Math.floor((end - start) / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function getStatusIcon(status: string) {
  switch (status) {
    case "running":
      return <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />;
    case "complete":
      return <CheckCircle2 className="w-4 h-4 text-green-400" />;
    case "failed":
      return <XCircle className="w-4 h-4 text-red-400" />;
    case "stopped":
      return <StopCircle className="w-4 h-4 text-amber-400" />;
    default:
      return <Clock className="w-4 h-4 text-text-muted" />;
  }
}

function getStatusBadgeVariant(
  status: string
): "success" | "destructive" | "info" | "warning" | "secondary" {
  switch (status) {
    case "complete":
      return "success";
    case "failed":
      return "destructive";
    case "running":
      return "info";
    case "stopped":
      return "warning";
    default:
      return "secondary";
  }
}

// --- Main component ---------------------------------------------------------

export default function RunPlanPage() {
  const { isOffline, isLoading: healthLoading } = useRunnerHealth();

  // Mode: form or json
  const [mode, setMode] = useState<"form" | "json">("form");

  // Form state
  const [planName, setPlanName] = useState("");
  const [planOverview, setPlanOverview] = useState("");
  const [phases, setPhases] = useState<PlanPhaseInput[]>([
    { name: "", prompt: "" },
  ]);
  const [nextStepsSweep, setNextStepsSweep] = useState(true);
  const [maxIterations, setMaxIterations] = useState(5);
  const [timeoutSeconds, setTimeoutSeconds] = useState<string>("");

  // JSON import state
  const [jsonInput, setJsonInput] = useState("");

  // Execution state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  // History state
  const [planHistory, setPlanHistory] = useState<TaskRun[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(true);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  // Poll plan history
  const fetchHistory = useCallback(async () => {
    try {
      const runs = await runnerApi.getTaskRuns({
        limit: 20,
        workflow_type: "plan",
      });
      setPlanHistory(runs);
    } catch {
      // Silently fail - history is non-critical
    }
  }, []);

  useEffect(() => {
    if (isOffline) return;
    setHistoryLoading(true);
    fetchHistory().finally(() => setHistoryLoading(false));

    pollRef.current = setInterval(fetchHistory, 10000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [isOffline, fetchHistory]);

  // Phase management
  const addPhase = useCallback(() => {
    setPhases((prev) => [...prev, { name: "", prompt: "" }]);
  }, []);

  const removePhase = useCallback((index: number) => {
    setPhases((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updatePhase = useCallback(
    (index: number, field: "name" | "prompt", value: string) => {
      setPhases((prev) =>
        prev.map((p, i) => (i === index ? { ...p, [field]: value } : p))
      );
    },
    []
  );

  // Validation
  const validateForm = useCallback((): string | null => {
    if (!planName.trim()) return "Plan name is required.";
    if (!planOverview.trim()) return "Plan overview is required.";
    if (phases.length === 0) return "At least one phase is required.";
    for (let i = 0; i < phases.length; i++) {
      if (!phases[i]!.name.trim()) return `Phase ${i + 1} name is required.`;
      if (!phases[i]!.prompt.trim())
        return `Phase ${i + 1} prompt is required.`;
    }
    if (
      timeoutSeconds &&
      (isNaN(Number(timeoutSeconds)) || Number(timeoutSeconds) < 1)
    ) {
      return "Timeout must be a positive number.";
    }
    return null;
  }, [planName, planOverview, phases, timeoutSeconds]);

  const validateJson = useCallback((): ExecutePlanRequest | string => {
    if (!jsonInput.trim()) return "JSON input is required.";
    try {
      const parsed = JSON.parse(jsonInput);
      if (!parsed.plan_name) return "Missing required field: plan_name";
      if (!parsed.plan_overview) return "Missing required field: plan_overview";
      if (!Array.isArray(parsed.phases) || parsed.phases.length === 0)
        return "phases must be a non-empty array";
      for (let i = 0; i < parsed.phases.length; i++) {
        if (!parsed.phases[i].name)
          return `Phase ${i + 1} missing 'name' field`;
        if (!parsed.phases[i].prompt)
          return `Phase ${i + 1} missing 'prompt' field`;
      }
      return {
        plan_name: parsed.plan_name,
        plan_overview: parsed.plan_overview,
        phases: parsed.phases.map((p: { name: string; prompt: string }) => ({
          name: p.name,
          prompt: p.prompt,
        })),
        next_steps_sweep: parsed.next_steps_sweep ?? true,
        max_next_steps_iterations: parsed.max_next_steps_iterations ?? 5,
        timeout_seconds: parsed.timeout_seconds ?? null,
      };
    } catch (e) {
      return `Invalid JSON: ${e instanceof Error ? e.message : "Parse error"}`;
    }
  }, [jsonInput]);

  // Submit plan
  const handleSubmit = useCallback(async () => {
    setSubmitError(null);
    setSubmitSuccess(null);

    let request: ExecutePlanRequest;

    if (mode === "form") {
      const error = validateForm();
      if (error) {
        setSubmitError(error);
        return;
      }
      request = {
        plan_name: planName.trim(),
        plan_overview: planOverview.trim(),
        phases: phases.map((p) => ({
          name: p.name.trim(),
          prompt: p.prompt.trim(),
        })),
        next_steps_sweep: nextStepsSweep,
        max_next_steps_iterations: maxIterations,
        timeout_seconds: timeoutSeconds ? Number(timeoutSeconds) : null,
      };
    } else {
      const result = validateJson();
      if (typeof result === "string") {
        setSubmitError(result);
        return;
      }
      request = result;
    }

    setIsSubmitting(true);
    try {
      const result = await runnerApi.executePlan(request);
      setSubmitSuccess(result.message || "Plan execution started.");
      // Refresh history after short delay
      setTimeout(fetchHistory, 2000);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Failed to execute plan"
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [
    mode,
    validateForm,
    validateJson,
    planName,
    planOverview,
    phases,
    nextStepsSweep,
    maxIterations,
    timeoutSeconds,
    fetchHistory,
  ]);

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
            <CalendarClock className="w-6 h-6 text-indigo-400 mr-3" />
            <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">
              Run Plan
            </h1>
          </div>
        </header>
        <main className="p-6 max-w-4xl mx-auto">
          <RunnerOfflineState message="Start the Qontinui Runner desktop app to create and execute run plans." />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white">
      {/* Header */}
      <header className="border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <CalendarClock className="w-6 h-6 text-indigo-400" />
            <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">
              Run Plan
            </h1>
          </div>
          <p className="text-sm text-text-muted">
            Create structured implementation plans with phases
          </p>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-6 max-w-3xl mx-auto space-y-6">
        {/* Mode Toggle */}
        <div className="flex items-center gap-2">
          <Button
            variant={mode === "form" ? "default" : "ghost"}
            size="sm"
            onClick={() => {
              setMode("form");
              setSubmitError(null);
            }}
            className={
              mode === "form"
                ? "bg-brand-primary hover:bg-brand-primary/90 text-black"
                : "text-text-muted hover:text-white"
            }
          >
            <FileText className="w-4 h-4 mr-1.5" />
            Form
          </Button>
          <Button
            variant={mode === "json" ? "default" : "ghost"}
            size="sm"
            onClick={() => {
              setMode("json");
              setSubmitError(null);
            }}
            className={
              mode === "json"
                ? "bg-brand-primary hover:bg-brand-primary/90 text-black"
                : "text-text-muted hover:text-white"
            }
          >
            <FileJson className="w-4 h-4 mr-1.5" />
            JSON Import
          </Button>
        </div>

        {/* Error/Success */}
        {submitError && (
          <div className="flex items-center gap-2 text-red-400 bg-red-950/20 border border-red-500/30 rounded-lg p-3">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <p className="text-sm">{submitError}</p>
          </div>
        )}
        {submitSuccess && (
          <div className="flex items-center gap-2 text-green-400 bg-green-950/20 border border-green-500/30 rounded-lg p-3">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <p className="text-sm">{submitSuccess}</p>
          </div>
        )}

        {mode === "form" ? (
          <>
            {/* Plan Metadata */}
            <Card className="bg-surface-raised/50 border-border-subtle/50">
              <CardHeader>
                <CardTitle className="text-lg text-white flex items-center gap-2">
                  <ListOrdered className="w-5 h-5" />
                  Plan Details
                </CardTitle>
                <CardDescription className="text-text-muted">
                  Define the plan name and overall goal
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-text-muted mb-1.5 block">
                    Plan Name <span className="text-red-400">*</span>
                  </label>
                  <Input
                    placeholder="e.g., Refactor authentication module"
                    value={planName}
                    onChange={(e) => setPlanName(e.target.value)}
                    className="bg-surface-raised/50 border-border-subtle/50 text-white placeholder:text-text-muted"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-text-muted mb-1.5 block">
                    Plan Overview <span className="text-red-400">*</span>
                  </label>
                  <Textarea
                    placeholder="Describe the overall goal and context for this plan..."
                    value={planOverview}
                    onChange={(e) => setPlanOverview(e.target.value)}
                    rows={3}
                    className="bg-surface-raised/50 border-border-subtle/50 text-white placeholder:text-text-muted resize-none"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Phases */}
            <Card className="bg-surface-raised/50 border-border-subtle/50">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg text-white flex items-center gap-2">
                      <Zap className="w-5 h-5" />
                      Phases
                    </CardTitle>
                    <CardDescription className="text-text-muted mt-1">
                      Each phase runs as a separate AI session. Add at least
                      one.
                    </CardDescription>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={addPhase}
                    className="text-brand-primary hover:text-brand-primary/80"
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    Add Phase
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {phases.map((phase, index) => (
                  <div
                    key={index}
                    className="p-4 rounded-lg border border-border-subtle/50 bg-surface-canvas/30 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <Badge variant="secondary" className="text-xs">
                        Phase {index + 1}
                      </Badge>
                      {phases.length > 1 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-text-muted hover:text-red-400"
                          onClick={() => removePhase(index)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                    <Input
                      placeholder="Phase name"
                      value={phase.name}
                      onChange={(e) =>
                        updatePhase(index, "name", e.target.value)
                      }
                      className="bg-surface-raised/50 border-border-subtle/50 text-white placeholder:text-text-muted"
                    />
                    <Textarea
                      placeholder="Describe what this phase should accomplish..."
                      value={phase.prompt}
                      onChange={(e) =>
                        updatePhase(index, "prompt", e.target.value)
                      }
                      rows={3}
                      className="bg-surface-raised/50 border-border-subtle/50 text-white placeholder:text-text-muted resize-none"
                    />
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Execution Options */}
            <Card className="bg-surface-raised/50 border-border-subtle/50">
              <CardHeader>
                <CardTitle className="text-base text-white flex items-center gap-2">
                  <Timer className="w-4 h-4" />
                  Execution Options
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-text-primary">
                      Next Steps Sweep
                    </p>
                    <p className="text-xs text-text-muted mt-0.5">
                      After all phases complete, run additional iterations to
                      catch overlooked items
                    </p>
                  </div>
                  <Switch
                    checked={nextStepsSweep}
                    onCheckedChange={setNextStepsSweep}
                  />
                </div>

                {nextStepsSweep && (
                  <div className="ml-4 border-l-2 border-border-subtle/50 pl-4">
                    <label className="text-sm font-medium text-text-muted mb-1.5 block">
                      Max Sweep Iterations
                    </label>
                    <Input
                      type="number"
                      min={1}
                      max={20}
                      value={maxIterations}
                      onChange={(e) =>
                        setMaxIterations(
                          Math.max(1, Math.min(20, Number(e.target.value) || 1))
                        )
                      }
                      className="bg-surface-raised/50 border-border-subtle/50 text-white w-24"
                    />
                    <p className="text-xs text-text-muted mt-1">Range: 1-20</p>
                  </div>
                )}

                <div>
                  <label className="text-sm font-medium text-text-muted mb-1.5 block">
                    Timeout per Session (seconds)
                  </label>
                  <Input
                    type="number"
                    min={1}
                    placeholder="Default (no timeout)"
                    value={timeoutSeconds}
                    onChange={(e) => setTimeoutSeconds(e.target.value)}
                    className="bg-surface-raised/50 border-border-subtle/50 text-white w-48 placeholder:text-text-muted"
                  />
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          /* JSON Import Mode */
          <Card className="bg-surface-raised/50 border-border-subtle/50">
            <CardHeader>
              <CardTitle className="text-lg text-white flex items-center gap-2">
                <FileJson className="w-5 h-5" />
                JSON Import
              </CardTitle>
              <CardDescription className="text-text-muted">
                Paste a pre-built JSON plan for execution
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                placeholder={`{
  "plan_name": "My Plan",
  "plan_overview": "What this plan does...",
  "phases": [
    { "name": "Phase 1", "prompt": "Do something..." },
    { "name": "Phase 2", "prompt": "Do something else..." }
  ],
  "next_steps_sweep": true,
  "max_next_steps_iterations": 5,
  "timeout_seconds": 300
}`}
                value={jsonInput}
                onChange={(e) => setJsonInput(e.target.value)}
                rows={15}
                className="bg-surface-raised/50 border-border-subtle/50 text-white placeholder:text-text-muted font-mono text-sm resize-none"
              />
            </CardContent>
          </Card>
        )}

        {/* Execute Button */}
        <Button
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="w-full bg-brand-primary hover:bg-brand-primary/90 text-black font-semibold py-6 text-base"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Submitting Plan...
            </>
          ) : (
            <>
              <Play className="w-5 h-5 mr-2" />
              Execute Plan
            </>
          )}
        </Button>

        {/* Plan Run History */}
        <div className="border-t border-border-subtle/30 pt-6">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center gap-2 text-text-muted hover:text-white transition-colors mb-4"
          >
            {showHistory ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
            <Clock className="w-4 h-4" />
            <span className="text-sm font-medium">Recent Plan Runs</span>
            {planHistory.length > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                {planHistory.length}
              </Badge>
            )}
          </button>

          {showHistory && (
            <div className="space-y-2">
              {historyLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
                </div>
              ) : planHistory.length === 0 ? (
                <div className="text-center py-8">
                  <CalendarClock className="w-8 h-8 mx-auto mb-2 text-text-muted" />
                  <p className="text-sm text-text-muted">
                    No plan runs yet. Create and execute a plan above.
                  </p>
                </div>
              ) : (
                planHistory.map((run) => (
                  <div
                    key={run.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
                      run.status === "running"
                        ? "border-blue-500/30 bg-blue-950/10"
                        : run.status === "complete"
                          ? "border-green-500/20 bg-green-950/5"
                          : run.status === "failed"
                            ? "border-red-500/20 bg-red-950/5"
                            : "border-border-subtle/50 bg-surface-canvas/30"
                    }`}
                  >
                    {/* Status icon */}
                    <div className="flex-shrink-0">
                      {getStatusIcon(run.status)}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate">
                        {run.task_name || run.workflow_name || "Unnamed Plan"}
                      </p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span data-content-role="metric" data-content-label="run time" className="text-xs text-text-muted">
                          {formatRelativeTime(run.created_at)}
                        </span>
                        <span data-content-role="metric" data-content-label="run duration" className="text-xs text-text-muted">
                          {formatDuration(run.created_at, run.completed_at)}
                        </span>
                        {run.sessions_count !== undefined &&
                          run.max_sessions !== undefined && (
                            <span data-content-role="metric" data-content-label="session count" className="text-xs text-text-muted">
                              {run.sessions_count}/{run.max_sessions} sessions
                            </span>
                          )}
                      </div>
                      {run.summary && (
                        <p className="text-xs text-text-muted mt-1 truncate">
                          {run.summary.slice(0, 120)}
                          {run.summary.length > 120 ? "..." : ""}
                        </p>
                      )}
                    </div>

                    {/* Status badge */}
                    <Badge
                      variant={getStatusBadgeVariant(run.status)}
                      className="text-[10px] flex-shrink-0"
                    >
                      {run.status}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
