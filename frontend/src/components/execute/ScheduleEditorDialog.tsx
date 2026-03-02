"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Calendar } from "lucide-react";
import type { ScheduledTask } from "@/lib/runner/types/scheduler";
import { useScheduleForm } from "./_hooks/useScheduleForm";
import { WorkflowSelector } from "./_components/WorkflowSelector";
import { ScheduleTypeSelector } from "./_components/ScheduleTypeSelector";
import { ConditionsSection } from "./_components/ConditionsSection";
import { TaskOptionsSection } from "./_components/TaskOptionsSection";
import { DialogActions } from "./_components/DialogActions";

interface ScheduleEditorDialogProps {
  open: boolean;
  onClose: () => void;
  editingTask?: ScheduledTask;
  onSaved: () => void;
}

export function ScheduleEditorDialog({
  open,
  onClose,
  editingTask,
  onSaved,
}: ScheduleEditorDialogProps) {
  const form = useScheduleForm(open, editingTask, onSaved);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
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

      <Card className="relative z-10 w-full max-w-xl max-h-[90vh] overflow-y-auto bg-surface-raised border-border-subtle/50 shadow-2xl">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base text-text-primary flex items-center gap-2">
            <Calendar className="size-4" />
            {editingTask ? "Edit Scheduled Task" : "New Scheduled Task"}
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
          <div className="space-y-1.5">
            <label
              htmlFor="sed-task-name"
              className="text-sm font-medium text-text-muted"
            >
              Task Name
            </label>
            <Input
              id="sed-task-name"
              placeholder="e.g., Daily regression test"
              value={form.name}
              onChange={(e) => form.setName(e.target.value)}
              className="bg-surface-canvas/50 border-border-subtle/50"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="sed-description"
              className="text-sm font-medium text-text-muted"
            >
              Description <span className="text-text-muted/50">(optional)</span>
            </label>
            <textarea
              id="sed-description"
              placeholder="What does this scheduled task do?"
              value={form.description}
              onChange={(e) => form.setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-border-subtle/50 bg-surface-canvas/50 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-brand-primary/50 resize-none"
            />
          </div>

          <WorkflowSelector
            workflowName={form.workflowName}
            setWorkflowName={form.setWorkflowName}
            workflowSearch={form.workflowSearch}
            setWorkflowSearch={form.setWorkflowSearch}
            filteredWorkflows={form.filteredWorkflows}
            workflowsLoading={form.workflowsLoading}
          />

          <ScheduleTypeSelector
            scheduleType={form.scheduleType}
            setScheduleType={form.setScheduleType}
            onceDateTime={form.onceDateTime}
            setOnceDateTime={form.setOnceDateTime}
            cronExpression={form.cronExpression}
            setCronExpression={form.setCronExpression}
            intervalAmount={form.intervalAmount}
            setIntervalAmount={form.setIntervalAmount}
            intervalUnit={form.intervalUnit}
            setIntervalUnit={form.setIntervalUnit}
          />

          <ConditionsSection
            showConditions={form.showConditions}
            setShowConditions={form.setShowConditions}
            requireIdle={form.requireIdle}
            setRequireIdle={form.setRequireIdle}
            timeoutMinutes={form.timeoutMinutes}
            setTimeoutMinutes={form.setTimeoutMinutes}
          />

          <TaskOptionsSection
            autoFixOnFailure={form.autoFixOnFailure}
            setAutoFixOnFailure={form.setAutoFixOnFailure}
            skipIfCompleted={form.skipIfCompleted}
            setSkipIfCompleted={form.setSkipIfCompleted}
          />

          <DialogActions
            isEditing={!!editingTask}
            isSaving={form.isSaving}
            canSave={!!form.name.trim() && !!form.workflowName}
            onCancel={onClose}
            onSave={form.handleSave}
          />
        </CardContent>
      </Card>
    </div>
  );
}
