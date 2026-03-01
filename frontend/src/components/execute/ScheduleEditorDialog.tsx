"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  X,
  Calendar,
  Clock,
  Repeat,
  Search,
  Workflow,
  ChevronDown,
  ChevronUp,
  Loader2,
  Save,
} from "lucide-react";
import { useUnifiedWorkflows } from "@/lib/api/unified-workflows";
import {
  useCreateScheduledTask,
  updateScheduledTask,
} from "@/lib/runner/hooks/scheduler-hooks";
import type {
  ScheduledTask,
  ScheduleExpression,
  CreateScheduledTaskRequest,
  ScheduleConditions,
} from "@/lib/runner/types/scheduler";
import { toast } from "sonner";

// =============================================================================
// Props
// =============================================================================

interface ScheduleEditorDialogProps {
  open: boolean;
  onClose: () => void;
  editingTask?: ScheduledTask;
  onSaved: () => void;
}

// =============================================================================
// Schedule type helpers
// =============================================================================

type ScheduleType = "once" | "cron" | "interval";
type IntervalUnit = "minutes" | "hours" | "days";

function getScheduleType(schedule?: ScheduleExpression): ScheduleType {
  if (!schedule) return "once";
  switch (schedule.type) {
    case "Once":
      return "once";
    case "Cron":
      return "cron";
    case "Interval":
      return "interval";
  }
}

function getIntervalValues(seconds: number): {
  amount: number;
  unit: IntervalUnit;
} {
  if (seconds >= 86400 && seconds % 86400 === 0) {
    return { amount: seconds / 86400, unit: "days" };
  }
  if (seconds >= 3600 && seconds % 3600 === 0) {
    return { amount: seconds / 3600, unit: "hours" };
  }
  return { amount: Math.max(1, Math.round(seconds / 60)), unit: "minutes" };
}

function intervalToSeconds(amount: number, unit: IntervalUnit): number {
  switch (unit) {
    case "minutes":
      return amount * 60;
    case "hours":
      return amount * 3600;
    case "days":
      return amount * 86400;
  }
}

// Format a date string for datetime-local input
function toDateTimeLocal(iso?: string): string {
  if (!iso) {
    // Default: 1 hour from now
    const d = new Date(Date.now() + 3600_000);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

// =============================================================================
// Component
// =============================================================================

export function ScheduleEditorDialog({
  open,
  onClose,
  editingTask,
  onSaved,
}: ScheduleEditorDialogProps) {
  const isEditing = !!editingTask;

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [workflowName, setWorkflowName] = useState("");
  const [workflowSearch, setWorkflowSearch] = useState("");
  const [scheduleType, setScheduleType] = useState<ScheduleType>("once");
  const [onceDateTime, setOnceDateTime] = useState(() => toDateTimeLocal());
  const [cronExpression, setCronExpression] = useState("0 9 * * *");
  const [intervalAmount, setIntervalAmount] = useState(30);
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>("minutes");
  const [showConditions, setShowConditions] = useState(false);
  const [requireIdle, setRequireIdle] = useState(false);
  const [timeoutMinutes, setTimeoutMinutes] = useState<number | "">(0);
  const [autoFixOnFailure, setAutoFixOnFailure] = useState(false);
  const [skipIfCompleted, setSkipIfCompleted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Workflow data
  const { data: workflows, isLoading: workflowsLoading } =
    useUnifiedWorkflows();
  const { mutate: createTask } = useCreateScheduledTask();

  // Populate form when editing
  useEffect(() => {
    if (!open) return;

    if (editingTask) {
      setName(editingTask.name);
      setDescription(editingTask.description || "");
      setScheduleType(getScheduleType(editingTask.schedule));
      setAutoFixOnFailure(editingTask.auto_fix_on_failure);
      setSkipIfCompleted(editingTask.skip_if_completed);

      // Schedule-specific
      if (editingTask.schedule.type === "Once") {
        setOnceDateTime(toDateTimeLocal(editingTask.schedule.value));
      } else if (editingTask.schedule.type === "Cron") {
        setCronExpression(editingTask.schedule.value);
      } else if (editingTask.schedule.type === "Interval") {
        const { amount, unit } = getIntervalValues(editingTask.schedule.value);
        setIntervalAmount(amount);
        setIntervalUnit(unit);
      }

      // Task type
      if (editingTask.task.task_type === "Workflow") {
        setWorkflowName(editingTask.task.workflow_name);
      }

      // Conditions
      if (editingTask.conditions) {
        const hasConditions =
          editingTask.conditions.require_idle?.enabled ||
          (editingTask.conditions.timeout_minutes &&
            editingTask.conditions.timeout_minutes > 0);
        setShowConditions(!!hasConditions);
        setRequireIdle(editingTask.conditions.require_idle?.enabled || false);
        setTimeoutMinutes(editingTask.conditions.timeout_minutes || 0);
      } else {
        setShowConditions(false);
        setRequireIdle(false);
        setTimeoutMinutes(0);
      }
    } else {
      // Reset form for new task
      setName("");
      setDescription("");
      setWorkflowName("");
      setWorkflowSearch("");
      setScheduleType("once");
      setOnceDateTime(toDateTimeLocal());
      setCronExpression("0 9 * * *");
      setIntervalAmount(30);
      setIntervalUnit("minutes");
      setShowConditions(false);
      setRequireIdle(false);
      setTimeoutMinutes(0);
      setAutoFixOnFailure(false);
      setSkipIfCompleted(false);
    }
  }, [open, editingTask]);

  // Filtered workflows for selector
  const filteredWorkflows = useMemo(() => {
    if (!workflows) return [];
    if (!workflowSearch.trim()) return workflows;
    const q = workflowSearch.toLowerCase();
    return workflows.filter(
      (w) =>
        w.name.toLowerCase().includes(q) ||
        (w.description && w.description.toLowerCase().includes(q))
    );
  }, [workflows, workflowSearch]);

  // Build schedule expression
  function buildSchedule(): ScheduleExpression {
    switch (scheduleType) {
      case "once":
        return { type: "Once", value: new Date(onceDateTime).toISOString() };
      case "cron":
        return { type: "Cron", value: cronExpression };
      case "interval":
        return {
          type: "Interval",
          value: intervalToSeconds(intervalAmount, intervalUnit),
        };
    }
  }

  // Build conditions
  function buildConditions(): ScheduleConditions | undefined {
    if (
      !showConditions &&
      !requireIdle &&
      (!timeoutMinutes || timeoutMinutes === 0)
    ) {
      return undefined;
    }
    const conditions: ScheduleConditions = {};
    if (requireIdle) {
      conditions.require_idle = { enabled: true };
    }
    if (timeoutMinutes && timeoutMinutes > 0) {
      conditions.timeout_minutes = Number(timeoutMinutes);
    }
    return conditions;
  }

  // Save handler
  async function handleSave() {
    if (!name.trim()) {
      toast.error("Task name is required");
      return;
    }
    if (!workflowName) {
      toast.error("Please select a workflow");
      return;
    }

    setIsSaving(true);
    try {
      const schedule = buildSchedule();
      const conditions = buildConditions();

      if (isEditing && editingTask) {
        await updateScheduledTask(editingTask.id, {
          name: name.trim(),
          description: description.trim() || null,
          schedule,
          task: { task_type: "Workflow", workflow_name: workflowName },
          skip_if_completed: skipIfCompleted,
          auto_fix_on_failure: autoFixOnFailure,
          conditions: conditions || null,
        });
        toast.success("Schedule updated");
      } else {
        const request: CreateScheduledTaskRequest = {
          name: name.trim(),
          description: description.trim() || undefined,
          schedule,
          task: { task_type: "Workflow", workflow_name: workflowName },
          skip_if_completed: skipIfCompleted,
          auto_fix_on_failure: autoFixOnFailure,
          conditions,
        };
        await createTask(request);
        toast.success("Schedule created");
      }
      onSaved();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save schedule"
      );
    } finally {
      setIsSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        role="button"
        tabIndex={0}
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClose();
          }
        }}
      />

      {/* Dialog */}
      <Card className="relative z-10 w-full max-w-xl max-h-[90vh] overflow-y-auto bg-surface-raised border-border-subtle/50 shadow-2xl">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base text-text-primary flex items-center gap-2">
            <Calendar className="size-4" />
            {isEditing ? "Edit Scheduled Task" : "New Scheduled Task"}
          </CardTitle>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onClose}
          >
            <X className="size-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Task Name */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-text-muted">
              Task Name
            </label>
            <Input
              placeholder="e.g., Daily regression test"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-surface-canvas/50 border-border-subtle/50"
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-text-muted">
              Description <span className="text-text-muted/50">(optional)</span>
            </label>
            <textarea
              placeholder="What does this scheduled task do?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-border-subtle/50 bg-surface-canvas/50 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-brand-primary/50 resize-none"
            />
          </div>

          {/* Workflow Selector */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-text-muted">
              Workflow
            </label>
            {workflowName && (
              <div className="flex items-center gap-2 mb-2">
                <Badge
                  variant="outline"
                  className="bg-brand-primary/10 text-brand-primary border-brand-primary/30"
                >
                  <Workflow className="size-3 mr-1" />
                  {workflowName}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 text-text-muted hover:text-red-400"
                  onClick={() => setWorkflowName("")}
                >
                  <X className="size-3" />
                </Button>
              </div>
            )}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-text-muted" />
              <Input
                placeholder="Search workflows..."
                value={workflowSearch}
                onChange={(e) => setWorkflowSearch(e.target.value)}
                className="pl-8 h-8 bg-surface-canvas/50 border-border-subtle/50 text-xs"
              />
            </div>
            <div className="max-h-[140px] overflow-y-auto space-y-1 mt-1">
              {workflowsLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="size-4 animate-spin text-text-muted" />
                </div>
              ) : filteredWorkflows.length === 0 ? (
                <p className="text-xs text-text-muted text-center py-3">
                  No workflows found
                </p>
              ) : (
                filteredWorkflows.map((w) => (
                  <div
                    key={w.id}
                    className={`px-3 py-2 rounded-md text-xs cursor-pointer transition-colors ${
                      workflowName === w.name
                        ? "bg-brand-primary/10 border border-brand-primary/30 text-brand-primary"
                        : "bg-surface-canvas/30 border border-transparent hover:border-border-subtle text-text-secondary hover:text-text-primary"
                    }`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setWorkflowName(w.name)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setWorkflowName(w.name);
                      }
                    }}
                  >
                    <span className="font-medium">{w.name}</span>
                    {w.description && (
                      <p className="text-text-muted mt-0.5 line-clamp-1">
                        {w.description}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Schedule Type */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-text-muted">
              Schedule
            </label>
            <div className="flex gap-1">
              {(
                [
                  { key: "once", label: "One-time", icon: Calendar },
                  { key: "cron", label: "Cron", icon: Clock },
                  { key: "interval", label: "Interval", icon: Repeat },
                ] as const
              ).map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setScheduleType(key)}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
                    scheduleType === key
                      ? "bg-brand-primary/15 border-brand-primary/40 text-brand-primary"
                      : "bg-surface-canvas/30 border-border-subtle/30 text-text-muted hover:text-text-secondary hover:border-border-subtle"
                  }`}
                >
                  <Icon className="size-3.5" />
                  {label}
                </button>
              ))}
            </div>

            {/* One-time: date + time */}
            {scheduleType === "once" && (
              <div className="space-y-1.5 mt-2">
                <label className="text-xs text-text-muted">Date & Time</label>
                <Input
                  type="datetime-local"
                  value={onceDateTime}
                  onChange={(e) => setOnceDateTime(e.target.value)}
                  className="bg-surface-canvas/50 border-border-subtle/50 text-sm"
                />
              </div>
            )}

            {/* Cron */}
            {scheduleType === "cron" && (
              <div className="space-y-1.5 mt-2">
                <label className="text-xs text-text-muted">
                  Cron Expression
                </label>
                <Input
                  placeholder="0 9 * * *"
                  value={cronExpression}
                  onChange={(e) => setCronExpression(e.target.value)}
                  className="bg-surface-canvas/50 border-border-subtle/50 font-mono text-sm"
                />
                <p className="text-[11px] text-text-muted/70">
                  Format: minute hour day-of-month month day-of-week (e.g.,
                  &quot;0 9 * * *&quot; = daily at 9:00 AM)
                </p>
              </div>
            )}

            {/* Interval */}
            {scheduleType === "interval" && (
              <div className="space-y-1.5 mt-2">
                <label className="text-xs text-text-muted">Repeat Every</label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    min={1}
                    value={intervalAmount}
                    onChange={(e) =>
                      setIntervalAmount(
                        Math.max(1, parseInt(e.target.value) || 1)
                      )
                    }
                    className="w-24 bg-surface-canvas/50 border-border-subtle/50 text-sm"
                  />
                  <select
                    value={intervalUnit}
                    onChange={(e) =>
                      setIntervalUnit(e.target.value as IntervalUnit)
                    }
                    className="flex-1 rounded-md border border-border-subtle/50 bg-surface-canvas/50 px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/50"
                  >
                    <option value="minutes">Minutes</option>
                    <option value="hours">Hours</option>
                    <option value="days">Days</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Conditions (collapsible) */}
          <div className="space-y-2">
            <button
              onClick={() => setShowConditions(!showConditions)}
              className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-secondary transition-colors"
            >
              {showConditions ? (
                <ChevronUp className="size-3.5" />
              ) : (
                <ChevronDown className="size-3.5" />
              )}
              Show conditions
            </button>

            {showConditions && (
              <div className="space-y-3 border-l-2 border-border-subtle/30 ml-1 py-2 pl-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={requireIdle}
                    onChange={(e) => setRequireIdle(e.target.checked)}
                    className="rounded border-border-subtle"
                  />
                  <span className="text-sm text-text-secondary">
                    Require idle (no other tasks running)
                  </span>
                </label>

                <div className="space-y-1">
                  <label className="text-xs text-text-muted">
                    Timeout (minutes)
                  </label>
                  <Input
                    type="number"
                    min={0}
                    placeholder="0 = no timeout"
                    value={timeoutMinutes}
                    onChange={(e) =>
                      setTimeoutMinutes(
                        e.target.value === ""
                          ? ""
                          : Math.max(0, parseInt(e.target.value) || 0)
                      )
                    }
                    className="w-32 bg-surface-canvas/50 border-border-subtle/50 text-sm"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Checkboxes */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoFixOnFailure}
                onChange={(e) => setAutoFixOnFailure(e.target.checked)}
                className="rounded border-border-subtle"
              />
              <span className="text-sm text-text-secondary">
                Auto-fix on failure
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={skipIfCompleted}
                onChange={(e) => setSkipIfCompleted(e.target.checked)}
                className="rounded border-border-subtle"
              />
              <span className="text-sm text-text-secondary">
                Skip if already completed
              </span>
            </label>
          </div>

          {/* Actions */}
          <div className="flex gap-2 justify-end pt-2 border-t border-border-subtle/30">
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              variant="brand-primary"
              size="sm"
              onClick={handleSave}
              disabled={isSaving || !name.trim() || !workflowName}
            >
              {isSaving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="size-4" />
                  {isEditing ? "Update" : "Create"} Schedule
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
