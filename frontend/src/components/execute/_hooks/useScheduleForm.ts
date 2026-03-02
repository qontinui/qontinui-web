"use client";

import { useState, useEffect, useMemo } from "react";
import { useUnifiedWorkflows } from "@/lib/api/unified-workflows";
import {
  useCreateScheduledTask,
  updateScheduledTask,
} from "@/lib/runner/hooks/scheduler-hooks";
import type { ScheduledTask } from "@/lib/runner/types/scheduler";
import { toast } from "sonner";
import {
  type ScheduleFormState,
  getScheduleType,
  getIntervalValues,
  toDateTimeLocal,
  buildSchedule,
  buildConditions,
} from "../_types/schedule-editor";

export function useScheduleForm(
  open: boolean,
  editingTask: ScheduledTask | undefined,
  onSaved: () => void
): ScheduleFormState {
  const isEditing = !!editingTask;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [workflowName, setWorkflowName] = useState("");
  const [workflowSearch, setWorkflowSearch] = useState("");
  const [scheduleType, setScheduleType] = useState<
    "once" | "cron" | "interval"
  >("once");
  const [onceDateTime, setOnceDateTime] = useState(() => toDateTimeLocal());
  const [cronExpression, setCronExpression] = useState("0 9 * * *");
  const [intervalAmount, setIntervalAmount] = useState(30);
  const [intervalUnit, setIntervalUnit] = useState<
    "minutes" | "hours" | "days"
  >("minutes");
  const [showConditions, setShowConditions] = useState(false);
  const [requireIdle, setRequireIdle] = useState(false);
  const [timeoutMinutes, setTimeoutMinutes] = useState<number | "">(0);
  const [autoFixOnFailure, setAutoFixOnFailure] = useState(false);
  const [skipIfCompleted, setSkipIfCompleted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const { data: workflows, isLoading: workflowsLoading } =
    useUnifiedWorkflows();
  const { mutate: createTask } = useCreateScheduledTask();

  useEffect(() => {
    if (!open) return;

    if (editingTask) {
      setName(editingTask.name);
      setDescription(editingTask.description || "");
      setScheduleType(getScheduleType(editingTask.schedule));
      setAutoFixOnFailure(editingTask.auto_fix_on_failure);
      setSkipIfCompleted(editingTask.skip_if_completed);

      if (editingTask.schedule.type === "Once") {
        setOnceDateTime(toDateTimeLocal(editingTask.schedule.value));
      } else if (editingTask.schedule.type === "Cron") {
        setCronExpression(editingTask.schedule.value);
      } else if (editingTask.schedule.type === "Interval") {
        const { amount, unit } = getIntervalValues(editingTask.schedule.value);
        setIntervalAmount(amount);
        setIntervalUnit(unit);
      }

      if (editingTask.task.task_type === "Workflow") {
        setWorkflowName(editingTask.task.workflow_name);
      }

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
      const schedule = buildSchedule(
        scheduleType,
        onceDateTime,
        cronExpression,
        intervalAmount,
        intervalUnit
      );
      const conditions = buildConditions(
        showConditions,
        requireIdle,
        timeoutMinutes
      );

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
        await createTask({
          name: name.trim(),
          description: description.trim() || undefined,
          schedule,
          task: { task_type: "Workflow", workflow_name: workflowName },
          skip_if_completed: skipIfCompleted,
          auto_fix_on_failure: autoFixOnFailure,
          conditions,
        });
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

  return {
    name,
    setName,
    description,
    setDescription,
    workflowName,
    setWorkflowName,
    workflowSearch,
    setWorkflowSearch,
    scheduleType,
    setScheduleType,
    onceDateTime,
    setOnceDateTime,
    cronExpression,
    setCronExpression,
    intervalAmount,
    setIntervalAmount,
    intervalUnit,
    setIntervalUnit,
    showConditions,
    setShowConditions,
    requireIdle,
    setRequireIdle,
    timeoutMinutes,
    setTimeoutMinutes,
    autoFixOnFailure,
    setAutoFixOnFailure,
    skipIfCompleted,
    setSkipIfCompleted,
    isSaving,
    filteredWorkflows,
    workflowsLoading,
    handleSave,
  };
}
